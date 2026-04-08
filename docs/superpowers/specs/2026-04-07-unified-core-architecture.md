# ZClaw Unified Core Architecture

**Date:** 2026-04-07
**Status:** Design Proposal — Revised (v2) addressing review gaps
**Review:** `docs/superpowers/specs/2026-04-07-unified-core-architecture-review.md`
**Authors:** Architecture Council (Core Architect, Simplification Analyst, Entry Point Designer, Migration Planner)

---

## Problem Statement

The codebase has critical duplication making every change require 4 edits:

| Concern | Copies | Locations |
|---|:---:|---|
| Agent loop | 4 | `agent.ts`, `sdk/agent.ts`, `sdk/index.ts` (x2), `server/index.ts` |
| Session store | 3 | `sdk/agent.ts` (inline), `sdk/session.ts`, `server/session-store.ts` |
| Provider resolution | 3 | `index.ts`, `sdk/providers.ts`, `server/index.ts` |
| Helper functions (6x) | 2 | `sdk/index.ts`, `sdk/agent.ts` — byte-for-byte identical |
| ToolDefinition name | 2 | `tools/interface.ts` vs `sdk/types.ts` (different shapes, same name) |
| Default models | 3 | Inconsistent values across `sdk/providers.ts`, `index.ts`, `agent.ts` |

The server (`bridgeGenerateText`) bypasses the SDK entirely, re-implementing a degraded single-step loop. The CLI (`Agent.chat`) is coupled to `chalk`/`ora`/`console.log`.

**Net impact:** ~930 lines of duplicated code, inconsistent behavior across entry points, every bug fix needs N edits.

---

## Design Principles

1. **Core has zero knowledge of transport or presentation.** No `chalk`, no `ora`, no `http`, no `WebSocket`.
2. **One implementation per concern.** Agent loop, session store, provider resolution — each exists exactly once.
3. **Thin adapters compose behavior.** CLI adds spinners/colors, SDK adds functional API, Server adds HTTP/WS.
4. **`Message` is the canonical type.** `ProviderMessage` is an internal wire format, never exposed outside `core/`.
5. **CLI keeps working throughout migration.** Each phase is independently verifiable.
6. **Every current feature has a home.** No feature left behind, no legacy code paths, no "old way still works alongside."

---

## Target File Structure

```
src/
  core/                          # PURE LIBRARY — no chalk, no HTTP, no WS
    types.ts                     # Canonical types (one ProviderType, one SkillMetadata, etc.)
    agent-loop.ts                # THE agent loop (one implementation, used by all 3 adapters)
    provider-resolver.ts         # Config + env + programmatic resolution (one path)
    session-store.ts             # File-based session store (one implementation)
    tool-executor.ts             # Tool registry + resolveTools + tool() factory
    skill-invoker.ts             # Skill invocation: parse → resolve → prompt → model-switch
    hooks.ts                     # Hook executor
    message-convert.ts           # Message <-> ProviderMessage conversions + helpers
    errors.ts                    # ZclawError class hierarchy + error codes

  providers/                     # LLM provider implementations (UNCHANGED)
    types.ts, factory.ts, openai.ts, anthropic.ts

  tools/                         # Tool implementations (UNCHANGED)
    interface.ts, index.ts, core.ts, email.ts, search.ts, etc.

  skills/                        # Skill system (UNCHANGED)
    types.ts, index.ts, loader.ts, parser.ts, resolver.ts, args.ts, registry.ts

  adapters/                      # Thin layers that compose core for each entry point
    cli/                         # CLI adapter
      index.ts                   # Commander setup, dotenv, config loading, readline loop (~250 lines)
      agent.ts                   # Wraps core agent-loop, adds chalk/ora output
      config-loader.ts           # Loads setting.json, merges global/local/env, legacy migration
      setup.ts                   # Setup wizard (~320 lines) — provider selection, API keys, extras
    sdk/                         # SDK adapter
      index.ts                   # generateText(), streamText() (~120 lines, down from 690)
      agent.ts                   # createAgent() (~180 lines, down from 730)
      tools.ts                   # tool() factory re-exports, tool group constants
      http.ts                    # toSSEStream(), toResponse() helpers
      react.ts                   # useChat() React hook
    server/                      # Server adapter
      index.ts                   # createServer() (~100 lines, down from 449)
      rest.ts                    # REST route handler (~180 lines)
      websocket.ts               # WebSocket protocol handler (~200 lines)
      auth.ts                    # API key authentication (~220 lines, unchanged)
      session-store.ts           # TTL/concurrency decorator ON TOP of core session-store

  models-catalog.ts              # (UNCHANGED)
```

