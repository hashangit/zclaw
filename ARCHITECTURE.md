# ZClaw Architecture

Headless AI agent framework with CLI, SDK, and Server adapters. Multi-provider LLM support, skill plugin system, and Docker-native deployment.

## Layered Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Adapters                                               │
│  ┌──────────┐   ┌──────────┐   ┌────────────────────┐  │
│  │   CLI    │   │   SDK    │   │      Server        │  │
│  │  (REPL)  │   │  (Lib)   │   │  (WS + REST)       │  │
│  └────┬─────┘   └────┬─────┘   └──────┬─────────────┘  │
├───────┼──────────────┼────────────────┼─────────────────┤
│       └──────────────┼────────────────┘                 │
│                  Core                                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Agent Loop · Hooks · Tool Executor              │   │
│  │  Provider Resolver · Message Convert              │   │
│  │  Middleware · Skill Invoker · Session Store       │   │
│  │  Errors                                           │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Infrastructure                                         │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ Providers  │  │   Tools    │  │     Skills       │  │
│  │  (4 LLMs)  │  │ (12 tools) │  │ (Plugin system)  │  │
│  └────────────┘  └────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

All three adapters delegate to a single `runAgentLoop` implementation in the core layer.

## Source Layout

```
src/
├── core/                    # Canonical execution engine
│   ├── agent-loop.ts        # Single agent loop (all adapters delegate here)
│   ├── types.ts             # Central type definitions
│   ├── hooks.ts             # Safe hook executor
│   ├── tool-executor.ts     # Tool registry, factory, resolution
│   ├── provider-resolver.ts # Re-export hub for provider-env + provider-config
│   ├── provider-env.ts      # Env var helpers, defaults, resolveFromEnv()
│   ├── provider-config.ts   # Types, singleton, mutation, getProvider()
│   ├── message-convert.ts   # SDK ↔ Provider message format conversion
│   ├── skill-invoker.ts     # Skill invocation orchestrator
│   ├── skill-catalog.ts     # Skill catalog builder for system prompt injection
│   ├── session-store.ts     # PersistenceBackend factory + registry, file & memory backends
│   ├── stream-manager.ts   # Shared streaming queue, async iterables, SSE
│   ├── errors.ts            # Error class hierarchy
│   ├── permission.ts        # Permission matrix (levels × risk categories)
│   ├── settings-schema.ts   # Static settings map, schema, env vars, categories
│   ├── settings-manager.ts  # SettingsManager (get/set/reset/list, persistence, masking)
│   ├── middleware.ts         # Pipeline types + compose()
│   ├── middleware/           # Built-in middleware
│   │   ├── logging.ts       # Request/response logging
│   │   ├── rate-limit.ts    # Token bucket rate limiting
│   │   └── auth.ts          # Auth validation
│   └── index.ts             # Core barrel export
├── providers/               # LLM provider implementations
│   ├── types.ts             # LLMProvider interface
│   ├── factory.ts           # Provider creation (dynamic imports)
│   ├── openai.ts            # OpenAI + OpenAI-compatible
│   └── anthropic.ts         # Anthropic + GLM (via Anthropic SDK)
├── skills/                  # Skill plugin system
│   ├── types.ts             # Skill, SkillFrontmatter interfaces
│   ├── registry.ts          # DefaultSkillRegistry with LRU body cache (lazy loading)
│   ├── loader.ts            # Multi-source skill discovery
│   ├── parser.ts            # YAML frontmatter parser (parseFrontmatter for discovery, parseSkillFile for full)
│   ├── args.ts              # Dynamic argument parsing + template substitution
│   ├── resolver.ts          # @path file reference resolution
│   └── index.ts             # Registry initialization
├── tools/                   # Built-in tools
│   ├── interface.ts         # ToolModule interface
│   ├── index.ts             # Tool registry + executeToolHandler
│   ├── core.ts              # Shell, file I/O, datetime
│   ├── browser.ts           # Playwright web content extraction
│   ├── screenshot.ts        # Full-page screenshots
│   ├── email.ts             # SMTP email
│   ├── search.ts            # Tavily web search
│   ├── notify.ts            # Feishu/DingTalk/WeCom notifications
│   ├── image.ts             # DALL-E image generation
│   └── prompt-optimizer.ts  # Prompt enhancement via GPT
├── adapters/
│   ├── cli/                 # Interactive terminal agent
│   │   ├── index.ts         # Commander setup, delegation to repl.ts
│   │   ├── repl.ts          # Interrupt handling, runChat loop, command registry builder
│   │   ├── agent.ts         # Agent class (REPL state, skill catalog)
│   │   ├── setup.ts         # Interactive setup wizard
│   │   ├── config-loader.ts # Multi-source config loading
│   │   ├── docker-utils.ts  # Docker/non-interactive detection
│   │   └── commands/        # Slash commands (/help, /clear, /exit, /compact, /skills, /models, /settings)
│   ├── sdk/                 # Programmatic library (npm package)
│   │   ├── index.ts         # generateText, streamText, createAgent, settings
│   │   ├── settings.ts      # SDK settings facade (get/set/reset/list/onChange)
│   │   ├── agent.ts         # SdkAgent (session, streaming, provider switching)
│   │   ├── http.ts          # SSE streaming helpers
│   │   ├── react.ts         # createUseChat React hook factory
│   │   └── tools.ts         # Re-export layer
│   └── server/              # Standalone WebSocket + REST server
│       ├── index.ts         # HTTP server creation, core agent loop delegation
│       ├── websocket.ts     # WS re-export hub (setup + teardown)
│       ├── ws-types.ts      # WS type shims and protocol message interfaces
│       ├── ws-handlers.ts   # WS connection handlers and safe send
│       ├── rest.ts          # REST endpoints (includes /v1/settings and /v1/providers routes)
│       ├── settings-handlers.ts # Settings REST + WS handlers with async mutex
│       ├── auth.ts          # API key auth with scopes
│       ├── session-store.ts # Server sessions with TTL + concurrency, delegates to PersistenceBackend
│       └── standalone.ts    # Docker/production entry point
├── models-catalog.ts        # Provider model catalog
└── (no index.ts at root — entry points defined in package.json exports)
```

