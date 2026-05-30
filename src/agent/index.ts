import type {
  ContentBlockParam,
  MessageParam,
  TextBlock,
  Tool,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import type { Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import { redact, type SensitiveValue } from './redact';
import { callWithTools, callForText } from './model_providers';
import type { ModelOptions } from './model_providers/types';
import {
  formatDuration,
  logSnapshot,
  logToolError,
  logToolResult,
  logToolUse,
} from './log_utils';
export { SUCCESS_TOOL } from './tools';
export { createSession, SEPARATOR } from './log_utils';

export const MAX_TURNS = 20;
const MAX_EMPTY_RETRIES = 3;

export interface ToolContinue {
  done: false;
  summary: string;
}

export interface ToolDone<T> {
  done: true;
  value: T;
  summary: string;
}

export function toolResult(summary: string): ToolContinue {
  return { done: false, summary };
}

export function toolDone<T>(value: T, summary: string): ToolDone<T> {
  return { done: true, value, summary };
}

function isDone<T>(r: ToolContinue | ToolDone<T>): r is ToolDone<T> {
  return r.done;
}


function pageStateMessage(snap: string, url: string): { type: 'text'; text: string } {
  return { type: 'text', text: `Current page state:\nURL: ${url}\n\n${snap}` };
}

// Waits for the page to settle, then polls until the DOM stabilises before snapshotting.
// See inline comments below for the rationale behind each wait.
async function takeSnapshot(
  page: Page,
  snapshotsDir: string,
  snapPrefix: string,
  snapCount: number,
  redactSensitive: (text: string) => string,
): Promise<{ snap: string; snapFile: string; url: string }> {
  const startMs = Date.now();
  // First wait: block until no network requests for 500ms (Playwright's networkidle definition).
  // Catches in-flight XHR/fetch from the triggering click before we read the DOM.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const ariaSnap = () => page.locator('body').ariaSnapshot({ mode: 'ai' });

  // ariaSnapshot can transiently fail mid-navigation; retry a few times before giving up.
  let snap: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      snap = await ariaSnap();
      break;
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }
  }
  if (snap === null) throw new Error('Could not snapshot page after 3 attempts');

  // Second wait: poll until two consecutive snapshots are identical, which signals that
  // lazily-rendered content (e.g. balance figures fetched after page load) has settled.
  // Each financial institution behaves differently, so we use DOM stability as a
  // institution-agnostic proxy rather than waiting on a known element.
  const STABILITY_INTERVAL_MS = 2000;
  const STABILITY_DEADLINE = Date.now() + 15000;
  while (Date.now() < STABILITY_DEADLINE) {
    await new Promise(r => setTimeout(r, STABILITY_INTERVAL_MS));
    const next = await ariaSnap().catch(() => null);
    if (next === null || next === snap) break; // stable or page closed
    snap = next;
  }

  snap = redactSensitive(snap);
  const url = page.url();
  const snapFile = `${snapshotsDir}/${snapPrefix}_${String(snapCount).padStart(3, '0')}.txt`;
  await fs.writeFile(snapFile, `URL: ${url}\n\n${snap}`);
  logSnapshot(snap, snapFile, Date.now() - startMs);
  return { snap, snapFile, url };
}

async function summarizePage(
  snap: string, url: string, prevContext: string, systemPrompt: string, model: string,
  modelOptions?: ModelOptions,
): Promise<string> {
  const prompt = [
    `Task context:\n${systemPrompt}`,
    prevContext ? `Previously seen:\n${prevContext}` : null,
    `Current page (URL: ${url}):\n${snap}`,
    `Summarize the data on the current page that is relevant to the task. \
Attribute each recorded value to this exact URL \
so it is clear which page it came from. \
Record exact dollar amounts and other key values verbatim with their labels — \
do not paraphrase or interpret labels. \
Build on the previously seen context so the result is a full accumulated \
picture of what has been observed so far.`,
  ].filter(Boolean).join('\n\n');
  return callForText(model, prompt, 512, modelOptions);
}

