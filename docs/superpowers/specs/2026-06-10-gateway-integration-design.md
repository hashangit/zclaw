# ZClaw Gateway Integration — Design Spec

**Date:** 2026-06-10
**Status:** Approved
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
| Credential storage | SettingsManager (no separate vault) | One source of truth for all secrets |
| Target persistence | Settings-based (`~/.zclaw/setting.json`) | Uses existing config system |
| Activation | Opt-out (always on unless `gateway.enabled: false`) | Agent can discover and use gateway from first run |
| Scoring | Keyword matching | Zero dependencies, fast, deterministic |
| Injection budget | Top 3 tools per request | Conservative on context window |
| Agent scope | Can add targets, cannot remove them | Self-service addition, human-gated removal |
| Rate limiting | Existing `rateLimitMiddleware` | No duplicate implementation |
| Dynamic tool execution | Metadata lookup bridge in agent-loop | ~15 lines, no architectural change |

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
└── index.ts                       # Barrel: createGateway, initializeGateway, types

src/core/middleware/
└── semantic-tools.ts              # Semantic injection middleware

src/adapters/cli/commands/
└── gateway.ts                     # /gateway slash command handlers
```

### Modified Files

| File | Change |
|------|--------|
| `src/core/agent-loop.ts` | Add `executeToolOrInjected()` helper (~10 lines) + metadata merge in finalHandler (~5 lines) |
| `src/core/settings-schema.ts` | Add `gateway.*` settings keys (~20 lines) |
| `src/core/errors.ts` | Add `GatewayError` subclass (~10 lines) |
| `src/adapters/server/rest.ts` | Add 10 gateway REST routes + handlers (~120 lines) |
| `src/adapters/server/index.ts` | Initialize gateway at startup (~15 lines) |
| `src/adapters/cli/repl.ts` | Register `/gateway` command (~5 lines) |
| `src/adapters/sdk/index.ts` | Export gateway namespace (~10 lines) |

### New Dependency

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP client SDK (stdio + SSE transport, Client, transport classes) |

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
  auth: { type: AuthType; name?: string; settingsKey?: string };
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
  auth?: { type: AuthType; name?: string; settingsKey?: string };
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

The `settingsKey` field replaces the proposed `credentialKey`. When the gateway needs a credential, it resolves via `settingsManager.get("gateway.credentials.<settingsKey>")`.

---

## 4. Gateway Engine

### `src/gateway/gateway.ts`

The `MCPGateway` class manages target lifecycle, MCP client connections, REST proxying, routing, and tool extraction.

**Constructor:** Takes a `SettingsManager` instance (injected, not created internally).

**Lifecycle:**
- `initialize()` — Loads targets from settings, connects enabled MCP targets, discovers capabilities
- `shutdown()` — Closes all MCP client connections

**Management plane (called by adapters):**
- `registerTarget(name, target)` — Add target, persist to settings
- `unregisterTarget(name)` — Remove target, close MCP client, admin-only
- `toggleTarget(name, enabled)` — Enable/disable, admin-only
- `getTargets()` — List all targets
- `addRoute(pattern, target, priority)` / `removeRoute(...)` — Semantic routing rules

**Credential resolution:**
```typescript
private resolveCredential(settingsKey: string): string | undefined {
  return this.settingsManager.get(`gateway.credentials.${settingsKey}`) as string | undefined;
}
```
No separate vault. Delegates to SettingsManager.

**Execution plane:**
- `callMcpTool(agent, target, tool, args)` — Connect to MCP server (cached), call tool, audit
- `callRest(agent, target, path, method, query, body)` — Proxy REST call with credential injection
- `routeRequest(request)` — NL routing via routes + tag matching
- `readResource(agent, target, uri)` — Read MCP resource
- `getPrompt(agent, target, name, args)` — Get MCP prompt template

**Semantic injection support:**
- `getInjectableTools()` — Returns `ToolModule[]` for all tools from all enabled targets, with `target__toolName` naming to prevent collisions

**Observability:**
- `getAuditLogs(target?, limit?)` — Ring buffer of audit records
- `getUsageSummary()` — Per-target call/error counts

**MCP Client Lifecycle:**
- `connectMcpClient(targetName, target)` — Creates `Client` with appropriate transport (stdio/SSE/HTTP)
- Resolves `vault:` prefixed env vars via SettingsManager
- Auto-discovers capabilities on connect: `listTools()`, `listResources()`, `listPrompts()`
- Caches clients by target name
- Sampling support: `CreateMessageRequestSchema` handler delegates to `GatewayHooks.onSamplingRequest`

**Removed from proposed design (consolidated):**
- `GatewayVault` — replaced by SettingsManager
- Internal rate limiting — replaced by existing `rateLimitMiddleware`
- Self-managed file persistence — replaced by settings system

---

## 5. Settings Schema

### Additions to `src/core/settings-schema.ts`

New **"gateway"** category with 6 top-level keys + dynamic credentials:

| Key | Type | Default | Secret | Env Var |
|-----|------|---------|--------|---------|
| `gateway.enabled` | boolean | true | no | `ZCLAW_GATEWAY_ENABLED` |
| `gateway.semanticTopK` | number | 3 | no | — |
| `gateway.defaultRateLimitPerMin` | number | 60 | no | `ZCLAW_GATEWAY_RATE_LIMIT` |
| `gateway.maxAuditLogs` | number | 1000 | no | — |
| `gateway.targets` | object | {} | no | — |
| `gateway.routes` | object | [] | no | — |
| `gateway.credentials.*` | string | — | **yes** | — |

`gateway.targets` stores target configurations as a nested JSON object:
```json
{
  "gateway.targets": {
    "postgres_prod": {
      "kind": "mcp",
      "transport": "stdio",
      "command": "mcp-postgres",
      "description": "Production PostgreSQL",
      "tags": ["database", "postgres", "sql"],
      "enabled": true
    }
  }
}
```

`gateway.credentials.*` stores individual API keys/tokens with secret masking:
```json
{
  "gateway.credentials.stripe_key": "sk_live_...",
  "gateway.credentials.db_password": "s3cret"
}
```

---

## 6. Error Handling

### New Error Class

```typescript
// src/core/errors.ts
export class GatewayError extends ZclawError {
  public readonly target?: string;
  constructor(message: string, target?: string) {
    super(message, "GATEWAY_ERROR", true); // retryable
    this.target = target;
  }
}
```

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

## 7. Data Flows

### Flow 1: Semantic Injection (Primary)

```
User message → Adapter builds AgentLoopOptions
  → runAgentLoop() creates PipelineContext
  → compose([semanticToolInjectionMiddleware]) runs
    → Middleware extracts user message
    → gateway.getInjectableTools() → all tools from all targets
    → scoreRelevance(message, tool.name + tool.description) for each
    → Top 3 with score > 0 → push definitions to ctx.toolDefs
    → Store handlers in ctx.metadata.injectedTools (Map<string, ToolModule>)
  → finalHandler merges ctx.metadata.injectedTools into options.config
  → executeLoop() runs
    → LLM sees built-in tools + 3 injected tools
    → LLM calls injected tool (e.g., "postgres_prod__query")
    → executeToolOrInjected() finds handler in config.injectedTools
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
  → gateway persists to settingsManager.set("gateway.targets.<name>", ...)
  → Target available for semantic injection on next request
