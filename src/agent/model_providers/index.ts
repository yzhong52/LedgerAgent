export type { ProviderCallParams, ProviderResponse, TextCallParams } from './types';

import { callAnthropic, callAnthropicForText } from './anthropic';
import { callOllama, callOllamaForText } from './ollama';
import type { ProviderCallParams, ProviderResponse, TextCallParams } from './types';

export function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-');
}

// TODO: add isOpenAIModel() here and route to openai.ts once that provider is tested.
// OpenAI model IDs typically start with 'gpt-' or 'o1'/'o3'.

export async function callWithTools(params: ProviderCallParams): Promise<ProviderResponse> {
  if (isAnthropicModel(params.model)) return callAnthropic(params);
  return callOllama(params);
}

export async function callForText(params: TextCallParams): Promise<string> {
  if (isAnthropicModel(params.model)) return callAnthropicForText(params);
  return callOllamaForText(params);
}
