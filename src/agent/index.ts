import type {
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

// Prompt for Call 1 each turn: synthesize previous state + tool results + current snapshot
// into a structured JSON summary. The act model (Call 2) receives only this summary.
const SUMMARIZE_SYSTEM =
  'You are tracking the state of a browser automation session. ' +
  'Given what was known before, the results of recent actions, and the current page snapshot, ' +
  'produce a concise JSON summary of: pages visited, data collected so far (with specific names ' +
  'and values), and what still needs to be found. ' +
  'Output only the JSON object — no explanation, no markdown code fences.';

// T is the task's return type — e.g. Account[] for exploreAccounts, void for login.
//
// systemPrompt: task instructions for the act model — what to find and which tools to use.
//
// initialMessage: context for the first turn's summarizer (e.g. "User is now logged in.").
//
// onTool: called for each tool use. Return toolResult(str) to continue or toolDone(value) to end.
//
// summaryModel: optional cheaper model for the summarize call; defaults to model.
export async function runAgent<T>(
  page: Page,
  tools: Tool[],
  systemPrompt: string,
  initialMessage: string,
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
  summaryModel?: string,
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

  const logFile = `${sessionDir}/conversation_${taskName}.md`;
  await fs.writeFile(
    logFile,
    `# ${path.basename(sessionDir)} — ${taskName}\n\n` +
      `## System Prompt\n\n${redactSensitive(systemPrompt)}\n\n`,
  );

  // currentSummary carries the JSON state produced by Call 1 into Call 2 and the next turn.
  // lastToolResults carries the outcomes of Call 2's tool executions into the next turn's Call 1.
  let currentSummary = '';
  let lastToolResults: string[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const { snap, snapFile } = await takeSnapshot();

    if (turn > 0) await fs.appendFile(logFile, '---\n\n');
    await fs.appendFile(logFile, `## Turn ${turn}\n\n`);

    // ── Call 1: Summarize ──────────────────────────────────────────────────────
    const summarizeParts: string[] = [];
    if (currentSummary) {
      summarizeParts.push(`Previous state:\n${currentSummary}`);
    } else {
      summarizeParts.push(`Session context: ${initialMessage}`);
    }
    if (lastToolResults.length > 0) {
      summarizeParts.push(`Last actions and results:\n${lastToolResults.join('\n')}`);
    }
    summarizeParts.push(`Current page (${snapFile}):\n${snap}`);
    const summarizeUserMsg = summarizeParts.join('\n\n');

    await fs.appendFile(logFile, `### Turn ${turn} — Summarize\n\n`);
    await fs.appendFile(logFile, `#### Input\n\n\`\`\`\n${redactSensitive(summarizeUserMsg)}\n\`\`\`\n\n`);

    currentSummary = redactSensitive(await callForText({
      model: summaryModel ?? model,
      system: SUMMARIZE_SYSTEM,
      userMessage: summarizeUserMsg,
      maxTokens: 1024,
    }));

    await fs.appendFile(logFile, `#### Output\n\n\`\`\`json\n${currentSummary}\n\`\`\`\n\n`);

    // ── Call 2: Act ────────────────────────────────────────────────────────────
    await fs.appendFile(logFile, `### Turn ${turn} — Act\n\n`);
    await fs.appendFile(logFile, `#### Input\n\n\`\`\`json\n${currentSummary}\n\`\`\`\n\n`);

    const response = await callWithTools({
      model,
      maxTokens,
      system: systemPrompt,
      tools,
      messages: [],
      userContent: [{ type: 'text', text: `Current state:\n${currentSummary}` }],
    });

    await fs.appendFile(
      logFile,
      `#### Response\n\n\`\`\`json\n${redactSensitive(JSON.stringify(response.rawForLog, null, 2))}\n\`\`\`\n\n`,
    );

    const toolUses = response.toolUses;
    if (toolUses.length === 0) throw new Error('unexpected: model returned no tool calls');

    const toolResults: ToolResultBlockParam[] = [];
    lastToolResults = [];
    let completion: { value: T } | undefined;

    for (const toolUse of toolUses) {
      if (!completion) {
        logToolUse(turn, maxTurns, toolUse.name, toolUse.input as Record<string, unknown>, redactSensitive);

        let output = '';
        try {
          const r = await onTool(toolUse.name, toolUse.input as Record<string, unknown>, page);
          if (isDone(r)) {
            output = redactSensitive(r.content);
            toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
            completion = { value: r.value };
          } else {
            output = redactSensitive(r.content);
            logToolResult(toolUse.name, output);
            toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
          }
          lastToolResults.push(`${toolUse.name}: ${output}`);
        } catch (err) {
          output = redactSensitive(`error: ${err instanceof Error ? err.message : String(err)}`);
          logToolError(err, output);
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
          lastToolResults.push(`${toolUse.name}: ${output}`);
        }
      } else {
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'skipped' });
      }
    }

    if (completion) return completion.value;
  }

  throw new Error(`agent did not complete within ${maxTurns} turns`);
}
