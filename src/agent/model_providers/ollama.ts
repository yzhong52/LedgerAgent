import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import type { ModelOptions, ProviderCallParams, ProviderResponse } from './types';
import { toOpenAITools, toOpenAIMessages, extractToolUses } from './openai_compat';

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

export { parseToolCallsFromText } from './openai_compat';

// ─── Main call ───────────────────────────────────────────────────────────────

type CompletionParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

function withOllamaReasoningOptions(
  params: CompletionParams,
  modelOptions?: ModelOptions,
): CompletionParams {
  if (!modelOptions?.reasoningEffort) return params;
  // Our ReasoningEffort includes 'max'/'none' which aren't in OpenAI's SDK type (see types.ts).
  return { ...params, reasoning_effort: modelOptions.reasoningEffort } as CompletionParams;
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
  model: string, userMessage: string, maxTokens: number, modelOptions?: ModelOptions,
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

