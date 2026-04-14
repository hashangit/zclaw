/**
 * ZClaw Server — WebSocket Type Definitions
 *
 * All WS library type shims, protocol message interfaces, and context types.
 * Extracted from websocket.ts for single-responsibility.
 */

import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import type {
  ProviderType,
  Message,
  Usage,
  PermissionLevel,
} from "../../core/types.js";

// ── WS library type shims ────────────────────────────────────────────

export interface WS {
  WebSocket: new (address: string, protocols?: string | string[]) => WebSocket;
  WebSocketServer: new (options: {
    noServer?: boolean;
    path?: string;
  }) => WSServer;
}

export interface WSServer {
  on(event: "connection", cb: (ws: WebSocket, req: IncomingMessage) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "headers", cb: (headers: string[], req: IncomingMessage) => void): void;
  emit(event: "connection", ws: WebSocket, req: IncomingMessage): void;
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    cb: (ws: WebSocket) => void,
  ): void;
  close(): void;
}

export interface WebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", cb: (data: Buffer) => void): void;
  on(event: "close", cb: (code: number, reason: Buffer) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "pong", cb: () => void): void;
  ping(data?: unknown): void;
  readyState: number;
}

// ── Client → Server message types ────────────────────────────────────

export interface ChatMessage {
  type: "chat";
  id: string;
  message: string;
  options?: {
    model?: string;
    provider?: ProviderType;
    tools?: string[];
    maxSteps?: number;
    skills?: string[];
    permissionLevel?: PermissionLevel;
  };
  sessionId?: string;
}

export interface ToolApprovalResponse {
  type: "tool_approval_response";
  callId: string;
  approved: boolean;
}

export interface AbortMessage {
  type: "abort";
  reason?: string;
}

export interface ResumeMessage {
  type: "resume";
  sessionId: string;
  lastMessageId?: string;
}

export interface ReconnectMessage {
  type: "reconnect";
  sessionId: string;
  lastSeenId?: string;
}

export interface SwitchProviderMessage {
  type: "switch_provider";
  provider: ProviderType;
  model?: string;
}

export interface ListModelsMessage {
  type: "list_models";
}

export interface ListSkillsMessage {
  type: "list_skills";
}

export interface PingMessage {
  type: "ping";
  clientTime: string;
}

export type ClientMessage =
  | ChatMessage
  | ToolApprovalResponse
  | AbortMessage
  | ResumeMessage
  | ReconnectMessage
  | SwitchProviderMessage
  | ListModelsMessage
  | ListSkillsMessage
  | PingMessage;

// ── Server → Client message types ────────────────────────────────────

export interface AckMessage {
  type: "ack";
  clientMsgId: string;
  serverMsgId: string;
  timestamp: string;
}

export interface TextDeltaMessage {
  type: "text";
  delta: string;
  serverMsgId: string;
}

export interface ToolCallMessage {
  type: "tool_call";
  callId: string;
  name: string;
  args: object;
}

export interface ToolApprovalRequestMessage {
  type: "tool_approval_request";
  callId: string;
  name: string;
  args: object;
}

export interface ToolProgressMessage {
  type: "tool_progress";
  callId: string;
  percentage: number;
  output?: string;
}

export interface ToolResultMessage {
  type: "tool_result";
  callId: string;
  output: string;
  success: boolean;
}

export interface ProgressMessage {
  type: "progress";
  step: number;
  totalSteps: number;
  percentage: number;
  activity: string;
}

export interface UsageMessage {
  type: "usage";
  promptTokens: number;
  completionTokens: number;
  cost: number;
}

export interface DoneMessage {
  type: "done";
  serverMsgId: string;
  usage: Usage;
  finishReason: string;
}

export interface SessionCreatedMessage {
  type: "session_created";
  sessionId: string;
  expiresAt: string;
}

export interface SessionResumedMessage {
  type: "session_resumed";
  sessionId: string;
  messages: Message[];
}

export interface ReplayMessage {
  type: "replay";
  messages: object[];
  currentStatus: string;
}

export interface ErrorMessage {
  type: "error";
  code: string;
  retryable: boolean;
  message: string;
  provider?: string;
  tool?: string;
}

export interface PongMessage {
  type: "pong";
  serverTime: string;
}

export interface ModelsListMessage {
  type: "models_list";
  models: Record<string, string[]>;
}

export interface SkillsListMessage {
  type: "skills_list";
  skills: { name: string; description: string; tags: string[] }[];
}

export type ServerMessage =
  | AckMessage
  | TextDeltaMessage
  | ToolCallMessage
  | ToolApprovalRequestMessage
  | ToolProgressMessage
  | ToolResultMessage
  | ProgressMessage
  | UsageMessage
  | DoneMessage
  | SessionCreatedMessage
  | SessionResumedMessage
  | ReplayMessage
  | ErrorMessage
  | PongMessage
  | ModelsListMessage
  | SkillsListMessage;

// ── Context ──────────────────────────────────────────────────────────

export interface WebSocketHandlerContext {
  sessionManager: import("./session-store.js").ServerSessionManager;
  streamText: (options: {
    message: string;
    model?: string;
    provider?: ProviderType;
    tools?: string[];
    maxSteps?: number;
    skills?: string[];
    sessionId?: string;
    permissionLevel?: PermissionLevel;
    onText: (delta: string) => void;
    onToolCall: (info: { name: string; args: Record<string, unknown>; callId: string }) => void;
    onToolResult: (info: { callId: string; output: string; success: boolean }) => void;
    onStep: (step: { type: string; content?: string; timestamp: number }) => void;
    onError: (error: { code: string; message: string; provider?: string; tool?: string }) => void;
    onDone: (result: { text: string; usage: Usage; finishReason: string }) => void;
    signal?: AbortSignal;
  }) => void;
  listModels: () => Record<ProviderType, string[]>;
  listSkills: () => { name: string; description: string; tags: string[] }[];
  maxPermissionLevel?: PermissionLevel;
}

// ── Connection state ─────────────────────────────────────────────────

export interface ConnectionState {
  sessionId: string | null;
  currentAbortController: AbortController | null;
  activeProvider: ProviderType | null;
  activeModel: string | null;
  permissionLevel?: PermissionLevel;
  maxPermissionLevel?: PermissionLevel;
}
