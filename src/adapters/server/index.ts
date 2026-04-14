/**
 * ZClaw Remote Server — Entry Point
 *
 * Creates an HTTP server with REST endpoints and WebSocket support
 * for real-time streaming conversations with LLM providers.
 *
 * Default port: 7337
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";

import type { ProviderType, GenerateTextResult, Usage, Message, PermissionLevel } from "../../core/types.js";
import { runAgentLoop } from "../../core/agent-loop.js";
import { createHookExecutor } from "../../core/hooks.js";
import { resolveTools, getAllToolDefinitions } from "../../core/tool-executor.js";
import { generateId, now } from "../../core/message-convert.js";
import { configureProviders, getProvider, resolveFromEnv } from "../../core/provider-resolver.js";
import { createRestHandler, type RestHandlerContext } from "./rest.js";
import { setupWebSocket, closeWebSocket, type WebSocketHandlerContext } from "./websocket.js";
import { ServerSessionManager } from "./session-store.js";
import { MODEL_CATALOG } from "../../models-catalog.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface ServerOptions {
  /** Port to listen on (default: ZCLAW_PORT, PORT, or 7337) */
  port?: number;
  /** Host to bind to (default: "0.0.0.0") */
  host?: string;
  /** Enable CORS headers (default: true) */
  cors?: boolean;
  /** Session TTL in seconds (default: 86400 = 24 hours) */
  sessionTTL?: number;
  /** Default permission level for REST endpoints (default: "moderate") */
  permissionLevel?: PermissionLevel;
  /** Maximum permission level clients can request (caps WebSocket messages) */
  maxPermissionLevel?: PermissionLevel;
}

