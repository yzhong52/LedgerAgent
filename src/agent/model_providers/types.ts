import type { ContentBlockParam, MessageParam, TextBlock, Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';

export interface TextCallParams {
  model: string;
  system: string;
  userMessage: string;
  maxTokens: number;
}

export interface ProviderResponse {
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  // Anthropic-format content blocks — used to append the assistant turn to message history.
  // Includes text blocks so any reasoning the model writes is preserved in history.
  assistantContent: (TextBlock | ToolUseBlock)[];
  rawForLog: unknown;
  // Any text the model wrote before its tool calls — used to archive a page summary
  // in place of the full snapshot, avoiding a separate summarization API call.
  responseText: string;
}

export interface ProviderCallParams {
  model: string;
  maxTokens: number;
  system: string;
  tools: Tool[];
  messages: MessageParam[];         // archived turns in Anthropic format
  userContent: ContentBlockParam[]; // current user turn
}
