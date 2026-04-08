---
title: Types Reference
description: Complete TypeScript types reference for the ZClaw SDK.
---

# Types Reference

Complete TypeScript type definitions for the ZClaw SDK. All types are exported from `"zclaw-core"`.

```typescript
import type { Message, GenerateTextResult, SdkAgent } from "zclaw-core";
```

## Core Types

### ProviderType

```typescript
type ProviderType = "openai" | "anthropic" | "glm" | "openai-compatible";
```

### Message

```typescript
interface Message {
  /** Unique message identifier. */
  id: string;
  /** Message role. */
  role: "system" | "user" | "assistant" | "tool";
  /** Message text content. */
  content: string;
  /** Tool calls made in this message (assistant role only). */
  toolCalls?: ToolCall[];
  /** Tool call ID this message responds to (tool role only). */
  toolCallId?: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}
```

### ToolCall

```typescript
interface ToolCall {
  /** Unique tool call identifier. */
  id: string;
  /** Tool name, e.g. "web_search", "read_file". */
  name: string;
  /** Arguments passed to the tool. */
  arguments: Record<string, unknown>;
  /** Tool execution result, if available. */
  result?: string;
}
```

### StepResult

```typescript
interface StepResult {
  /** Step type: text generation or tool invocation. */
  type: "text" | "tool_call";
  /** Generated text content (type: "text"). */
  content?: string;
  /** Tool call details (type: "tool_call"). */
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    result: string;
    /** Execution time in milliseconds. */
    duration: number;
  };
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}
```

### Usage

```typescript
interface Usage {
  /** Number of tokens in the prompt. */
  promptTokens: number;
  /** Number of tokens in the completion. */
  completionTokens: number;
  /** Total tokens (prompt + completion). */
  totalTokens: number;
  /** Estimated cost in USD. */
  cost: number;
}
```

## generateText Types

### GenerateTextOptions

```typescript
interface GenerateTextOptions {
  /** Model identifier, e.g. "gpt-5.4", "claude-sonnet-4-6-20260320". */
  model?: string;
  /** LLM provider to use. */
  provider?: ProviderType;
  /** System message prepended to the conversation. */
  systemPrompt?: string;
  /** Tools available to the agent. String names, group names, or custom definitions. */
  tools?: string[] | UserToolDefinition[];
  /** Skill names to activate. */
  skills?: string[];
  /** Maximum agent loop iterations (tool call rounds). Default: 10. */
  maxSteps?: number;
  /** Sampling temperature (0.0 -- 2.0). */
  temperature?: number;
  /** Maximum tokens in the completion. */
  maxTokens?: number;
  /** Zod schema for structured output. */
  output?: unknown;
  /** Lifecycle callbacks. */
  hooks?: Hooks;
  /** Abort controller signal for cancellation. */
  signal?: AbortSignal;
  /** Extra config passed to tool handlers. */
  config?: Record<string, unknown>;
}
```

### GenerateTextResult

```typescript
interface GenerateTextResult {
  /** The final assistant response text. */
  text: string;
  /** Structured data when output schema is provided and validation succeeds. */
  data?: unknown;
  /** Validation error when output schema is provided and validation fails. */
  error?: { message: string; issues: unknown };
  /** Ordered list of all loop iterations. */
  steps: StepResult[];
  /** All tool calls made during execution. */
  toolCalls: ToolCall[];
  /** Token usage and cost. */
  usage: Usage;
  /** Why the loop terminated. */
  finishReason: "stop" | "length" | "max_steps" | "error";
  /** Full conversation history for this invocation. */
  messages: Message[];
}
```

## streamText Types

### StreamTextOptions

Extends `GenerateTextOptions` with streaming callbacks:

```typescript
interface StreamTextOptions extends GenerateTextOptions {
  /** Called with each text chunk as it arrives. */
  onText?: (delta: string) => void;
  /** Called when the agent invokes a tool. */
  onToolCall?: (tool: {
    name: string;
    args: Record<string, unknown>;
    callId: string;
  }) => void;
  /** Called when a tool finishes execution. */
  onToolResult?: (result: {
    callId: string;
    output: string;
    success: boolean;
  }) => void;
  /** Called for every agent loop step. */
  onStep?: (step: StepResult) => void;
  /** Called if an error occurs during execution. */
  onError?: (error: ZclawError) => void;
}
```

### StreamTextResult

```typescript
interface StreamTextResult {
  /** Async iterator yielding text deltas as they arrive. */
  textStream: AsyncIterable<string>;
  /** Async iterator yielding each agent loop step. */
  steps: AsyncIterable<StepResult>;
  /** Resolves with the complete text when the loop finishes. */
  fullText: Promise<string>;
  /** Resolves with token usage and cost when the loop finishes. */
  usage: Promise<Usage>;
  /** Resolves with the finish reason. */
  finishReason: Promise<string>;
  /** Call to cancel the running loop. */
  abort: () => void;
  /** Returns a Web API Response with SSE body. */
  toResponse: () => Response;
  /** Returns a ReadableStream in SSE wire format. */
  toSSEStream: () => ReadableStream;
}
```

