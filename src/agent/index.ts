import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import type { Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BROWSER_TOOL, SUCCESS_TOOL } from './tools';
import { redact } from './redact';
export { SUCCESS_TOOL } from './tools';
import { LOGS_DIR } from '../db';
import { keychainLoadApiKey } from '../keychain';

export const MODEL = 'claude-sonnet-4-6';
export const MAX_TURNS = 20;
export const VERBOSE = process.env.VERBOSE === '1';
const MAX_SESSIONS_PER_HOST = 10;


let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = keychainLoadApiKey() ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error(
      'Anthropic API key not found. Run: npm run cli -- config anthropic',
    );
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export interface ToolDone<T> {
  done: true;
  value: T;
  content: string;
}

export function toolDone<T>(value: T, content: string): ToolDone<T> {
  return { done: true, value, content };
}

function isDone<T>(r: string | ToolDone<T>): r is ToolDone<T> {
  return typeof r !== 'string';
}

function pageStateMessage(snapshot: string): { type: 'text'; text: string } {
  return { type: 'text', text: `Current page state:\n${snapshot}` };
}

function sessionHostSlug(folderName: string): string | null {
  const match = folderName.match(/^(.+)_\d{4}-\d{2}-\d{2}_\d{6}$/);
  return match ? match[1] : null;
}

async function pruneSessionsForHost(hostSlug: string): Promise<void> {
  const entries = await fs.readdir(LOGS_DIR, { withFileTypes: true }).catch(() => []);
  const folders = entries
    .filter(e => e.isDirectory() && sessionHostSlug(e.name) === hostSlug)
    .map(e => e.name)
    .sort()
    .reverse();

  for (const name of folders.slice(MAX_SESSIONS_PER_HOST)) {
    await fs.rm(`${LOGS_DIR}/${name}`, { recursive: true }).catch(() => {});
  }
}

export async function createSession(url: string): Promise<string> {
  const hostSlug = new URL(url).hostname.replace(/\./g, '_');
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const sessionDir = `${LOGS_DIR}/${hostSlug}_${date}_${time}`;
  await fs.mkdir(sessionDir, { recursive: true });
  await pruneSessionsForHost(hostSlug);
  return sessionDir;
}

