/**
 * ZClaw Server — Server-side Session Management
 *
 * Wraps the SDK's SessionStore for server-specific needs:
 *  - TTL-based session expiration
 *  - Per-API-key concurrency limits
 *  - Periodic cleanup of stale sessions
 */

import type { ProviderType, Message, SessionData } from "../../core/types.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface ServerSessionManagerOptions {
  /** Session TTL in milliseconds (default: 24 hours) */
  sessionTTL?: number;
  /** Inactivity timeout in milliseconds (default: 30 minutes) */
  inactivityTimeout?: number;
  /** Max concurrent sessions per API key (default: 5) */
  maxSessionsPerKey?: number;
  /** Cleanup interval in milliseconds (default: 5 minutes) */
  cleanupInterval?: number;
  /** Directory for file-based session storage */
  sessionDir?: string;
}

interface TrackedSession extends SessionData {
  apiKeyHash: string;
  lastActivityAt: number;
}

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_SESSION_TTL = 24 * 60 * 60 * 1000;       // 24 hours
const DEFAULT_INACTIVITY_TIMEOUT = 30 * 60 * 1000;      // 30 minutes
const DEFAULT_MAX_SESSIONS = 5;
const DEFAULT_CLEANUP_INTERVAL = 5 * 60 * 1000;         // 5 minutes

// ── Helpers ────────────────────────────────────────────────────────────

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── ServerSessionManager ───────────────────────────────────────────────

export class ServerSessionManager {
  private sessions: Map<string, TrackedSession> = new Map();
  private sessionTTL: number;
  private inactivityTimeout: number;
  private maxSessionsPerKey: number;
  private cleanupInterval: number;
  private sessionDir: string;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: ServerSessionManagerOptions) {
    this.sessionTTL = options?.sessionTTL ?? DEFAULT_SESSION_TTL;
    this.inactivityTimeout = options?.inactivityTimeout ?? DEFAULT_INACTIVITY_TIMEOUT;
    this.maxSessionsPerKey = options?.maxSessionsPerKey ?? DEFAULT_MAX_SESSIONS;
    this.cleanupInterval = options?.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL;
    this.sessionDir = options?.sessionDir ?? path.join(process.cwd(), ".zclaw", "sessions");

    ensureDir(this.sessionDir);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Start the periodic cleanup timer.
   */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval);
    // Prevent the timer from keeping the process alive
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop the periodic cleanup timer.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────

  /**
   * Create a new session. Enforces per-API-key session limits.
   * Returns the new SessionData or throws if the limit is exceeded.
   */
  createSession(
    apiKey: string,
    provider?: ProviderType,
    model?: string,
  ): SessionData {
    const keyHash = hashKey(apiKey);

    // Enforce per-key limit
    const existing = this.getSessionsByKey(keyHash);
    if (existing.length >= this.maxSessionsPerKey) {
      throw new Error(
        `Maximum concurrent sessions (${this.maxSessionsPerKey}) reached for this API key.`,
      );
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    const session: TrackedSession = {
      id,
      messages: [],
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      apiKeyHash: keyHash,
      provider,
      model,
    };

    this.sessions.set(id, session);
    this.persistSession(session);

    return {
      id: session.id,
      messages: session.messages,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      provider: session.provider,
      model: session.model,
    };
  }

  /**
   * Get a session by its ID.
   * Returns null if the session does not exist or has expired.
   */
  getSession(id: string): SessionData | null {
    const session = this.sessions.get(id);
    if (!session) {
      // Try loading from disk
      const loaded = this.loadSessionFromDisk(id);
      if (!loaded) return null;
      this.sessions.set(id, loaded);
      return {
        id: loaded.id,
        messages: loaded.messages,
        createdAt: loaded.createdAt,
        updatedAt: loaded.updatedAt,
        provider: loaded.provider,
        model: loaded.model,
      };
    }

    // Check expiration
    if (this.isExpired(session)) {
      this.deleteSession(id);
      return null;
    }

    return {
      id: session.id,
      messages: session.messages,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      provider: session.provider,
      model: session.model,
    };
  }

  /**
   * Add a message to an existing session.
   * Updates the last-activity timestamp.
   */
  addMessage(sessionId: string, message: Message): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.messages.push(message);
    session.updatedAt = Date.now();
    session.lastActivityAt = Date.now();

    this.persistSession(session);
  }

  /**
   * Delete a session by ID.
   */
  deleteSession(id: string): void {
    this.sessions.delete(id);
    const filePath = this.sessionFilePath(id);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // File may not exist
    }
  }

  /**
   * Get all active (non-expired) sessions.
   */
  getActiveSessions(): SessionData[] {
    const active: SessionData[] = [];
    for (const [id, session] of this.sessions) {
      if (!this.isExpired(session)) {
        active.push({
          id: session.id,
          messages: session.messages,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          provider: session.provider,
          model: session.model,
        });
      }
    }
    return active;
  }

  /**
   * Remove expired sessions from memory and disk.
   */
  cleanup(): void {
    for (const [id, session] of this.sessions) {
      if (this.isExpired(session)) {
        this.deleteSession(id);
      }
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  private getSessionsByKey(keyHash: string): TrackedSession[] {
    const result: TrackedSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.apiKeyHash === keyHash && !this.isExpired(session)) {
        result.push(session);
      }
    }
    return result;
  }

  private isExpired(session: TrackedSession): boolean {
    const now = Date.now();

    // Absolute TTL
    if (now - session.createdAt > this.sessionTTL) {
      return true;
    }

    // Inactivity timeout
    if (now - session.lastActivityAt > this.inactivityTimeout) {
      return true;
    }

    return false;
  }

  private sessionFilePath(id: string): string {
    return path.join(this.sessionDir, `${id}.json`);
  }

  private persistSession(session: TrackedSession): void {
    const filePath = this.sessionFilePath(session.id);
    try {
      const data: SessionData = {
        id: session.id,
        messages: session.messages,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        provider: session.provider,
        model: session.model,
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch {
      // Best-effort persistence — don't crash on write errors
    }
  }

  private loadSessionFromDisk(id: string): TrackedSession | null {
    const filePath = this.sessionFilePath(id);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as SessionData;

      // We don't have the apiKeyHash on disk — reconstruct a placeholder
      return {
        ...data,
        lastActivityAt: data.updatedAt,
        apiKeyHash: "",
      };
    } catch {
      return null;
    }
  }
}