## Agent Types

### AgentCreateOptions

```typescript
interface AgentCreateOptions {
  /** Model identifier. */
  model?: string;
  /** LLM provider to use. */
  provider?: ProviderType;
  /** System prompt prepended to every conversation. */
  systemPrompt?: string;
  /** Tools available to the agent. */
  tools?: string[] | UserToolDefinition[];
  /** Skill names to activate. */
  skills?: string[];
  /** Maximum agent loop iterations. Default: 10. */
  maxSteps?: number;
  /** Tool execution mode. Default: "auto". */
  permissionMode?: "auto" | "confirm";
  /** Session persistence: directory path or custom SessionStore. */
  persist?: string | SessionStore;
  /** Lifecycle callbacks. */
  hooks?: Hooks;
  /** Extra config passed to tool handlers. */
  config?: Record<string, unknown>;
}
```

### SdkAgent

```typescript
interface SdkAgent {
  /** Send a message and get the full response. Context is preserved. */
  chat(message: string): Promise<AgentResponse>;
  /** Send a message with streaming output. */
  chatStream(message: string, options?: StreamTextOptions): Promise<StreamTextResult>;
  /** Switch the LLM provider (and optionally model) mid-conversation. */
  switchProvider(provider: ProviderType, model?: string): Promise<void>;
  /** Update the system prompt. */
  setSystemPrompt(prompt: string): void;
  /** Update the available tool set. */
  setTools(tools: string[]): void;
  /** Abort the currently running chat() or chatStream() call. */
  abort(): void;
  /** Clear conversation history. Keeps the system prompt. */
  clear(): void;
  /** Return a copy of the full conversation history. */
  getHistory(): Message[];
  /** Return cumulative token usage across all calls. */
  getUsage(): CumulativeUsage;
}
```

### AgentResponse

```typescript
interface AgentResponse {
  /** The assistant response text. */
  text: string;
  /** Tool calls made during this response. */
  toolCalls: ToolCall[];
  /** Token usage for this request. */
  usage: Usage;
}
```

### CumulativeUsage

```typescript
interface CumulativeUsage {
  /** Total prompt tokens across all requests. */
  totalPromptTokens: number;
  /** Total completion tokens across all requests. */
  totalCompletionTokens: number;
  /** Total estimated cost in USD across all requests. */
  totalCost: number;
  /** Total number of requests made. */
  requestCount: number;
}
```

## Tool Types

### UserToolDefinition

```typescript
interface UserToolDefinition {
  /** Tool name. Auto-generated if omitted. */
  name?: string;
  /** Description of what the tool does. Used by the LLM for tool selection. */
  description: string;
  /** Zod schema defining the tool's parameters. */
  parameters: unknown;
  /** The function that runs when the LLM calls this tool. */
  execute: (args: unknown, context: ToolContext) => Promise<string | ToolResult>;
}
```

### ToolContext

```typescript
interface ToolContext {
  /** Report progress during long-running operations. */
  onUpdate?: (progress: { percentage: number; message?: string }) => void;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Extra config from the agent or generateText call. */
  config?: Record<string, unknown>;
}
```

### ToolResult

```typescript
interface ToolResult {
  /** Tool output text. */
  output: string;
  /** Whether the tool execution succeeded. */
  success: boolean;
  /** Optional metadata about the execution. */
  metadata?: Record<string, unknown>;
}
```

### ToolDefinition

```typescript
interface ToolDefinition {
  /** Tool name, e.g. "read_file", "web_search". */
  name: string;
  /** Description of what the tool does. Used by the LLM for tool selection. */
  description: string;
  /** JSON Schema defining the tool's parameters. */
  parameters: Record<string, unknown>;
}
```

### ToolModule

```typescript
// Returned by the tool() factory
interface ToolModule {
  /** Tool name. */
  name: string;
  /** Config keys this tool reads from the agent config. */
  configKeys?: string[];
  /** Tool definition for the LLM. */
  definition: ToolDefinition;
  /** Execute function that runs when the LLM calls this tool. */
  handler: (args: any, config?: any) => Promise<string>;
}
```

## Hooks

```typescript
interface Hooks {
  /** Called before each tool execution. */
  beforeToolCall?: (
    call: { name: string; args: Record<string, unknown> },
  ) => void | Promise<void>;

  /** Called after each tool execution completes. */
  afterToolCall?: (
    result: { name: string; output: string; duration: number },
  ) => void | Promise<void>;

  /** Called for every step in the agent loop (text or tool_call). */
  onStep?: (step: StepResult) => void | Promise<void>;

  /** Called when an error occurs. */
  onError?: (error: ZclawError) => void | Promise<void>;

  /** Called when the agent loop finishes. */
  onFinish?: (result: GenerateTextResult) => void | Promise<void>;
}
```

