import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
} from 'openai/resources/chat/completions';
import type { ContentBlockParam, MessageParam, Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import type { ModelOptions, ProviderCallParams, ProviderResponse } from './types';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1',
      apiKey: 'ollama', // required by the SDK but ignored by Ollama
    });
  }
  return _client;
}

// ─── Anthropic → OpenAI format conversion ────────────────────────────────────

function toOpenAITools(tools: Tool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

// Anthropic allows a single user turn to contain both tool_result blocks and text blocks.
// OpenAI requires these to be separate messages: role:'tool' for results, role:'user' for text.
// Tool results must immediately precede the next user text message in the sequence.
function toOpenAIMessages(
  messages: MessageParam[],
  userContent: ContentBlockParam[],
  system: string,
): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: 'system', content: system }];

  function splitUserContent(blocks: ContentBlockParam[]): {
    toolResults: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[];
    textContent: string;
  } {
    const toolResults: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = [];
    const textParts: string[] = [];

    for (const block of blocks) {
      if (block.type === 'tool_result') {
        const content = typeof block.content === 'string'
          ? block.content
          : (block.content ?? []).find(b => b.type === 'text')?.text ?? '';
        toolResults.push({ role: 'tool', tool_call_id: block.tool_use_id, content });
      } else if (block.type === 'text') {
        textParts.push(block.text);
      }
    }

    return { toolResults, textContent: textParts.join('\n\n') };
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      const blocks = Array.isArray(msg.content)
        ? (msg.content as ContentBlockParam[])
        : [{ type: 'text' as const, text: msg.content as string }];

      const { toolResults, textContent } = splitUserContent(blocks);
      out.push(...toolResults);
      if (textContent) out.push({ role: 'user', content: textContent });

    } else if (msg.role === 'assistant') {
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const textParts: string[] = [];
      const toolCalls: ChatCompletionMessageFunctionToolCall[] = [];

      for (const block of blocks) {
        if (block.type === 'text') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: (block as ToolUseBlock).id,
            type: 'function',
            function: {
              name: (block as ToolUseBlock).name,
              arguments: JSON.stringify((block as ToolUseBlock).input),
            },
          });
        }
      }

      if (toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: textParts.join(''),
          tool_calls: toolCalls,
        });
      } else {
        out.push({ role: 'assistant', content: textParts.join('') });
      }
    }
  }

  const { toolResults, textContent } = splitUserContent(userContent);
  out.push(...toolResults);
  if (textContent) out.push({ role: 'user', content: textContent });

  return out;
}

// ─── Text-content tool call fallback ─────────────────────────────────────────
//
// Some models (e.g. Qwen) embed tool calls as <tool_call> XML, markdown code
// blocks, or bare JSON in the content field when structured tool_calls are absent.

// Walk the text character-by-character, tracking brace/string depth, and yield
// each top-level JSON object as a parsed value. A regex with lazy [\s\S]*? breaks
// on nested objects because it stops at the first } regardless of depth.
function extractJsonObjects(text: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') { i++; continue; }
    let depth = 0;
    let inString = false;
    let escaped = false;
    let j = i;
    while (j < text.length) {
      const ch = text[j];
      if (escaped)              { escaped = false; }
      else if (ch === '\\' && inString) { escaped = true; }
      else if (ch === '"')      { inString = !inString; }
      else if (!inString) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              const obj = JSON.parse(text.slice(i, j + 1)) as unknown;
              if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                results.push(obj as Record<string, unknown>);
              }
            } catch { /* not valid JSON */ }
            i = j + 1;
            break;
          }
        }
      }
      j++;
    }
    if (j >= text.length && depth > 0) i++; // unclosed brace — skip
  }
  return results;
}

let _callIdSeq = 0;

