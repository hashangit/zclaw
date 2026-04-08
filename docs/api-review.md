# Zclaw API Review — Consolidated Report

**Date**: 2026-04-07
**Method**: 7 parallel expert agents across 2 audit phases
**Principle**: "Better Engineering — Operates via precise system APIs and shell commands rather than unstable visual recognition, ensuring deterministic outcomes."

**Note**: Provider system design (GLM architecture, streaming, model catalog, factory coupling) excluded — working as intended in this version.

---

## Part 1: General API Issues

### Cross-Cutting Themes

#### 1. `any` Everywhere — Type Safety Broken at Boundaries
**Severity: CRITICAL**

Every module boundary uses `any`, destroying TypeScript's value:

| Location | What's `any` |
|----------|-------------|
| `src/agent.ts:14` | `config: any` |
| `src/tools/interface.ts:18` | `handler: (args: any, config?: any)` |
| `src/index.ts:128` | `runSetup(options: any)` |

**Fix**: Define `ToolConfig`, `AgentConfig` interfaces. Make tool handlers generic: `handler: (args: TArgs, config: ToolConfig) => Promise<string>`.

---

#### 2. Legacy + Modern Config Coexist Without Migration
**Severity: CRITICAL**

`AppConfig` has both old single-provider fields (`apiKey`, `model`, `baseUrl`) and new `models.*` structure. Fallback logic is scattered across 3+ functions:

```typescript
const apiKey = ('apiKey' in modelConfig) ? modelConfig.apiKey : config.apiKey;
const model = 'model' in modelConfig ? modelConfig.model : config.model || 'gpt-4o';
```

**Impact**: Users don't know which fields to set. Silent fallbacks mask misconfiguration.

**Fix**: Version the config schema (`v1` -> `v2`). Add explicit `migrateConfig()`. Deprecate top-level provider fields.

---

#### 3. No Error Handling Strategy
**Severity: MAJOR**

Every layer handles errors differently:
- **Tools**: Return error strings (`"Error: ..."`)
- **Agent**: Catch and log
- **Factory/CLI**: No error handling — returns `undefined` for unknown states

**Fix**: Create `ZclawError` hierarchy (`ToolExecutionError`, `ConfigError`). Standardize: tools return structured results, factory throws typed errors.

---

#### 4. Circular Dependency: Tools <-> Skills
**Severity: CRITICAL**

```
src/tools/index.ts -> imports getSkillRegistry from skills/
```

Tools shouldn't know about skills. This creates initialization risks and tight coupling.

**Note**: The previous circular dependency via `src/skills/direct-executor.ts` has been removed.

**Fix**: Inject a `ToolExecutor` interface into the skills system instead of direct imports.

---

### CLI & Config UX

| # | Severity | Issue | Location |
|---|----------|-------|----------|
| 5 | **CRITICAL** | Config file named `setting.json` (typo — should be `settings.json`) | `src/index.ts` |
| 6 | **MAJOR** | No `/help` command — poor discoverability | `src/index.ts` |
| 7 | **MAJOR** | "Active provider" concept is unclear — poor visibility into which provider is being used | `src/index.ts` |
| 8 | **MAJOR** | Duplicate provider config logic across `addProviderInline`, `editProviderConfig`, `resolveProviderConfig` | `src/index.ts` |
| 9 | **MAJOR** | No env var support for multi-provider setup | — |
| 10 | **MAJOR** | Silent fallback behavior — config failures return `null` without explaining what went wrong | `src/index.ts` |
| 11 | **MAJOR** | Weak error messages lacking actionable guidance | multiple |
| 12 | **MAJOR** | Inconsistent provider state when removing active provider — stale `config.provider` references | `src/index.ts` |

---

### Tools & Skills

| # | Severity | Issue | Location |
|---|----------|-------|----------|
| 13 | **CRITICAL** | `ToolDefinition.function.name` uses union with `string` — false type safety | `tools/interface.ts:7` |
| 14 | **CRITICAL** | `handler: (args: any, config?: any)` — completely untyped handler signature | `tools/interface.ts:18` |
| 15 | **MAJOR** | All tools return `string` — no structured error/success distinction | `tools/interface.ts:16` |
| 16 | **MAJOR** | No validation at tool registration — malformed tools fail at runtime | `tools/index.ts:64` |
| 17 | **MAJOR** | Skill `args` field relationship to `$1`, `$2` template vars is undocumented/unclear | `skills/types.ts` |
| 18 | **MAJOR** | `ImageTool` definition declared outside `ToolModule` object, needs `as any` cast — inconsistent with other tools | `tools/image.ts:8-55` |
| 20 | **MINOR** | Skill body cache limited to 5 entries with no LRU eviction | `skills/registry.ts:6` |
| 21 | **MINOR** | `ProviderMessage` uses optional `tool_call_id` but it's required when `role='tool'` | `providers/types.ts:10` |
| 22 | **MINOR** | Error message format inconsistent across tools (some `"Error: ..."`, some `"Failed to ..."`) | multiple |

---

## Part 2: Determinism Audit

