import { OpenAI } from 'openai';
import { ProviderMessage, ProviderResponse, ProviderToolCall, LLMProvider, ChatOptions } from './types.js';
import type { ToolDefinition } from '../tools/interface.js';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model;
  }

  async chat(messages: ProviderMessage[], tools: ToolDefinition[], options?: ChatOptions): Promise<ProviderResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      tools: tools as OpenAI.ChatCompletionTool[],
    }, { signal: options?.signal });

    const message = response.choices[0]?.message;
    if (!message) return {};

    return {
      content: message.content ?? undefined,
      tool_calls: message.tool_calls
        ?.filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => tc.type === 'function')
        .map((tc): ProviderToolCall => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        })),
    };
  }
}
