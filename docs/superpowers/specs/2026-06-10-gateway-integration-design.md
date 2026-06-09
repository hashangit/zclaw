# ZClaw Gateway Integration — Design Spec

**Date:** 2026-06-10
**Status:** Approved (post-scrutiny revision)
**Scope:** Add Universal API Hub to ZClaw as a first-class Infrastructure subsystem

---

## 1. Overview

The Gateway gives ZClaw the ability to act as an MCP (Model Context Protocol) client, a secure REST proxy, and an OpenAPI auto-adapter. It connects to downstream MCP servers and REST APIs, discovers their capabilities, and exposes them to the agent through two complementary patterns:

1. **Semantic Injection (primary):** A middleware scores the user's message against all discovered tools and injects the top-3 most relevant directly into the agent's tool context. Zero context pollution.
2. **Proxy Pattern (fallback):** Generic tools (`gateway_call_tool`, `gateway_route`, etc.) let the agent navigate targets when semantic injection finds no match.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture layer | Infrastructure (alongside Providers, Tools, Skills) | All adapters get gateway automatically; single wiring point |
| Credential storage | Dedicated JSON file via SettingsAdapter | SettingsManager's static SETTINGS_MAP rejects dynamic keys; dedicated adapter avoids schema collision |
| Target persistence | Dedicated `~/.zclaw/gateway/targets.json` + `credentials.json` | Avoids impedance mismatch between structured target data and flat dot-key settings |
| Activation | Settings-gated at startup (check `gateway.enabled` before registration) | Tools registered only if enabled. No runtime toggle — restart required |
| Scoring | Keyword matching | Zero dependencies, fast, deterministic |
| Injection budget | Top 3 tools per request | Conservative on context window |
| Agent scope | Can add targets, cannot remove them | Self-service addition, human-gated removal |
| Rate limiting | Existing `rateLimitMiddleware` | No duplicate implementation |
| Dynamic tool execution | Metadata lookup bridge in agent-loop | ~20 lines, no architectural change |

---

## 2. Module Structure

### New Files

```
src/gateway/                        # Infrastructure layer subsystem
├── types.ts                        # Target, AuditRecord, GatewayConfig, GatewayHooks
├── gateway.ts                      # MCPGateway class (engine)
├── semantic-scorer.ts             # Keyword-based tool scoring
├── tool-factory.ts                # 10 proxy tools + getInjectableTools()
├── openapi-importer.ts            # OpenAPI spec fetch + parse + register
├── settings-adapter.ts            # Bypass SettingsManager for dynamic key storage
└── index.ts                       # Barrel: createGateway, initializeGateway, types

src/core/middleware/
└── semantic-tools.ts              # Semantic injection middleware

src/adapters/cli/commands/
└── gateway.ts                     # /gateway slash command handlers

src/adapters/server/
└── rest-gateway.ts               # Gateway REST routes (extracted from rest.ts)
```

### Modified Files

| File | Change |
|------|--------|
| `src/core/agent-loop.ts` | Rebuild options from `ctx` in finalHandler + inline injected-tools lookup (~21 lines) |
| `src/core/settings-schema.ts` | Add `SettingsCategory: "gateway"` + `gateway.enabled/semanticTopK/rateLimit/maxAuditLogs` keys (~25 lines) |
| `src/core/errors.ts` | Add `GatewayError` subclass with configurable `retryable` (~12 lines) |
| `src/adapters/server/rest.ts` | Extract settings handler wrappers to `rest-settings.ts` + delegate `/v1/gateway/*` to `rest-gateway.ts` (net reduction) |
| `src/adapters/server/index.ts` | Extract `serverGenerateText`/`serverStreamText` to `server-core.ts` + initialize gateway + set `config.agentName` (net reduction) |
| `src/adapters/cli/repl.ts` | Register `/gateway` command (~5 lines) |
| `src/adapters/sdk/index.ts` | Export gateway namespace (~10 lines) |

### Prerequisite Extractions (NEW-2)

`rest.ts` (445 lines) and `server/index.ts` (447 lines) are already over the 400-line budget. Before adding gateway code, extract existing code:

1. **`rest.ts` → `rest-settings.ts`**: Move settings handler wrappers (lines 349-445, ~97 lines) to a new file. Rest.ts drops to ~348 lines, well under budget.

