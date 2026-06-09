# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v0.2.2] - 2026-06-10

This release fixes five bugs found during a holistic system audit — two that could silently lose data under real workloads, one that broke SSE streaming order, one that left provider state corrupted after skill execution, and one that made `agent.abort()` a no-op during streaming. Session files are now written atomically, and a brand discriminator on `PersistenceBackend` stops metadata from being stripped when custom backends are passed to `createAgent()`.

### Fixed

- **SSE events arrived out of order** (`stream-manager.ts`): `toSSEStream()` drained the text queue completely before touching the step queue, so consumers saw all text deltas first, then all tool events — even when tools actually ran between text chunks. Added a unified `eventQueue` that preserves the real interleaved order. Text and step streams still work independently for non-SSE consumers.
- **`agent.abort()` did nothing during `chatStream()`** (`sdk/agent.ts`): `chatStream()` created its own local `AbortController`, but `agent.abort()` still called `.abort()` on a stale closure variable. Now tracks a single `activeAbortController` that both `chat()` and `chatStream()` assign before starting the loop.
- **`PersistenceBackend` instances lost metadata on save** (`sdk/agent.ts`, `types.ts`, `session-store.ts`): `wrapAsPersistenceBackend()` couldn't tell `SessionStore` from `PersistenceBackend` — both have a `save` method, so it always wrapped, calling `.save(id, data.messages)` and throwing away `createdAt`, `provider`, `model`, and custom `metadata`. Added a `__persistenceBackend` brand field to the interface and both built-in backends; the wrapper now passes through branded instances untouched. **Breaking**: third-party `PersistenceBackend` implementations must add `readonly __persistenceBackend = true as const`.
- **Skill provider switching leaked state after loop exit** (`agent-loop.ts`): `providerFactory.restore()` was only called inside the tool-calls block. On text-only completion, errors, or aborts, the factory stayed in a switched state — the next agent run would start with the wrong provider. Wrapped the entire loop body in `try/finally` so `restore()` runs on every exit path.
- **Concurrent `chat()`/`chatStream()` calls corrupted the message history** (`sdk/agent.ts`): `chatStream()` runs the agent loop in a background IIFE and returns immediately. Nothing prevented a second call from starting while the first was still mutating the shared `messages` array — no lock, no guard. Added a promise-based `acquire()`/`release()` lock that serializes all chat operations. A second call blocks until the first completes.
- **Session files were not written atomically** (`session-store.ts`): `FilePersistenceBackend.save()` used a bare `fs.writeFile()` — a crash mid-write left a corrupt JSON file. Now writes to a temp file first, then renames to the target path, matching the atomic pattern already used by `SettingsManager`.
- **Middleware errors left no audit trail** (`agent-loop.ts`): When outer middleware (auth, rate-limit) threw, the error was caught and returned as a structured result, but nothing was logged. Added a `console.error` in the middleware catch block so rejected requests show up in server logs.

### Changed

- Redesigned `/settings` interactive mode into a 3-level drill-down wizard with bordered ASCII headers and mini-forms.
- Reorganized settings categories from 6 to 5: Providers & Models, Permissions & Safety, Tools & Integrations, Notifications, Skills.
- `/settings` with no arguments now launches the wizard (was a plain list).
- Removed `/settings edit` and `/settings wizard` subcommands.
- All 12 built-in tools now carry a `risk` field (`safe`, `edit`, `communications`, or `destructive`).
- `--headless` flag replaces the binary `ZCLAW_SHELL_APPROVE` approval mechanism.
- Unknown and custom tools default to `destructive` risk category, requiring approval in all modes except `permissive`.
- `ToolModule` interface now includes optional `risk` field.
- `permissionMode` option removed from `AgentCreateOptions` (replaced by `permissionLevel`).

### Added

