# Slash Commands Design for zclaw

**Date**: 2026-04-10
**Status**: Draft
**Audience**: CLI interactive users + SDK/server programmatic users

## Goal

Define a minimal, well-designed set of slash commands that cover essential user needs while leveraging the existing skills system for domain-specific extensibility.

## Design Principles

1. **Skills-first** — Domain-specific workflows (Docker, K8s, testing) are skills, not commands
2. **Aliases for familiarity** — Support common aliases so users from Claude Code/Gemini CLI feel at home
3. **Flat namespace** — No nested subcommands. One `/` prefix, one level deep
4. **Progressive disclosure** — `/help` shows core commands; `/help --all` includes aliases and skills
5. **SDK parity** — Every slash command maps to an SDK function for programmatic access

## Command Registry

A `Map<string, CommandHandler>` in the CLI adapter. Each command is a function `(agent, args, rl) => Promise<void>`.

Lookup order:
1. Exact match in registry (e.g., `/clear`)
2. Alias match (e.g., `/reset` → `/clear`)
3. Skill invocation (e.g., `/docker-ops`)
4. Unknown command → show "Unknown command. Type /help for available commands."

## Commands

### Tier 1 — Session Control

| Command | Aliases | Description | Status |
|---------|---------|-------------|--------|
| `/help` | `/?` | Show available commands | **Needs implementation** |
| `/clear` | `/reset`, `/new` | Clear conversation history | **Exists** |
| `/exit` | `/quit` | End the session | **Exists** (standardize to slash-prefixed) |
| `/compact` | `/compress` | Replace conversation with summary to save tokens | **Needs implementation** |

### Tier 2 — Configuration & Discovery

| Command | Aliases | Description | Status |
|---------|---------|-------------|--------|
| `/models` | `/model` | Switch providers, add/edit/remove models | **Exists** |
| `/skills` | — | List loaded skills with descriptions | **Exists** |
| `/config` | `/settings` | Open interactive settings editor | **Needs implementation** (wizard exists, command needs wiring) |
| `/init` | — | Analyze project and generate `ZCLAW.md` | **Needs implementation** |

### Tier 3 — Session History & Recovery

| Command | Aliases | Description | Status |
|---------|---------|-------------|--------|
| `/resume` | `/continue` | Resume a previously saved session | **Needs implementation** (session store exists, CLI command does not) |
| `/rewind` | `/undo` | Undo last conversation turn and file changes | **Needs implementation** |
| `/copy` | `/clipboard` | Copy last response to clipboard | **Needs implementation** |

### Tier 4 — Infrastructure

| Command | Aliases | Description | Status |
|---------|---------|-------------|--------|
| `/mcp` | — | List/manage MCP server connections | **Needs implementation** (zclaw is MCP provider, not client; this would add client capability) |

### Catch-all — Skill Invocation

| Pattern | Description | Status |
|---------|-------------|--------|
| `/<skill-name> [args]` | Invoke a loaded skill by name with arguments | **Exists** |

## Input Prefixes

| Prefix | Type | Description |
|--------|------|-------------|
| `/command` | Slash command | Meta control over the agent session |
| `@path` | File injection | Embed file/directory content in the prompt |
| `!shell` | Shell passthrough | Execute a shell command and return to agent |

> `@path` and `!shell` prefixes are already supported in the current codebase.

## Implementation Status Summary

### Can ship now (underlying feature exists)

- `/help` — purely a UI command, no dependencies
- `/exit`/`/quit` — just standardize existing `exit`/`quit` to also accept `/` prefix
- `/config` — wire existing setup wizard to a `/config` command entry point
- `/resume` — session store (`FileSessionStore`) exists, needs CLI command to list and reload sessions

### Needs feature implementation first