---

## The Core: File-by-File

### `src/core/types.ts` — Canonical types

**Why:** Single source of truth. Eliminates duplicate `ProviderType`, `SkillMetadata`, `ToolDefinition`.

**Key changes:**
- `ProviderType` is defined HERE (not in `providers/types.ts`). `providers/types.ts` re-exports it.
- SDK's `ToolDefinition` is renamed to `UserToolDefinition` to disambiguate from `tools/interface.ts::ToolDefinition`.
- `SSEOptions` is NOT in core — it's a transport concern, lives in `adapters/sdk/http.ts`.
- `SessionStore` is a defined interface (not just a type alias), so core and adapters share the contract.
- `ZclawError` is a proper class hierarchy (not just an interface).

**Exports:** `ProviderType`, `MultiProviderConfig`, `Message`, `ToolCall`, `StepResult`, `Usage`, `CumulativeUsage`, `UserToolDefinition`, `ToolContext`, `ToolResult`, `Hooks`, `HookExecutor`, `GenerateTextOptions`, `GenerateTextResult`, `StreamTextOptions`, `StreamTextResult`, `AgentCreateOptions`, `SdkAgent`, `AgentResponse`, `SessionStore` (interface), `SessionData`, `SkillMetadata`, `ZclawError` (class), `ProviderError`, `ToolError`, `MaxStepsError`, `AbortedError`

**Imports:** Nothing (leaf node).

---

### `src/core/agent-loop.ts` — THE agent loop

**Why:** Replaces 4 copies with 1. The single most impactful change.

**Key design decisions (from review):**
- Accepts a `systemPrompt` so adapters can inject role/OS/constraint info without core knowing about it.
- Accepts a `providerFactory` for per-skill model switching — instead of a static `provider`, adapters can supply a factory that the loop calls before each step, enabling mid-conversation provider swaps without mutating state.
- Returns structured error info on failure, with partial results preserved.

**Exports:**
```typescript
interface AgentLoopOptions {
  provider: LLMProvider;              // Initial/current provider
  model: string;                      // Model name for initial provider
  messages: Message[];                // Mutable, appended in-place
  toolDefs: ToolWireDefinition[];     // OpenAI-format for provider.chat()
  systemPrompt?: string;              // Prepended as system message if provided
  maxSteps: number;
  hooks: HookExecutor;
  signal?: AbortSignal;
  config?: Record<string, unknown>;   // Passed to tool handlers
  onStep?: (step: StepResult) => void;
  providerFactory?: ProviderFactory;  // For per-skill model switching
}

// Factory enables skill-driven provider swaps without mutable state
type ProviderFactory = {
  resolve: (skillName?: string) => Promise<{ provider: LLMProvider; model: string }>;
  restore: () => void;  // Signal that skill context is done
};

interface AgentLoopResult {
  messages: Message[];
  steps: StepResult[];
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: "stop" | "max_steps" | "error" | "aborted";
  error?: AgentLoopError;  // Structured error when finishReason is "error"
}

interface AgentLoopError {
  message: string;
  code: string;          // "PROVIDER_ERROR" | "TOOL_FAILED" | "MAX_STEPS" | "ABORTED"
  retryable: boolean;
  provider?: string;
  tool?: string;
}

function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult>;
```

**Imports:** `./types.js`, `./errors.js`, `./message-convert.js`, `../providers/types.js`, `../tools/index.js`

**How each adapter uses it:**
- **CLI:** Calls `runAgentLoop()` with `systemPrompt` from `buildSystemPrompt()`, `providerFactory` from CLI's skill-aware provider state. Prints `result.messages` with chalk. On error, displays `result.error.message` with recovery hint if `retryable`.
- **SDK `generateText()`:** Calls `runAgentLoop()`, wraps in `GenerateTextResult`. No `providerFactory` (SDK is stateless per call).
- **SDK `createAgent()`:** Calls `runAgentLoop()` per turn, persists via session store. Provider factory handles skill model switching.
- **Server:** Calls `runAgentLoop()` via SDK, streams events over WebSocket.

