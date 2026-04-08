---
title: Session Persistence
description: Persist and restore agent conversation history with built-in and custom session stores.
---

# Session Persistence

ZClaw agents can persist conversation history across process restarts using session stores. Pass a `persist` option to `createAgent()` and the agent automatically saves and loads messages.

## Quick example

```typescript
import { createAgent } from "zclaw-core";

// File-based persistence -- sessions stored as JSON files
const agent = await createAgent({
  persist: "./sessions/my-agent",
});

await agent.chat("My name is Alice");
await agent.chat("I am working on a React project");

// In a new process, recreate with the same path:
// const agent2 = await createAgent({ persist: "./sessions/my-agent" });
// History is loaded automatically.
```

## SessionStore interface

All session stores implement the same interface:

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

## Built-in stores

ZClaw ships with two session store implementations.

### FileSessionStore

File-backed storage. Each session is a JSON file in a directory.

```typescript
import { createSessionStore } from "zclaw-core";

// Default: stores in ~/.zclaw/sessions/
const store = createSessionStore();

// Custom directory
const customStore = createSessionStore("./data/my-sessions");
```

| Property         | Value                                      |
|------------------|--------------------------------------------|
| Storage          | JSON files, one per session                |
| Default path     | `~/.zclaw/sessions/`                       |
| File naming      | `{sessionId}.json`                         |
| Auto-creates dir | Yes                                        |

Each session file contains a `SessionData` object:

```typescript
interface SessionData {
  id: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  provider?: ProviderType;
  model?: string;
}
```

::: info
Session IDs must contain only alphanumeric characters and dashes (`[a-zA-Z0-9-]+`). Invalid IDs throw an error on save.
:::

### MemorySessionStore

In-memory storage backed by a `Map`. Sessions are lost when the process exits.

```typescript
import { createMemoryStore } from "zclaw-core";

const store = createMemoryStore();

// Useful for testing
const agent = await createAgent({
  persist: store,
});
```

| Property         | Value                          |
|------------------|--------------------------------|
| Storage          | In-memory `Map<string, SessionData>` |
| Persistence      | Process lifetime only          |
| Best for         | Testing, ephemeral sessions   |

### Choosing a store

| Use case                      | Recommended store    |
|-------------------------------|----------------------|
| Production, long-lived agents | `FileSessionStore`   |
| Testing                       | `MemorySessionStore` |
| Distributed deployment        | Custom Redis store   |
| Serverless functions          | Custom database store|

## Usage with createAgent

### File path (string)

Pass a directory path as a string. ZClaw creates a `FileSessionStore` automatically:

```typescript
const agent = await createAgent({
  persist: "./data/sessions",
});
```

### SessionStore instance

Pass any `SessionStore` implementation:

```typescript
import { createSessionStore } from "zclaw-core";

const store = createSessionStore("./data/sessions");

const agent = await createAgent({
  persist: store,
});
```

### Auto-generated session IDs

When you use `createAgent()` with a `persist` option, ZClaw auto-generates a session ID. Each agent instance gets its own session file:

```typescript
// Each creates a separate session file
const agent1 = await createAgent({ persist: "./sessions" });
const agent2 = await createAgent({ persist: "./sessions" });

await agent1.chat("Hello from agent 1");
await agent2.chat("Hello from agent 2");

// Both histories are persisted independently
```

## Session lifecycle

### Save behavior

The session is automatically saved after each `chat()` and `chatStream()` call:

```typescript
const agent = await createAgent({ persist: "./sessions" });

// Saves to disk after each call
await agent.chat("First message");    // Session saved
await agent.chat("Second message");   // Session updated
```

### Load behavior

When an agent is created with a persist path that contains existing session data, the history is loaded automatically:

```typescript
// Process 1: create and chat
const agent = await createAgent({ persist: "./sessions/app" });
await agent.chat("Remember: project uses TypeScript");

// Process 2: resume (same path)
const resumedAgent = await createAgent({ persist: "./sessions/app" });
const reply = await resumedAgent.chat("What language does the project use?");
// The agent remembers the TypeScript context
```

### Clearing sessions

Use `agent.clear()` to reset conversation history. The session file is updated:

```typescript
const agent = await createAgent({ persist: "./sessions" });

await agent.chat("Some context");
agent.clear();
// Session file updated with just the system prompt
```

## Session limits and cleanup

ZClaw enforces the following session limits to prevent resource exhaustion:

| Limit                  | Value      | Description                                        |
|------------------------|------------|----------------------------------------------------|
| Session TTL            | 24 hours   | Sessions older than 24 hours are eligible for cleanup |
| Inactivity timeout     | 30 minutes | Sessions with no activity for 30 minutes may be cleaned up |
| Max concurrent sessions| 5 per key  | Maximum 5 active sessions per API key              |
| Auto-cleanup interval  | 5 minutes  | Background cleanup runs every 5 minutes            |

::: warning
These limits apply to the Server adapter's `ServerSessionManager`, which manages sessions for API consumers. The core SDK's `FileSessionStore` and `MemorySessionStore` have NO built-in TTL, inactivity timeout, or automatic cleanup. For direct SDK usage, implement your own cleanup logic for production deployments.
:::

### Manual cleanup

```typescript
import { createSessionStore } from "zclaw-core";

const store = createSessionStore("./sessions");

// List all sessions
const sessions = await store.list();

// Delete expired sessions manually
const ONE_DAY = 24 * 60 * 60 * 1000;
for (const id of sessions) {
  const messages = await store.load(id);
  if (!messages) continue;

  const lastMessage = messages[messages.length - 1];
  if (Date.now() - lastMessage.timestamp > ONE_DAY) {
    await store.delete(id);
    console.log(`Cleaned up session: ${id}`);
  }
}
```

## Custom session store

Implement the `SessionStore` interface to use any backend.

### Redis session store

```typescript
import { createAgent, type SessionStore, type Message } from "zclaw-core";
import { createClient } from "redis";

const redis = createClient({ url: "redis://localhost:6379" });
await redis.connect();

const redisStore: SessionStore = {
  async save(sessionId: string, messages: Message[]): Promise<void> {
    const key = `zclaw:session:${sessionId}`;
    const data = {
      id: sessionId,
      messages,
      createdAt: await this.getCreatedAt(key),
      updatedAt: Date.now(),
    };
    await redis.set(key, JSON.stringify(data), {
      EX: 86400, // 24-hour TTL
    });
  },

  async load(sessionId: string): Promise<Message[] | null> {
    const raw = await redis.get(`zclaw:session:${sessionId}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.messages;
  },

  async delete(sessionId: string): Promise<void> {
    await redis.del(`zclaw:session:${sessionId}`);
  },

  async list(): Promise<string[]> {
    const keys = await redis.keys("zclaw:session:*");
    return keys.map((k) => k.replace("zclaw:session:", ""));
  },

  async getCreatedAt(key: string): Promise<number> {
    const existing = await redis.get(key);
    if (existing) {
      const data = JSON.parse(existing);
      return data.createdAt ?? Date.now();
    }
    return Date.now();
  },
};

const agent = await createAgent({ persist: redisStore });
```

### Database session store

```typescript
import { createAgent, type SessionStore, type Message } from "zclaw-core";

// Example with a generic database client
const dbStore: SessionStore = {
  async save(sessionId: string, messages: Message[]): Promise<void> {
    await db.query(
      `INSERT INTO sessions (id, messages, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE
       SET messages = $2, updated_at = NOW()`,
      [sessionId, JSON.stringify(messages)],
    );
  },

  async load(sessionId: string): Promise<Message[] | null> {
    const row = await db.query(
      "SELECT messages FROM sessions WHERE id = $1",
      [sessionId],
    );
    if (!row) return null;
    return JSON.parse(row.messages);
  },

  async delete(sessionId: string): Promise<void> {
    await db.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
  },

  async list(): Promise<string[]> {
    const rows = await db.query("SELECT id FROM sessions ORDER BY updated_at DESC");
    return rows.map((r: { id: string }) => r.id);
  },
};

const agent = await createAgent({ persist: dbStore });
```

::: tip
For custom stores, implement TTL cleanup in your backend (Redis EX, database cron job, etc.) to prevent unbounded storage growth.
:::

## SessionStore factories

| Function               | Signature                           | Returns              |
|-------------------------|-------------------------------------|----------------------|
| `createSessionStore()`  | `(path?: string) => SessionStore`   | `FileSessionStore`   |
| `createMemoryStore()`   | `() => SessionStore`                | `MemorySessionStore` |

```typescript
import { createSessionStore, createMemoryStore } from "zclaw-core";

// Production: file-based
const fileStore = createSessionStore("./data/sessions");

// Testing: in-memory
const testStore = createMemoryStore();
```

## Related APIs

- [createAgent()](/sdk/create-agent) -- Stateful agent with `persist` option
- [Types](/sdk/types) -- Full TypeScript type reference including `SessionStore` and `SessionData`