export function parseToolCallsFromText(
  text: string,
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  const results: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

  function tryExtract(raw: string): void {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const name = obj.name;
      if (typeof name !== 'string' || name.length === 0) return;
      const input = (obj.arguments ?? obj.parameters ?? obj.input ?? {}) as Record<string, unknown>;
      // Allow any name through — unknown names produce an error result that the
      // model can learn from, exactly as the structured tool_calls path does.
      results.push({ id: `tc_${++_callIdSeq}`, name, input });
    } catch { /* not valid JSON */ }
  }

  let m: RegExpExecArray | null;

  // Match ```json ... ``` or ``` ... ``` markdown code blocks
  const mdRe = /```(?:json)?\s*([\s\S]*?)```/g;
  while ((m = mdRe.exec(text)) !== null) tryExtract(m[1].trim());
  if (results.length > 0) return results;

  // Scan for bare JSON objects using brace-depth tracking.
  // A regex with lazy [\s\S]*? stops at the first } and fails on nested objects
  // like {"name":"fill","arguments":{"selector":"#id"}} — the depth tracker does not.
  for (const candidate of extractJsonObjects(text)) tryExtract(JSON.stringify(candidate));

  return results;
}

// ─── Main call ───────────────────────────────────────────────────────────────

type RawMessage = OpenAI.Chat.Completions.ChatCompletionMessage | undefined;

function extractToolUses(
  msg: RawMessage,
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  const structured = (msg?.tool_calls ?? []).filter(
    (tc): tc is ChatCompletionMessageFunctionToolCall => tc.type === 'function',
  );
  if (structured.length > 0) {
    return structured.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      input: (() => {
        try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; }
        catch { return {} as Record<string, unknown>; }
      })(),
    }));
  }
  return parseToolCallsFromText(msg?.content ?? '');
}

type CompletionParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

function withOllamaReasoningOptions(
  params: CompletionParams,
  modelOptions?: ModelOptions,
): CompletionParams {
  if (!modelOptions?.reasoningEffort) return params;
  return { ...params, reasoning_effort: modelOptions.reasoningEffort };
}

function buildCompletionParams(
  model: string,
  maxTokens: number,
  messages: ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  modelOptions?: ModelOptions,
): CompletionParams {
  return withOllamaReasoningOptions({
    model,
    max_tokens: maxTokens,
    messages,
    tools,
    tool_choice: 'required',
  }, modelOptions);
}

function buildTextCompletionParams(
  model: string,
  maxTokens: number,
  messages: ChatCompletionMessageParam[],
  modelOptions?: ModelOptions,
): CompletionParams {
  return withOllamaReasoningOptions({
    model,
    max_tokens: maxTokens,
    messages,
  }, modelOptions);
}

export async function callOllama(params: ProviderCallParams): Promise<ProviderResponse> {
  const messages = toOpenAIMessages(params.prevMessages, params.currentMessage, params.system);
  const tools = toOpenAITools(params.tools);

  const response = await getClient().chat.completions.create(
    buildCompletionParams(params.model, params.maxTokens, messages, tools, params.modelOptions),
  );

  const message = response.choices[0]?.message;
  let toolUses = extractToolUses(message);

  if (toolUses.length === 0) {
    // The model responded with text instead of a tool call. Give it one retry with
    // an explicit nudge — this happens when tool_choice:'required' is not honored.
    const textContent = message?.content ?? '';
    const retryMessages: ChatCompletionMessageParam[] = [
      ...messages,
      { role: 'assistant', content: textContent },
      { role: 'user', content: 'You must call one of the provided tools. Do not write text.' },
    ];
    const retry = await getClient().chat.completions.create(
      buildCompletionParams(
        params.model, params.maxTokens, retryMessages, tools, params.modelOptions,
      ),
    );
    toolUses = extractToolUses(retry.choices[0]?.message);
    if (toolUses.length === 0) {
      const preview = textContent ? `\nModel responded with text: ${textContent.slice(0, 300)}` : '';
      throw new Error(`unexpected: model returned no tool calls${preview}`);
    }
  }

  const assistantContent: ToolUseBlock[] = toolUses.map(tu => ({
    type: 'tool_use',
    id: tu.id,
    name: tu.name,
    input: tu.input,
  }));

  return { toolUses, assistantContent, rawForLog: response };
}

export async function callOllamaForText(
  model: string, userMessage: string, maxTokens = 512, modelOptions?: ModelOptions,
): Promise<string> {
  const response = await getClient().chat.completions.create(
    buildTextCompletionParams(
      model,
      maxTokens,
      [{ role: 'user', content: userMessage }],
      modelOptions,
    ),
  );
  return response.choices[0]?.message.content ?? '';
}