2. **`server/index.ts` → `server-core.ts`**: Move `serverGenerateText` (lines 84-138) and `serverStreamText` (lines 337-428) to a new file. Server/index.ts drops to ~260 lines, leaving room for gateway initialization.

These extractions happen before any gateway code is added. They are a separate commit.

### New Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP client SDK (stdio + SSE transport, Client, transport classes) |
| `js-yaml` | YAML parsing for OpenAPI specs (most real-world specs are YAML) |

---

## 3. Types

### `src/gateway/types.ts`

```typescript
export type AuthType = 'none' | 'header' | 'bearer' | 'query' | 'basic';
export type McpTransportType = 'stdio' | 'sse' | 'http';

export interface RestTarget {
  kind: 'rest';
  baseUrl: string;
  description: string;
  auth: { type: AuthType; name?: string; credentialRef?: string };
  defaultHeaders: Record<string, string>;
  operations: Array<{ opId: string; method: string; path: string; summary: string }>;
  tags: string[];
  enabled: boolean;
}

export interface McpTarget {
  kind: 'mcp';
  transport: McpTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  auth?: { type: AuthType; name?: string; credentialRef?: string };
  description: string;
  tags: string[];
  enabled: boolean;
  capabilities?: { tools?: any[]; resources?: any[]; prompts?: any[] };
}

export type Target = RestTarget | McpTarget;

export interface AuditRecord {
  timestamp: number;
  agent: string;
  target: string;
  operation: string;
  status: string;
  durationMs: number;
  success: boolean;
}

export interface GatewayHooks {
  onAudit?: (record: AuditRecord) => void | Promise<void>;
  onSamplingRequest?: (params: any) => Promise<any>;
}

export interface GatewayConfig {
  enabled: boolean;
  semanticTopK: number;
  defaultRateLimitPerMin: number;
  maxAuditLogsInMemory: number;
}
```

Gateway reuses ZClaw's existing `ToolModule` and `ToolDefinition` from `src/tools/interface.ts`. No duplicate type definitions.

### Credential References (`credentialRef`)

Targets reference credentials by name via `credentialRef`. The gateway resolves them through `GatewaySettingsAdapter` (see Section 5). Example:

```json
// Target config
{ "auth": { "type": "bearer", "credentialRef": "stripe_api_key" } }

// Resolves to: gateway-settings.credentials["stripe_api_key"]
```

### MCP Target Environment Variables

MCP target `env` values can reference credentials with the `credential:` prefix:

```json
{ "env": { "DB_PASSWORD": "credential:db_password" } }
```

Resolution: `gateway-settings.credentials["db_password"]` is looked up and substituted at connection time.

**Trust boundary:** The `credential:` prefix is ONLY resolved in targets registered by an admin (via REST API with `admin` scope, CLI commands, or SDK). Targets registered by the agent via `gateway_register_target` have `credential:` prefixes treated as literal strings — no resolution. This prevents a crafted target config from leaking stored credentials into untrusted MCP server environments.

---

## 4. Gateway Engine

### `src/gateway/gateway.ts`

The `MCPGateway` class manages target lifecycle, MCP client connections, REST proxying, routing, and tool extraction.

**Constructor:** Takes a `GatewaySettingsAdapter` instance (injected, not created internally).

**Lifecycle:**
- `initialize()` — Loads targets + credentials from storage, connects enabled MCP targets, discovers capabilities
- `shutdown()` — Closes all MCP client connections, flushes state

**Management plane (called by adapters):**
- `registerTarget(name, target)` — Add target, persist via settings adapter
- `unregisterTarget(name)` — Remove target, close MCP client, admin-only
- `toggleTarget(name, enabled)` — Enable/disable, admin-only
- `getTargets()` — List all targets
- `addRoute(pattern, target, priority)` / `removeRoute(...)` — Semantic routing rules

**Credential resolution:**
```typescript
private resolveCredential(credentialRef: string): string | undefined {
  return this.settings.getCredential(credentialRef);
}
```

**Execution plane:**
- `callMcpTool(agent, target, tool, args)` — Connect to MCP server (cached), call tool, audit
- `callRest(agent, target, path, method, query, body)` — Proxy REST call with credential injection
- `routeRequest(request)` — NL routing via routes + tag matching
- `readResource(agent, target, uri)` — Read MCP resource
- `getPrompt(agent, target, name, args)` — Get MCP prompt template