interface ReadPackageJson {
  version: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function resolveVersion(): string {
  try {
    // Try relative to dist/ first (production), then src/ (development)
    const pkgPath = path.join(import.meta.dirname ?? ".", "..", "..", "package.json");
    const raw = fs.readFileSync(pkgPath, "utf-8");
    return (JSON.parse(raw) as ReadPackageJson).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function resolvePort(options?: ServerOptions): number {
  if (options?.port) return options.port;
  const fromEnv = parseInt(process.env.ZCLAW_PORT ?? process.env.PORT ?? "", 10);
  if (!isNaN(fromEnv) && fromEnv > 0) return fromEnv;
  return 7337;
}

// ── Provider initialization ────────────────────────────────────────────

function initializeProvidersFromEnv(): void {
  const config = resolveFromEnv();
  if (config) {
    configureProviders(config);
  }
}

// ── Core-backed generation functions ───────────────────────────────────

/**
 * Server-side generateText using core agent loop directly.
 */
async function serverGenerateText(
  options: {
    message: string;
    model?: string;
    provider?: ProviderType;
    tools?: string[];
    maxSteps?: number;
    skills?: string[];
  },
  permissionLevel: PermissionLevel,
): Promise<GenerateTextResult> {
  // Resolve provider
  const { provider: llmProvider, model } = await getProvider(options.provider);

  // Resolve tools
  const toolDefs = options.tools ? resolveTools(options.tools) : getAllToolDefinitions();

  // Hooks
  const hooks = createHookExecutor();

  // Build message list
  const messages: Message[] = [];
  messages.push({
    id: generateId(),
    role: "user",
    content: options.message,
    timestamp: now(),
  });

  // Run the agent loop
  const result = await runAgentLoop({
    provider: llmProvider,
    model: options.model ?? model,
    messages,
    toolDefs,
    maxSteps: options.maxSteps ?? 5,
    hooks,
    permissionLevel,
  });

  // Extract final text from last assistant message
  const lastAssistant = [...result.messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content);
  const text = lastAssistant?.content ?? "";

  return {
    text,
    steps: result.steps,
    toolCalls: result.toolCalls,
    usage: result.usage,
    finishReason: result.finishReason as GenerateTextResult["finishReason"],
    messages: result.messages,
  };
}

function listModels(): Record<ProviderType, string[]> {
  const result: Record<ProviderType, string[]> = {
    openai: [],
    anthropic: [],
    glm: [],
    "openai-compatible": [],
  };

  for (const [provider, entries] of Object.entries(MODEL_CATALOG)) {
    if (provider in result) {
      result[provider as ProviderType] = entries.map((e) => e.id);
    }
  }

  return result;
}

/**
 * Cached skill list — populated asynchronously at startup.
 */
let cachedSkillList: { name: string; description: string; tags: string[] }[] = [];

/**
 * Initialize the skill registry and cache the skill metadata list.
 * Called once during server startup.
 */
export async function initializeSkills(): Promise<void> {
  try {
    const { getSkillRegistry } = await import("../../skills/index.js");
    const registry = getSkillRegistry();
    if (registry) {
      cachedSkillList = registry.getMetadata().map((s) => ({
        name: s.name,
        description: s.description,
        tags: s.tags,
      }));
    }
  } catch {
    // Skills system not available — keep empty list
  }
}

function listSkills(): { name: string; description: string; tags: string[] }[] {
  return cachedSkillList;
}

// ── CORS helper ────────────────────────────────────────────────────────

function addCORSHeaders(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const origin = req.headers.origin ?? "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Zclaw-API-Key");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function isPreflight(req: http.IncomingMessage): boolean {
  return req.method === "OPTIONS";
}

function handlePreflight(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  res.writeHead(204);
  res.end();
}

// ── Server creation ────────────────────────────────────────────────────

/**
 * Create and return the ZClaw HTTP server (not yet listening).
 *
 * This sets up REST endpoints, WebSocket upgrade handling,
 * session management, and CORS support.
 */
export async function createServer(options?: ServerOptions): Promise<http.Server> {
  const version = resolveVersion();
  const startTime = Date.now();

  // Initialize providers from environment
  initializeProvidersFromEnv();

  const serverPermissionLevel = options?.permissionLevel ?? "moderate";

  // Resolve session directory
  const sessionDir = process.env.ZCLAW_SESSION_DIR ??
    path.join(process.cwd(), ".zclaw", "sessions");

  const sessionTTL = (options?.sessionTTL ?? parseInt(process.env.ZCLAW_SESSION_TTL ?? "86400", 10)) * 1000;

  // Create session manager
  const sessionManager = new ServerSessionManager({
    sessionDir,
    sessionTTL,
  });
  sessionManager.startCleanup();

  // Create REST handler context
  const restCtx: RestHandlerContext = {
    version,
    startTime,
    sessionManager,
    generateText: (opts) => serverGenerateText(opts, serverPermissionLevel),
    listModels,
    listSkills,
  };

  const restHandler = createRestHandler(restCtx);

  // Create HTTP server
  const enableCors = options?.cors ?? true;

  const server = http.createServer((req, res) => {
    // CORS
    if (enableCors) {
      addCORSHeaders(req, res);
    }

    // Preflight
    if (isPreflight(req)) {
      handlePreflight(req, res);
      return;
    }

    // Delegate to REST handler
    restHandler(req, res);
  });

  // Create WebSocket handler context
  const wsCtx: WebSocketHandlerContext = {
    sessionManager,
    streamText: (opts) => {
      serverStreamText(opts, serverPermissionLevel).catch((err) => {
        opts.onError({
          code: "STREAM_ERROR",
          message: err instanceof Error ? err.message : "Stream failed",
        });
        opts.onDone({
          text: "",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
          finishReason: "error",
        });
      });
    },
    listModels,
    listSkills,
    maxPermissionLevel: options?.maxPermissionLevel,
  };

  // Set up WebSocket (async, but we wait for it)
  await setupWebSocket(server, wsCtx);

  // Graceful shutdown handler
  const shutdown = () => {
    console.log("[server] Shutting down...");
    sessionManager.stopCleanup();
    closeWebSocket();
    server.close(() => {
      console.log("[server] Server closed.");
      process.exit(0);
    });
    // Force exit after 5 seconds if connections don't close
    setTimeout(() => process.exit(0), 5000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
}

/**
 * Server-side streamText using core agent loop directly.
 */
async function serverStreamText(
  opts: {
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
  },
  serverPermissionLevel: PermissionLevel,
): Promise<void> {
  try {
    // Resolve provider
    const { provider: llmProvider, model } = await getProvider(opts.provider);

    // Resolve tools
    const toolDefs = opts.tools ? resolveTools(opts.tools) : getAllToolDefinitions();

    // Hooks
    const hooks = createHookExecutor();

    // Build message list
    const messages: Message[] = [];
    messages.push({
      id: generateId(),
      role: "user",
      content: opts.message,
      timestamp: now(),
    });

    // Accumulate text for the final result
    let accumulatedText = "";

    // Run the agent loop with onStep callbacks
    const result = await runAgentLoop({
      provider: llmProvider,
      model: opts.model ?? model,
      messages,
      toolDefs,
      maxSteps: opts.maxSteps ?? 5,
      hooks,
      permissionLevel: opts.permissionLevel ?? serverPermissionLevel,
      signal: opts.signal,
      onStep: (step) => {
        if (step.type === "text" && step.content) {
          accumulatedText += step.content;
          opts.onText(step.content);
        }
        if (step.type === "tool_call" && step.toolCall) {
          opts.onToolCall({
            name: step.toolCall.name,
            args: step.toolCall.args,
            callId: step.toolCall.name,
          });
          opts.onToolResult({
            callId: step.toolCall.name,
            output: step.toolCall.result,
            success: !step.toolCall.result.startsWith("Error:"),
          });
        }
        opts.onStep(step);
      },
    });

    opts.onDone({
      text: accumulatedText,
      usage: result.usage,
      finishReason: result.finishReason,
    });
  } catch (err) {
    opts.onError({
      code: "STREAM_ERROR",
      message: err instanceof Error ? err.message : "Stream failed",
    });
    opts.onDone({
      text: "",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
      finishReason: "error",
    });
  }
}

// ── Convenience starter ────────────────────────────────────────────────

/**
 * Create and start listening. Returns the running server.
 */
export async function startServer(options?: ServerOptions): Promise<http.Server> {
  const server = await createServer(options);

  const port = resolvePort(options);
  const host = options?.host ?? "0.0.0.0";

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      console.log(`[zclaw] Server listening on ${host}:${port}`);
      resolve(server);
    });
  });
}
