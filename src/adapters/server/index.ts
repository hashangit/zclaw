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
import * as crypto from "crypto";
import type { ProviderType, GenerateTextResult, Usage } from "../../core/types.js";
import { generateText, streamText } from "../sdk/index.js";
import { configureProviders, getProvider, getDefaultProviderType } from "../../core/provider-resolver.js";
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
  const config: Record<string, { apiKey: string; model?: string; baseUrl?: string }> = {};

  if (process.env.OPENAI_API_KEY) {
    config.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    config.anthropic = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
    };
  }
  if (process.env.GLM_API_KEY) {
    config.glm = {
      apiKey: process.env.GLM_API_KEY,
      model: process.env.GLM_MODEL ?? "glm-5.1",
    };
  }
  if ((process.env.OPENAI_COMPAT_API_KEY || process.env.ZCLAW_API_KEY) &&
      (process.env.OPENAI_COMPAT_BASE_URL || process.env.OPENAI_BASE_URL)) {
    config["openai-compatible"] = {
      apiKey: process.env.OPENAI_COMPAT_API_KEY || process.env.ZCLAW_API_KEY!,
      baseUrl: process.env.OPENAI_COMPAT_BASE_URL || process.env.OPENAI_BASE_URL!,
      model: process.env.ZCLAW_MODEL ?? "gpt-4o",
    };
  }

  if (Object.keys(config).length > 0) {
    const defaultProvider = (process.env.ZCLAW_PROVIDER as ProviderType) ??
      (config.openai ? "openai" : Object.keys(config)[0]) as ProviderType;

    configureProviders({
      ...config,
      default: defaultProvider,
    } as any);
  }
}

// ── SDK wrapper functions ───────────────────────────────────────────────

/**
 * Thin wrapper around SDK's generateText for server use.
 */
async function serverGenerateText(options: {
  message: string;
  model?: string;
  provider?: ProviderType;
  tools?: string[];
  maxSteps?: number;
  skills?: string[];
}): Promise<GenerateTextResult> {
  return generateText(options.message, {
    model: options.model,
    provider: options.provider,
    tools: options.tools,
    maxSteps: options.maxSteps ?? 5,
  });
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
    generateText: serverGenerateText,
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
      serverStreamText(opts).catch((err) => {
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
 * Thin wrapper around SDK's streamText for server use.
 */
async function serverStreamText(opts: {
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
}): Promise<void> {
  try {
    const stream = await streamText(opts.message, {
      model: opts.model,
      provider: opts.provider,
      tools: opts.tools,
      maxSteps: opts.maxSteps ?? 5,
      onText: opts.onText,
      onToolCall: opts.onToolCall,
      onToolResult: opts.onToolResult,
      onStep: opts.onStep,
      signal: opts.signal,
    });

    const [text, usage, finishReason] = await Promise.all([
      stream.fullText,
      stream.usage,
      stream.finishReason,
    ]);

    opts.onDone({ text, usage, finishReason });
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