**Semantic injection support:**
- `getInjectableTools()` — Returns `ToolModule[]` for all tools from all enabled targets. Each module has `risk: "communications"` set explicitly (not undefined). Uses `target__toolName` naming to prevent collisions.

**Observability:**
- `getAuditLogs(target?, limit?)` — Ring buffer of audit records
- `getUsageSummary()` — Per-target call/error counts

**MCP Client Lifecycle:**
- `connectMcpClient(targetName, target)` — Creates `Client` with appropriate transport (stdio/SSE/HTTP)
- Resolves `credential:` prefixed env vars via settings adapter
- Auto-discovers capabilities on connect: `listTools()`, `listResources()`, `listPrompts()`
- Caches clients by target name
- **Reconnection:** On connection error, evicts the cached client. Next call to `callMcpTool` triggers a fresh `connectMcpClient`. No explicit health checking — lazy reconnection on failure.
- Sampling support: `CreateMessageRequestSchema` handler delegates to `GatewayHooks.onSamplingRequest`

**Removed from proposed design (consolidated):**
- `GatewayVault` — replaced by `GatewaySettingsAdapter`
- Internal rate limiting — replaced by existing `rateLimitMiddleware`
- Self-managed file persistence — replaced by settings adapter

---

## 5. Settings Adapter (Fixes Blockers 2 & 3)

### `src/gateway/settings-adapter.ts`

The existing `SettingsManager` has a static `SETTINGS_MAP` that rejects unknown dot-keys. Gateway needs dynamic key storage for targets, routes, and credentials. Rather than modifying `SettingsManager` internals, the gateway gets its own thin adapter.

```typescript
export class GatewaySettingsAdapter {
  private targetsPath: string;
  private credentialsPath: string;

  constructor(storageDir: string) {
    this.targetsPath = path.join(storageDir, 'gateway', 'targets.json');
    this.credentialsPath = path.join(storageDir, 'gateway', 'credentials.json');
  }

  // Targets
  async loadTargets(): Promise<Record<string, Target>>;
  async saveTarget(name: string, target: Target): Promise<void>;
  async deleteTarget(name: string): Promise<void>;

  // Credentials
  async loadCredentials(): Promise<Record<string, string>>;
  async setCredential(key: string, value: string): Promise<void>;
  async deleteCredential(key: string): Promise<void>;
  getCredential(key: string): string | undefined; // in-memory sync access

  // Routes
  async loadRoutes(): Promise<Array<{ pattern: string; target: string; priority: number }>>;
  async saveRoutes(routes: Array<{ pattern: string; target: string; priority: number }>): Promise<void>;
}
```

**Storage location:** `~/.zclaw/gateway/` (configurable via `ZCLAW_GATEWAY_DIR` env var).

**Atomic writes:** Same temp-file + rename pattern as the existing `SettingsManager` and `FilePersistenceBackend`.

**Credential security:** `credentials.json` written with `mode: 0o600`.

**Why not SettingsManager?** `SettingsManager.get/set` throw `SettingsError` for any key not in the static `SETTINGS_MAP` (verified at `settings-manager.ts:78` and `:119`). Dynamic keys like `gateway.credentials.stripe_key` would require either (a) modifying SettingsManager internals to support wildcard keys, or (b) pre-registering every possible credential name in the schema — impossible. The adapter is the clean boundary: `SettingsManager` handles the 4 known gateway settings (`gateway.enabled`, etc.), while the adapter handles the dynamic subtree.

**Guideline exception (CLAUDE.md compliance):** CLAUDE.md states "Configuration: user settings use one settings mechanism; build-time config uses build config and env vars. No third system." The `GatewaySettingsAdapter` is a conscious exception, justified by the same reasoning as `FilePersistenceBackend` (`session-store.ts`): the data shape (structured target objects, secret credential blobs) does not fit the flat dot-key settings model. Like the session store, it has its own storage path, atomic writes, and permissions. The 4 typed gateway settings (`gateway.enabled`, etc.) DO go through `SettingsManager`. Only the dynamic subtree (targets, credentials, routes) uses the adapter. This exception is documented here and should not set a precedent for other subsystems.

