/**
 * ZClaw SDK — Session persistence
 *
 * Provides file-based and in-memory session stores for persisting
 * conversation history across requests.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionStore, SessionData, Message } from "./types.js";

// ── Session ID validation ───────────────────────────────────────────────

const SESSION_ID_RE = /^[a-zA-Z0-9-]+$/;

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error(
      `Invalid session ID "${sessionId}". Only alphanumeric characters and dashes are allowed.`,
    );
  }
}

// ── Default path ────────────────────────────────────────────────────────

function defaultSessionPath(): string {
  return join(homedir(), ".zclaw", "sessions");
}

// ── File-based SessionStore ─────────────────────────────────────────────

/**
 * File-backed session store. Each session is stored as a JSON file
 * at `{basePath}/{sessionId}.json`.
 */
class FileSessionStore implements SessionStore {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  private filePath(sessionId: string): string {
    return join(this.basePath, `${sessionId}.json`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  async save(sessionId: string, messages: Message[]): Promise<void> {
    validateSessionId(sessionId);
    await this.ensureDir();

    const now = Date.now();
    let data: SessionData;

    // Try to load existing session to preserve createdAt and metadata
    try {
      const raw = await fs.readFile(this.filePath(sessionId), "utf-8");
      const existing = JSON.parse(raw) as SessionData;
      data = {
        id: sessionId,
        messages,
        createdAt: existing.createdAt,
        updatedAt: now,
        provider: existing.provider,
        model: existing.model,
      };
    } catch {
      // New session
      data = {
        id: sessionId,
        messages,
        createdAt: now,
        updatedAt: now,
      };
    }

    await fs.writeFile(
      this.filePath(sessionId),
      JSON.stringify(data, null, 2),
      "utf-8",
    );
  }

  async load(sessionId: string): Promise<Message[] | null> {
    validateSessionId(sessionId);
    try {
      const raw = await fs.readFile(this.filePath(sessionId), "utf-8");
      const data = JSON.parse(raw) as SessionData;
      return data.messages;
    } catch {
      return null;
    }
  }

  async delete(sessionId: string): Promise<void> {
    validateSessionId(sessionId);
    try {
      await fs.unlink(this.filePath(sessionId));
    } catch {
      // File doesn't exist — nothing to delete
    }
  }

  async list(): Promise<string[]> {
    await this.ensureDir();
    const entries = await fs.readdir(this.basePath);
    return entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length));
  }
}

// ── In-memory SessionStore ──────────────────────────────────────────────

/**
 * In-memory session store backed by a Map. Useful for testing.
 */
class MemorySessionStore implements SessionStore {
  private store = new Map<string, SessionData>();

  async save(sessionId: string, messages: Message[]): Promise<void> {
    validateSessionId(sessionId);
    const existing = this.store.get(sessionId);
    const now = Date.now();

    this.store.set(sessionId, {
      id: sessionId,
      messages,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      provider: existing?.provider,
      model: existing?.model,
    });
  }

  async load(sessionId: string): Promise<Message[] | null> {
    const data = this.store.get(sessionId);
    return data?.messages ?? null;
  }

  async delete(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Creates a file-based session store.
 *
 * @param path  Directory to store session JSON files in.
 *              Defaults to `~/.zclaw/sessions/`.
 */
export function createSessionStore(path?: string): SessionStore {
  return new FileSessionStore(path ?? defaultSessionPath());
}

/**
 * Creates an in-memory session store for testing.
 */
export function createMemoryStore(): SessionStore {
  return new MemorySessionStore();
}
