export type { ProviderCallParams, ProviderResponse } from './types';

import { callAnthropic, callAnthropicForText } from './anthropic';
import { callOllama, callOllamaForText } from './ollama';
import { callOpenRouter, callOpenRouterForText } from './openrouter';
import type { ModelOptions, ProviderCallParams, ProviderResponse } from './types';

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-');
}

// OpenRouter model IDs always contain a slash, e.g. "anthropic/claude-3-5-haiku", "openai/gpt-4o".
export function isOpenRouterModel(model: string): boolean {
  return model.includes('/');
}

export async function callWithTools(params: ProviderCallParams): Promise<ProviderResponse> {
  if (isAnthropicModel(params.model)) return callAnthropic(params);
  if (isOpenRouterModel(params.model)) return callOpenRouter(params);
  return callOllama(params);
}

export async function callForText(
  model: string, userMessage: string, maxTokens = 512, modelOptions?: ModelOptions,
): Promise<string> {
  if (isAnthropicModel(model)) {
    return callAnthropicForText(model, userMessage, maxTokens, modelOptions);
  }
  if (isOpenRouterModel(model)) {
    return callOpenRouterForText(model, userMessage, maxTokens, modelOptions);
  }
  return callOllamaForText(model, userMessage, maxTokens, modelOptions);
}