## Error Types

### ZclawError

Base class for all ZClaw errors:

```typescript
class ZclawError extends Error {
  /** Machine-readable error code. */
  code: string;
  /** Whether the operation can be retried. */
  retryable: boolean;
}
```

### ProviderError

```typescript
class ProviderError extends ZclawError {
  code: "PROVIDER_ERROR";
  retryable: true;
  /** The provider name that produced the error. */
  provider?: string;
}
```

### ToolError

```typescript
class ToolError extends ZclawError {
  code: "TOOL_FAILED";
  retryable: true;
  /** The tool name that produced the error. */
  tool?: string;
}
```

### MaxStepsError

```typescript
class MaxStepsError extends ZclawError {
  code: "MAX_STEPS";
  retryable: false;
  /** The number of steps that were executed. */
  steps: number;
}
```

### AbortedError

```typescript
class AbortedError extends ZclawError {
  code: "ABORTED";
  retryable: false;
}
```

### Error summary

| Error class     | `code`             | `retryable` | Extra fields    | When                            |
|-----------------|--------------------|--------------|-----------------|---------------------------------|
| `ProviderError` | `PROVIDER_ERROR`   | `true`       | `provider?`     | LLM API failure, rate-limit     |
| `ToolError`     | `TOOL_FAILED`      | `true`       | `tool?`         | Tool execution failure          |
| `MaxStepsError` | `MAX_STEPS`        | `false`      | `steps`         | Agent loop exceeded `maxSteps`  |
| `AbortedError`  | `ABORTED`          | `false`      | *(none)*        | Cancelled via `AbortSignal`     |

## Provider Types

### MultiProviderConfig

```typescript
interface MultiProviderConfig {
  openai?: { apiKey: string; model?: string };
  anthropic?: { apiKey: string; model?: string };
  glm?: { apiKey: string; model?: string };
  "openai-compatible"?: { apiKey: string; baseUrl: string; model?: string };
  /** Default provider when none is specified. */
  default: ProviderType;
}
```

### ProviderConfig

Returned by the `provider()` factory:

```typescript
interface ProviderConfig {
  /** Provider type identifier. */
  type: ProviderType;
  /** API key for authentication. */
  apiKey: string;
  /** Model identifier to use. */
  model: string;
  /** Custom base URL (used by openai-compatible provider). */
  baseUrl?: string;
  /** Request timeout in milliseconds. */
  timeout?: number;
}
```

## Session Types

### SessionStore

```typescript
interface SessionStore {
  /** Save messages for a session. Creates or updates. */
  save(sessionId: string, messages: Message[]): Promise<void>;
  /** Load messages for a session. Returns null if not found. */
  load(sessionId: string): Promise<Message[] | null>;
  /** Delete a session. */
  delete(sessionId: string): Promise<void>;
  /** List all session IDs. */
  list(): Promise<string[]>;
}
```

### SessionData

```typescript
interface SessionData {
  /** Session identifier. */
  id: string;
  /** Conversation messages. */
  messages: Message[];
  /** Creation timestamp (Unix ms). */
  createdAt: number;
  /** Last update timestamp (Unix ms). */
  updatedAt: number;
  /** Provider used for this session. */
  provider?: ProviderType;
  /** Model used for this session. */
  model?: string;
}
```

### FileSessionStore

File-backed store, created by `createSessionStore()`:

```typescript
// Factory function
function createSessionStore(path?: string): SessionStore;
// Default path: ~/.zclaw/sessions/
```

### MemorySessionStore

In-memory store, created by `createMemoryStore()`:

```typescript
// Factory function
function createMemoryStore(): SessionStore;
```

## Skill Types

### SkillMetadata

```typescript
interface SkillMetadata {
  /** Unique skill identifier. */
  name: string;
  /** Short description shown to the LLM for skill selection. */
  description: string;
  /** Semantic version. */
  version: string;
  /** Tags for categorization. */
  tags: string[];
  /** Restrict which tools this skill can use. */
  allowedTools?: string[];
}
```

## Related pages

- [generateText()](/sdk/generate-text) -- One-shot execution
- [streamText()](/sdk/stream-text) -- Streaming execution
- [createAgent()](/sdk/create-agent) -- Stateful multi-turn agent
- [Custom Tools](/sdk/custom-tools) -- Building custom tools
- [Hooks](/sdk/hooks) -- Lifecycle callbacks
- [Providers](/sdk/providers) -- Multi-provider configuration
- [Session Persistence](/sdk/session-persistence) -- Session management
