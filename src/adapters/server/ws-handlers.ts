/**
 * ZClaw Server — WebSocket Protocol Handlers
 *
 * All handler functions, safeSend helper, and active connections registry.
 * Extracted from websocket.ts for single-responsibility.
 */

import * as crypto from "crypto";
import { authMiddleware } from "./auth.js";
import type {
  WebSocket,
  WSServer,
  ClientMessage,
  ServerMessage,
  ChatMessage,
  AbortMessage,
  ResumeMessage,
  ReconnectMessage,
  SwitchProviderMessage,
  WebSocketHandlerContext,
  ConnectionState,
} from "./ws-types.js";

// ── Active connections registry ──────────────────────────────────────

const activeConnections = new Map<WebSocket, ConnectionState>();

/**
 * Get the number of currently active WebSocket connections.
 */
export function getActiveConnectionCount(): number {
  return activeConnections.size;
}

// ── Send helper ──────────────────────────────────────────────────────

export function safeSend(ws: WebSocket, message: ServerMessage): void {
  try {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(message));
    }
  } catch {
    // Connection may have closed
  }
}

// ── Protocol handler ─────────────────────────────────────────────────

export function handleConnection(
  ws: WebSocket,
  req: import("http").IncomingMessage,
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

// ── Chat handler ─────────────────────────────────────────────────────

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
          const assistantMsg: import("../../core/types.js").Message = {
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

// ── Abort handler ────────────────────────────────────────────────────

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

// ── Resume handler ───────────────────────────────────────────────────

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

// ── Reconnect handler ────────────────────────────────────────────────

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

// ── Switch provider handler ──────────────────────────────────────────

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

// ── List models handler ──────────────────────────────────────────────

function handleListModels(
  ws: WebSocket,
  ctx: WebSocketHandlerContext,
): void {
  safeSend(ws, {
    type: "models_list",
    models: ctx.listModels(),
  });
}

// ── List skills handler ──────────────────────────────────────────────

function handleListSkills(
  ws: WebSocket,
  ctx: WebSocketHandlerContext,
): void {
  safeSend(ws, {
    type: "skills_list",
    skills: ctx.listSkills(),
  });
}

// ── Active connections accessor (for closeWebSocket) ──────────────────

/**
 * Close all active connections and clear the registry.
 * Used by closeWebSocket() during shutdown.
 */
export function closeAllConnections(): void {
  for (const [ws] of activeConnections) {
    try {
      ws.close(1001, "Server shutting down");
    } catch {
      // Ignore errors during shutdown
    }
  }
  activeConnections.clear();
}