- `/setup` slash command to access the setup wizard directly.
- Bordered mini-form with type-appropriate prompts (password masking, enum lists, boolean confirms).
- Env var override warnings in the setting editor.
- Number field validation with min/max constraints.
- **Permission Levels System**: 3-tier permission matrix (strict/moderate/permissive) with 4 tool risk categories (safe/edit/communications/destructive) controlling which tools auto-execute vs. require human approval.
- CLI flags: `--headless`, `--strict`, `--moderate`, `--yolo` for controlling tool approval behavior.
- SDK: `permissionLevel` option on `GenerateTextOptions`, `StreamTextOptions`, and `AgentCreateOptions`.
- Server: per-message permission level with `maxPermissionLevel` ceiling per connection.
- `ZCLAW_PERMISSION` environment variable and settings file support for default permission level.
- `src/core/permission.ts` — Permission matrix with 3 pure functions (`needsApproval`, `resolvePermissionLevel`, `getToolRiskCategory`).
- 12 built-in tools categorized by risk; custom tools default to "destructive" (deny-by-default).
- 25 new tests (22 in `permission.test.ts`, 3 in `tool-executor.test.ts`).
- **Settings System**: Schema-driven settings management with CLI, SDK, and Server adapters.
- `src/core/settings-schema.ts` — 37 settings mapped to AppConfig paths with validation metadata, env var overrides, and category grouping.
- `src/core/settings-manager.ts` — SettingsManager with get/set/reset/list/onChange, secret masking, origin resolution, atomic file persistence, and deep merge for provider configs.
- CLI `/settings` command with subcommands: `list`, `get`, `set`, `reset`, `edit`, `wizard`, `export`, `help`. Aliases: `/config`, `/setting`.
- SDK `settings` facade exporting get/set/apply/list/listByCategory/onChange/reset/resetAll.
- Server REST endpoints: `GET/PATCH /v1/settings`, `GET /v1/settings/schema`, `POST/PATCH/DELETE /v1/providers`.
- Server WebSocket message types for settings get/update/change broadcast.
- 58 new tests (30 unit + 28 integration) covering schema, manager, validation, persistence, events, and secret masking.

### Security

- **Critical**: WebSocket tool approvals are now bound to the originating connection, preventing cross-connection approval bypass.
- **High**: `autoConfirm` state is captured immutably at agent construction time, preventing runtime mutation attacks.
- **High**: Tool denial messages use generic text ("Tool execution denied.") to prevent information leakage.
- **Medium**: Unknown permission level values are validated in server ceiling comparison, preventing ceiling bypass via invalid levels.
- **Medium**: Custom tool registry is included in risk lookups alongside built-in tools.
- **Low**: Conflicting `--headless` and permission level flags produce a warning.
- **Low**: Legacy `ZCLAW_SHELL_APPROVE` env var is ignored when new permission flags are active.

## [v0.2.1] - 2026-04-09

### Fixed
- Corrected Homebrew formula SHA256 checksum to match npm-published tarball.

## [v0.2.0] - 2026-04-09

### Added

- **Skills System**: Loadable skill packs with `@path` references, workspace setup, and built-in skills (docker-ops, k8s-deploy, log-analyzer).
- **SDK (Programmatic API)**: Full TypeScript SDK with `createAgent`, `streamText`, `generateText`, structured output, React hooks, and session persistence.
- **Server Adapter**: Standalone HTTP/WebSocket server with REST API, session management, and authentication (API key + bearer token).
- **Docker Support**: Production-ready Dockerfile, `.dockerignore`, `docker-compose.yml`, `--docker` CLI flag, and non-interactive environment detection.
- **Shell Approval Modes**: Dual-mode shell command approval — interactive inquirer prompt and non-interactive `ZCLAW_SHELL_APPROVE` env var with `auto`/`deny` modes.
- **Standalone Server Binary**: `zclaw-server` with `--generate-api-key` flag, env var configuration, and graceful shutdown.
- Environment variable overrides for provider API keys.
- VitePress documentation site.

### Changed

- **Modular Multi-Adapter Architecture**: Restructured from monolithic `index.ts` into `core/`, `adapters/{cli,sdk,server}/`, `providers/`, `skills/`, `tools/`.
- **Unified Core**: Shared agent loop, provider resolver, tool executor, error hierarchy, and hooks system across all adapters.
- Extracted error hierarchy into `src/core/errors.ts`.
- Extracted tool executor into `src/core/tool-executor.ts`.
- Split CLI adapter into focused modules (`agent.ts`, `config-loader.ts`, `setup.ts`, `index.ts`).
- Standardized `OPENAI_COMPAT_*` environment variables.
- Updated default models catalog.
- Session store with filesystem backend for persistent session management.

### Fixed

- Corrected parentheses in provider resolution logic.

### Removed

- Monolithic `src/index.ts` entry point (replaced by modular architecture).

[v0.2.2]: https://github.com/hashangit/zclaw/compare/v0.2.1...v0.2.2
[v0.2.0]: https://github.com/hashangit/zclaw/compare/v0.1.0...v0.2.0
