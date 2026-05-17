import type {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import type { Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import { redact } from './redact';
import { callWithTools, callForText } from './model_providers';
import {
  logSnapshot,
  logToolError,
  logToolResult,
  logToolUse,
} from './log_utils';
export { SUCCESS_TOOL } from './tools';
export { createSession, SEPARATOR } from './log_utils';

export const MAX_TURNS = 20;

export interface ToolContinue {
  done: false;
  content: string;
}

export interface ToolDone<T> {
  done: true;
  value: T;
  content: string;
}

export function toolResult(content: string): ToolContinue {
  return { done: false, content };
}

export function toolDone<T>(value: T, content: string): ToolDone<T> {
  return { done: true, value, content };
}

function isDone<T>(r: ToolContinue | ToolDone<T>): r is ToolDone<T> {
  return r.done;
}


function pageStateMessage(snap: string): { type: 'text'; text: string } {
  return { type: 'text', text: `Current page state:\n${snap}` };
}

async function summarizePage(
  snap: string, prevContext: string, systemPrompt: string, model: string,
): Promise<string> {
  const prompt = [
    `Task context:\n${systemPrompt}`,
    prevContext ? `Previously seen:\n${prevContext}` : null,
    `Current page:\n${snap}`,
    'Summarize the data visible on the current page for the task.' +
      'Build on the previously seen context so the result is a full accumulated ' +
      'picture of what has been observed so far.',
  ].filter(Boolean).join('\n\n');
  return callForText(model, prompt);
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
  sensitiveValues: string[] = [],
  maxTurns: number,
  maxTokens: number,
  model: string,
): Promise<T> {
  let snapCount = 0;
  const redactSensitive = (text: string) => redact(text, sensitiveValues);
  const snapshotsDir = `${sessionDir}/snapshots`;
  const snapPrefix = `snapshot_${taskName}`;
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
    const snapFile = `${snapshotsDir}/${snapPrefix}_${String(++snapCount).padStart(3, '0')}.txt`;
    await fs.writeFile(snapFile, snap);
    logSnapshot(snap, snapFile);
    return { snap, snapFile };
  }

  // prevMessages holds compressed history. pendingToolResults is the non-snapshot content for the
  // next user turn: tool results on later turns. Each loop appends the fresh snapshot before
  // sending it to the API; archived user turns get the agent's page summary instead.
  const prevMessages: MessageParam[] = [];
  let pendingToolResults: ContentBlockParam[] = [];
  let accumulatedContext = '';

  const logFile = `${sessionDir}/conversation_${taskName}.md`;
  await fs.writeFile(
    logFile,
    `# ${path.basename(sessionDir)} — ${taskName}\n\n` +
      `## System Prompt\n\n${redactSensitive(systemPrompt)}\n\n`,
  );
  for (let turn = 0; turn < maxTurns; turn++) {
    const { snap, snapFile } = await takeSnapshot();
    // API receives the full snapshot content; the log records the file path instead
    // so conversation logs stay readable without the full ARIA tree on every turn.
    const contextBlock: ContentBlockParam[] = accumulatedContext
      ? [{ type: 'text', text: `[accumulated context]\n${accumulatedContext}` }]
      : [];
    const currentUserMsg = [...pendingToolResults, ...contextBlock, pageStateMessage(snap)];

    if (turn > 0) await fs.appendFile(logFile, '---\n\n');
    await fs.appendFile(logFile, `## Turn ${turn}\n\n`);
    await fs.appendFile(logFile, `### User → Agent\n\n`);
    await fs.appendFile(
      logFile,
      `\`\`\`json\n` +
        `${redactSensitive(JSON.stringify([...pendingToolResults, pageStateMessage(snapFile)], null, 2))}` +
        `\n\`\`\`\n\n`,
    );

    const response = await callWithTools({
      model,
      maxTokens,
      system: systemPrompt,
      tools,
      prevMessages,
      currentMessage: currentUserMsg,
    });

    await fs.appendFile(logFile, `### Agent → User\n\n`);
    await fs.appendFile(
      logFile,
      `\`\`\`json\n${redactSensitive(JSON.stringify(response.rawForLog, null, 2))}\n\`\`\`\n\n`,
    );

    accumulatedContext = await summarizePage(snap, accumulatedContext, systemPrompt, model);
    await fs.appendFile(logFile, `### Accumulated Context\n\n${accumulatedContext}\n\n`);

    prevMessages.push({
      role: 'user',
      content: [...pendingToolResults, { type: 'text', text: `[page summary]\n${accumulatedContext}` }],
    });
    prevMessages.push({
      role: 'assistant',
      content: response.assistantContent as MessageParam['content'],
    });

    const toolUses = response.toolUses;
    if (toolUses.length === 0) throw new Error('unexpected: model returned no tool calls');

    const toolResults: ToolResultBlockParam[] = [];
    let completion: { value: T } | undefined;

    for (const toolUse of toolUses) {
      if (!completion) {
        logToolUse(
          turn,
          maxTurns,
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          redactSensitive,
        );

        let output = '';
        try {
          const r = await onTool(toolUse.name, toolUse.input as Record<string, unknown>, page);
          if (isDone(r)) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: redactSensitive(r.content),
            });
            completion = { value: r.value };
          } else {
            output = redactSensitive(r.content);
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

    if (!completion) {
      // Store tool results as the non-snapshot content for the next turn; the snapshot is taken
      // at the top of that turn so it captures the final post-tool page state.
      pendingToolResults = toolResults;
    } else {
      return completion.value;
    }
  }

  throw new Error(`agent did not complete within ${maxTurns} turns`);
}
