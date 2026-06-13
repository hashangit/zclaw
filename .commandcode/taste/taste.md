# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# workflow
- After implementing significant code changes, run a formal QA/scrutinize review following the 4-step process: Intent (state goal, ask if simpler alternative exists), Trace (walk actual code paths end-to-end), Verify (confirm each claim, find edge cases), Report (findings ordered by severity: blocker → major → nit, with evidence and suggested fix, closing with one-line verdict). Confidence: 0.80
- When writing findings or content to a file that may already exist, first check if it has existing content and append/edit instead of overwriting. Confidence: 0.75
- When verifying a streaming/async path, test that it exercises the full agent loop: tool execution, skill/provider switching, permission prompts, and hooks — not just input→response flow. UI-visible metrics alone miss skipped execution paths. Confidence: 0.75
- In planning documents (PRDs, specs, roadmaps), mark each item with its real implementation status (✅ shipped / 🔲 Phase 1 / 🔲 Phase 2+) so readers can distinguish done from to-build. Don't present half-shipped work as entirely future work — it creates execution hazards. Confidence: 0.70

# technical-accuracy
- Node.js does not tree-shake. Don't claim it does. The real guarantee for keeping code out of a build is dynamic import + ensuring no static import chain reaches the module. For JSX/React, verify with "no static import from headless entry points reaches any .tsx file." Confidence: 0.80

# pnpm
- Always use pnpm, never npm. Confidence: 1

# architecture
- Before committing to complex dependency strategies (git subtree, vendoring, manual copying), explicitly evaluate the simpler package-manager alternative (e.g., pnpm add the published package) and document why it was rejected in the decision record. Confidence: 0.80
- Use Ink/React (not Pi TUI) for the terminal UI — Pi TUI's native C addon has no Linux prebuilds, conflicting with zClaw's Docker-native identity. Confidence: 0.85
- Never break the abstraction layer — the TUI must call Agent methods, not reach into Core/Provider internals directly. Confidence: 0.80
- When adding streaming to any adapter, reuse runAgentLoop + StreamManager (not a parallel engine). Pattern: run runAgentLoop in background, pipe onStep through StreamManager, expose textStream/stepsStream — same as SDK's chatStream(). Bypassing the loop silently drops tools, skills, permissions, gateway injection, and hooks. Confidence: 0.85

# dependencies
- Before adopting new packages in a PRD or implementation plan, verify peer dependency compatibility against the npm registry: check the package's declared peer range, cross-reference publish dates against framework version release dates, search open upstream issues for compatibility reports, and run `pnpm why` or `pnpm peer-check` before declaring a dep list "proven." Confidence: 0.75
- Peer-check alone is insufficient when packages predate the target framework version — peer ranges like ">=5" trivially pass against v6 even when the package was built against v5 internals. Add a runtime smoke test as the real gate (e.g., a minimal render() in CI that exercises the actual reconciliation seam). Confidence: 0.70

# architecture
- Before committing to complex dependency strategies (git subtree, vendoring, manual copying), explicitly evaluate the simpler package-manager alternative (e.g., pnpm add the published package) and document why it was rejected in the decision record. Confidence: 0.80
- Use Ink/React (not Pi TUI) for the terminal UI — Pi TUI's native C addon has no Linux prebuilds, conflicting with zClaw's Docker-native identity. Confidence: 0.85
- Never break the abstraction layer — the TUI must call Agent methods, not reach into Core/Provider internals directly. Confidence: 0.80
- When adding streaming to any adapter, reuse runAgentLoop + StreamManager (not a parallel engine). Pattern: run runAgentLoop in background, pipe onStep through StreamManager, expose textStream/stepsStream — same as SDK's chatStream(). Bypassing the loop silently drops tools, skills, permissions, gateway injection, and hooks. Confidence: 0.85
- When forking dispatch paths (e.g., TUI vs readline), extract the shared setup phase (config loading, provider resolution, skills init, gateway init, permissions) into a single bootstrap function that both paths call — don't duplicate it. Confidence: 0.70

# theme
- Use Tokyo Night Moon color scheme instead of Pi agent's default colors. Confidence: 0.75
