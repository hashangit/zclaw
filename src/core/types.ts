/**
 * ZClaw SDK — Shared TypeScript types
 *
 * This file is the single source of truth for all SDK interfaces.
 * Every SDK module imports from here.
 */

// ── Provider ──────────────────────────────────────────────────────────

export type ProviderType = "openai" | "anthropic" | "glm" | "openai-compatible";

export interface MultiProviderConfig {
  openai?: { apiKey: string; model?: string };
  anthropic?: { apiKey: string; model?: string };
  glm?: { apiKey: string; model?: string };
  "openai-compatible"?: { apiKey: string; baseUrl: string; model?: string };
  default: ProviderType;
}

// ── Messages ──────────────────────────────────────────────────────────

export interface Message {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
}

// ── Steps ─────────────────────────────────────────────────────────────

export interface StepResult {
  type: "text" | "tool_call";
  content?: string;
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    result: string;
    duration: number;
  };
  timestamp: number;
}

// ── Usage ─────────────────────────────────────────────────────────────

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface CumulativeUsage {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  requestCount: number;
}

// ── Tools ─────────────────────────────────────────────────────────────

export interface UserToolDefinition {
  name?: string;
  description: string;
  parameters: unknown; // ZodSchema at runtime
  execute: (args: unknown, context: ToolContext) => Promise<string | ToolResult>;
}

export interface ToolContext {
  onUpdate?: (progress: { percentage: number; message?: string }) => void;
  signal?: AbortSignal;
  config?: Record<string, unknown>;
}

export interface ToolResult {
  output: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}

// ── Hooks ─────────────────────────────────────────────────────────────

export interface Hooks {
  beforeToolCall?: (
    call: { name: string; args: Record<string, unknown> },
  ) => void | Promise<void>;
  afterToolCall?: (
    result: { name: string; output: string; duration: number },
  ) => void | Promise<void>;
  onStep?: (step: StepResult) => void | Promise<void>;
  onError?: (error: ZclawError) => void | Promise<void>;
  onFinish?: (result: GenerateTextResult) => void | Promise<void>;
}

// ── generateText ──────────────────────────────────────────────────────

export interface GenerateTextOptions {
  model?: string;
  provider?: ProviderType;
  systemPrompt?: string;
  tools?: string[] | UserToolDefinition[];
  skills?: string[];
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  output?: unknown; // ZodSchema
  hooks?: Hooks;
  signal?: AbortSignal;
  config?: Record<string, unknown>;
}

export interface GenerateTextResult {
  text: string;
  data?: unknown;
  error?: { message: string; issues: unknown };
  steps: StepResult[];
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: "stop" | "length" | "max_steps" | "error";
  messages: Message[];
}

// ── streamText ────────────────────────────────────────────────────────

export interface StreamTextOptions extends GenerateTextOptions {
  onText?: (delta: string) => void;
  onToolCall?: (
    tool: { name: string; args: Record<string, unknown>; callId: string },
  ) => void;
  onToolResult?: (
    result: { callId: string; output: string; success: boolean },
  ) => void;
  onStep?: (step: StepResult) => void;
  onError?: (error: ZclawError) => void;
}

export interface StreamTextResult {
  textStream: AsyncIterable<string>;
  steps: AsyncIterable<StepResult>;
  fullText: Promise<string>;
  usage: Promise<Usage>;
  finishReason: Promise<string>;
  abort: () => void;
  toResponse: () => Response;
  toSSEStream: () => ReadableStream;
}

// ── createAgent ───────────────────────────────────────────────────────

export interface AgentCreateOptions {
  model?: string;
  provider?: ProviderType;
  systemPrompt?: string;
  tools?: string[] | UserToolDefinition[];
  skills?: string[];
  maxSteps?: number;
  permissionMode?: "auto" | "confirm";
  persist?: string | SessionStore;
  hooks?: Hooks;
  config?: Record<string, unknown>;
}

export interface SdkAgent {
  chat(message: string): Promise<AgentResponse>;
  chatStream(message: string, options?: StreamTextOptions): Promise<StreamTextResult>;
  switchProvider(provider: ProviderType, model?: string): Promise<void>;
  setSystemPrompt(prompt: string): void;
  setTools(tools: string[]): void;
  abort(): void;
  clear(): void;
  getHistory(): Message[];
  getUsage(): CumulativeUsage;
}

export interface AgentResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
}

// ── Session ───────────────────────────────────────────────────────────

export interface SessionStore {
  save(sessionId: string, messages: Message[]): Promise<void>;
  load(sessionId: string): Promise<Message[] | null>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface SessionData {
  id: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  provider?: ProviderType;
  model?: string;
}

// ── Skills ────────────────────────────────────────────────────────────

export interface SkillMetadata {
  name: string;
  description: string;
  tags: string[];
}

// ── Errors ────────────────────────────────────────────────────────────

export interface ZclawError extends Error {
  code: string; // "PROVIDER_ERROR" | "TOOL_FAILED" | "MAX_STEPS" | "ABORTED"
  retryable: boolean;
  provider?: string;
  tool?: string;
}

