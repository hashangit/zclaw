# Provider Config Management

Date: 2026-04-01

## Problem

Once a provider is configured via `zclaw setup` or `/models`, there is no way to:
- Edit its config (API key, base URL, default model)
- Remove it and reconfigure from scratch

The only option is to manually edit `~/.zclaw/setting.json`.

## Solution

Add edit and remove actions to both the `/models` command and the `zclaw setup` wizard.

---

## 1. `/models` Command Changes

### New Flow

Current: Select provider -> Select model -> Switch
New: Select provider -> Select action -> Execute action

After selecting a provider, show an action menu:

```
? Select a provider: openai-compatible
? Choose action:
   Switch model
   Edit config
   Remove provider
   < Back
```

### Actions

**Switch model** - Unchanged from current behavior. Select from catalog or type custom, then switch the active provider.

**Edit config** - Re-prompt all fields for that provider with current values as defaults. For API key fields, show masked value and allow empty input to keep current. After saving, if the edited provider is the active one, reload the provider instance.

Fields per provider type:
- `openai-compatible`: apiKey, baseUrl, model
- `openai`: apiKey, model
- `anthropic`: apiKey, model
- `glm`: apiKey, model

**Remove provider** - Confirm prompt: "Remove <provider> config? This cannot be undone." On confirm, delete from `config.models` and save. If it was the active provider, fall back to the first remaining configured provider. If no providers remain, show "No providers configured."

**Back** - Loop back to the provider selection step (the first prompt in handleModelsCommand).

### Implementation

Add a new `ProviderAction` type: `'switch' | 'edit' | 'remove' | 'back'`.

After the provider selection step, insert an action selection prompt before the model selection. The action prompt is a `select` with the four choices.

New helper functions:
- `editProviderConfig(config, providerType)` - prompts for all fields, saves, returns updated config
- `removeProviderConfig(config, providerType, activeProvider)` - confirms, removes, returns new active provider

### Readline handling

Follow the same pattern as the existing `/models` command: pause readline before inquirer prompts, resume after. This is already done in the calling code (`runChat`).

---

## 2. `/setup` Wizard Changes

### Provider Checkbox Enhancement

Label configured providers in the checkbox prompt:

```
? Which providers do you want to configure?
   ◯ OpenAI API Compatible (configured)
   ◯ OpenAI Official
   ◉ Anthropic Official (configured)
   ◯ GLM Code Plan
```

Pre-check providers that are already configured.

### Remove Unselected Providers

After the per-provider configuration loop, check if any previously configured providers were NOT selected. If so, prompt:

```
The following providers are configured but were not selected for reconfiguration:
  - glm

Remove their configuration?
```

If confirmed, delete those entries from `config.models` before saving.

### No Other Setup Changes

The existing pre-fill behavior (empty input keeps current value for API keys, defaults for other fields) already handles editing. No changes needed to the per-provider prompt logic.

---

## 3. Shared Code

### `saveConfig(config)`

Already exists. Used by both flows.

### `editProviderConfig(config, providerType)`

New function. Extracts the provider-specific prompt logic from both `addProviderInline` and `runSetup` into a shared function. Accepts existing values as defaults.

For API key prompts: show masked current value in the message, allow empty to keep.
For other fields: use current value as default.

### `removeProviderConfig(config, providerType)`

New function. Confirms removal, deletes from `config.models`, calls `saveConfig`.

---

## 4. Error Handling

- Removing the last provider: warn but allow it. The next `/models` invocation will show "No providers configured. Let's add one."
- Editing the active provider: reload the provider instance after saving so changes take effect immediately.
- All prompts wrapped in existing try/catch for Ctrl+C graceful handling.
- If removal leaves `config.provider` pointing to a removed provider, update it to the first remaining configured provider.

---

## 5. Files Changed

- `src/index.ts` - Modify `handleModelsCommand`, add `editProviderConfig` and `removeProviderConfig` helpers, update `runSetup` checkbox labels and post-configure removal step.
