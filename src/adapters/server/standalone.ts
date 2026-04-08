#!/usr/bin/env node
/**
 * ZClaw Server — Standalone Entry Point
 *
 * Starts the ZClaw remote server as a standalone process.
 * Suitable as a Docker CMD/ENTRYPOINT or direct CLI invocation.
 *
 * Usage:
 *   node dist/adapters/server/standalone.js
 *   node dist/adapters/server/standalone.js --generate-api-key
 *
 * Environment variables:
 *   ZCLAW_PORT / PORT     — Port to listen on (default: 7337)
 *   ZCLAW_HOST            — Host to bind to (default: "0.0.0.0")
 *   ZCLAW_SESSION_DIR     — Directory for session storage
 *   ZCLAW_SESSION_TTL     — Session TTL in seconds (default: 86400)
 *   ZCLAW_API_KEYS_FILE   — Path to API key store file
 */

import * as fs from "fs";
import * as path from "path";
import { createServer, startServer, initializeSkills } from "./index.js";
import { generateApiKey } from "./auth.js";
import type { ServerOptions } from "./index.js";

// ── Version ────────────────────────────────────────────────────────────

function resolveVersion(): string {
  try {
    const pkgPath = path.join(
      import.meta.dirname ?? ".",
      "..",
      "..",
      "package.json",
    );
    const raw = fs.readFileSync(pkgPath, "utf-8");
    return JSON.parse(raw).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ── API Key Generation ─────────────────────────────────────────────────

function handleGenerateApiKey(): void {
  const filePath = process.env.ZCLAW_API_KEYS_FILE || undefined;
  const entry = generateApiKey(["agent:run", "admin"], {
    label: "cli-generated",
    filePath,
  });
  process.stdout.write(`Generated API key:\n\n  ${entry.key}\n\n`);
  process.stdout.write(
    `Scopes: ${entry.scopes.join(", ")}\n` +
      `Created: ${entry.created}\n` +
      `Stored in: ${filePath ?? "~/.zclaw/server-keys.json"}\n`,
  );
  process.exit(0);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Handle --generate-api-key flag
  if (process.argv.includes("--generate-api-key")) {
    handleGenerateApiKey();
    return; // unreachable, but satisfies type checker
  }

  const version = resolveVersion();

  // Resolve configuration from environment
  const port = parseInt(process.env.ZCLAW_PORT ?? process.env.PORT ?? "", 10);
  const host = process.env.ZCLAW_HOST ?? "0.0.0.0";
  const sessionTTL = parseInt(process.env.ZCLAW_SESSION_TTL ?? "", 10);
  const apiKeysFile = process.env.ZCLAW_API_KEYS_FILE;

  // Expose API keys file path for the auth module if provided
  if (apiKeysFile) {
    process.env.ZCLAW_API_KEYS_FILE = apiKeysFile;
  }

  const options: ServerOptions = {
    host,
    ...(isNaN(port) || port <= 0 ? {} : { port }),
    ...(isNaN(sessionTTL) || sessionTTL <= 0 ? {} : { sessionTTL }),
  };

  process.stdout.write(`[zclaw] Starting ZClaw server v${version}\n`);

  try {
    // Initialize skills registry
    await initializeSkills();

    // Start server
    const server = await startServer(options);

    const actualPort = (server.address() as any)?.port ?? options.port ?? 7337;
    process.stdout.write(
      `[zclaw] Listening on ${host}:${actualPort}\n` +
        `[zclaw] Session TTL: ${
          isNaN(sessionTTL) || sessionTTL <= 0 ? 86400 : sessionTTL
        }s\n` +
        `[zclaw] API keys: ${
          apiKeysFile ?? "~/.zclaw/server-keys.json"
        }\n`,
    );

    // Graceful shutdown
    const shutdown = (signal: string) => {
      process.stdout.write(`[zclaw] Received ${signal}, shutting down...\n`);
      server.close(() => {
        process.stdout.write("[zclaw] Server stopped.\n");
        process.exit(0);
      });
      // Force exit after 5 seconds if connections don't drain
      setTimeout(() => {
        process.stdout.write(
          "[zclaw] Force exiting after 5s timeout.\n",
        );
        process.exit(0);
      }, 5000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);

    if (
      message.includes("EADDRINUSE") ||
      message.includes("EACCES")
    ) {
      process.stdout.write(
        `[zclaw] Fatal: ${message}\n` +
          `[zclaw] Check that port ${
            isNaN(port) || port <= 0 ? 7337 : port
          } is available and you have permission to bind.\n`,
      );
    } else if (
      message.includes("ENOENT") &&
      message.includes("sessions")
    ) {
      process.stdout.write(
        `[zclaw] Fatal: Cannot create session directory.\n` +
          `[zclaw] Ensure ZCLAW_SESSION_DIR (${
            process.env.ZCLAW_SESSION_DIR ?? "<cwd>/.zclaw/sessions"
          }) is writable.\n`,
      );
    } else {
      process.stdout.write(`[zclaw] Fatal error: ${message}\n`);
    }

    process.exit(1);
  }
}

main();