## Core Layer

### Agent Loop (`agent-loop.ts`)

The single execution engine. Runs an iterative loop:

1. Check abort signal
2. Resolve provider for this step (supports per-skill model switching via `ProviderFactory`)
3. Convert messages to provider format
4. Call `provider.chat()`
5. Process text response → emit step
6. Process tool calls → execute each → emit steps
7. If tool calls were executed, continue loop; otherwise stop

Returns `AgentLoopResult` with messages, steps, tool calls, usage, and finish reason (`stop` | `max_steps` | `error` | `aborted`).

### Middleware Pipeline (`middleware.ts`)

Composable `(ctx, next) => Promise<void>` chain that wraps `runAgentLoop`. When middleware is provided, the loop body runs as the final handler; errors from middleware (e.g., auth rejection) produce an error result with `finishReason: "error"`. When no middleware is provided, behavior is identical to before.

```typescript
interface PipelineContext {
  requestId: string;
  messages: Message[];
  provider: LLMProvider;
  model: string;
  toolDefs: ToolDefinition[];
  metadata: Record<string, unknown>;
  result?: { messages, steps, toolCalls, usage, finishReason };
  signal?: AbortSignal;
  startedAt: number;
}

type Middleware = (ctx: PipelineContext, next: () => Promise<void>) => Promise<void>;
```

Three built-in middleware in `src/core/middleware/`:

| Middleware | Purpose | Key options |
|------------|---------|-------------|
| `loggingMiddleware` | Logs request start + response with duration, model, steps, tokens | `logRequest`, `logResponse`, `logger` |
| `rateLimitMiddleware` | Token bucket per key, throws on limit exceeded | `maxRequests`, `windowMs`, `keyExtractor` |
| `authMiddleware` | Calls `validate(ctx)`, throws on failure | `validate`, `errorMessage` |

