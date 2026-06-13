<!--
  ============================================================================
  Sync Impact Report
  ----------------------------------------------------------------------------
  Version change: (uninitialized template) → 1.0.0
  Rationale: Initial adoption. The prior file was the unmodified template
    (all bracketed placeholders). MAJOR version 1.0.0 established on
    first concrete adoption of the constitution.

  Added principles (all new):
    - I.   Single Execution Engine & Layered Boundaries
    - II.  Single Source of Truth
    - III. Simplicity First
    - IV.  Surgical Changes
    - V.   Safe by Default & Verifiable

  Added sections:
    - Technology Stack & Constraints
    - Development Workflow & Quality Gates

  Modified principles: n/a (initial adoption)
  Removed sections: n/a

  Templates reviewed:
    - .specify/templates/plan-template.md     — ✅ reviewed (no change)
        "Constitution Check" gate defers to this file generically; gates
        below now populate it.
    - .specify/templates/spec-template.md     — ✅ reviewed (no change)
        Already uses MUST language and independent-testable MVP stories,
        consistent with Principle V.
    - .specify/templates/tasks-template.md    — ✅ reviewed (no change)
        Test-first / verify-fail-before-implement aligns with Principle V.
    - .specify/templates/checklist-template.md — ✅ reviewed (no change)

  Follow-up TODOs: none
  ============================================================================
-->

# ZClaw Constitution

## Core Principles

### I. Single Execution Engine & Layered Boundaries

All three adapters (CLI, SDK, Server) MUST delegate to a single `runAgentLoop`
implementation in `src/core/`. No adapter may reimplement the agent loop.

- Layering MUST hold: `Adapters → Core → Infrastructure` (Providers, Tools,
  Skills, Gateway). A higher layer may depend on a lower one; the reverse is
  forbidden.
- Adapters MUST NOT duplicate core logic. The Server imports core directly;
  it MUST NOT depend on the SDK adapter.
- Rationale: One execution engine guarantees identical behavior across every
  surface. Behavioral divergence between adapters is a defect.

### II. Single Source of Truth

Each type, registry, and piece of logic MUST have exactly one definition.
Duplication MUST be eliminated, not tolerated.

- `ProviderType`, tool registries, streaming logic, and provider resolution
  each have ONE canonical home (see `AGENTS.md` "Known Gaps"). New work MUST
  extend the canonical location, not fork it.
- Rationale: Two definitions always drift; the drift always becomes a bug.

### III. Simplicity First

Write the minimum code that solves the stated problem. Nothing speculative.

- No features beyond what was asked. No abstractions for single-use code. No
  "flexibility" or configurability that no consumer requested. No error
  handling for impossible scenarios.
- If an implementation is notably longer than necessary, rewrite it shorter
  before merging. If a simpler approach exists, surface it and push back.
- Rationale: Every line is a maintenance liability. Speculative code costs
  more than it ever saves.

### IV. Surgical Changes

Touch only what the task requires. Every changed line MUST trace directly to
the request.

- Do not "improve" adjacent code, comments, or formatting. Do not refactor
  what is not broken. Match existing style even when you would do otherwise.
- Remove only the imports/variables/functions that YOUR changes orphan.
  Note pre-existing dead code; do not delete it unprompted.
- Rationale: Large, unfocused diffs hide intent, break reviews, and
  introduce regressions.

### V. Safe by Default & Verifiable

The framework must fail predictably, and every task must be expressible as a
verifiable goal.

- Hook errors MUST be non-fatal: observability/extension hooks MUST NEVER
  crash the agent loop.
- Every `ZclawError` MUST carry a machine-readable `code` and a `retryable`
  flag. Tool/permission failures surface through this hierarchy, not raw
  throws where avoidable.
