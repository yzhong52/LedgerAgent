import type { ContentBlockParam, MessageParam, TextBlock, Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';

// Values accepted by Ollama's OpenAI-compatible endpoint.
// Validated in: https://github.com/ollama/ollama/blob/main/openai/openai.go (search "invalid reasoning value")
// NOTE: intentionally NOT OpenAI.Shared.ReasoningEffort — OpenAI's SDK type uses 'xhigh'/'minimal'
// whereas Ollama uses 'max' and has no 'minimal'. Using the SDK type directly caused 400 errors.
export const REASONING_EFFORTS = [
  'none', 'low', 'medium', 'high', 'max',
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface ModelOptions {
  reasoningEffort?: ReasoningEffort;
}

export interface ProviderResponse {
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  // Anthropic-format content blocks — used to append the assistant turn to message history.
  // Includes text blocks so any reasoning the model writes is preserved in history.
  assistantContent: (TextBlock | ToolUseBlock)[];
  rawForLog: unknown;
}

export interface ProviderCallParams {
  model: string;
  modelOptions?: ModelOptions;
  maxTokens: number;
  system: string;
  tools: Tool[];
  prevMessages: MessageParam[];       // archived turns in Anthropic format
  currentMessage: ContentBlockParam[]; // current user turn
}
