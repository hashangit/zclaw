/**
 * ZClaw Server — WebSocket Protocol Handler
 *
 * Handles real-time bidirectional communication for streaming,
 * multi-turn conversations, session management, and more.
 *
 * NOTE: Requires the `ws` npm package for Node.js. Install it via:
 *   npm install ws
 *   npm install -D @types/ws
 *
 * The module uses a dynamic import so it fails gracefully if `ws` is missing.
 */

import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import * as crypto from "crypto";
import { authMiddleware } from "./auth.js";
import type { ServerSessionManager } from "./session-store.js";
import type {
  ProviderType,
  Message,
  Usage,
  GenerateTextResult,
} from "../../core/types.js";

// ── Types ──────────────────────────────────────────────────────────────

// ws types — we define a minimal interface to avoid hard import at top level
interface WS {
  WebSocket: new (address: string, protocols?: string | string[]) => WebSocket;
  WebSocketServer: new (options: {
    noServer?: boolean;
    path?: string;
  }) => WSServer;
}

interface WSServer {
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

interface WebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", cb: (data: Buffer) => void): void;
  on(event: "close", cb: (code: number, reason: Buffer) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "pong", cb: () => void): void;
  ping(data?: unknown): void;
  readyState: number;
}

// ── Client → Server message types ──────────────────────────────────────

interface ChatMessage {
  type: "chat";
  id: string;
  message: string;
  options?: {
    model?: string;
    provider?: ProviderType;
    tools?: string[];
    maxSteps?: number;
    skills?: string[];
  };
  sessionId?: string;
}

interface AbortMessage {
  type: "abort";
  reason?: string;
}

interface ResumeMessage {
  type: "resume";
  sessionId: string;
  lastMessageId?: string;
}

interface ReconnectMessage {
  type: "reconnect";
  sessionId: string;
  lastSeenId?: string;
}

interface SwitchProviderMessage {
  type: "switch_provider";
  provider: ProviderType;
  model?: string;
}

interface ListModelsMessage {
  type: "list_models";
}

interface ListSkillsMessage {
  type: "list_skills";
}

interface PingMessage {
  type: "ping";
  clientTime: string;
}

type ClientMessage =
  | ChatMessage
  | AbortMessage
  | ResumeMessage
  | ReconnectMessage
  | SwitchProviderMessage
  | ListModelsMessage
  | ListSkillsMessage
  | PingMessage;

// ── Server → Client message types ──────────────────────────────────────

interface AckMessage {
  type: "ack";
  clientMsgId: string;
  serverMsgId: string;
  timestamp: string;
}

interface TextDeltaMessage {
  type: "text";
  delta: string;
  serverMsgId: string;
}

interface ToolCallMessage {
  type: "tool_call";
  callId: string;
  name: string;
  args: object;
}

interface ToolProgressMessage {
  type: "tool_progress";
  callId: string;
  percentage: number;
  output?: string;
}

interface ToolResultMessage {
  type: "tool_result";
  callId: string;
  output: string;
  success: boolean;
}

interface ProgressMessage {
  type: "progress";
  step: number;
  totalSteps: number;
  percentage: number;
  activity: string;
}

interface UsageMessage {
  type: "usage";
  promptTokens: number;
  completionTokens: number;
  cost: number;
}

interface DoneMessage {
  type: "done";
  serverMsgId: string;
  usage: Usage;
  finishReason: string;
}

interface SessionCreatedMessage {
  type: "session_created";
  sessionId: string;
  expiresAt: string;
}

interface SessionResumedMessage {
  type: "session_resumed";
  sessionId: string;
  messages: Message[];
}

interface ReplayMessage {
  type: "replay";
  messages: object[];
  currentStatus: string;
}

interface ErrorMessage {
  type: "error";
  code: string;
  retryable: boolean;
  message: string;
  provider?: string;
  tool?: string;
}

interface PongMessage {
  type: "pong";
  serverTime: string;
}

interface ModelsListMessage {
  type: "models_list";
  models: Record<string, string[]>;
}

interface SkillsListMessage {
  type: "skills_list";
  skills: { name: string; description: string; tags: string[] }[];
}

type ServerMessage =
  | AckMessage
  | TextDeltaMessage
  | ToolCallMessage
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

// ── Context ────────────────────────────────────────────────────────────

export interface WebSocketHandlerContext {
  sessionManager: ServerSessionManager;
  streamText: (options: {
    message: string;
    model?: string;
    provider?: ProviderType;
    tools?: string[];
    maxSteps?: number;
    skills?: string[];
    sessionId?: string;
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
}

// ── Connection state ───────────────────────────────────────────────────

interface ConnectionState {
  sessionId: string | null;
  currentAbortController: AbortController | null;
  activeProvider: ProviderType | null;
  activeModel: string | null;
}

// ── Active connections registry ────────────────────────────────────────

const activeConnections = new Map<WebSocket, ConnectionState>();

/**
 * Get the number of currently active WebSocket connections.
 */
export function getActiveConnectionCount(): number {
  return activeConnections.size;
}

// ── Send helper ────────────────────────────────────────────────────────

function safeSend(ws: WebSocket, message: ServerMessage): void {
  try {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(message));
    }
  } catch {
    // Connection may have closed
  }
}

