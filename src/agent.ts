import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import type { Page } from 'playwright';

export const MODEL = 'claude-sonnet-4-6';
export const MAX_TURNS = 20;
export const DEBUG = process.env.DEBUG === '1';

export function debug(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}

const client = new Anthropic();

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

export async function runAgent<T>(
  page: Page,
  tools: Tool[],
  systemPrompt: string,
  initialMessage: string,
  onTool: (name: string, input: Record<string, unknown>, page: Page) => Promise<string | ToolDone<T>>,
): Promise<T> {
  const messages: MessageParam[] = [{ role: 'user', content: initialMessage }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    debug('\n── prompt to claude ──────────────────────────────');
    debug(JSON.stringify(messages[messages.length - 1], null, 2));
    debug('──────────────────────────────────────────────────\n');

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      tool_choice: { type: 'any' },
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    // tool_choice: 'any' guarantees at least one tool call per response.
    if (toolUses.length === 0) throw new Error('unexpected: Claude returned no tool calls');

    const toolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];
    let result: { value: T } | undefined;

    for (const toolUse of toolUses) {
      // Stub any tool_use blocks that follow the terminal tool — the API requires
      // one tool_result per tool_use in the conversation history.
      if (result) {
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'skipped' });
        continue;
      }

      console.log(`[turn ${turn + 1}/${MAX_TURNS}] [tool] ${toolUse.name}`, toolUse.input);

      let output = '';
      try {
        const r = await onTool(toolUse.name, toolUse.input as Record<string, unknown>, page);
        if (isDone(r)) {
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: r.content });
          result = { value: r.value };
          continue;
        }
        output = r;
      } catch (err) {
        output = `error: ${err instanceof Error ? err.message : String(err)}`;
      }

      console.log(`[turn ${turn + 1}/${MAX_TURNS}] [tool] → ${output.length > 120 ? output.slice(0, 120) + '…' : output}`);
      if (DEBUG) await new Promise(resolve => setTimeout(resolve, 1000));
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: output });
    }

    messages.push({ role: 'user', content: toolResults });

    if (result) return result.value;
  }

  throw new Error(`agent did not complete within ${MAX_TURNS} turns`);
}
