# Unified Core Architecture — Review & Gap Analysis

**Date:** 2026-04-08
**Status:** Validated — Spec revised to v2 addressing all gaps
**Reviewed against:** `docs/superpowers/specs/2026-04-07-unified-core-architecture.md` (v1)
**Resolution:** All 7 CRITICAL + 4 MAJOR gaps addressed in spec v2

---

## Review Methodology

5 parallel validation agents traced actual source code against every gap identified in the initial review. Each gap was confirmed, downgraded, or refuted with exact file:line references.

---

## CRITICAL Gaps (7 — will break functionality)

### C1: Per-skill model switching has no home

**Current:** `switchToSkillModel()` and `restoreProvider()` at `src/agent.ts:147-196`. Mutates `this.provider` and `this.model` on the Agent instance during skill invocation.

**Spec:** `runAgentLoop()` is stateless — takes a single `provider`, no mechanism to swap mid-conversation.

**Impact:** Skills with preferred models (e.g., GLM for code, Anthropic for reasoning) silently use wrong provider.

**Fix needed:** Either:
- Add provider-switching to `AgentLoopOptions.onStep` callback, or
- Make `runAgentLoop()` accept a `providerResolver: (skillName?) => Promise<LLMProvider>` factory, or
- Handle switching at the adapter level (CLI adapter wraps each skill call in a new `runAgentLoop()`)

### C2: UseSkillTool — the tool transfers but the flow doesn't

**Current:** `use_skill` defined in `src/tools/index.ts:12-69`, registered normally, part of `ADVANCED_TOOLS` group.

**Spec:** Would be picked up by `tool-executor.ts` automatically — the tool definition is fine.

**Impact:** The tool itself works, but the LLM→skill→model-switch→execute→restore flow (Gap C1) is broken. The tool fires but the provider doesn't switch.

**Fix needed:** Resolve C1 first, then wire `use_skill` execution through the provider-switching mechanism.

### C3: System prompt construction is orphaned

**Current:** Built in `src/agent.ts:24-57` (Agent constructor). Partially dynamic: injects `os.type()`, `os.arch()`, `process.version`, `os.userInfo().username`, `new Date().toLocaleString()`, and skill list after `initializeSkills()`.

**Spec:** `AgentLoopOptions` has no `systemPrompt` field. Only has `messages: Message[]`.

**Impact:** System prompt (role definition, OS info, container constraints, guidelines) disappears.

**Fix needed:** Add `systemPrompt?: string` to `AgentLoopOptions`, or make it the adapter's responsibility to prepend a system message to `messages[]` before calling `runAgentLoop()`.

### C5: Legacy flat config silently breaks

**Current:** Auto-migration at `src/index.ts:802-812`. Detects top-level `apiKey`/`baseUrl`/`model` and converts to `openai-compatible` provider entry.

**Spec:** `provider-resolver.ts` has `resolveFromConfigFile()` but no legacy format handling.

**Impact:** Existing users with old config format get "no provider found" error. No auto-migration path.

**Fix needed:** `provider-resolver.ts` must include legacy format detection and auto-migration, or config-loader must normalize before passing to resolver.

### C6: Setup wizard (313 lines) is homeless

**Current:** `runSetup()` at `src/index.ts:128-440`. Interactive CLI that:
- Prompts for provider selection (4 providers)
- Collects API keys with masking
- Configures provider-specific options (baseUrl, model)
- Sets default provider
- Optional: Image gen, Email, Web Search, Group Bots
- Creates `~/zclaw_documents` workspace
- Saves to `~/.zclaw/setting.json` or `.zclaw/setting.json`

**Spec:** No file assigned. Not mentioned anywhere.

**Impact:** New users cannot configure ZClaw. Existing users can't reconfigure.

**Fix needed:** Assign to `adapters/cli/setup.ts` (~320 lines). Depends on `config-loader.ts` for persistence.

### C7: package.json exports will break npm consumers