---

### `src/core/provider-resolver.ts` — Unified provider resolution

**Why:** Replaces 3 copies. One resolution path: explicit config → env vars → error. Also handles runtime mutation (currently in `/models` command) and legacy format migration.

**Exports:**
```typescript
// --- Resolution (read path) ---
function configureProviders(config: MultiProviderConfig): void;
function getProvider(type?: ProviderType): Promise<{ provider: LLMProvider; model: string }>;
function getProviderConfig(type?: ProviderType): ResolvedProviderConfig;
function resolveFromEnv(): MultiProviderConfig | null;
function resolveFromConfigFile(config: any, type?: ProviderType): ResolvedProviderConfig | null;

// --- Mutation (write path — powers /models command) ---
function addProvider(type: ProviderType, config: ProviderConfig): void;
function updateProviderConfig(type: ProviderType, updates: Partial<ProviderConfig>): void;
function removeProvider(type: ProviderType): void;
function saveConfig(configPath?: string): void;  // Persist current state to disk

// --- Legacy migration ---
function migrateLegacyConfig(config: any): MultiProviderConfig;  // Top-level apiKey/baseUrl/model → openai-compatible

// --- GLM support ---
function resolveGLMModel(model: string): string;  // GLM_MODEL_MAP delegation to factory
```

**Legacy config handling:** `migrateLegacyConfig()` detects top-level `apiKey`/`baseUrl`/`model` and converts to `{ models: { 'openai-compatible': { apiKey, baseUrl, model } }, provider: 'openai-compatible' }`. Called by `config-loader.ts` before resolution.

**Environment variables resolved by `resolveFromEnv()`:**

| Category | Variables |
|----------|-----------|
| Provider | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GLM_API_KEY`, `GLM_MODEL`, `ZCLAW_PROVIDER`, `ZCLAW_MODEL`, `ZCLAW_API_KEY`, `ZCLAW_BASE_URL` |
| Server | `ZCLAW_PORT`, `ZCLAW_SESSION_DIR`, `ZCLAW_SESSION_TTL` |
| Skills | `ZCLAW_SKILLS_PATH`, `ZCLAW_NO_BUNDLED_SKILLS`, `ZCLAW_SKILLS_DEBUG` |
| Tools | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `TAVILY_API_KEY`, `FEISHU_WEBHOOK`, `FEISHU_KEYWORD`, `DINGTALK_WEBHOOK`, `DINGTALK_KEYWORD`, `WECOM_WEBHOOK`, `WECOM_KEYWORD` |

Tool env vars are NOT resolved by `resolveFromEnv()` — they're read directly by tool implementations from `process.env`. The resolver only handles provider-related env vars.

---

### `src/core/session-store.ts` — One file-based store

**Why:** Replaces 3 implementations. Server adds TTL as a decorator.

**Exports:** `FileSessionStore`, `MemorySessionStore`, `createSessionStore(path?)`, `createMemoryStore()`

---

### `src/core/tool-executor.ts` — Tool registry + resolution

**Why:** Moves `resolveTools()` and `tool()` factory from `sdk/tools.ts` to core so server can use them without importing from SDK adapter.

**Exports:** `resolveTools(inputs?)`, `executeTool(name, args, config?)`, `registerTool(module)`, `tool(definition)`, `getToolGroup(group)`, `CORE_TOOLS`, `COMM_TOOLS`, `ADVANCED_TOOLS`, `ALL_TOOLS`

**Tool groups include `use_skill`:** The `use_skill` tool (defined in `tools/index.ts`) is registered like all other tools and is part of `ADVANCED_TOOLS`. It is picked up automatically by `resolveTools()`. The `tool-executor.ts` does NOT need special handling for it.

---

### `src/core/skill-invoker.ts` — Skill invocation orchestrator

**Why:** The skill invocation flow crosses multiple boundaries (parsing, registry, file resolution, prompt construction, model switching). Currently scattered across `index.ts` (CLI loop) and `agent.ts` (model switching). Needs a single orchestrator in core that adapters can call.

**Full invocation flow:**
1. User input `/skillname args` → `parseInvocation()` from `skills/args.ts` → `{ skillName, args }`
2. Registry lookup → `skills/registry.ts` → `SkillMetadata`
3. `@path` resolution → `skills/resolver.ts::resolveReferences()` → resolves `@path`, `@zclaw_documents`, `@~` references, inlines file content
4. Prompt construction → `[Skill: {name} activated]\n\n{skillBody}\n\nUser request: {resolvedQuery}`
5. Provider switch → if skill has `preferredProvider`, signal `providerFactory.resolve(skillName)` to swap
6. Execute → `runAgentLoop()` with skill prompt and switched provider
7. Restore → `providerFactory.restore()` returns to original provider

**Exports:**
```typescript
interface SkillInvocationResult {
  prompt: string;             // Constructed prompt
  skill: SkillMetadata;       // Resolved skill
  providerSwitched: boolean;  // Whether a provider switch occurred
}