---

## 6. Settings Schema (Fixes Nit 1)

### Additions to `src/core/settings-schema.ts`

1. **Add `"gateway"` to `SettingsCategory` union** and `SETTINGS_CATEGORIES` array.
2. **Add 4 static settings keys** (the ones the SettingsManager can validate):

| Key | Type | Default | Secret | Env Var |
|-----|------|---------|--------|---------|
| `gateway.enabled` | boolean | true | no | `ZCLAW_GATEWAY_ENABLED` |
| `gateway.semanticTopK` | number | 3 | no | — |
| `gateway.defaultRateLimitPerMin` | number | 60 | no | `ZCLAW_GATEWAY_RATE_LIMIT` |
| `gateway.maxAuditLogs` | number | 1000 | no | — |

Dynamic data (targets, routes, credentials) lives in the `GatewaySettingsAdapter` — not in the settings schema.

---

## 7. Error Handling (Fixes Major 5)

### New Error Class

```typescript
// src/core/errors.ts
export class GatewayError extends ZclawError {
  public readonly target?: string;
  constructor(message: string, target?: string, retryable: boolean = true) {
    super(message, "GATEWAY_ERROR", retryable);
    this.target = target;
  }
}
```

`retryable` is a parameter, not hardcoded. Configuration errors (disabled target, missing target) pass `retryable: false`. Transient errors (network failure, MCP server timeout) pass `retryable: true` (default).

### Error Propagation

Gateway errors follow the existing tool error pattern — they are **non-terminal** to the agent loop:
1. `gateway_call_tool` catches `GatewayError`
2. Returns error string as tool result (e.g., `"Error: Target postgres is disabled"`)
3. LLM sees the error, can self-correct or check `gateway_audit_log`
4. Agent loop continues

The only terminal errors are from the existing `rateLimitMiddleware` — same as today.

### Audit Logging

Every gateway execution produces an `AuditRecord`:
- Successful calls: logged with status, duration
- Failed calls: logged with error message
- Rate-limited calls: logged before throwing

The agent can query these via `gateway_audit_log` for self-healing.

---

## 8. Data Flows

### Flow 1: Semantic Injection (Primary) (Fixes Blocker 1)

```
User message → Adapter builds AgentLoopOptions
  → runAgentLoop() creates PipelineContext from options
  → compose([semanticToolInjectionMiddleware]) runs
    → Middleware extracts user message
    → gateway.getInjectableTools() → all tools from all targets (each with risk: "communications")
    → scoreRelevance(message, tool.name + tool.description) for each
    → Top 3 with score > 0 → push definitions to ctx.toolDefs
    → Store handlers in ctx.metadata.injectedTools (Map<string, ToolModule>)
  → finalHandler REBUILDS options from ctx (not the original options):
      mergedOptions = { ...options, toolDefs: ctx.toolDefs, config: { ...options.config, ...ctx.metadata } }
  → executeLoop(mergedOptions) runs
    → LLM sees built-in tools + 3 injected tools (from mergedOptions.toolDefs)
    → LLM calls injected tool (e.g., "postgres_prod__query")
    → executeToolOrInjected() checks permission matrix, then:
       if found in config.injectedTools → calls injected handler (with risk: "communications")
       if not → falls through to executeTool()
    → Handler calls gateway.callMcpTool()
    → Result returns to LLM, loop continues
```

### Flow 2: Proxy Pattern (Fallback)

```
Semantic injection finds 0 matches → no tools injected
  → LLM sees only proxy tools (gateway_route, gateway_call_tool, etc.)
  → LLM calls gateway_capabilities() → discovers available targets
  → LLM calls gateway_route({ request: "..." }) → finds best target
  → LLM calls gateway_call_tool({ target, tool, arguments })
  → executeTool() finds proxy tool in static registry
  → Proxy handler calls gateway.callMcpTool() directly
```

### Flow 3: Management (REST)

```
Admin: POST /v1/gateway/targets
  → Auth check (admin scope)
  → gateway.registerTarget(name, target)
  → gateway persists via settingsAdapter.saveTarget(name, target)
  → Target available for semantic injection on next request
```

### Flow 4: OpenAPI Import

