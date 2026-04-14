export type { ProviderType } from "../core/types.js";

import type { ToolDefinition } from '../tools/interface.js';

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

export interface ChatOptions {
  signal?: AbortSignal;
}

export interface LLMProvider {
  chat(messages: ProviderMessage[], tools: ToolDefinition[], options?: ChatOptions): Promise<ProviderResponse>;
}
