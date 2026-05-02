import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock, MessageParam, Tool, ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import type { Page } from 'playwright';
import * as fs from 'fs/promises';
import { BROWSER_TOOL, SUCCESS_TOOL, STATE_CHANGING_TOOLS } from './tools';
import { normalizeSnapshot } from './utils/normalizeSnapshot';
import { PageCache } from './cache';
import { LOGS_DIR } from '../db';
import { keychainLoadApiKey } from '../keychain';

export { PageCache };

export const MODEL = 'claude-sonnet-4-6';
export const MAX_TURNS = 20;
export const DEBUG = process.env.DEBUG === '1';
export const VERBOSE = process.env.VERBOSE === '1' || DEBUG;
export { SUCCESS_TOOL };
const MAX_SESSIONS_PER_HOST = 10;

export function debug(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}

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

export interface RunAgentOptions {
  // A PageCache instance for cross-run snapshot caching. When provided, the agent
  // will replay cached actions for known pages instead of calling the API.
  // Optional so future tasks can opt out of caching if needed; all current tasks pass one.
  pageCache?: PageCache;
  // The initial page snapshot embedded in initialMessage. Seeding it here lets
  // the cache hit on turn 1 without waiting for an explicit snapshot tool call.
  initialSnapshot: string;
}

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
  options: RunAgentOptions,
): Promise<T> {
  const { pageCache, initialSnapshot } = options;
  const messages: MessageParam[] = [{ role: 'user', content: initialMessage }];
  const hostSlug = new URL(page.url()).hostname.replace(/\./g, '_');
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const sessionDir = `${LOGS_DIR}/${hostSlug}_${date}_${time}`;
  let snapCount = 0;
  await fs.mkdir(sessionDir, { recursive: true });

  // Snapshot pending for the next cache check. Seeded from initialSnapshot so
  // turn-1 can hit the cache without waiting for an explicit snapshot tool call.
  let pendingSnapshot: string | null = initialSnapshot;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Save snapshot reference before resetting, so replay-failure tracking
    // can reference the same value that was used for the cache lookup.
    const snapshotForCache = pendingSnapshot;
    pendingSnapshot = null;

    // --- Cache check / API call ---
    const cachedActions = pageCache && snapshotForCache !== null
      ? pageCache.check(snapshotForCache)
      : null;
    const replayIds = new Set<string>();
    let assistantContent: ContentBlock[];

    if (cachedActions) {
      assistantContent = cachedActions.map((action, i) => {
        const id = `cache_${turn}_${i}_${Date.now()}`;
        replayIds.add(id);
        return { type: 'tool_use' as const, id, name: action.name, input: action.input };
      });
      console.log(`⚡ Replay: ${cachedActions.map(a => a.name).join(', ')}`);
    } else {
      debug('\n── prompt to claude ──────────────────────────────');
      debug(JSON.stringify(messages[messages.length - 1], null, 2));
      debug('──────────────────────────────────────────────────\n');

      const response = await getClient().messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        // 'any' forces a tool call every turn — 'auto' would allow plain-text replies,
        // which would break the loop (line below throws if no tool calls are returned).
        tool_choice: { type: 'any' },
        messages,
      });

      assistantContent = response.content;

      // Record all tools Claude chose, keyed by the snapshot that prompted them.
      if (pageCache && snapshotForCache !== null) {
        const toolUses = assistantContent
          .filter((b): b is ToolUseBlock => b.type === 'tool_use')
          .map(t => ({ name: t.name, input: t.input as Record<string, unknown> }));
        if (toolUses.length > 0) pageCache.record(snapshotForCache, toolUses);
      }
    }

    messages.push({ role: 'assistant', content: assistantContent });

    const toolUses = assistantContent.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    // tool_choice: 'any' guarantees at least one tool call per response.
    if (toolUses.length === 0) throw new Error('unexpected: Claude returned no tool calls');

    const toolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];
    let result: { value: T } | undefined;
    let replayFailed = false;

    // Claude usually returns one tool call per turn for sequential browser interactions,
    // but the API allows multiple — we execute all of them and collect their results.
    for (const toolUse of toolUses) {
      // Stub any tool_use blocks that follow the terminal tool — the API requires
      // one tool_result per tool_use in the conversation history.
      if (result) {
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'skipped' });
        continue;
      }

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
          continue;
        }
        output = r;

        const preview = output.length > 240 ? output.slice(0, 240) + '…' : output;
        if (toolUse.name === BROWSER_TOOL.SNAPSHOT) {
          pendingSnapshot = output; // available for next turn's cache check
          const file = `${sessionDir}/${String(++snapCount).padStart(3, '0')}.txt`;
          await fs.writeFile(file, output);
          await pruneSessionsForHost(hostSlug);
          if (VERBOSE) console.log(`🔧 snapshot taken:\n${preview}\nSee full snapshot in ${file}`);
          else console.log(`🔧 Snapshot taken`);
        } else if (toolUse.name === BROWSER_TOOL.GET_INPUTS) {
          if (VERBOSE) console.log(`🔧 Inputs retrieved:\n${preview}`);
          else console.log(`🔧 Inputs retrieved`);
        } else {
          console.log(`🔧 ${preview}`);
          // Implicitly snapshot after state-changing actions so the next turn can
          // hit the cache without Claude needing to call snapshot explicitly first.
          if (pageCache && STATE_CHANGING_TOOLS.has(toolUse.name)) {
            try {
              const autoSnap = await page.locator('body').ariaSnapshot();
              // If the page structure didn't change, the action was a no-op for
              // caching purposes — invalidate the entry to prevent a replay loop.
              if (snapshotForCache !== null
                  && normalizeSnapshot(autoSnap) === normalizeSnapshot(snapshotForCache)) {
                pageCache.failSnapshot(snapshotForCache);
              } else {
                pendingSnapshot = autoSnap;
              }
            } catch {
              // Ignore — cache will just miss on the next turn
            }
          }
        }

      } catch (err) {
        output = `error: ${err instanceof Error ? err.message : String(err)}`;
        if (replayIds.has(toolUse.id)) replayFailed = true;
        if (VERBOSE) {
          const preview = output.length > 480 ? output.slice(0, 480) + '…' : output;
          // Playwright errors contain ANSI colour codes; '\x1b[0m' prevents colour bleed.
          console.log(`❌ ${preview}\x1b[0m`);
        } else {
          const errorType = err instanceof Error ? err.constructor.name : String(err);
          console.log(`❌ ${errorType}`);
        }
      }

      if (DEBUG) await new Promise(resolve => setTimeout(resolve, 1000));
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
    }

    // Invalidate this snapshot's cache entry for the remainder of the run so
    // the next iteration calls Claude instead of replaying the same bad action.
    if (replayFailed && snapshotForCache !== null && pageCache) {
      pageCache.failSnapshot(snapshotForCache);
      console.log('⚡ Replay failed — falling back to Claude');
    }

    messages.push({ role: 'user', content: toolResults });

    if (result) {
      await pageCache?.flush();
      return result.value;
    }
  }

  throw new Error(`agent did not complete within ${MAX_TURNS} turns`);
}
