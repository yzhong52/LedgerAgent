import Anthropic from '@anthropic-ai/sdk';
import type { TextBlock, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import { keychainLoadApiKey } from '../../keychain';
import type { ModelOptions, ProviderCallParams, ProviderResponse } from './types';

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = keychainLoadApiKey() ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error(
      'Anthropic API key not found. Run: npm run cli -- config anthropic',
    );
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export async function callAnthropic(params: ProviderCallParams): Promise<ProviderResponse> {
  const response = await getClient().messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.system,
    tools: params.tools,
    tool_choice: { type: 'any' },
    messages: [...params.prevMessages, { role: 'user', content: params.currentMessage }],
  });

  const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
  const textBlocks = response.content.filter((b): b is TextBlock => b.type === 'text');

  return {
    toolUses: toolUses.map(b => ({
      id: b.id,
      name: b.name,
      input: b.input as Record<string, unknown>,
    })),
    assistantContent: [...textBlocks, ...toolUses],
    rawForLog: response,
  };
}

export async function callAnthropicForText(
  model: string, userMessage: string, maxTokens: number, _modelOptions?: ModelOptions,
): Promise<string> {
  const response = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userMessage }],
  });
  const block = response.content.find(b => b.type === 'text');
  return block?.type === 'text' ? block.text : '';
}
