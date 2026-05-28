export type { ProviderCallParams, ProviderResponse } from './types';

import { callAnthropic, callAnthropicForText } from './anthropic';
import { callOllama, callOllamaForText } from './ollama';
import type { ModelOptions, ProviderCallParams, ProviderResponse } from './types';

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-');
}

// TODO: add isOpenAIModel() here and route to openai.ts once that provider is tested.
// OpenAI model IDs typically start with 'gpt-' or 'o1'/'o3'.

export async function callWithTools(params: ProviderCallParams): Promise<ProviderResponse> {
  if (isAnthropicModel(params.model)) return callAnthropic(params);
  return callOllama(params);
}

export async function callForText(
  model: string, userMessage: string, maxTokens = 512, modelOptions?: ModelOptions,
): Promise<string> {
  if (isAnthropicModel(model)) return callAnthropicForText(model, userMessage, maxTokens);
  return callOllamaForText(model, userMessage, maxTokens, modelOptions);
}
