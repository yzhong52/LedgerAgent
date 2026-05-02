import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import type { Page } from 'playwright';
import * as fs from 'fs/promises';
import { BROWSER_TOOL, SUCCESS_TOOL } from './tools';
export { SUCCESS_TOOL } from './tools';
import { LOGS_DIR } from '../db';
import { keychainLoadApiKey } from '../keychain';

export const MODEL = 'claude-sonnet-4-6';
export const MAX_TURNS = 20;
export const DEBUG = process.env.DEBUG === '1';
export const VERBOSE = process.env.VERBOSE === '1' || DEBUG;
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

// T is the task's return type — e.g. Account[] for exploreAccounts, void for login.
// onTool returns either a plain string (tool result fed back to Claude) or
// toolDone(value) to signal completion and carry the final value out of the loop.
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
): Promise<T> {
  const initialSnapshot = await page.locator('body').ariaSnapshot();
  const messages: MessageParam[] = [{
    role: 'user',
    content: `${initialMessage}\n\nCurrent page state:\n${initialSnapshot}`,
  }];
  const hostSlug = new URL(page.url()).hostname.replace(/\./g, '_');
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const sessionDir = `${LOGS_DIR}/${hostSlug}_${date}_${time}`;
  let snapCount = 0;
  await fs.mkdir(sessionDir, { recursive: true });

  const logFile = `${sessionDir}/conversation.md`;
  await fs.writeFile(logFile,
    `# ${hostSlug} ${date} ${time}\n\n## System Prompt\n\n${systemPrompt}\n\n## Initial State\n\n${messages[0].content}\n`,
  );

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      tool_choice: { type: 'any' },
      messages,
    });

    const toolCallLog = response.content
      .filter((b): b is ToolUseBlock => b.type === 'tool_use')
      .map(t => `**→ ${t.name}** \`${JSON.stringify(t.input)}\``)
      .join('\n\n');
    await fs.appendFile(logFile, `\n---\n\n## Turn ${turn + 1}\n\n${toolCallLog}\n`);

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
          console.log(`🔄 ${turn + 1}/${MAX_TURNS} 💬 ${toolUse.name}`, toolUse.input);
        } else {
          console.log(`🔄 ${turn + 1}/${MAX_TURNS} 💬 ${toolUse.name}`);
        }

        let output = '';
        try {
          const r = await onTool(toolUse.name, toolUse.input as Record<string, unknown>, page);
          if (isDone(r)) {
            toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: r.content });
            result = { value: r.value };
          } else {
            output = r;
            const preview = output.length > 240 ? output.slice(0, 240) + '…' : output;
            if (toolUse.name === BROWSER_TOOL.GET_INPUTS) {
              if (VERBOSE) console.log(`🔧 Inputs retrieved:\n${preview}`);
              else console.log(`🔧 Inputs retrieved`);
            } else {
              console.log(`🔧 ${preview}`);
            }
          }
        } catch (err) {
          output = `error: ${err instanceof Error ? err.message : String(err)}`;
          if (VERBOSE) {
            const preview = output.length > 480 ? output.slice(0, 480) + '…' : output;
            // Playwright errors contain ANSI colour codes; '\x1b[0m' prevents colour bleed.
            console.log(`❌ ${preview}\x1b[0m`);
          } else {
            const errorType = err instanceof Error ? err.constructor.name : String(err);
            console.log(`❌ ${errorType}`);
          }
        }

        if (!result) {
          // Automatically append current page state so Claude always has fresh context
          // without needing to call snapshot explicitly.
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
          const snapFile = `${sessionDir}/${String(++snapCount).padStart(3, '0')}.txt`;
          await fs.writeFile(snapFile, snap);
          await pruneSessionsForHost(hostSlug);
          if (VERBOSE) {
            const preview = snap.length > 240 ? snap.slice(0, 240) + '…' : snap;
            console.log(`📸 Snapshot:\n${preview}\nFull: ${snapFile}`);
          } else {
            console.log(`📸 Snapshot`);
          }
          output += `\n\nCurrent page state:\n${snap}`;

          if (DEBUG) await new Promise(resolve => setTimeout(resolve, 1000));
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
        }
      } else {
        // The API requires a tool_result for every tool_use in the conversation history,
        // even for tool calls that came after the terminal tool in the same response.
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'skipped' });
      }
    }

    const toolNameById = new Map(toolUses.map(t => [t.id, t.name]));
    const resultsLog = toolResults
      .filter(r => r.content !== 'skipped')
      .map(r => `**← ${toolNameById.get(r.tool_use_id) ?? r.tool_use_id}:** ${r.content}`)
      .join('\n\n');
    if (resultsLog) await fs.appendFile(logFile, `\n${resultsLog}\n`);

    messages.push({ role: 'user', content: toolResults });

    if (result) return result.value;
  }

  throw new Error(`agent did not complete within ${MAX_TURNS} turns`);
}