**Current:** `package.json` exports reference `dist/sdk/` paths (which don't even exist in current build yet). After migration, files move to `dist/adapters/sdk/`.

**Required changes:**
```json
{
  "main": "dist/adapters/cli/index.js",
  "exports": {
    ".": { "import": "./dist/adapters/sdk/index.js", "types": "./dist/adapters/sdk/index.d.ts" },
    "./react": { "import": "./dist/adapters/sdk/react.js", "types": "./dist/adapters/sdk/react.d.ts" },
    "./server": { "import": "./dist/adapters/server/index.js", "types": "./dist/adapters/server/index.d.ts" }
  },
  "bin": { "zclaw": "dist/adapters/cli/index.js" },
  "files": ["dist/adapters", "dist/core", "dist/providers", "dist/tools", "dist/skills", "skills", "README.md", "LICENSE"]
}
```

**Fix needed:** Step 12 must include explicit package.json update. No backward-compat shims per user's "no garbage collection" directive.

### C8: Error handling has no contract

**Current:** `ZclawError` interface exists in `sdk/types.ts` with `code`, `retryable`, `provider`, `tool` fields. Error is caught in agent loop, passed to hooks, but NOT included in result.

**Spec:** `AgentLoopResult` has `finishReason: "error"` but no error details, no partial results, no recovery info.

**Impact:** Adapters can't tell users what went wrong, whether to retry, or what partial work was completed.

**Fix needed:** Add to `AgentLoopResult`:
```typescript
error?: {
  message: string;
  code: string;  // from ZclawError
  retryable: boolean;
  provider?: string;
  tool?: string;
};
```

---

## MAJOR Gaps (4 — degraded or lost functionality)

### M9: /models command needs mutation API

**Current:** `handleModelsCommand()` at `src/index.ts:589-763`. Supports add/edit/remove/switch with immediate persistence via `saveConfig()`.

**Spec:** `provider-resolver.ts` only has `configureProviders()` (bulk replace) and `getProvider()`. No `updateProviderConfig()`, `removeProvider()`, `addProvider()`.

**Fix needed:** Add mutation APIs to `provider-resolver.ts` or create a `config-manager.ts` that handles both resolution and mutation with persistence.

### M10: 24+ environment variables not enumerated

Found across codebase:

**Provider vars (13):** `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GLM_API_KEY`, `GLM_MODEL`, `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_BASE_URL`, `ZCLAW_PROVIDER`, `ZCLAW_MODEL`

**Tool vars (10):** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `TAVILY_API_KEY`, `FEISHU_WEBHOOK`, `FEISHU_KEYWORD`, `DINGTALK_WEBHOOK`, `DINGTALK_KEYWORD`, `WECOM_WEBHOOK`, `WECOM_KEYWORD`

**Feature flags (4):** `ZCLAW_SKILLS_PATH`, `ZCLAW_NO_BUNDLED_SKILLS`, `ZCLAW_SKILLS_DEBUG`, `ZCLAW_PORT`, `ZCLAW_SESSION_DIR`, `ZCLAW_SESSION_TTL`

**Fix needed:** Spec must enumerate all env vars and clarify which `resolveFromEnv()` covers vs which are tool-level.

### M11: dotenv.config() not mentioned

**Current:** Called at `src/index.ts:85`, before any config loading.

**Fix needed:** CLI adapter's `index.ts` must call `dotenv.config()` as first action. Document in spec.

### M12: Skill invocation flow not detailed

**Current flow:**
1. User types `/skillname args` → detected in chat loop
2. `parseInvocation()` in `src/skills/args.ts:25-45` → `{ skillName, args }`
3. Registry lookup → `registry.get(skillName)`
4. `resolveReferences()` in `src/skills/resolver.ts:80-126` → resolves `@path`, `@zclaw_documents`, `@~`
5. `switchToSkillModel()` → swaps provider/model
6. `agent.chat(skillPrompt)` → executes with skill context
7. `restoreProvider()` → restores original provider

**Fix needed:** Spec must detail where each step lives in new architecture. Especially steps 4-7 which cross multiple boundaries.

---

## Downgraded

### D4: Headless mode (--no-interactive) → Informational

**Original concern:** Not mentioned in spec.
**Validation:** `--no-interactive` flag at `src/index.ts:107` simply skips the readline loop and exits after first query. The CLI adapter pattern handles this naturally as a conditional. **Not a breakage risk**, but should be documented in the spec.

---

## Architecture Quality (unchanged from initial review)

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Separation of Concerns | GOOD | Core has no transport. 1 leak: `SSEOptions` in core/types |
| Interface Design | CONCERN | Missing `systemPrompt`, `SessionStore` interface not defined |
| Dependency Direction | CONCERN | Server→SDK sibling coupling needs stability contract |
| Error Handling | PROBLEM | Weakest area. No error in result, no partial results |
| State Management | CONCERN | Provider mutation ownership unclear |
| Extensibility | GOOD | New adapters/tools/providers work cleanly |

---

## Recommended Spec Revision Priority

1. **Resolve C1 (skill model switching)** — blocks C2, M12, and the overall adapter wiring strategy
2. **Resolve C3 (system prompt)** — trivial fix, add field to `AgentLoopOptions`
3. **Resolve C8 (error handling)** — add error field to `AgentLoopResult`
4. **Resolve C6 (setup wizard)** — assign file, document flow
5. **Resolve C5 (legacy config)** — add to `provider-resolver.ts` or `config-loader.ts`
6. **Resolve C7 (package.json)** — update Step 12 with explicit exports
7. **Resolve M9 (mutation API)** — add to `provider-resolver.ts`
8. **Resolve M10-M12** — enumerate env vars, dotenv, skill flow in spec