// ── Protocol handler ───────────────────────────────────────────────────

function handleConnection(
  ws: WebSocket,
  req: IncomingMessage,
  ctx: WebSocketHandlerContext,
): void {
  // Auth check — the token should have been validated during upgrade,
  // but verify again for safety
  const key = authMiddleware(req);
  if (!key) {
    safeSend(ws, {
      type: "error",
      code: "UNAUTHORIZED",
      retryable: false,
      message: "Authentication required",
    });
    ws.close(4001, "Unauthorized");
    return;
  }

  const state: ConnectionState = {
    sessionId: null,
    currentAbortController: null,
    activeProvider: null,
    activeModel: null,
  };

  activeConnections.set(ws, state);

  // ── Message dispatch ───────────────────────────────────────────────

  ws.on("message", (data: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString("utf-8")) as ClientMessage;
    } catch {
      safeSend(ws, {
        type: "error",
        code: "INVALID_MESSAGE",
        retryable: false,
        message: "Invalid JSON message",
      });
      return;
    }

    switch (msg.type) {
      case "chat":
        handleChat(ws, msg, state, ctx);
        break;
      case "abort":
        handleAbort(ws, msg, state);
        break;
      case "resume":
        handleResume(ws, msg, state, ctx);
        break;
      case "reconnect":
        handleReconnect(ws, msg, state, ctx);
        break;
      case "switch_provider":
        handleSwitchProvider(ws, msg, state);
        break;
      case "list_models":
        handleListModels(ws, ctx);
        break;
      case "list_skills":
        handleListSkills(ws, ctx);
        break;
      case "ping":
        safeSend(ws, {
          type: "pong",
          serverTime: new Date().toISOString(),
        });
        break;
      default:
        safeSend(ws, {
          type: "error",
          code: "UNKNOWN_MESSAGE_TYPE",
          retryable: false,
          message: `Unknown message type: ${(msg as { type: string }).type}`,
        });
    }
  });

  // ── Close ──────────────────────────────────────────────────────────

  ws.on("close", () => {
    // Abort any in-flight stream
    if (state.currentAbortController) {
      state.currentAbortController.abort();
      state.currentAbortController = null;
    }
    activeConnections.delete(ws);
  });

  // ── Error ──────────────────────────────────────────────────────────

  ws.on("error", (err: Error) => {
    console.error("[ws] Connection error:", err.message);
    if (state.currentAbortController) {
      state.currentAbortController.abort();
      state.currentAbortController = null;
    }
    activeConnections.delete(ws);
  });
}

// ── Chat handler ───────────────────────────────────────────────────────