```
Agent: gateway_import_openapi({ name: "stripe", specUrl: "..." })
  → Fetch spec → auto-detect JSON/YAML → parse paths → create RestTarget
  → gateway.registerTarget("stripe", { kind: "rest", operations: [...] })
  → Operations immediately available for semantic injection
```

---

## 9. Semantic Middleware

### `src/core/middleware/semantic-tools.ts`

```typescript
import type { PipelineContext, Middleware } from '../middleware.js';
import type { ToolModule } from '../../tools/interface.js';
import type { MCPGateway } from '../../gateway/index.js';
import { scoreRelevance } from '../../gateway/semantic-scorer.js';

export function semanticToolInjectionMiddleware(
  gateway: MCPGateway,
  topK: number = 3,
): Middleware {
  return async (ctx: PipelineContext, next: () => Promise<void>) => {
    const lastMessage = [...ctx.messages].reverse().find(m => m.role === 'user');
    if (!lastMessage) { await next(); return; }

    const allGatewayTools = gateway.getInjectableTools();
    if (allGatewayTools.length === 0) { await next(); return; }

    const query = lastMessage.content.toLowerCase();
    const scored = allGatewayTools.map(tool => ({
      tool,
      score: scoreRelevance(query, tool.name + ' ' + (tool.description ?? '')),
    }));

    scored.sort((a, b) => b.score - a.score);
    const selected = scored.filter(s => s.score > 0).slice(0, topK).map(s => s.tool);

    if (selected.length === 0) { await next(); return; }

    // Inject definitions (LLM sees these via ctx.toolDefs)
    ctx.toolDefs.push(...selected.map(t => t.definition));

    // Store handlers (agent-loop bridge picks these up)
    if (!ctx.metadata.injectedTools) ctx.metadata.injectedTools = new Map();
    const injected = ctx.metadata.injectedTools as Map<string, ToolModule>;
    for (const tool of selected) {
      injected.set(tool.definition.function.name, tool);
    }

    await next();
  };
}
```

### Agent-Loop Bridge (Fixes Blocker 1, M1, M2, NEW-1, NEW-5, NEW-6)

In `src/core/agent-loop.ts`, **one structural change** and **one inline addition** — no separate helper function.

**Design principle:** Rather than creating a standalone `executeToolOrInjected` function that duplicates the permission logic (risk of drift), we inline the injected-tools lookup directly into `executeLoop`'s existing tool-execution block. This keeps a single code path for all permission checks.

**1. FinalHandler rebuilds options from `ctx` (fixes Blocker 1):**

The current code passes the original `options` to `executeLoop`, but middleware mutations are on `ctx`. The fix: rebuild `options` from `ctx` fields.

```typescript
// Replace the current finalHandler in runAgentLoop:
await compose(middleware)(ctx, async () => {
  // Rebuild options from ctx to capture middleware mutations
  const mergedOptions: AgentLoopOptions = {
    ...options,
    toolDefs: ctx.toolDefs,  // Middleware may have injected tools here
    config: {
      ...options.config,
      agentName: options.config?.agentName ?? 'zclaw',
      ...(ctx.metadata.injectedTools ? { injectedTools: ctx.metadata.injectedTools } : {}),
    },
  };
  const result = await executeLoop(mergedOptions);
  ctx.result = {
    messages: result.messages,
    steps: result.steps,
    toolCalls: result.toolCalls,
    usage: result.usage,
    finishReason: result.finishReason,
  };
});
```

**2. Inline injected-tools lookup in `executeLoop` (fixes NEW-1, NEW-6):**

Instead of a separate function, add ~5 lines at the top of the tool-execution block inside `executeLoop`. This reuses the existing permission check, approval callback, and error handling — zero duplication, zero drift risk.

In `executeLoop`, before the existing permission check block (before `const riskCategory = getToolRiskCategory(...)` at current line ~352), add:

```typescript
// Check for dynamically injected tools (from semantic middleware)
const injectedTools = config?.injectedTools;
const injectedModule = injectedTools instanceof Map ? injectedTools.get(tc.name) : undefined;
```

Then, after the existing permission check and approval logic (which already handles both `autoConfirm` bypass and `approveTool` callback), replace the `executeTool` call:

```typescript
// Current:
output = await executeTool(tc.name, parsedArgs, config);

// Becomes:
output = injectedModule
  ? await injectedModule.handler(parsedArgs, config)
  : await executeTool(tc.name, parsedArgs, config);
```