// T is the task's return type — e.g. Account[] for exploreAccounts, void for login.
//
// systemPrompt: persistent instructions passed via the `system` API parameter, visible on every
//   turn but outside the conversation history. Holds task description and memory notes.
//   Example: "You are a browser agent. Use fill_credential to fill in credentials. Call success()
//   once the dashboard is visible."
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
  onTool: (
    name: string,
    input: Record<string, unknown>,
    page: Page,
  ) => Promise<ToolContinue | ToolDone<T>>,
  sessionDir: string,
  taskName: string,
  sensitiveValues: SensitiveValue[] = [],
  maxTurns: number,
  maxTokens: number,
  model: string,
  modelOptions: ModelOptions,
): Promise<T> {
  let snapCount = 0;
  const redactSensitive = (text: string) => redact(text, sensitiveValues);
  const snapshotsDir = `${sessionDir}/snapshots`;
  const snapPrefix = `snapshot_${taskName}`;
  await fs.mkdir(snapshotsDir, { recursive: true });

  // prevMessages holds compressed history. pendingToolResults is the non-snapshot content for the
  // next user turn: tool results on later turns. Each loop appends the fresh snapshot before
  // sending it to the API; archived user turns get the agent's page summary instead.
  const prevMessages: MessageParam[] = [];
  let pendingToolResults: ContentBlockParam[] = [];
  let accumulatedContext = '';
  let done: T | undefined;

  const logFile = `${sessionDir}/conversation_${taskName}.md`;
  await fs.writeFile(
    logFile,
    `# ${path.basename(sessionDir)} — ${taskName}\n\n` +
      `## System Prompt\n\n${redactSensitive(systemPrompt)}\n\n`,
  );
  for (let turn = 0; turn < maxTurns; turn++) {
    const { snap, snapFile, url } = await takeSnapshot(
      page, snapshotsDir, snapPrefix, ++snapCount, redactSensitive,
    );
    // API receives the full snapshot content; the log records the file path instead
    // so conversation logs stay readable without the full ARIA tree on every turn.
    const contextBlock: ContentBlockParam[] = accumulatedContext
      ? [{ type: 'text', text: `[accumulated context]\n${accumulatedContext}` }]
      : [];
    const currentUserMsg = [...pendingToolResults, ...contextBlock, pageStateMessage(snap, url)];

    if (turn > 0) await fs.appendFile(logFile, '---\n\n');
    await fs.appendFile(logFile, `## Turn ${turn}\n\n`);
    await fs.appendFile(logFile, `### User → Agent\n\n`);
    await fs.appendFile(
      logFile,
      `\`\`\`json\n` +
        `${redactSensitive(JSON.stringify([...pendingToolResults, pageStateMessage(snapFile, url)], null, 2))}` +
        `\n\`\`\`\n\n`,
    );

    let response;
    let modelDurationMs = 0;
    for (let attempt = 0; attempt < MAX_EMPTY_RETRIES; attempt++) {
      try {
        const modelStartedAt = Date.now();
        response = await callWithTools({
          model,
          modelOptions,
          maxTokens,
          system: systemPrompt,
          tools,
          prevMessages,
          currentMessage: currentUserMsg,
        });
        modelDurationMs = Date.now() - modelStartedAt;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await fs.appendFile(logFile, `### Agent → User\n\n**Error:** ${msg}\n\n`);
        throw err;
      }

      await fs.appendFile(logFile, `### Agent → User (${formatDuration(modelDurationMs)})\n\n`);
      await fs.appendFile(
        logFile,
        `\`\`\`json\n${redactSensitive(JSON.stringify(response.rawForLog, null, 2))}\n\`\`\`\n\n`,
      );

      if (response.toolUses.length > 0) break;

      const modelText = response.assistantContent
        .filter((b): b is TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
      console.log(`[agent] model returned no tool calls${modelText ? `:\n${modelText}` : ''}`);
      if (attempt < MAX_EMPTY_RETRIES - 1) {
        console.log(`[agent] retrying (${attempt + 1}/${MAX_EMPTY_RETRIES})...`);
      } else {
        throw new Error('unexpected: model returned no tool calls after retries');
      }
    }

    const toolUses = response!.toolUses;
    for (const toolUse of toolUses) {
      logToolUse(
        turn,
        maxTurns,
        toolUse.name,
        toolUse.input as Record<string, unknown>,
        redactSensitive,
        modelDurationMs,
      );
    }

    const summaryStartedAt = Date.now();
    accumulatedContext = await summarizePage(
      snap, url, accumulatedContext, systemPrompt, model, modelOptions,
    );
    const summaryDurationMs = Date.now() - summaryStartedAt;
    await fs.appendFile(
      logFile,
      `### Accumulated Context (${formatDuration(summaryDurationMs)})\n\n` +
        `${accumulatedContext}\n\n`,
    );

    prevMessages.push({
      role: 'user',
      content: [...pendingToolResults, { type: 'text', text: `[page summary]\n${accumulatedContext}` }],
    });
    prevMessages.push({
      role: 'assistant',
      content: response.assistantContent as MessageParam['content'],
    });

    const toolResults: ToolResultBlockParam[] = [];

    for (const toolUse of toolUses) {
      if (!done) {
        let output = '';
        try {
          const r = await onTool(toolUse.name, toolUse.input as Record<string, unknown>, page);
          if (isDone(r)) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: redactSensitive(r.summary),
            });
            done = r.value;
          } else {
            output = redactSensitive(r.summary);
            logToolResult(toolUse.name, output);
            toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
          }
        } catch (err) {
          // TODO: break retry loops — the model sometimes retries the same failing call
          // repeatedly even when the error is unrecoverable. Appending a "do not retry"
          // hint to the tool result was tried (tracking seen calls by toolName+input) but
          // didn't reliably stop the loop in practice because the model still found reasons
          // to retry given the full conversation history. Needs a better approach.
          output = redactSensitive(`error: ${err instanceof Error ? err.message : String(err)}`);
          logToolError(err, output);
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
        }
      } else {
        // The API requires a tool_result for every tool_use in the conversation history,
        // even for tool calls that came after the terminal tool in the same response.
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'skipped' });
      }
    }

    if (done) break;

    // Store tool results as the non-snapshot content for the next turn; the snapshot is taken
    // at the top of that turn so it captures the final post-tool page state.
    pendingToolResults = toolResults;
  }

  await fs.appendFile(logFile, `## Summary\n\n`);

  if (done) {
    await fs.appendFile(logFile, `**Result:** success\n`);
    return done;
  } else {
    await fs.appendFile(logFile, `**Result:** failed — agent did not complete within ${maxTurns} turns\n`);
    throw new Error(`agent did not complete within ${maxTurns} turns`);
  }
}