function handleChat(
  ws: WebSocket,
  msg: ChatMessage,
  state: ConnectionState,
  ctx: WebSocketHandlerContext,
): void {
  const serverMsgId = crypto.randomUUID();

  // Acknowledge
  safeSend(ws, {
    type: "ack",
    clientMsgId: msg.id,
    serverMsgId,
    timestamp: new Date().toISOString(),
  });

  // Create session if needed
  if (!state.sessionId && msg.sessionId) {
    state.sessionId = msg.sessionId;
  }

  // Set up abort controller
  const abortController = new AbortController();
  state.currentAbortController = abortController;

  // Resolve options with connection-level overrides
  const provider = msg.options?.provider ?? state.activeProvider ?? undefined;
  const model = msg.options?.model ?? state.activeModel ?? undefined;

  // Stream text
  try {
    ctx.streamText({
      message: msg.message,
      model,
      provider,
      tools: msg.options?.tools,
      maxSteps: msg.options?.maxSteps ?? 10,
      skills: msg.options?.skills,
      sessionId: state.sessionId ?? undefined,
      signal: abortController.signal,
      onText: (delta) => {
        safeSend(ws, {
          type: "text",
          delta,
          serverMsgId,
        });
      },
      onToolCall: (info) => {
        safeSend(ws, {
          type: "tool_call",
          callId: info.callId,
          name: info.name,
          args: info.args,
        });
      },
      onToolResult: (info) => {
        safeSend(ws, {
          type: "tool_result",
          callId: info.callId,
          output: info.output,
          success: info.success,
        });
      },
      onStep: (step) => {
        // Estimate progress — we don't know totalSteps ahead of time
        safeSend(ws, {
          type: "progress",
          step: 0,
          totalSteps: 0,
          percentage: 0,
          activity: step.content ?? step.type,
        });
      },
      onError: (error) => {
        safeSend(ws, {
          type: "error",
          code: error.code || "STREAM_ERROR",
          retryable: error.code === "PROVIDER_ERROR",
          message: error.message,
          provider: error.provider,
          tool: error.tool,
        });
      },
      onDone: (result) => {
        safeSend(ws, {
          type: "done",
          serverMsgId,
          usage: result.usage,
          finishReason: result.finishReason,
        });

        // Add assistant message to session
        if (state.sessionId) {
          const assistantMsg: Message = {
            id: serverMsgId,
            role: "assistant",
            content: result.text,
            timestamp: Date.now(),
          };
          ctx.sessionManager.addMessage(state.sessionId, assistantMsg);
        }

        state.currentAbortController = null;
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Stream failed";
    safeSend(ws, {
      type: "error",
      code: "STREAM_ERROR",
      retryable: false,
      message,
    });
    state.currentAbortController = null;
  }
}

// ── Abort handler ──────────────────────────────────────────────────────

function handleAbort(
  ws: WebSocket,
  _msg: AbortMessage,
  state: ConnectionState,
): void {
  if (state.currentAbortController) {
    state.currentAbortController.abort();
    state.currentAbortController = null;
    safeSend(ws, {
      type: "error",
      code: "ABORTED",
      retryable: false,
      message: "Request aborted by client",
    });
  }
}

// ── Resume handler ─────────────────────────────────────────────────────

function handleResume(
  ws: WebSocket,
  msg: ResumeMessage,
  state: ConnectionState,
  ctx: WebSocketHandlerContext,
): void {
  const session = ctx.sessionManager.getSession(msg.sessionId);
  if (!session) {
    safeSend(ws, {
      type: "error",
      code: "SESSION_NOT_FOUND",
      retryable: false,
      message: `Session ${msg.sessionId} not found or expired`,
    });
    return;
  }

  state.sessionId = msg.sessionId;

  safeSend(ws, {
    type: "session_resumed",
    sessionId: msg.sessionId,
    messages: session.messages,
  });
}

// ── Reconnect handler ──────────────────────────────────────────────────

function handleReconnect(
  ws: WebSocket,
  msg: ReconnectMessage,
  state: ConnectionState,
  ctx: WebSocketHandlerContext,
): void {
  const session = ctx.sessionManager.getSession(msg.sessionId);
  if (!session) {
    safeSend(ws, {
      type: "error",
      code: "SESSION_NOT_FOUND",
      retryable: false,
      message: `Session ${msg.sessionId} not found or expired`,
    });
    return;
  }

  state.sessionId = msg.sessionId;

  // Replay messages — optionally only those after lastSeenId
  let messages = session.messages;
  if (msg.lastSeenId) {
    const lastIndex = messages.findIndex((m) => m.id === msg.lastSeenId);
    if (lastIndex !== -1) {
      messages = messages.slice(lastIndex + 1);
    }
  }

  safeSend(ws, {
    type: "replay",
    messages,
    currentStatus: "ready",
  });
}

// ── Switch provider handler ────────────────────────────────────────────

function handleSwitchProvider(
  ws: WebSocket,
  msg: SwitchProviderMessage,
  state: ConnectionState,
): void {
  state.activeProvider = msg.provider;
  if (msg.model) {
    state.activeModel = msg.model;
  }

  safeSend(ws, {
    type: "ack",
    clientMsgId: "",
    serverMsgId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  });
}

// ── List models handler ────────────────────────────────────────────────

function handleListModels(
  ws: WebSocket,
  ctx: WebSocketHandlerContext,
): void {
  safeSend(ws, {
    type: "models_list",
    models: ctx.listModels(),
  });
}

// ── List skills handler ────────────────────────────────────────────────

function handleListSkills(
  ws: WebSocket,
  ctx: WebSocketHandlerContext,
): void {
  safeSend(ws, {
    type: "skills_list",
    skills: ctx.listSkills(),
  });
}

// ── Exported setup function ────────────────────────────────────────────

let wss: WSServer | null = null;

/**
 * Initialize the WebSocket server.
 *
 * Uses a dynamic import for the `ws` package. If it's not installed,
 * logs a warning and returns null.
 */
export async function setupWebSocket(
  server: import("http").Server,
  ctx: WebSocketHandlerContext,
): Promise<WSServer | null> {
  let wsModule: WS;
  try {
    // @ts-expect-error — ws is an optional peer dependency
    wsModule = (await import("ws")) as unknown as WS;
  } catch {
    console.warn(
      "[ws] The 'ws' package is not installed. WebSocket support is disabled.\n" +
        "       Install it with: npm install ws",
    );
    return null;
  }

  wss = new wsModule.WebSocketServer({ noServer: true, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    handleConnection(ws, req, ctx);
  });

  // Handle HTTP upgrade requests
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Only handle /ws upgrades
    const url = req.url?.split("?")[0];
    if (url !== "/ws") {
      return;
    }

    // Authenticate the upgrade request
    const key = authMiddleware(req);
    if (!key) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss!.emit("connection", ws, req);
    });
  });

  return wss;
}

/**
 * Close the WebSocket server and all active connections.
 */
export function closeWebSocket(): void {
  if (wss) {
    // Close all active connections
    for (const [ws] of activeConnections) {
      try {
        ws.close(1001, "Server shutting down");
      } catch {
        // Ignore errors during shutdown
      }
    }
    activeConnections.clear();
    wss.close();
    wss = null;
  }
}