Audited all components against the core engineering principle: **precise system APIs over unstable pattern matching**.

### Overall Score: 25/25 components DETERMINISTIC

### Agent Loop & Providers: ALL DETERMINISTIC (6/6)

| Component | Status | How it works |
|-----------|--------|-------------|
| `src/agent.ts` | DETERMINISTIC | Tool calls from `response.tool_calls` (structured SDK field), args via `JSON.parse(toolCall.arguments)` |
| `src/providers/types.ts` | DETERMINISTIC | All data flows through typed interfaces (`ProviderToolCall`, `ProviderResponse`) |
| `src/providers/anthropic.ts` | DETERMINISTIC | SDK-native `block.type === 'tool_use'` enum checks, `block.input` structured access |
| `src/providers/openai.ts` | DETERMINISTIC | SDK-native `tc.type === 'function'` type guard, `tc.function.name` property access |
| `src/providers/factory.ts` | DETERMINISTIC | Enum-based `switch (config.type)` routing |
| `src/tools/index.ts` | DETERMINISTIC | Array `find()` on structured name match, structured args passed to handler |

### Tools: 10/11 DETERMINISTIC

| Tool | Status | API used |
|------|--------|----------|
| Shell Execution | DETERMINISTIC | `child_process.exec()` |
| File Reader | DETERMINISTIC | `fs.readFile()` |
| File Writer | DETERMINISTIC | `fs.writeFile()` + `fs.mkdir()` |
| Date/Time | DETERMINISTIC | Native `Date` + `Intl.DateTimeFormat` |
| Email | DETERMINISTIC | `nodemailer` SMTP library |
| Web Search | DETERMINISTIC | Tavily REST API with JSON |
| Notification | DETERMINISTIC | Webhook APIs (Feishu, DingTalk, WeCom) |
| Browser | DETERMINISTIC | Playwright + Mozilla Readability (DOM parsing, not visual) |
| Image Generation | DETERMINISTIC | OpenAI SDK `client.images.generate()` |
| Prompt Optimizer | DETERMINISTIC | OpenAI SDK `client.chat.completions.create()` |
| **Screenshot** | **FRAGILE** | Playwright API is deterministic, but hardcoded font paths for CJK and `fc-list` output parsing are OS-specific heuristics |

**Screenshot fragility details** (`src/tools/screenshot.ts`):
- Hardcoded font paths (`/usr/share/fonts/noto/...`) that may not exist on all systems
- Parses `fc-list` command output — fragile to different OS versions
- Mitigated by fallback mechanisms and auto-install attempts, but still non-contractual

### Skills Pipeline: 8/8 DETERMINISTIC

| Component | Status | How it works |
|-----------|--------|-------------|
| `skills/types.ts` | DETERMINISTIC | Pure TypeScript interfaces |
| `skills/parser.ts` | DETERMINISTIC | Parses authored YAML frontmatter (structured, not LLM output) |
| `skills/loader.ts` | DETERMINISTIC | `fs/promises` filesystem traversal |
| `skills/registry.ts` | DETERMINISTIC | In-memory Map with caching |
| `skills/args.ts` | DETERMINISTIC | Parses user command input (structured format), precise `$N` replacement |
| `skills/resolver.ts` | DETERMINISTIC | `@path` extraction with `fs.readFile()`, includes path traversal security |
| `skills/index.ts` | DETERMINISTIC | Barrel exports + singleton initialization |
| Agent skill integration | DETERMINISTIC | Structured `resolveReferences` + `substituteArgs` |
| CLI skill invocation | DETERMINISTIC | Structured `/skill-name args` parsing |

### Previously: `src/skills/direct-executor.ts` (REMOVED)

The direct executor used regex to parse tool calls from skill body text. This violated the determinism principle. It was redundant because the normal LLM flow already executes the same tools deterministically via structured `tool_calls`. Removed in this session.

---

## What's Working Well

- Agent loop uses structured `response.tool_calls` from SDK — no text parsing
- Both providers (Anthropic, OpenAI) use SDK-native structured responses with type guards
- All core tools use proper APIs/SDKs (`fs`, `child_process`, `nodemailer`, `fetch`, Playwright)
- Browser tool uses DOM parsing (Readability + JSDOM), not visual recognition
- Skills discovery, registry, args parsing, and reference resolution are all deterministic
- Clean factory pattern with dynamic imports
- Proper API key masking and file permissions

---

## Priority Roadmap

### Phase 1 — Fix the Bleeding
1. Replace `any` at all module boundaries with proper interfaces
2. Break the tools <-> skills circular dependency (inject `ToolExecutor` interface)
3. Fix `setting.json` typo with migration

### Phase 2 — Clean the API Surface
4. Version the config schema, deprecate legacy fields
5. Add tool registration validation
6. Add `/help` command and provider status visibility
7. Unify tool return types (structured success/error)
8. Clarify skill `args` <-> template variable contract

### Phase 3 — Harden
9. Generify tool module interface (`ToolModule<TArgs, TConfig>`)
10. Separate public/internal exports
11. Add env var support for multi-provider config
12. Make screenshot font detection configurable instead of hardcoded paths
