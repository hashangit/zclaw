# `/models` Command Redesign

## Problem

The current `/models` command (in `handleModelsCommand`) only shows configured providers with no way to pick a specific model. Selecting a provider immediately switches to whatever model is saved in config. This is confusing and limited — users can't switch models within a provider. The GLM experience is especially poor.

## Solution

A two-step inquirer flow: pick provider, then pick model from a curated catalog (with a custom option).

## Changes

### 1. New file: `src/models-catalog.ts`

A curated model catalog grouped by provider. Each entry has an `id` (used internally) and a `name` (shown to the user).

```ts
export interface ModelEntry {
  id: string;
  name: string;
}

export const MODEL_CATALOG: Record<ProviderType, ModelEntry[]> = {
  'openai-compatible': [], // No curated list — user provides their own model name
  openai: [
    { id: 'gpt-5.4', name: 'GPT-5.4' },
    { id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro' },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
    { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano' },
    { id: 'gpt-5.3-instant', name: 'GPT-5.3 Instant' },
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
    { id: 'o3', name: 'o3' },
    { id: 'o3-mini', name: 'o3 Mini' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-6-20260320', name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6-20260320', name: 'Claude Opus 4.6' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
  ],
  glm: [
    { id: 'haiku', name: 'GLM-4.5 Air' },
    { id: 'sonnet', name: 'GLM-4.7' },
    { id: 'opus', name: 'GLM-5.1' },
  ],
};

export const CUSTOM_MODEL_VALUE = '__custom__';
```

For GLM, the `id` field uses the alias (`haiku`/`sonnet`/`opus`) so `GLM_MODEL_MAP` in `factory.ts` continues to resolve them at provider creation time. No changes to `factory.ts`.

### 2. Rewrite `handleModelsCommand` in `src/index.ts`

Two-step flow:

**Step 1 — Provider selection:**
- List all providers found in `config.models`
- Mark the currently active provider with an arrow indicator
- If only one provider is configured, skip this step and go straight to model selection

**Step 2 — Model selection:**
- If the provider has curated models in `MODEL_CATALOG`, show them as a list with a "Type custom model..." option appended at the bottom
- If the provider has no curated models (empty array, e.g. `openai-compatible`), skip the list and go straight to a free-text input prompt
- Pre-select the model currently saved in config when showing the list
- If custom is chosen, show a free-text input prompt

**After selection:**
- Update `config.models[selectedProvider].model` with the chosen model id
- Call `agent.switchProvider(newProvider, model)`
- Print confirmation: `Switched to {provider} ({model})`

**Error handling:**
- Wrap entire flow in try/catch so Ctrl+C or errors return to chat loop without crashing

### 3. No other file changes

- `factory.ts` — unchanged, `GLM_MODEL_MAP` continues to work
- `providers/types.ts` — unchanged
- `agent.ts` — unchanged, `switchProvider` already exists

## Files to create/modify

| File | Action |
|------|--------|
| `src/models-catalog.ts` | Create |
| `src/index.ts` | Rewrite `handleModelsCommand` |