- **`/compact`** — Requires a conversation summarization feature. Implementation: send conversation history to the LLM with a "summarize this conversation" system prompt, replace `agent.messages` with the summary while preserving the system prompt.
- **`/copy`** — Requires clipboard integration. Implementation: use `execFile` with platform-specific tools (`pbcopy` on macOS, `xclip` on Linux, `clip` on Windows). Use the existing `src/utils/execFileNoThrow.ts` utility for safe execution. Cross-platform clipboard package (e.g., `clipboardy`) is an option.
- **`/init`** — Requires project analysis logic. Implementation: scan project files (package.json, tsconfig, directory structure), generate a `ZCLAW.md` file with project context, conventions, and preferences.
- **`/rewind`** — Requires checkpoint/undo system. Implementation: snapshot conversation state and file changes before each agent turn, support rolling back to previous snapshot.
- **`/mcp`** — Requires MCP client capability. Implementation: add MCP client connection manager to discover, connect to, and call tools from external MCP servers.

## Command Registry Architecture

```
src/adapters/cli/
├── commands/
│   ├── registry.ts      # Map<string, CommandHandler> + alias resolution
│   ├── help.ts          # /help implementation
│   ├── clear.ts         # /clear implementation
│   ├── compact.ts       # /compact implementation (future)
│   ├── config.ts        # /config implementation
│   ├── copy.ts          # /copy implementation (future)
│   ├── exit.ts          # /exit implementation
│   ├── init.ts          # /init implementation (future)
│   ├── mcp.ts           # /mcp implementation (future)
│   ├── models.ts        # /models implementation (extract from index.ts)
│   ├── resume.ts        # /resume implementation (future)
│   ├── rewind.ts        # /rewind implementation (future)
│   └── skills.ts        # /skills implementation
├── agent.ts             # Agent class (unchanged)
└── index.ts             # Chat loop uses registry.dispatch(input)
```

### Registry Interface

```typescript
interface CommandContext {
  agent: CliAgent;
  args: string;
  rl: Interface;  // readline interface
}

type CommandHandler = (ctx: CommandContext) => Promise<void>;

interface CommandRegistry {
  register(name: string, handler: CommandHandler, options?: { aliases?: string[] }): void;
  dispatch(input: string, ctx: CommandContext): Promise<boolean>; // returns true if handled
  help(showAll?: boolean): string;
}
```

### Dispatch Flow

```
User types "/compact focus on auth logic"
  → registry.dispatch(input, ctx)
  → extract command: "compact", args: "focus on auth logic"
  → lookup "compact" in registry → found
  → call handler(ctx) with args = "focus on auth logic"
  → returns true (handled)

User types "/unknown-thing"
  → registry.dispatch(input, ctx)
  → lookup "unknown-thing" → not found
  → try skill invocation → no skill named "unknown-thing"
  → print "Unknown command. Type /help for available commands."
  → returns true (handled, prevents sending to LLM)
```

## SDK Parity

Each command should have an SDK equivalent:

| Slash Command | SDK Function |
|---------------|-------------|
| `/clear` | `agent.clearConversation()` |
| `/compact` | `agent.compact(focus?: string)` |
| `/models` | `agent.switchProvider(provider, model)` |
| `/resume` | `createAgent({ resume: sessionId })` |
| `/rewind` | `agent.rewind(steps?: number)` |
| `/copy` | N/A (CLI-only, clipboard is terminal concept) |
| `/help` | N/A (CLI-only) |
| `/init` | `generateInit(projectDir)` |
| `/config` | `loadConfig()`, `saveConfig()` |
| `/mcp` | `agent.listMcpServers()` |

## What This Is NOT

- Not a plugin system for commands — that's what skills are for
- Not a subcommand hierarchy — flat namespace keeps things simple
- Not trying to match Claude Code's 55+ commands — zclaw's skills system handles extensibility
- Not adding `/diff`, `/review`, `/batch` etc. — those are skill territory

## Success Metrics

1. A new user can discover all commands via `/help` in under 10 seconds
2. Every command works identically whether invoked via CLI or SDK
3. Adding a new command requires only: create file, register handler, done
4. Total command count stays under 15 (excluding skills)