Usage via SDK:

```typescript
const result = await generateText("Hello", {
  middleware: [authMiddleware({ validate: (ctx) => !!ctx.metadata.apiKey })],
  metadata: { apiKey: "..." },
});
```

### Hooks (`hooks.ts`)

User-supplied callbacks wrapped in safe executors. Missing hooks are no-ops. Errors are caught and logged without disrupting the main flow.

| Hook | When |
|------|------|
| `beforeToolCall` | Before a tool executes |
| `afterToolCall` | After a tool completes |
| `onStep` | Each agent step (text or tool_call) |
| `onError` | On any error |
| `onFinish` | When the loop completes |

### Provider Resolver (`provider-resolver.ts`)

Re-export hub for `provider-env.ts` (env var helpers, defaults, `resolveFromEnv()`, `resolveGLMModel()`) and `provider-config.ts` (types, singleton, `getProvider()`, `addProvider()`, `saveConfig()`, etc.). Single source of truth for provider configuration. Resolution chain:

```
Explicit config (configureProviders())
  → Environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
    → Legacy env vars (ZCLAW_API_KEY, OPENAI_BASE_URL) with deprecation warnings
      → Defaults (provider: openai, model: gpt-5.4)
```

Key exports: `configureProviders()`, `getProvider()`, `getProviderConfig()`, `resolveFromEnv()`, `addProvider()`, `removeProvider()`, `saveConfig()`.

### Tool Executor (`tool-executor.ts`)

Tools organized in three tiers:

| Tier | Tools |
|------|-------|
| **Core** | `execute_shell_command`, `read_file`, `write_file`, `get_current_datetime` |
| **Comm** | `send_email`, `web_search`, `send_notification` |
| **Advanced** | `read_website`, `take_screenshot`, `generate_image`, `optimize_prompt`, `use_skill` |

Resolution accepts: group names (`"all"`, `"core"`), built-in tool names, or `UserToolDefinition` objects (via `tool()` factory). Deduplicates by name.

### Permission Pre-Filter (`permission.ts`)

Risk-based permission matrix controlling which tools auto-execute vs. require human approval. Three levels (`strict`, `moderate`, `permissive`) cross-referenced with four risk categories (`safe`, `edit`, `communications`, `destructive`).

```typescript
type PermissionLevel = "strict" | "moderate" | "permissive";
type ToolRiskCategory = "safe" | "edit" | "communications" | "destructive";
```

Key functions:

| Function | Purpose |
|----------|---------|
| `needsApproval(toolName, level, registry?)` | Returns `true` if the tool requires approval at the given level |
| `resolvePermissionLevel(flags)` | Resolves effective level from CLI flags, env var, and config |
| `getToolRiskCategory(toolName, registry?)` | Looks up a tool's risk category, defaults to `"destructive"` |

Applied in `runAgentLoop` as a pre-filter before tool execution. CLI uses `--strict`/`--moderate`/`--yolo`/`--headless` flags; SDK accepts `permissionLevel` option; Server enforces a `maxPermissionLevel` ceiling per connection.

### Settings System (`settings-schema.ts`, `settings-manager.ts`)

Schema-driven settings management with unified get/set/reset across CLI, SDK, and Server adapters.

**Schema** (`settings-schema.ts`): Static data mapping 37 dot-key settings to `AppConfig` paths, with validation metadata (type, secret, restart-required, enum values, min/max), env var overrides (20 mappings), and category grouping (6 categories: providers, image, smtp, search, notifications, agent).

**Manager** (`settings-manager.ts`): `SettingsManager` class providing:

| Method | Description |
|--------|-------------|
| `get(dotKey)` | Read value with secret masking and origin resolution |
| `set(dotKey, rawValue)` | Validate → persist to config file → update in-memory → emit change event |
| `reset(dotKey)` | Remove from config file, revert to default (or env var) |
| `resetAll()` | Clear config file, rebuild from env vars |
| `list()` / `listByCategory()` | All settings with metadata |
| `onChange(callback)` | Subscribe to changes, returns unsubscribe function |