function invokeSkill(options: {
  input: string;              // Raw "/skillname args" input
  registry: SkillRegistry;
  providerFactory: ProviderFactory;
  skillsPath?: string;
}): Promise<SkillInvocationResult>;
```

**Note:** Steps 5-7 (provider switching) are handled by the adapter, not by `invokeSkill()` itself. `invokeSkill()` returns the constructed prompt and skill metadata. The adapter then calls `providerFactory.resolve(skillName)`, runs the loop, and calls `providerFactory.restore()`. This keeps core stateless.

---

### `src/core/message-convert.ts` — Message conversion helpers

**Why:** Extracts 2 copy-pasted conversion functions + 4 helpers into one file.

**Exports:** `messageToProviderMessage(msg)`, `providerToolCallToToolCall(tc)`, `providerResponseToMessages(res)`, `generateId()`, `now()`, `estimateTokens(text)`, `toZclawError(err, code)`

---

## Adapter Specifications

### CLI Adapter (`src/adapters/cli/`)

| File | Lines | What it adds over core |
|------|------:|---|
| `index.ts` | ~250 | Commander setup, `dotenv.config()` (first call), readline loop, headless mode (`--no-interactive`), model switch UI, skill invocation |
| `agent.ts` | ~100 | `buildSystemPrompt()` (OS info, container constraints, role), `onStep` callback: ora spinner, chalk coloring |
| `config-loader.ts` | ~180 | JSON config loading, global/local merge, env var overlay, legacy format auto-migration via `migrateLegacyConfig()` |
| `setup.ts` | ~320 | Setup wizard: provider selection (4 providers), API key input with masking, baseUrl/model config, default provider, optional extras (Image gen, Email, Web Search, Group Bots), `~/zclaw_documents` workspace creation |

**Headless mode:** `--no-interactive` flag processes the initial query and exits with `process.exit(0)`, skipping the readline loop entirely. This is a simple conditional in the CLI adapter — no core changes needed.

**Skill invocation flow in CLI:**
```typescript
// In CLI chat loop, when input starts with '/'
if (input.startsWith('/')) {
  const result = await invokeSkill({ input, registry, providerFactory, skillsPath });
  if (result.providerSwitched) {
    await providerFactory.resolve(result.skill.name);
  }
  await runAgentLoop({ provider, messages, toolDefs, systemPrompt, config,
    onStep: (step) => { /* chalk/ora output */ }
  });
  providerFactory.restore();
}
```

**System prompt construction in CLI adapter:**
```typescript
function buildSystemPrompt(skills: SkillMetadata[]): string {
  return `You are ZClaw, a Docker-Native Autonomous Agent designed for massive scale automation.
CONTEXT:
- OS: ${os.type()} ${os.release()} (${os.platform()})
- Architecture: ${os.arch()}
- Node.js: ${process.version}
- CWD: ${process.cwd()}
- User: ${os.userInfo().username}
- Date: ${new Date().toLocaleString()}

ENVIRONMENT: HEADLESS, CONTAINER-OPTIMIZED, NON-INTERACTIVE
AVAILABLE SKILLS: ${skills.map(s => s.name).join(', ')}
...`;
}
```

**dotenv.config():** Called as the very first line in `adapters/cli/index.ts`, before any config loading or provider resolution.

**Setup wizard (`setup.ts`):** Triggered by `zclaw setup` command or automatically when no provider config is found. Creates `~/.zclaw/setting.json` (global) or `.zclaw/setting.json` (project). Uses `config-loader.ts` for persistence.

### SDK Adapter (`src/adapters/sdk/`)

| File | Lines | What it adds over core |
|------|------:|---|
| `index.ts` | ~120 | `generateText()` (~30 lines), `streamText()` (~60 lines), re-exports |
| `agent.ts` | ~180 | `createAgent()` stateful wrapper, session persistence, cumulative usage |
| `tools.ts` | ~40 | Re-exports from core + tool group constants |
| `http.ts` | ~60 | SSE stream + Response helpers |
| `react.ts` | ~200 | `useChat()` hook |

**Key simplification:** `generateText()` becomes ~30 lines (down from 165):
```typescript
export async function generateText(prompt, options?) {
  const { provider, model } = await getProvider(options?.provider);
  const toolDefs = options?.tools ? resolveTools(options.tools) : getToolDefinitions();
  const messages = [userMsg(prompt)];  // No system prompt for SDK — caller provides it via options
  const result = await runAgentLoop({ provider, model, messages, toolDefs,
    systemPrompt: options?.systemPrompt,
    maxSteps: options?.maxSteps ?? 5, ... });
  if (result.error) throw new ZclawError(result.error.message, result.error.code);
  return { text: lastAssistantText(result.messages), ...result };
}
```

**SDK agent skill handling:** `createAgent()` uses `providerFactory` for per-skill model switching. When a skill is invoked via `use_skill` tool, the `providerFactory.resolve(skillName)` swaps the provider for subsequent steps within the same `runAgentLoop()` call.

### Server Adapter (`src/adapters/server/`)

| File | Lines | What it adds over core |
|------|------:|---|
| `index.ts` | ~100 | HTTP server creation, CORS, graceful shutdown, env-based provider init |
| `rest.ts` | ~180 | Route matching, JSON parsing, calls `generateText()` from SDK |
| `websocket.ts` | ~200 | WS protocol, calls `streamText()` from SDK with WS-send callbacks |
| `auth.ts` | ~220 | API key generation, validation, scoping (server-only) |
| `session-store.ts` | ~180 | TTL decorator over core `FileSessionStore`, per-key limits |

**Server→SDK stability contract:** Server imports only from `adapters/sdk/` (never from `core/` directly). The SDK adapter is the public API surface. Breaking changes in core are acceptable; breaking changes in SDK adapter exports require a major version bump.

**Key simplification:** `bridgeGenerateText()` (72 lines) and `bridgeStreamText()` (65 lines) are DELETED. Server calls SDK directly:
```typescript
// REST
const result = await generateText(req.body.message, { model, tools, maxSteps });
if (result.error) { res.status(500).json({ error: result.error }); return; }
res.json({ text: result.text, usage: result.usage, finishReason: result.finishReason });

