# Gateway Test Coverage — Design Spec

**Date:** 2026-06-10
**Status:** Approved
**Goal:** Verify gateway functionality works end-to-end — every test exercises a real code path and asserts on actual output/state, not structural properties.

---

## Principle

Every test must answer: "given this input, does this code path produce the correct result?" No tests that only check shapes, counts, or types without exercising behavior.

## Test Files

| # | File | Target | Strategy | ~Tests |
|---|------|--------|----------|--------|
| 1 | `src/gateway/__tests__/gateway.test.ts` | `MCPGateway` engine | Mock settings adapter + mock MCP Client | 18 |
| 2 | `src/core/__tests__/semantic-tools.test.ts` | Semantic middleware | Mock gateway with real ToolModules | 8 |
| 3 | `src/core/__tests__/agent-loop-gateway.test.ts` | Agent-loop bridge | Minimal mock provider + injected tools | 6 |
| 4 | `src/gateway/__tests__/openapi-importer.test.ts` | OpenAPI importer | Mock global fetch | 6 |
| 5 | `src/adapters/server/__tests__/rest-gateway.test.ts` | REST route handler | Mock IncomingMessage/ServerResponse + gateway | 10 |

## Test Cases

### 1. gateway.test.ts — MCPGateway engine

**Target management:**
- `registerTarget` stores target, persists via adapter, appears in `getTargets()`
- `registerTarget` with `isAdmin=true` adds to admin set (verifiable via credential resolution)
- `unregisterTarget` removes target, closes MCP client, cleans up routes, persists
- `toggleTarget` persists enabled state — reload from disk and verify
- `toggleTarget` on missing target returns false

**Routing:**
- Route with matching pattern returns `"-> target (route: 'pattern')"`
- Tag fallback returns `"-> target (tag match)"`
- No match returns available targets message
- Empty gateway returns "No targets registered."

**REST proxy:**
- `callRest` makes fetch with correct URL, method, headers
- `callRest` on missing target throws GatewayError with retryable=false
- `callRest` on disabled target throws GatewayError
- `callRest` with bearer auth injects Authorization header (verify via fetch mock args)
- `callRest` HTTP error wraps in GatewayError with correct retryable (5xx=true, 4xx=false)

**Audit:**
- Successful call produces audit record with correct target/operation/success=true
- Failed call produces audit record with success=false
- Ring buffer caps at maxAuditLogsInMemory
- `getUsageSummary` aggregates calls and errors per target

**Injectable tools:**
- `getInjectableTools()` for MCP target with capabilities produces tools named `target__toolName`
- All injectable tools have `risk: "communications"`
- `getInjectableTools()` for REST target produces tools for each operation

**Credential trust guard:**
- Admin MCP target with `credential:` env var resolves credential
- Agent-registered MCP target with `credential:` env var does NOT resolve

### 2. semantic-tools.test.ts — Middleware

- No user message → no injection, next() called
- Empty gateway → no injection, next() called
- User message matching one tool → that tool injected into ctx.toolDefs
- User message matching multiple → topK limits injection
- Non-matching message → no injection, next() called
- Injected tools populate ctx.metadata.injectedTools as Map with handler
- Content type guard: non-string content → no injection, no crash
- Handler in injectedTools map matches tool definition name

### 3. agent-loop-gateway.test.ts — Agent-loop bridge

- finalHandler rebuild: middleware mutates ctx.toolDefs → executeLoop receives merged toolDefs
- Injected tool called by name → injectedModule.handler invoked, not executeTool
- Permission check: injected tool risk "communications" → correct riskCategory in permission decision
- autoConfirm=true → injected tool executes without approval
- Static tool name (not injected) → falls through to executeTool
- config.agentName passed through to injected handler

### 4. openapi-importer.test.ts

- JSON spec fetch → target registered with correct baseUrl, operations, tags
- YAML spec fetch → target registered correctly
- Missing servers + no baseUrl override → throws
- Tag filter → only matching operations included
- HTTP fetch failure → throws
- Registered as admin target (isAdmin=true)

### 5. rest-gateway.test.ts — REST handler

- GET /v1/gateway/targets with agent:read scope → 200 with targets
- GET /v1/gateway/targets without auth → 401
- GET /v1/gateway/targets with agent:read scope but admin endpoint → verify each scope gate
- POST /v1/gateway/targets with admin scope → 201, target registered
- POST /v1/gateway/targets missing fields → 400
- PATCH /v1/gateway/targets/:name/toggle → 200, toggle called
- PATCH /v1/gateway/targets/:name/toggle missing target → 404
- DELETE /v1/gateway/targets/:name → 200, target removed
- PUT /v1/gateway/credentials/:key → 200, credential set
- POST /v1/gateway/import-openapi → delegates to importer

## Mocking Strategy

- **MCP Client:** Create a mock that implements the subset of Client used (connect, callTool, listTools, listResources, listPrompts, close)
- **fetch:** Use `vi.fn()` to mock global fetch for REST proxy and OpenAPI importer tests
- **GatewaySettingsAdapter:** Use real adapter with temp directory (like existing settings-adapter tests)
- **Provider:** Minimal mock that returns canned responses for agent-loop tests
- **IncomingMessage/ServerResponse:** Construct from strings with event emitter for body chunks