Key behaviors:
- **Secret masking**: Strings ≥8 chars show first 3 + last 4 chars; shorter show `******`
- **Origin resolution**: env var → project config → global config → default
- **Atomic persistence**: Write to temp file → rename, with backup
- **Deep merge**: Setting one provider key preserves sibling provider configs
- **Validation**: Type coercion (string → number/boolean), enum constraints, URL parsing, hostname regex
- **SettingsError**: Extends `ZclawError` with codes `SETTINGS_INVALID_KEY`, `SETTINGS_VALIDATION_FAILED`, `SETTINGS_WRITE_FAILED`

### Session Store (`session-store.ts`)

Composable persistence via `PersistenceBackend` interface: `save(id, SessionData)`, `load(id)`, `delete(id)`, `list()`. Factory function `createPersistenceBackend(config)` creates backends by type. `registerBackend(type, factory)` registers custom backends (Redis, SQLite, etc.). Built-in: `file` (JSON files in `~/.zclaw/sessions/`) and `memory` (Map-based, for testing). Legacy `SessionStore`-based API (`createSessionStore`, `createMemoryStore`) preserved for backward compatibility.

### Error Hierarchy (`errors.ts`)

```
ZclawError (base: message, code, retryable)
├── ProviderError  (provider field)
├── ToolError      (tool field)
├── MaxStepsError  (steps field)
└── AbortedError
```

Each error carries a machine-readable `code` and `retryable` flag for intelligent retry logic.

## Provider Layer

All providers implement the `LLMProvider` interface:

```typescript
interface LLMProvider {
  chat(messages: ProviderMessage[], tools: ToolDefinition[], options?: ChatOptions): Promise<ProviderResponse>;
}
```

| Provider Type | Implementation | Notes |
|---------------|---------------|-------|
| `openai` | `OpenAIProvider` | Wraps `openai` SDK |
| `openai-compatible` | `OpenAIProvider` | Same class with custom `baseUrl` |
| `anthropic` | `AnthropicProvider` | Wraps `@anthropic-ai/sdk` |
| `glm` | `AnthropicProvider` | Same class with `api.z.ai/api/anthropic` base URL, model alias mapping |

Model aliases for GLM: `haiku` → `glm-4.5-air`, `sonnet` → `glm-4.7`, `opus` → `glm-5.1`.

Providers are created via dynamic import in the factory, keeping unused provider SDKs out of memory.

## Adapter Layer

### CLI Adapter

Interactive REPL built on Commander.js.

**Entry flow**: `index.ts` → parse args → `loadMergedConfig()` → `runSetup()` (if needed) → create `Agent` → REPL loop.

- **Config loading**: Global (`~/.zclaw/setting.json`) + local (`.zclaw/setting.json`) + env overrides
- **Interrupt handling**: ESC key via raw stdin → `AbortSignal` → provider HTTP cancellation
- **Slash commands**: Registry-based dispatch (`/help`, `/clear`, `/exit`, `/compact`)
- **Docker mode**: Detects `.dockerenv`, switches to non-interactive + auto-approve shell

### SDK Adapter

Programmatic library published as `zclaw-core` on npm.

Three entry points:
- `zclaw` → `generateText()`, `streamText()`, `createAgent()`
- `zclaw/react` → `createUseChat()` hook factory
- `zclaw/server` → Server adapter (imports core directly, no SDK dependency)

`createAgent()` returns `SdkAgent` with: `chat()`, `chatStream()`, `switchProvider()`, `abort()`, `clear()`, `getHistory()`, `getUsage()`. Supports session persistence via `persist` option.

### Server Adapter

Standalone HTTP + WebSocket server. Delegates directly to `runAgentLoop` in core (no SDK dependency). REST endpoints for generate/stream/agent operations. WebSocket for real-time bidirectional communication with reconnection support.

- **Auth**: API key with scopes (`chat`, `admin`). Keys stored in `~/.zclaw/api-keys.json`
- **Sessions**: TTL-based expiration, per-key concurrency limits
- **Deployment**: `zclaw-server` binary, Docker image, or `docker-compose`