// WebSocket
const stream = await streamText(msg.message, {
  onText: (d) => ws.send(JSON.stringify({ type: 'text', delta: d })),
  onToolCall: (t) => ws.send(JSON.stringify({ type: 'tool_call', ...t })),
});
```

**SSEOptions:** Defined locally in `adapters/sdk/http.ts` (NOT in core/types.ts). SSE is a transport concern.

---

## Consolidation Verdicts

| Current File | Verdict | Target |
|---|---|---|
| `src/agent.ts` | **DELETE** | → `core/agent-loop.ts` + `core/skill-invoker.ts` + `adapters/cli/agent.ts` |
| `src/index.ts` | **DELETE** | → `adapters/cli/index.ts` + `adapters/cli/config-loader.ts` + `adapters/cli/setup.ts` |
| `src/sdk/types.ts` | **DELETE** | → `core/types.ts` |
| `src/sdk/agent.ts` | **DELETE** | → `adapters/sdk/agent.ts` (slimmed) |
| `src/sdk/index.ts` | **DELETE** | → `adapters/sdk/index.ts` (slimmed) |
| `src/sdk/providers.ts` | **DELETE** | → `core/provider-resolver.ts` |
| `src/sdk/hooks.ts` | **DELETE** | → `core/hooks.ts` |
| `src/sdk/session.ts` | **DELETE** | → `core/session-store.ts` |
| `src/sdk/tools.ts` | **DELETE** | → `core/tool-executor.ts` + `adapters/sdk/tools.ts` |
| `src/sdk/http.ts` | **DELETE** | → `adapters/sdk/http.ts` (includes SSEOptions) |
| `src/sdk/react.ts` | **MOVE** | → `adapters/sdk/react.ts` |
| `src/sdk/react-types.d.ts` | **MOVE** | → `adapters/sdk/react-types.d.ts` |
| `src/server/index.ts` | **DELETE** | → `adapters/server/index.ts` |
| `src/server/rest.ts` | **MOVE** | → `adapters/server/rest.ts` |
| `src/server/websocket.ts` | **MOVE** | → `adapters/server/websocket.ts` |
| `src/server/auth.ts` | **MOVE** | → `adapters/server/auth.ts` |
| `src/server/session-store.ts` | **DELETE** | → `adapters/server/session-store.ts` (decorator over core) |
| `src/providers/*` | **KEEP** | Unchanged |
| `src/tools/*` | **KEEP** | Unchanged |
| `src/skills/*` | **KEEP** | Unchanged |
| `src/models-catalog.ts` | **KEEP** | Unchanged |

---

## Dependency Flow

```
                  +------------------+
                  |   core/types.ts  |    <-- leaf node, no imports
                  +--------+---------+
                           |
          +----------------+----------------+
          |                |                |
  +-------v------+  +------v-------+  +----v----------+
  | core/errors  |  | core/hooks   |  | (other leaves)|
  +-------+------+  +------+-------+  +----+----------+
          |                |                |
          +--------+-------+--------+------+
                   |                |
          +--------v------+ +------v-------------+
          | core/message- | | core/provider-     |
          | convert.ts    | | resolver.ts        |
          +--------+------+ +------+-------------+
                   |                |
          +--------v----------------v------+
          |       core/agent-loop.ts       |   <-- THE loop
          +--------+-----------+-----------+
                   |           |
          +--------v---+ +----v-------------+
          | core/tool- | | core/session-    |
          | executor.ts| | store.ts         |
          +-----+------+ +----+-------------+
                |              |
          +-----v------+       |
          | core/skill- |      |
          | invoker.ts  |      |
          +-----+------+       |
                |              |
    +-----------+-----+--------+----------+
    |                 |                  |
+---v--------+  +----v--------+  +------v-------+
| adapters/  |  | adapters/   |  | adapters/    |
| cli/       |  | sdk/        |  | server/      |
| (chalk/ora)|  | (functional)|  | (HTTP/WS)    |
+------------+  +-------------+  +--------------+
```

---

## Migration Plan (14 Steps, 4 Phases)

### Phase 1: Extract Core (no deletions, no behavioral changes)

| Step | What | Files Created | Files Modified | Risk |
|------|------|---------------|----------------|------|
| 1 | Extract helpers to `core/message-convert.ts` | 1 | 3 (`sdk/agent.ts`, `sdk/index.ts`, `sdk/react.ts`) | LOW |
| 2 | Extract agent loop to `core/agent-loop.ts` (with `systemPrompt`, `providerFactory`, `AgentLoopError`) | 1 | 1 (`sdk/agent.ts` imports from core) | LOW |
| 3 | Extract provider resolver to `core/provider-resolver.ts` (includes `migrateLegacyConfig`, mutation APIs) | 1 | 1 (`server/index.ts` uses `resolveFromEnv`) | MED |
| 4 | Extract skill invocation to `core/skill-invoker.ts` | 1 | 1 (`index.ts` calls `invokeSkill()`) | MED |
| 5 | Unify session stores (remove inline from `sdk/agent.ts`) | 0 | 1 (`sdk/agent.ts` imports from `sdk/session.ts`) | LOW |

### Phase 2: Rewire Consumers (change imports)

| Step | What | Files Modified | Risk |
|------|------|----------------|------|
| 6 | `generateText()` calls `runAgentLoop()` with `systemPrompt` option | 1 (`sdk/index.ts`) | MED |
| 7 | `streamText()` calls `runAgentLoop()` | 1 (`sdk/index.ts`) | MED |
| 8 | Server calls SDK instead of `bridgeGenerateText` (with error propagation) | 2 (`server/index.ts`, `server/rest.ts`) | HIGH |

### Phase 3: Delete Dead Code

| Step | What | Files Modified | Risk |
|------|------|----------------|------|
| 9 | CLI `Agent.chat()` calls `runAgentLoop()` + `buildSystemPrompt()` | 1 (`agent.ts`) | MED |
| 10 | Move setup wizard to `adapters/cli/setup.ts`, wire `/models` to `provider-resolver` mutation APIs | 2 (`agent.ts`, `index.ts`) | MED |
| 11 | Clean dead code from SDK/server/CLI — explicit deletion checklist: | 5+ | LOW |
| | - `sdk/agent.ts` inline session store | | |
| | - `sdk/agent.ts` helper functions (now in `core/message-convert.ts`) | | |
| | - `server/index.ts` `bridgeGenerateText`/`bridgeStreamText` | | |
| | - `agent.ts` `switchToSkillModel`/`restoreProvider` (now via `providerFactory`) | | |
| | - `agent.ts` system prompt constructor (now in CLI adapter) | | |

### Phase 4: Restructure into Adapters

| Step | What | Files Created/Moved/Deleted | Risk |
|------|------|-----------------------------|------|
| 12 | Rename `ToolDefinition` → `UserToolDefinition`, move `SSEOptions` to SDK adapter | ~6-8 | LOW |
| 13 | Move files to `adapters/` structure | ~16 moves | MED |
| 14 | Update `package.json` exports/bin/files, final barrel exports, tsconfig paths | ~3 | LOW |

**Explicit package.json changes for Step 14:**
```json
{
  "main": "dist/adapters/cli/index.js",
  "exports": {
    ".": { "import": "./dist/adapters/sdk/index.js", "types": "./dist/adapters/sdk/index.d.ts" },
    "./react": { "import": "./dist/adapters/sdk/react.js", "types": "./dist/adapters/sdk/react.d.ts" },
    "./server": { "import": "./dist/adapters/server/index.js", "types": "./dist/adapters/server/index.d.ts" }
  },
  "bin": { "zclaw": "dist/adapters/cli/index.js" },
  "files": ["dist/core", "dist/adapters", "dist/providers", "dist/tools", "dist/skills", "dist/models-catalog.js", "skills", "README.md", "package.json", "LICENSE"]
}
```

**Invariant:** CLI works after every step. Phase 1 is zero-risk extraction. Phase 2-3 preserve behavior. Phase 4 is reorganization.

---

## Lines of Code Impact

| Area | Before | After | Delta |
|---|---:|---:|---:|
| Agent loop | ~500 (4 copies) | ~120 (1 copy) | **-380** |
| Session stores | ~300 (3 copies) | ~80 (1 copy + decorator) | **-220** |
| Provider resolution | ~250 (3 copies) | ~130 (1 copy) | **-120** |
| Helper functions | ~60 (3 copies) | ~20 (1 copy) | **-40** |
| Server bridge code | ~170 | 0 (uses SDK) | **-170** |
| **Total removed** | | | **~930 lines** |

---

## Open Questions (Resolved by Review)

1. ~~**Should `providers/types.ts` merge into `core/types.ts`?**~~ **RESOLVED:** NO. `ProviderMessage`/`LLMProvider` are provider wire types — keep them with providers.
2. ~~**Should server import from SDK adapter or directly from core?**~~ **RESOLVED:** SDK adapter. Server goes through the same path as SDK users. Documented as stability contract in Server adapter spec.
3. ~~**Backward compatibility for `import from 'zclaw'`?**~~ **RESOLVED:** No backward-compat shims. Update `package.json` exports to new paths. Users update import paths. Per project direction: no garbage collection, no legacy code paths.
4. ~~**React hook location?**~~ **RESOLVED:** Keep in `adapters/sdk/react.ts`. Consider `@zclaw/react` package in future.
5. ~~**Per-skill model switching?**~~ **RESOLVED:** `ProviderFactory` pattern. `runAgentLoop()` accepts a factory that adapters use to implement `switchToSkillModel`/`restoreProvider` semantics without mutable state. See `core/agent-loop.ts`.
6. ~~**System prompt construction?**~~ **RESOLVED:** `systemPrompt?: string` in `AgentLoopOptions`. CLI adapter's `buildSystemPrompt()` generates it. Core is unaware of content.
7. ~~**Setup wizard placement?**~~ **RESOLVED:** `adapters/cli/setup.ts` (~320 lines). Depends on `config-loader.ts` for persistence.