The injected tools have `risk: "communications"` set by `getInjectableTools()`, so the existing `getToolRiskCategory(name, getAllToolModules())` call finds them via the module lookup. When `injectedModule` is found, its `risk` field is used directly. When not found, the existing `getAllToolModules()` registry lookup works unchanged.

**This approach adds ~6 lines total** (vs. ~30 for a standalone function). Net impact on `agent-loop.ts`: ~21 lines (15 for finalHandler rebuild + 6 inline), bringing it to ~476 lines. Over the 400-line budget but contained to a single tightly-cohesive module (a state machine loop). If needed later, `executeLoop` can be extracted to its own file.

**Type safety (fixes NEW-5):**

The `injectedTools` field flows through `config: Record<string, unknown>`. Rather than using `as` casts, we add a runtime guard: `injectedTools instanceof Map`. This is explicit, safe, and requires no changes to the `PipelineContext` interface.

**AgentName flow (fixes Major 3):**

Each adapter sets `config.agentName` explicitly in the `AgentLoopOptions.config` they construct:

```typescript
// Server adapter (server/index.ts) — in serverGenerateText and serverStreamText:
config: { agentName: `server:${apiKeyPrefix ?? 'anon'}` }

// CLI adapter (cli/agent.ts) — constant:
config: { agentName: 'cli' }

// SDK adapter (sdk/index.ts and sdk/agent.ts) — from caller or default:
config: { ...opts.config, agentName: opts.config?.agentName ?? 'sdk' }
```

---

## 10. OpenAPI Auto-Coder (Fixes Nit 3)

### `src/gateway/openapi-importer.ts`

Fetches an OpenAPI spec (JSON or YAML), parses its paths, and registers all operations as a `RestTarget`.

```typescript
import * as yaml from 'js-yaml';

export async function importOpenApiSpec(
  gateway: MCPGateway,
  name: string,
  specUrl: string,
  options?: { baseUrl?: string; auth?: any; tagFilter?: string[] }
): Promise<{ imported: number; operations: string[] }>;
```

**Steps:**
1. `fetch(specUrl)` → get raw text
2. Auto-detect format: try `JSON.parse` first, fall back to `yaml.load`
3. Extract `servers[0].url` as baseUrl (overridable via options)
4. Parse `paths` → extract method, operationId, summary for each operation
5. Create `RestTarget` with all operations
6. Call `gateway.registerTarget(name, target)`
7. Return count and list of imported operations

Exposed as the `gateway_import_openapi` agent tool and `POST /v1/gateway/import-openapi` REST endpoint.

---

## 11. Tool Surface

### Agent-Facing Tools (10)

Registered in the static tool registry at startup via `registerTool()` — **only if `gateway.enabled` is true in settings**.

| # | Name | Risk | Purpose |
|---|------|------|---------|
| 1 | `gateway_route` | safe | NL → target routing |
| 2 | `gateway_call_tool` | communications | Execute MCP tool on downstream server |
| 3 | `gateway_call_rest` | communications | Proxy REST call with credential injection |
| 4 | `gateway_capabilities` | safe | List targets + auto-discovered capabilities |
| 5 | `gateway_read_resource` | safe | Read MCP resource (schemas, file trees) |
| 6 | `gateway_get_prompt` | safe | Get MCP prompt template |
| 7 | `gateway_import_openapi` | safe | Import OpenAPI spec → auto-register REST target |
| 8 | `gateway_register_target` | communications | Register new MCP or REST target (add-only) |
| 9 | `gateway_audit_log` | safe | Read audit logs (self-healing) |
| 10 | `gateway_usage_stats` | safe | Check rate limits and error rates |

All proxy tool handlers receive `config.agentName` and pass it to the gateway for audit logging.

### Management Operations (not agent tools)

Accessible via REST API (admin scope), CLI slash commands, and SDK:

| Operation | REST | CLI | SDK |
|-----------|------|-----|-----|
| Register target | `POST /v1/gateway/targets` | `/gateway add` | `gateway.registerTarget()` |
| Unregister target | `DELETE /v1/gateway/targets/:name` | `/gateway remove <name>` | `gateway.unregisterTarget()` |
| Toggle target | `PATCH /v1/gateway/targets/:name/toggle` | `/gateway toggle <name>` | `gateway.toggleTarget()` |
| List targets | `GET /v1/gateway/targets` | `/gateway list` | `gateway.listTargets()` |
| Add route | `POST /v1/gateway/routes` | `/gateway routes add` | `gateway.addRoute()` |
| Remove route | `DELETE /v1/gateway/routes/:pattern/:target` | `/gateway routes remove` | `gateway.removeRoute()` |
| Set credential | `PUT /v1/gateway/credentials/:key` | `/gateway credentials set` | `gateway.setCredential()` |
| List credential keys | `GET /v1/gateway/credentials` | `/gateway credentials list` | `gateway.listCredentials()` |
| Audit log | `GET /v1/gateway/audit` | — | — |
| Usage stats | `GET /v1/gateway/usage` | — | — |

---

## 12. REST Routes (Fixes Major 4)

### Extracted to `src/adapters/server/rest-gateway.ts`

To keep `rest.ts` under the 400-line budget, gateway REST routes live in their own module. The main `rest.ts` delegates `/v1/gateway/*` paths to the gateway handler.

**In `rest.ts` `matchRoute()`:**
```typescript
// Gateway routes — delegate to rest-gateway.ts
if (path.startsWith('/v1/gateway')) {
  return { handler: 'gateway', params: { path, method } };
}
```

**`rest-gateway.ts`** exports a single handler function:
```typescript
export function createGatewayRestHandler(gateway: MCPGateway): RequestHandler;
```

This handler has its own internal routing for the 10 gateway endpoints. Keeps `rest.ts` lean and gateway routes isolated.

---

## 13. Harmonization with Existing Systems

| Concern | Resolution |
|---------|------------|
| Tool name collisions | Injected tools use `target__toolName` prefix; proxy tools use `gateway_` prefix |
| Permission matrix | Gateway tools have explicit risk categories; injected tools always set `risk: "communications"`; existing matrix applies unchanged |
| Tool approval flow | Both built-in and injected tools go through the same permission check + `approveTool` callback via `executeToolOrInjected` |
| Existing tools | Unaffected — gateway tools are purely additive |
| Skill compatibility | Skills can scope gateway access via `allowedTools: ["gateway_call_tool"]` |
| Streaming | Gateway tool results flow through existing `onStep` / `StreamManager` pipeline |
| Rate limiting | Uses existing `rateLimitMiddleware`, no duplicate implementation |
| Session persistence | Gateway state is in settings adapter, not sessions. Stateless across sessions. |
| Provider switching | Gateway has no provider dependency. MCP client SDK is independent. |
| Target mutations | Gateway mutations are serialized. In the server adapter, the existing async mutex pattern from `settings-handlers.ts` is reused. |

---

## 14. Edge Cases

| Scenario | Behavior |
|----------|----------|
| No targets registered | Gateway tools return "No targets registered." Zero context overhead. |
| Semantic injection finds 0 matches | Falls through to proxy pattern. LLM uses `gateway_route` to discover. |
| MCP server goes offline | `callMcpTool` catches error, **evicts cached client**, returns error to LLM. Next call triggers fresh reconnection. |
| Target registered twice | Second registration overwrites. |
| Large OpenAPI spec (1000+ ops) | Operations stored but not in context. Only top-3 per request. |
| Gateway disabled in settings | Gateway tools not registered at startup. Semantic middleware returns early. Zero overhead. Restart required to toggle. |
| Concurrent calls to same target | MCP client cached per target. MCP SDK handles multiplexing. |
| `credentialRef` references missing credential | Credential resolves to `undefined`. Auth headers omitted. API returns 401, LLM sees it. |
| Concurrent target mutations via REST | Serialized via async mutex (same pattern as settings-handlers.ts). |

---

## 15. MCP Client Reconnection (Fixes Major 6)

The gateway uses lazy reconnection:

```typescript
async callMcpTool(agent: string, targetName: string, toolName: string, args: any): Promise<string> {
  const target = this.targets.get(targetName);
  if (!target || target.kind !== 'mcp') throw new GatewayError(`Target ${targetName} not found`, targetName, false);
  if (!target.enabled) throw new GatewayError(`Target ${targetName} is disabled`, targetName, false);

  try {
    const client = await this.connectMcpClient(targetName, target);
    const result = await client.callTool({ name: toolName, arguments: args });
    await this.audit(agent, targetName, `callTool:${toolName}`, 'ok', ...);
    return result.content.map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join('\n');
  } catch (e: any) {
    // Evict dead client — next call will reconnect
    this.mcpClients.delete(targetName);
    await this.audit(agent, targetName, `callTool:${toolName}`, 'error', ...);
    throw new GatewayError(e.message, targetName, true); // retryable — connection may work on retry
  }
}
```

Key behavior: on any connection error, the cached MCP client is evicted. The next `callMcpTool` call creates a fresh connection. No background health checks — simpler and sufficient.

---

## 16. Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | latest | MCP client: `Client`, `StdioClientTransport`, `SSEClientTransport`, `CreateMessageRequestSchema` |
| `js-yaml` | latest | YAML parsing for OpenAPI specs |

---

## 17. Testing Strategy

### Unit Tests

| File | Tests |
|------|-------|
| `gateway.ts` | Target registration, toggle, unregister, routing, MCP mock calls, REST mock calls, client eviction on error |
| `semantic-scorer.ts` | Score relevance with various inputs |
| `tool-factory.ts` | Tool definitions match expected schema, handlers call gateway correctly, `risk` field set correctly |
| `openapi-importer.ts` | Parse JSON spec, parse YAML spec, register target, handle invalid specs |
| `semantic-tools.ts` | Middleware injects correct tools, respects topK, handles no-match, `risk` field propagated |
| `settings-adapter.ts` | Load/save targets, load/save credentials, atomic writes, missing directory |
| `rest-gateway.ts` | Route matching, auth checks, CRUD operations |

### Integration Tests

| Scenario | Test |
|----------|------|
| Full semantic flow | User message → middleware → tool injection → agent-loop → permission check → tool execution → result |
| Proxy fallback | No semantic match → agent uses proxy tools → discovers target → calls tool |
| Management REST | Register target → list targets → toggle → unregister → verify 404 |
| OpenAPI import | POST spec URL → target registered → tools available for injection |
| Gateway disabled | `gateway.enabled: false` → no tools registered → middleware is no-op |
| Error self-healing | Failed tool call → agent reads audit log → retries with corrected args |
| MCP reconnection | Mock MCP server disconnect → callMcpTool fails → client evicted → next call reconnects |
| Permission enforcement | `strict` mode + injected `communications` tool → requires approval |

---

## 18. Implementation Order

### Phase 0: Prerequisite Extractions (separate commit)

0a. `src/adapters/server/rest-settings.ts` — Extract settings handler wrappers from rest.ts
0b. `src/adapters/server/server-core.ts` — Extract serverGenerateText/serverStreamText from index.ts

### Phase 1: Gateway Core

1. `src/gateway/types.ts` — Types first
2. `src/core/errors.ts` — Add `GatewayError` with configurable `retryable`
3. `src/core/settings-schema.ts` — Add `"gateway"` category + 4 static keys
4. `src/gateway/settings-adapter.ts` — Dedicated storage for targets/credentials/routes
5. `src/gateway/gateway.ts` — Core engine (with credential: trust guard)
6. `src/gateway/semantic-scorer.ts` — Scoring logic
7. `src/gateway/tool-factory.ts` — Proxy tools (with risk: "communications" set)
8. `src/gateway/openapi-importer.ts` — OpenAPI importer (JSON + YAML)
9. `src/gateway/index.ts` — Barrel

### Phase 2: Core Integration

10. `src/core/middleware/semantic-tools.ts` — Semantic middleware
11. `src/core/agent-loop.ts` — Inline injected-tools lookup + finalHandler rebuild (~21 lines)

### Phase 3: Adapter Wiring

12. `src/adapters/server/rest-gateway.ts` — Gateway REST routes (extracted)
13. `src/adapters/server/rest.ts` — Delegate `/v1/gateway/*` to rest-gateway
14. `src/adapters/server/index.ts` — Gateway initialization + config.agentName wiring
15. `src/adapters/cli/commands/gateway.ts` — CLI commands
16. `src/adapters/cli/repl.ts` — Command registration
17. `src/adapters/sdk/index.ts` — SDK exports

### Phase 4: Tests

18. Tests