## Skills System

Plugin architecture for domain-specific extensions.

### Skill File Format

```yaml
---
name: docker-ops
description: Docker operations assistant
version: 1.0.0
tags: [docker, devops]
allowedTools: [execute_shell_command, read_file]
args: [environment, service]
model:
  provider: openai
  model: gpt-5.4
---

System prompt and instructions for the skill...
{{environment}} {{service}} template variables...
```

### Discovery

Skills are discovered from multiple sources with priority (last wins):
1. Built-in skills bundled with the package
2. User skills in `~/.zclaw/skills/`
3. Project skills in `.zclaw/skills/`
4. Custom paths via `ZCLAW_SKILLS_PATH`

Discovery uses `parseFrontmatter()` which reads each skill file but discards the body text immediately, keeping only the YAML metadata and `filePath`. Bodies are loaded lazily from disk on first invocation via `registry.getBody()`, with an LRU cache (5 entries) in `DefaultSkillRegistry`.

### Invocation Flow

1. Parse skill name + args from user input
2. Look up skill in registry
3. Substitute template variables
4. Resolve `@path` file references (with path traversal protection)
5. If skill specifies a model, switch provider via `ProviderFactory`
6. Execute via `runAgentLoop`
7. Restore original provider

### Per-Skill Model Switching

Skills can specify a preferred provider and model in their frontmatter. The `createSkillProviderSwitcher()` factory in `src/core/skill-invoker.ts` handles temporary switching for any adapter:

```typescript
interface SkillProviderSwitcher {
  switchIfNeeded(skillResult: SkillInvocationResult): Promise<boolean>;
  restore(): void;
  readonly activeProvider: LLMProvider;
  readonly activeModel: string;
}
```

The CLI creates a switcher per skill invocation, applies it via `agent.switchProvider()`, and restores via `switcher.restore()` in a `finally` block. Other adapters (SDK, Server) can use the same factory.

## Cross-Cutting Systems

### Abort Mechanism

Three layers, all propagating to the same `AbortSignal`:

| Adapter | Trigger | Effect |
|---------|---------|--------|
| CLI | ESC key | Sets raw stdin listener → `controller.abort()` |
| SDK | `signal` option or `agent.abort()` | Direct `AbortSignal` |
| Server | WebSocket close / client disconnect | Signal propagation |

The signal reaches the provider's HTTP call, cancelling the in-flight request.

### Streaming

Async iterable pattern with queue-based backpressure. Used by SDK (`streamText`) and Server (SSE). SSE format follows the standard `data: ...\n\n` protocol with typed events (`text`, `tool_call`, `tool_result`, `error`, `done`).

React hook (`createUseChat`) lazily loads React and manages SSE parsing with buffer handling for partial chunks.

### Configuration

Multi-layer merge with precedence (highest wins):

```
Environment variables
  → Local project config (.zclaw/setting.json)
    → Global user config (~/.zclaw/setting.json)
      → Defaults
```

Env var mapping per provider:
- OpenAI: `OPENAI_API_KEY`, `OPENAI_MODEL`
- Anthropic: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- GLM: `GLM_API_KEY`, `GLM_MODEL`
- OpenAI-compatible: `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_MODEL`
- General: `LLM_PROVIDER`, `LLM_MODEL`

Legacy env vars (`ZCLAW_API_KEY`, `OPENAI_BASE_URL`, `ZCLAW_MODEL`) still work with deprecation warnings.

## Build & Deployment

### Build

TypeScript (`tsc`) targeting ES2022 with NodeNext module resolution. No bundler — direct compilation. Development via `tsx` for instant feedback.

### Package Exports

```json
{
  ".":       "dist/adapters/sdk/index.js",     // SDK library
  "./react": "dist/adapters/sdk/react.js",      // React hook
  "./server": "dist/adapters/server/index.js"   // Server
}
```

Two binaries: `zclaw` (CLI) and `zclaw-server` (standalone server).

### Docker