// T is the task's return type — e.g. Account[] for exploreAccounts, void for login.
//
// systemPrompt: persistent instructions passed via the `system` API parameter, visible on every
//   turn but outside the conversation history. Holds task description and memory notes.
//   Example: "You are a browser agent. Use fill_credential to fill in credentials. Call success()
//   once the dashboard is visible."
//
// initialMessage: the first user-role message that starts the conversation, combined internally
//   with the initial ARIA snapshot of the page.
//   Example: "The browser has navigated to the login page."
//
// onTool: called for each tool use Claude returns. Return a plain string to feed the result back
//   to Claude, or toolDone(value) to signal completion and carry the final value out of the loop.
//
// sensitiveValues: exact strings to redact from snapshots, tool results, and logs before they
//   are sent back to the model or written to disk.
export async function runAgent<T>(
  page: Page,
  tools: Tool[],
  systemPrompt: string,
  initialMessage: string,
  onTool: (
    name: string,
    input: Record<string, unknown>,
    page: Page,
  ) => Promise<string | ToolDone<T>>,
  sessionDir: string,
  logName: string,
  sensitiveValues: string[] = [],
): Promise<T> {
  let snapCount = 0;
  const redactSensitive = (text: string) => redact(text, sensitiveValues);

  async function takeSnapshot(): Promise<string> {
    // Wait for the page to settle before snapshotting. Without this, a snapshot taken
    // immediately after a click (e.g. clicking Log In) captures the pre-navigation DOM
    // because domcontentloaded fires before the new page finishes rendering — causing the
    // agent to see the login page again and incorrectly infer that MFA is needed.
    // Timeout is intentionally short; if the page stays "busy" we snapshot anyway.
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
    let snap: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        snap = await page.locator('body').ariaSnapshot();
        break;
      } catch {
        if (attempt < 2) await new Promise(r => setTimeout(r, 500));
      }
    }
    if (snap === null) throw new Error('Could not snapshot page after 3 attempts');
    snap = redactSensitive(snap);
    const snapFile = `${sessionDir}/${String(++snapCount).padStart(3, '0')}.txt`;
    await fs.writeFile(snapFile, snap);
    if (VERBOSE) {
      const preview = snap.length > 240 ? snap.slice(0, 240) + '…' : snap;
      console.log(`📸 Snapshot:\n${preview}\nFull: ${snapFile}`);
    } else {
      console.log(`📸 Snapshot`);
    }
    return snap;
  }

  const messages: MessageParam[] = [{
    role: 'user',
    content: [{ type: 'text', text: initialMessage }, pageStateMessage(await takeSnapshot())],
  }];

  const logFile = `${sessionDir}/${logName}.md`;
  await fs.writeFile(logFile, `# ${path.basename(sessionDir)} — ${logName}\n\n## System Prompt\n\n${redactSensitive(systemPrompt)}\n\n`);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const lastMsg = messages[messages.length - 1];
    if (turn > 0) await fs.appendFile(logFile, '---\n\n');
    await fs.appendFile(logFile, `## Turn ${turn}\n\n`);
    await fs.appendFile(logFile, `### User → Agent\n\n`);
    await fs.appendFile(logFile, `\`\`\`json\n${redactSensitive(JSON.stringify(lastMsg.content, null, 2))}\n\`\`\`\n\n`);
    await fs.appendFile(logFile, `### Agent → User\n\n`);

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      tool_choice: { type: 'any' },
      messages,
    });

    await fs.appendFile(logFile, `\`\`\`json\n${redactSensitive(JSON.stringify(response.content, null, 2))}\n\`\`\`\n\n`);

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    // tool_choice: 'any' guarantees at least one tool call per response.
    if (toolUses.length === 0) throw new Error('unexpected: Claude returned no tool calls');

    const toolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];
    let result: { value: T } | undefined;

    for (const toolUse of toolUses) {
      if (!result) {
        if (toolUse.name === SUCCESS_TOOL) {
          console.log(`🔄 ${turn + 1}/${MAX_TURNS} 💬 Mission accomplished`);
        } else if (VERBOSE) {
          console.log(`🔄 ${turn + 1}/${MAX_TURNS} 💬 ${toolUse.name}`, redactSensitive(JSON.stringify(toolUse.input)));
        } else {
          console.log(`🔄 ${turn + 1}/${MAX_TURNS} 💬 ${toolUse.name}`);
        }

        let output = '';
        try {
          const r = await onTool(toolUse.name, toolUse.input as Record<string, unknown>, page);
          if (isDone(r)) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: redactSensitive(r.content),
            });
            result = { value: r.value };
          } else {
            output = redactSensitive(r);
            const preview = output.length > 240 ? output.slice(0, 240) + '…' : output;
            if (toolUse.name === BROWSER_TOOL.GET_INPUTS) {
              if (VERBOSE) console.log(`🔧 Inputs retrieved:\n${preview}`);
              else console.log(`🔧 Inputs retrieved`);
            } else {
              console.log(`🔧 ${preview}`);
            }
            toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
          }
        } catch (err) {
          output = redactSensitive(`error: ${err instanceof Error ? err.message : String(err)}`);
          if (VERBOSE) {
            const preview = output.length > 480 ? output.slice(0, 480) + '…' : output;
            // Playwright errors contain ANSI colour codes; '\x1b[0m' prevents colour bleed.
            console.log(`❌ ${preview}\x1b[0m`);
          } else {
            const errorType = err instanceof Error ? err.constructor.name : String(err);
            console.log(`❌ ${errorType}`);
          }
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
        }
      } else {
        // The API requires a tool_result for every tool_use in the conversation history,
        // even for tool calls that came after the terminal tool in the same response.
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'skipped' });
      }
    }

    if (!result) {
      // Take one snapshot after all tools in this turn complete, so Claude sees the
      // cumulative page state rather than intermediate states between tool calls.
      messages.push({ role: 'user', content: [...toolResults, pageStateMessage(await takeSnapshot())] });
    } else {
      return result.value;
    }
  }

  throw new Error(`agent did not complete within ${MAX_TURNS} turns`);
}