```

### Flow 4: OpenAPI Import

```
Agent: gateway_import_openapi({ name: "stripe", specUrl: "..." })
  → Fetch spec → parse paths → create RestTarget
  → gateway.registerTarget("stripe", { kind: "rest", operations: [...] })
  → Operations immediately available for semantic injection
```

---

## 8. Tool Surface

### Agent-Facing Tools (10)

Registered in the static tool registry at startup via `registerTool()`.

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
| Set credential | `PUT /v1/gateway/credentials/:key` | `/gateway credentials set` | via SettingsManager |
| Audit log | `GET /v1/gateway/audit` | — | — |
| Usage stats | `GET /v1/gateway/usage` | — | — |

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

    // Inject definitions (LLM sees these)
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

### Agent-Loop Bridge

In `src/core/agent-loop.ts`, two changes:

**1. FinalHandler merges metadata (before calling executeLoop):**
```typescript
await compose(middleware)(ctx, async () => {
  if (ctx.metadata.injectedTools) {
    options.config = { ...options.config, injectedTools: ctx.metadata.injectedTools };
  }
  const result = await executeLoop(options);
  ctx.result = { ... };
});
```

**2. New helper replacing direct `executeTool()` calls:**
```typescript
async function executeToolOrInjected(
  name: string,
  args: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<string> {
  const injected = config?.injectedTools as Map<string, ToolModule> | undefined;
  if (injected?.has(name)) {
    return injected.get(name)!.handler(args, config);
  }
  return executeTool(name, args, config);
}
```

All `executeTool(tc.name, parsedArgs, config)` calls in `executeLoop` are replaced with `executeToolOrInjected(tc.name, parsedArgs, config)`.

**AgentName flow:** Injected tool handlers receive `config` and look for `config.agentName`. Adapters must include `agentName` in the `config` object they pass to `runAgentLoop`. The server adapter sets `config.agentName` from the session or API key. The CLI adapter sets it from the REPL agent name. The SDK lets the caller provide it via `config.agentName`.

---

## 10. OpenAPI Auto-Coder

### `src/gateway/openapi-importer.ts`

Fetches an OpenAPI spec (JSON only for v1), parses its paths, and registers all operations as a `RestTarget`.

```typescript
export async function importOpenApiSpec(
  gateway: MCPGateway,
  name: string,
  specUrl: string,
  options?: { baseUrl?: string; auth?: any; tagFilter?: string[] }
): Promise<{ imported: number; operations: string[] }>;
```

**Steps:**
1. `fetch(specUrl)` → get spec JSON
2. Extract `servers[0].url` as baseUrl (overridable via options)
3. Parse `paths` → extract method, operationId, summary for each operation
4. Create `RestTarget` with all operations
5. Call `gateway.registerTarget(name, target)`
6. Return count and list of imported operations

Exposed as the `gateway_import_openapi` agent tool and `POST /v1/gateway/import-openapi` REST endpoint.

---

## 11. Harmonization with Existing Systems

| Concern | Resolution |
|---------|------------|
| Tool name collisions | Injected tools use `target__toolName` prefix; proxy tools use `gateway_` prefix |
| Permission matrix | Gateway tools have explicit risk categories; injected tools are `communications`; existing matrix applies |
| Tool approval flow | Injected tools go through the same `approveTool` callback |
| Existing tools | Unaffected — gateway tools are purely additive |
| Skill compatibility | Skills can scope gateway access via `allowedTools: ["gateway_call_tool"]` |
| Streaming | Gateway tool results flow through existing `onStep` / `StreamManager` pipeline |
| Rate limiting | Uses existing `rateLimitMiddleware`, no duplicate implementation |
| Session persistence | Gateway state is in settings, not sessions. Stateless across sessions. |
| Provider switching | Gateway has no provider dependency. MCP client SDK is independent. |

---

## 12. Edge Cases

| Scenario | Behavior |
|----------|----------|
| No targets registered | Gateway tools return "No targets registered." Zero context overhead. |
| Semantic injection finds 0 matches | Falls through to proxy pattern. LLM uses `gateway_route` to discover. |
| MCP server goes offline | `callMcpTool` catches error, returns to LLM via audit log. |
| Target registered twice | Second registration overwrites. |
| Large OpenAPI spec (1000+ ops) | Operations stored but not in context. Only top-3 per request. |
| Gateway disabled in settings | Tools not registered. Middleware is no-op. Zero overhead. |
| Concurrent calls to same target | MCP client cached per target. SDK handles multiplexing. |
| `settingsKey` references missing credential | Credential resolves to `undefined`. Auth headers omitted. API returns 401, LLM sees it. |

---

## 13. Dependency

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | latest | MCP client: `Client`, `StdioClientTransport`, `SSEClientTransport`, `CreateMessageRequestSchema` |

No other new dependencies. OpenAPI parsing uses `JSON.parse` (JSON-only for v1).

---

## 14. Testing Strategy

### Unit Tests

| File | Tests |
|------|-------|
| `gateway.ts` | Target registration, toggle, unregister, routing, MCP mock calls, REST mock calls |
| `semantic-scorer.ts` | Score relevance with various inputs |
| `tool-factory.ts` | Tool definitions match expected schema, handlers call gateway correctly |
| `openapi-importer.ts` | Parse spec JSON, register target, handle invalid specs |
| `semantic-tools.ts` | Middleware injects correct tools, respects topK, handles no-match |

### Integration Tests

| Scenario | Test |
|----------|------|
| Full semantic flow | User message → middleware → tool injection → agent-loop → tool execution → result |
| Proxy fallback | No semantic match → agent uses proxy tools → discovers target → calls tool |
| Management REST | Register target → list targets → toggle → unregister → verify 404 |
| OpenAPI import | POST spec URL → target registered → tools available for injection |
| Gateway disabled | `gateway.enabled: false` → no tools registered → middleware is no-op |
| Error self-healing | Failed tool call → agent reads audit log → retries with corrected args |

---

## 15. Implementation Order

1. `src/gateway/types.ts` — Types first
2. `src/core/errors.ts` — Add `GatewayError`
3. `src/core/settings-schema.ts` — Add gateway settings keys
4. `src/gateway/gateway.ts` — Core engine
5. `src/gateway/semantic-scorer.ts` — Scoring logic
6. `src/gateway/tool-factory.ts` — Proxy tools
7. `src/gateway/openapi-importer.ts` — OpenAPI importer
8. `src/gateway/index.ts` — Barrel
9. `src/core/middleware/semantic-tools.ts` — Semantic middleware
10. `src/core/agent-loop.ts` — Bridge (executeToolOrInjected + metadata merge)
11. `src/adapters/server/rest.ts` — Gateway REST routes
12. `src/adapters/server/index.ts` — Gateway initialization
13. `src/adapters/cli/commands/gateway.ts` — CLI commands
14. `src/adapters/cli/repl.ts` — Command registration
15. `src/adapters/sdk/index.ts` — SDK exports
16. Tests
