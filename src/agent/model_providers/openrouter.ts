import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import type { ModelOptions, ProviderCallParams, ProviderResponse } from './types';
import { toOpenAITools, toOpenAIMessages, extractToolUses } from './openai_compat';
import { keychainLoadOpenRouterApiKey } from '../../keychain';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    const apiKey = keychainLoadOpenRouterApiKey() ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error(
      'OpenRouter API key not found. Run: npm run cli -- config openrouter',
    );
    _client = new OpenAI({ baseURL: OPENROUTER_BASE_URL, apiKey });
  }
  return _client;
}

// OpenRouter extends the OpenAI-compatible API with a `reasoning` field for controlling
// chain-of-thought. Cast to the base SDK type since the SDK doesn't know about this extension.
function withReasoning(
  params: ChatCompletionCreateParamsNonStreaming,
  modelOptions?: ModelOptions,
): ChatCompletionCreateParamsNonStreaming {
  if (!modelOptions?.reasoningEffort) return params;
  return { ...params, reasoning: { effort: modelOptions.reasoningEffort } } as
    ChatCompletionCreateParamsNonStreaming;
}

export async function callOpenRouter(params: ProviderCallParams): Promise<ProviderResponse> {
  const messages = toOpenAIMessages(params.prevMessages, params.currentMessage, params.system);
  const tools = toOpenAITools(params.tools);

  const response = await getClient().chat.completions.create(
    withReasoning({
      model: params.model,
      max_tokens: params.maxTokens,
      messages,
      tools,
      tool_choice: 'required',
    }, params.modelOptions),
  );

  const message = response.choices[0]?.message;
  let toolUses = extractToolUses(message);

  if (toolUses.length === 0) {
    // Give the model one retry with an explicit nudge when tool_choice:'required' is ignored.
    const textContent = message?.content ?? '';
    const retryMessages: ChatCompletionMessageParam[] = [
      ...messages,
      { role: 'assistant', content: textContent },
      { role: 'user', content: 'You must call one of the provided tools. Do not write text.' },
    ];
    const retry = await getClient().chat.completions.create(
      withReasoning({
        model: params.model,
        max_tokens: params.maxTokens,
        messages: retryMessages,
        tools,
        tool_choice: 'required',
      }, params.modelOptions),
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

export async function callOpenRouterForText(
  model: string, userMessage: string, maxTokens: number, modelOptions?: ModelOptions,
): Promise<string> {
  const response = await getClient().chat.completions.create(
    withReasoning({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userMessage }],
    }, modelOptions),
  );
  return response.choices[0]?.message.content ?? '';
}
