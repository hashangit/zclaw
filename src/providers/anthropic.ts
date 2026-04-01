import Anthropic from '@anthropic-ai/sdk';
import { ProviderMessage, ProviderResponse, ProviderToolCall, LLMProvider } from './types.js';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string, options?: { baseURL?: string; timeout?: number }) {
    this.client = new Anthropic({
      apiKey,
      baseURL: options?.baseURL,
      timeout: options?.timeout,
    });
    this.model = model;
  }

  async chat(messages: ProviderMessage[], tools: any[]): Promise<ProviderResponse> {
    // Extract system messages
    const systemParts: string[] = [];
    const nonSystem: ProviderMessage[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        if (msg.content) systemParts.push(msg.content);
      } else {
        nonSystem.push(msg);
      }
    }

    // Translate messages to Anthropic format
    const anthropicMessages: Anthropic.MessageParam[] = [];
    for (const msg of nonSystem) {
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.arguments),
          });
        }
        anthropicMessages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.tool_call_id!,
            content: msg.content ?? '',
          }],
        });
      } else {
        anthropicMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content ?? '',
        });
      }
    }

    // Translate tool definitions
    const anthropicTools: Anthropic.Tool[] = tools.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16384,
      system: systemParts.length ? systemParts.join('\n') : undefined,
      messages: anthropicMessages,
      tools: anthropicTools,
    });

    // Translate response
    let content: string | undefined;
    const toolCalls: ProviderToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content = content ? content + block.text : block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    return {
      content: content || undefined,
      tool_calls: toolCalls.length ? toolCalls : undefined,
    };
  }
}
