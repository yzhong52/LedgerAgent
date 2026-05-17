import type { ContentBlockParam, MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages';
import type { Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BROWSER_TOOL, SUCCESS_TOOL } from './tools';
import { redact } from './redact';
export { SUCCESS_TOOL } from './tools';
import { LOGS_DIR } from '../db';
import { callWithTools } from './model_providers';

export const MAX_TURNS = 20;
export const SEPARATOR = '─'.repeat(60);

function briefInput(input: Record<string, unknown>): string {
  if (input.role && input.name) return `${input.role} "${input.name}"`;
  if (input.testId)   return `#${input.testId}`;
  if (input.text)     return `"${input.text}"`;
  if (input.selector) return `"${input.selector}"`;
  if (Array.isArray(input.transactions)) return `(${input.transactions.length} items)`;
  if (Array.isArray(input.accounts))     return `(${input.accounts.length} items)`;
  return '';
}
export const VERBOSE = process.env.VERBOSE === '1';
const MAX_SESSIONS_PER_HOST = 10;



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

// Replaces the snapshot block in archived user messages to save input tokens.
// Only the latest snapshot is useful to Claude; prior ones are dead weight.
const SNAPSHOT_PLACEHOLDER = { type: 'text' as const, text: '[snapshot]' };

function pageStateMessage(snap: string): { type: 'text'; text: string } {
  return { type: 'text', text: `Current page state:\n${snap}` };
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
  maxTurns: number,
  maxTokens: number,
  model: string,
): Promise<T> {
  let snapCount = 0;
  const redactSensitive = (text: string) => redact(text, sensitiveValues);
  const snapshotsDir = `${sessionDir}/snapshots`;
  await fs.mkdir(snapshotsDir, { recursive: true });

  async function takeSnapshot(): Promise<{ snap: string; snapFile: string }> {
    // Wait for the page to settle before snapshotting. Without this, a snapshot taken
    // immediately after a click (e.g. clicking Log In) captures the pre-navigation DOM
    // because domcontentloaded fires before the new page finishes rendering — causing the
    // agent to see the login page again and incorrectly infer that MFA is needed.
    // 8s covers slow SPA login API calls (e.g. Wealthsimple); if the page stays busy
    // past that we snapshot anyway rather than blocking indefinitely.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    let snap: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        snap = await page.locator('body').ariaSnapshot({ mode: 'ai' });
        break;
      } catch {
        if (attempt < 2) await new Promise(r => setTimeout(r, 500));
      }
    }
    if (snap === null) throw new Error('Could not snapshot page after 3 attempts');
    snap = redactSensitive(snap);
    const snapFile = `${snapshotsDir}/${String(++snapCount).padStart(3, '0')}.txt`;
    await fs.writeFile(snapFile, snap);
    if (VERBOSE) {
      const preview = snap.length > 240 ? snap.slice(0, 240) + '…' : snap;
      console.log(`📸 Snapshot:\n${preview}\nFull: ${snapFile}`);
    } else {
      console.log(`📸 Snapshot`);
    }
    return { snap, snapFile };
  }

  // messages holds compressed history. pendingPrefix is the non-snapshot content for the next
  // user turn (initial message block, or tool results). At the top of each turn a snapshot is
  // taken and appended to form the live userContent sent to the API; SNAPSHOT_PLACEHOLDER is
  // appended instead when archiving into messages.
  const messages: MessageParam[] = [];
  const initialBlock = { type: 'text' as const, text: initialMessage };
  let pendingPrefix: ContentBlockParam[] = [initialBlock];

  const logFile = `${sessionDir}/${logName}.md`;
  await fs.writeFile(logFile, `# ${path.basename(sessionDir)} — ${logName}\n\n## System Prompt\n\n${redactSensitive(systemPrompt)}\n\n`);

  for (let turn = 0; turn < maxTurns; turn++) {
    const { snap, snapFile } = await takeSnapshot();
    // API receives the full snapshot content; the log records the file path instead
    // so conversation logs stay readable without the full ARIA tree on every turn.
    const userContent = [...pendingPrefix, pageStateMessage(snap)];

    if (turn > 0) await fs.appendFile(logFile, '---\n\n');
    await fs.appendFile(logFile, `## Turn ${turn}\n\n`);
    await fs.appendFile(logFile, `### User → Agent\n\n`);
    await fs.appendFile(logFile, `\`\`\`json\n${redactSensitive(JSON.stringify([...pendingPrefix, pageStateMessage(snapFile)], null, 2))}\n\`\`\`\n\n`);

    const response = await callWithTools({
      model,
      maxTokens,
      system: systemPrompt,
      tools,
      messages,
      userContent,
    });

    await fs.appendFile(logFile, `### Agent → User\n\n`);
    await fs.appendFile(
      logFile,
      `\`\`\`json\n${redactSensitive(JSON.stringify(response.rawForLog, null, 2))}\n\`\`\`\n\n`,
    );

    // Archive with placeholder — the snapshot is only needed live; compressing it
    // here keeps the history lean for every subsequent turn's API call.
    messages.push({ role: 'user', content: [...pendingPrefix, SNAPSHOT_PLACEHOLDER] });
    messages.push({ role: 'assistant', content: response.assistantContent as MessageParam['content'] });

    const toolUses = response.toolUses;
    if (toolUses.length === 0) throw new Error('unexpected: model returned no tool calls');

    const toolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];
    let result: { value: T } | undefined;

    for (const toolUse of toolUses) {
      if (!result) {
        if (toolUse.name === SUCCESS_TOOL) {
          console.log(`🔄 ${turn + 1}/${maxTurns} 💬 Mission accomplished`);
        } else if (VERBOSE) {
          console.log(`🔄 ${turn + 1}/${maxTurns} 💬 ${toolUse.name}`, redactSensitive(JSON.stringify(toolUse.input)));
        } else {
          const brief = briefInput(toolUse.input as Record<string, unknown>);
          console.log(`🔄 ${turn + 1}/${maxTurns} 💬 ${toolUse.name}${brief ? ` ${brief}` : ''}`);
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
          // TODO: break retry loops — the model sometimes retries the same failing call
          // repeatedly even when the error is unrecoverable. Appending a "do not retry"
          // hint to the tool result was tried (tracking seen calls by toolName+input) but
          // didn't reliably stop the loop in practice because the model still found reasons
          // to retry given the full conversation history. Needs a better approach.
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
      // Store tool results as the prefix for the next turn; the snapshot is taken
      // at the top of that turn so it captures the final post-tool page state.
      pendingPrefix = toolResults;
    } else {
      return result.value;
    }
  }

  throw new Error(`agent did not complete within ${maxTurns} turns`);
}