- Tasks MUST be transformed into verifiable goals (e.g., "write a test that
  reproduces the bug, then make it pass"). CI gates publish on test pass.
- Rationale: Predictable failure modes and testable goals are the difference
  between a framework people trust and one they cannot.

## Technology Stack & Constraints

- **Language/Build**: TypeScript compiled with `tsc` to ES2022 / NodeNext.
  NO bundler. Development via `tsx`. Package exports: `zclaw` (SDK),
  `zclaw/server`; binaries `zclaw` (CLI), `zclaw-server`.
- **Package manager**: `pnpm` MUST be used. `npm` MUST NOT be used to install
  dependencies.
- **Providers**: Four types behind the `LLMProvider` interface (`openai`,
  `openai-compatible`, `anthropic`, `glm`). Providers are created via dynamic
  import so unused SDKs stay out of memory.
- **Tools**: Built-in tools live in four tiers (Core, Comm, Advanced,
  Gateway). Custom tools register via `tool()` → `ToolModule` /
  `registerTool()`. The static registry's single source is `src/core/tool-executor.ts`.
- **Permissions**: A risk-based matrix (`strict` / `moderate` / `permissive`
  × `safe` / `edit` / `communications` / `destructive`) runs as a pre-filter
  inside `runAgentLoop`.
- **Configuration**: Multi-layer merge with precedence (highest wins):
  env vars → local `.zclaw/setting.json` → global `~/.zclaw/setting.json`
  → defaults. Settings are schema-driven (`settings-schema.ts`) with secret
  masking and atomic persistence.
- **Skills**: File-based plugins (YAML frontmatter + body), discovered from
  multiple sources (last wins). Bodies load lazily with an LRU cache; all
  three skill-size defenses (load warning, injection truncation, cumulative
  cap) MUST remain in place.
- **Gateway**: An Infrastructure-layer subsystem (MCP client, REST proxy,
  OpenAPI adapter). Targets registered by agents MUST NOT resolve
  `credential:` env vars (credential trust guard).

## Development Workflow & Quality Gates

- **Think before coding**: State assumptions explicitly. If multiple
  interpretations exist, present them — do not pick silently. If something
  is unclear, stop and ask. Surface tradeoffs and simpler alternatives.
- **Explore before editing**: Use the dual-graph context tools in order —
  `graph_continue` first, then `graph_read` the `recommended_files` (one
  call per file, `file::symbol` supported). Respect the returned
  `confidence` caps on supplementary greps/reads. Do NOT do broad or
  recursive exploration by default.
- **Register changes**: After edits, call `graph_register_edit` with the
  changed files (using `file::symbol` notation when the edit targets a
  specific function/class/hook).
- **Record durable context**: Log decisions, tasks, next steps, facts, and
  blockers via `graph_add_memory` as they arise — never via direct writes to
  the context store.
- **Verifiable gates**: Express work as a plan of steps each with a concrete
  verification check. Write the failing test before the fix. Do not mark a
  task complete while tests fail or the implementation is partial.
- **Multi-step work**: Use the task tracker (status: pending → in_progress →
  completed) for any work with 3+ steps. Exactly one task is in_progress at
  a time; mark completed immediately when done, never batched.

## Governance

- This constitution supersedes all other development practices for ZClaw.
  `AGENTS.md` provides runtime behavioral guidance; `ARCHITECTURE.md`
  provides the structural reference. On conflict, this constitution wins.
- **Amendment procedure**: Any change to this file MUST (1) state its
  rationale, (2) bump the version per the policy below, (3) propagate to
  dependent templates (plan / spec / tasks / checklist) and flag any
  pending ones, and (4) prepend a Sync Impact Report as an HTML comment at
  the top of the file.
- **Versioning policy** (semantic): MAJOR on backward-incompatible principle
  removals or redefinitions; MINOR on a new principle/section or materially
  expanded guidance; PATCH on clarifications, wording, or non-semantic
  refinements. Initial adoption is `1.0.0`.
- **Compliance review**: Every change MUST be verifiable against these
  principles. Any justified deviation (e.g., complexity that cannot be
  avoided) MUST be recorded in the plan's "Complexity Tracking" table with
  the simpler alternative and why it was rejected.
- **Session close**: When the user signals the session is done, update
  `CONTEXT.md` in the project root with current task, key decisions, and
  next steps (≤ 20 lines total).

**Version**: 1.0.0 | **Ratified**: 2026-06-13 | **Last Amended**: 2026-06-13