Multi-stage build: build stage with full Node.js → production stage with compiled JS only. Includes system Chromium for Playwright tools, CJK fonts, non-root user, health check endpoint.

Volumes: `/data/sessions` (session persistence), `/mnt/skills` (custom skills).

Env var `ZCLAW_SHELL_APPROVE=auto` enables non-interactive shell tool approval.

### CI/CD

GitHub Actions: tag-triggered NPM publish + GitHub release, plus docs deployment to GitHub Pages via VitePress.

### Documentation

VitePress site in `docs/` with sections: getting-started, guides, SDK reference, server, examples, superpowers (design specs).

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Single `runAgentLoop` implementation | All adapters share one execution engine — no behavioral divergence |
| Dynamic provider imports | Unused provider SDKs stay out of memory |
| Provider reuses (OpenAI↔compatible, Anthropic↔GLM) | Reduces maintenance surface — SDKs are API-compatible |
| Skills as files, not code | Portable, versionable, no build step for skill authors |
| `@path` reference resolution with allowlist | Convenience without compromising security |
| Hook errors are non-fatal | Observability hooks must never crash the agent loop |
| Token estimation (char-based) | Avoids extra API calls; sufficient for usage tracking |

## Known Gaps

- **Test suite (partial)** — Vitest configured with 161 tests across 10 files covering P0/P1 (errors, message-convert, args, parser, tool-executor, hooks, session-store, settings, settings-integration, permission). CI `test` job gates `publish-npm`.
- **Tool registry duplication** — FIXED: single source in `src/core/tool-executor.ts`, `tools/index.ts` is pure module collection
- **ProviderType defined in two places** — FIXED: single definition in `src/core/types.ts`, re-exported from `src/providers/types.ts`
- **Streaming duplication** — FIXED: `StreamManager` in `src/core/stream-manager.ts` is the single queue/iterable/SSE implementation used by both `streamText()` and `chatStream()`
- **Skill loading coupled to CLI** — FIXED: `createSkillProviderSwitcher()` in `src/core/skill-invoker.ts` replaces `switchToSkillModel()`/`restoreProvider()` from CLI `Agent` class; all adapters can now use skill provider switching
- ~~**No skill body size limits**~~ — FIXED: three-layer defense with load-time warning (`parser.ts`), injection-time truncation (`limitSkillBody` in `types.ts`, applied in `skill-invoker.ts` and `tools/index.ts`), and cumulative cap in `resolver.ts` (2MB total)
- ~~**Skill catalog only in CLI**~~ — FIXED: `buildSkillCatalog()` extracted to `src/core/skill-catalog.ts`, `skillCatalog` option on `AgentLoopOptions` enables injection at agent-loop level for all adapters
- ~~**Server imports SDK**~~ — FIXED: `server/index.ts` imports directly from core (`agent-loop`, `hooks`, `tool-executor`, `message-convert`, `provider-resolver`)
- ~~**Large files with mixed responsibilities**~~ — FIXED: `websocket.ts` split into `ws-types.ts` + `ws-handlers.ts` + re-export hub; `provider-resolver.ts` split into `provider-env.ts` + `provider-config.ts` + re-export hub; `cli/index.ts` split into `repl.ts` + `commands/skills.ts` + `commands/models.ts` + Commander setup
- ~~**No middleware pipeline**~~ — FIXED: `(ctx, next) => Promise<void>` middleware chain in `src/core/middleware.ts` with `compose()`. Built-in logging, rate-limit, and auth middleware. Pass-through from SDK (`generateText`, `streamText`, `createAgent`). 100% backward compatible (no middleware = identical behavior)
- ~~**Session persistence hardcoded**~~ — FIXED: `PersistenceBackend` interface with `createPersistenceBackend()` factory and `registerBackend()` registry in `src/core/session-store.ts`. Built-in `file` and `memory` backends. Server's `ServerSessionManager` accepts optional `backend` option, delegating raw storage while keeping TTL/concurrency/cleanup logic. 100% backward compatible — `persist: string` still works via legacy adapter.
