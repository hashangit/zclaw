export type ProviderType = 'openai-compatible' | 'openai' | 'anthropic' | 'glm';

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: ProviderToolCall[];
  tool_call_id?: string;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProviderResponse {
  content?: string;
  tool_calls?: ProviderToolCall[];
}

export interface LLMProvider {
  chat(messages: ProviderMessage[], tools: any[]): Promise<ProviderResponse>;
}
