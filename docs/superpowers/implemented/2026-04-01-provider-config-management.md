# Provider Config Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add edit and remove provider config capabilities to the `/models` command and `zclaw setup` wizard.

**Architecture:** Insert an action menu step into `handleModelsCommand` between provider selection and model selection. Extract per-provider prompt logic into a shared `editProviderConfig` helper. Add a `removeProviderConfig` helper with confirmation. Enhance `runSetup` with configured-status labels and post-configure removal of unselected providers.

**Tech Stack:** TypeScript, inquirer.js, chalk, Node.js fs/path

**Spec:** `docs/superpowers/specs/2026-04-01-provider-config-management-design.md`

---

### File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/index.ts` | Modify | All changes live here — new helpers + modifications to `handleModelsCommand` and `runSetup` |

---

### Task 1: Add `maskSecret` as a module-level function and create `editProviderConfig` helper

**Files:**
- Modify: `src/index.ts` (insert after `saveConfig` function, around line 460)

- [ ] **Step 1: Move `maskSecret` to module scope**

The `maskSecret` function is currently local to `runSetup` (around line 131). Move it to module scope (e.g., after `loadJsonConfig`) so both `runSetup` and the new `editProviderConfig` can use it. Remove it from inside `runSetup` and add it at module level:

```typescript
function maskSecret(secret?: string): string {
  if (!secret || secret.length < 8) return '******';
  return `${secret.slice(0, 3)}...${secret.slice(-4)}`;
}
```

In `runSetup`, delete the local `maskSecret` definition and its `function` keyword line.

- [ ] **Step 2: Add `editProviderConfig` function after `saveConfig`**

Insert after `saveConfig` (after line ~460):

```typescript
async function editProviderConfig(config: AppConfig, providerType: ProviderType): Promise<void> {
  const ex = config.models?.[providerType] as { apiKey?: string; baseUrl?: string; model?: string } | undefined;

  if (providerType === 'openai-compatible') {
    const answers = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: ex?.apiKey ? `API Key (Leave empty to keep ${maskSecret(ex.apiKey)}):` : 'API Key:', mask: '*', validate: (input: string) => (input || ex?.apiKey) ? true : 'API Key cannot be empty.' },
      { type: 'input', name: 'baseUrl', message: 'API Base URL:', default: ex?.baseUrl || 'https://api.openai.com/v1' },
      { type: 'input', name: 'model', message: 'Default Model:', default: ex?.model || 'gpt-4o' },
    ]);
    config.models!['openai-compatible'] = { apiKey: answers.apiKey || ex?.apiKey || '', baseUrl: answers.baseUrl, model: answers.model };
  } else if (providerType === 'openai') {
    const answers = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: ex?.apiKey ? `OpenAI API Key (Leave empty to keep ${maskSecret(ex.apiKey)}):` : 'OpenAI API Key:', mask: '*', validate: (input: string) => (input || ex?.apiKey) ? true : 'API Key cannot be empty.' },
      { type: 'input', name: 'model', message: 'Default Model:', default: ex?.model || 'gpt-5.4' },
    ]);
    config.models!.openai = { apiKey: answers.apiKey || ex?.apiKey || '', model: answers.model };
  } else if (providerType === 'anthropic') {
    const answers = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: ex?.apiKey ? `Anthropic API Key (Leave empty to keep ${maskSecret(ex.apiKey)}):` : 'Anthropic API Key:', mask: '*', validate: (input: string) => (input || ex?.apiKey) ? true : 'API Key cannot be empty.' },
      { type: 'input', name: 'model', message: 'Default Model:', default: ex?.model || 'claude-sonnet-4-5-20250929' },
    ]);
    config.models!.anthropic = { apiKey: answers.apiKey || ex?.apiKey || '', model: answers.model };
  } else if (providerType === 'glm') {
    const keyAnswer = await inquirer.prompt<{ apiKey: string }>([
      { type: 'password', name: 'apiKey', message: ex?.apiKey ? `GLM API Key (Leave empty to keep ${maskSecret(ex.apiKey)}):` : 'GLM API Key:', mask: '*', validate: (input: string) => (input || ex?.apiKey) ? true : 'API Key cannot be empty.' },
    ]);
    const modelAnswer = await inquirer.prompt<{ model: string }>([
      { type: 'list', name: 'model', message: 'Select Model:', choices: ['haiku', 'sonnet', 'opus'], default: ex?.model || 'sonnet' },
    ]);
    config.models!.glm = { apiKey: keyAnswer.apiKey || ex?.apiKey || '', model: modelAnswer.model };
  }

  saveConfig(config);
  console.log(chalk.green(`Updated ${providerType} configuration.`));
}
```

- [ ] **Step 3: Add `removeProviderConfig` function**

Insert right after `editProviderConfig`:

```typescript
async function removeProviderConfig(config: AppConfig, providerType: ProviderType): Promise<boolean> {
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Remove ${providerType} config? This cannot be undone.`,
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.dim('Removal cancelled.'));
    return false;
  }

  if (config.models) {
    delete config.models[providerType];
  }
  saveConfig(config);
  console.log(chalk.green(`Removed ${providerType} configuration.`));
  return true;
}
```

- [ ] **Step 4: Build and verify compilation**

Run: `cd /Users/hashanw/Developer/zclaw && npx tsc --noEmit`
Expected: No errors. The new functions reference existing types and imports.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: add editProviderConfig and removeProviderConfig helpers"
```

---

### Task 2: Add action menu to `handleModelsCommand`

**Files:**
- Modify: `src/index.ts:486-595` (the `handleModelsCommand` function)

- [ ] **Step 1: Add action type constants and modify `handleModelsCommand`**

Add these constants near the existing `ADD_PROVIDER_VALUE` constant (around line 414):

```typescript
type ProviderAction = 'switch' | 'edit' | 'remove' | 'back';
```

Now rewrite `handleModelsCommand` to insert an action selection step after provider selection. Replace the entire function body (lines 486-595):

```typescript
async function handleModelsCommand(agent: Agent, config: AppConfig, activeProvider: ProviderType): Promise<ProviderType> {
  if (!config.models) config.models = {};

  try {
    const configured = Object.keys(config.models).filter(
      k => (config.models as any)[k]?.apiKey
    ) as ProviderType[];

    if (configured.length === 0) {
      console.log(chalk.yellow('No providers configured. Let\'s add one.'));
      const added = await addProviderInline(config);
      if (!added) return activeProvider;
      return handleModelsCommand(agent, config, added);
    }

    // Step 1: Select provider
    const providerChoices = configured.map(p => ({
      name: `${p}${p === activeProvider ? ' (active)' : ''}`,
      value: p as ProviderType | typeof ADD_PROVIDER_VALUE,
    }));
    providerChoices.push({ name: 'Add a new provider...', value: ADD_PROVIDER_VALUE });

    const providerAnswer = await inquirer.prompt<{ selected: ProviderType | typeof ADD_PROVIDER_VALUE }>([
      {
        type: 'select',
        name: 'selected',
        message: 'Select a provider:',
        choices: providerChoices,
        default: activeProvider,
      },
    ]);

    if (providerAnswer.selected === ADD_PROVIDER_VALUE) {
      const added = await addProviderInline(config);
      if (!added) return handleModelsCommand(agent, config, activeProvider);
      return handleModelsCommand(agent, config, added);
    }

    const selected = providerAnswer.selected as ProviderType;

    // Step 2: Select action
    const actionAnswer = await inquirer.prompt<{ action: ProviderAction }>([
      {
        type: 'select',
        name: 'action',
        message: `Choose action for ${selected}:`,
        choices: [
          { name: 'Switch model', value: 'switch' as ProviderAction },
          { name: 'Edit config', value: 'edit' as ProviderAction },
          { name: 'Remove provider', value: 'remove' as ProviderAction },
          { name: '\u2190 Back', value: 'back' as ProviderAction },
        ],
      },
    ]);

    if (actionAnswer.action === 'back') {
      return handleModelsCommand(agent, config, activeProvider);
    }

    if (actionAnswer.action === 'edit') {
      await editProviderConfig(config, selected);
      // If editing the active provider, reload it
      if (selected === activeProvider) {
        const providerConfig = resolveProviderConfig(config, selected);
        if (providerConfig) {
          const newProvider = await createProvider(providerConfig);
          agent.switchProvider(newProvider, providerConfig.model);
          console.log(chalk.green(`Reloaded ${selected} with updated config.`));
        }
      }
      return activeProvider;
    }

    if (actionAnswer.action === 'remove') {
      const removed = await removeProviderConfig(config, selected);
      if (removed) {
        if (selected === activeProvider) {
          // Fall back to first remaining configured provider
          const remaining = Object.keys(config.models || {}).filter(
            k => (config.models as any)[k]?.apiKey
          ) as ProviderType[];
          if (remaining.length > 0) {
            activeProvider = remaining[0];
            const providerConfig = resolveProviderConfig(config, activeProvider);
            if (providerConfig) {
              const newProvider = await createProvider(providerConfig);
              agent.switchProvider(newProvider, providerConfig.model);
              console.log(chalk.green(`Switched active provider to ${activeProvider}.`));
            }
            // Update config.provider to reflect new active provider
            config.provider = activeProvider;
            saveConfig(config);
          } else {
            console.log(chalk.yellow('No providers remaining. Use /models to add one.'));
          }
        }
        return activeProvider;
      }
      return activeProvider;
    }

    // action === 'switch' — existing model selection flow
    const catalog = MODEL_CATALOG[selected];
    let model: string;

    if (catalog.length > 0) {
      const currentModel = config.models[selected]?.model || '';
      const modelChoices = catalog.map(m => ({
        name: m.name,
        value: m.id,
      }));
      modelChoices.push({ name: 'Type custom model...', value: CUSTOM_MODEL_VALUE });

      const modelAnswer = await inquirer.prompt<{ model: string }>([
        {
          type: 'select',
          name: 'model',
          message: `Select a model for ${selected}:`,
          choices: modelChoices,
          default: currentModel,
        },
      ]);

      if (modelAnswer.model === CUSTOM_MODEL_VALUE) {
        const customAnswer = await inquirer.prompt<{ model: string }>([
          {
            type: 'input',
            name: 'model',
            message: 'Enter model name:',
            default: currentModel,
          },
        ]);
        model = customAnswer.model;
      } else {
        model = modelAnswer.model;
      }
    } else {
      const customAnswer = await inquirer.prompt<{ model: string }>([
        {
          type: 'input',
          name: 'model',
          message: 'Enter model name:',
          default: config.models[selected]?.model || 'gpt-4o',
        },
      ]);
      model = customAnswer.model;
    }

    config.models[selected]!.model = model;
    const providerConfig = resolveProviderConfig(config, selected);
    if (providerConfig) {
      const newProvider = await createProvider(providerConfig);
      agent.switchProvider(newProvider, model);
      console.log(chalk.green(`Switched to ${selected} (${model})`));
      return selected;
    } else {
      console.log(chalk.red(`Failed to resolve provider config for ${selected}`));
      return activeProvider;
    }
  } catch (err: any) {
    if (err.message?.includes('User force closed') || err.message?.includes('Prompt was canceled')) {
      console.log(chalk.dim('\nModel selection cancelled.'));
    } else {
      console.error(chalk.red('Error in models command:'), err.message);
    }
    return activeProvider;
  }
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /Users/hashanw/Developer/zclaw && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Manual smoke test**

Run: `cd /Users/hashanw/Developer/zclaw && npx tsx src/index.ts` then type `/models` in the chat. Verify:
1. Selecting a configured provider shows the action menu (Switch model / Edit config / Remove provider / Back)
2. "Switch model" works as before
3. "Back" loops back to provider selection
4. "Edit config" prompts for fields with current defaults
5. "Remove provider" asks for confirmation

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add action menu to /models command with edit and remove provider support"
```

---

### Task 3: Enhance `runSetup` with configured labels and removal of unselected providers

**Files:**
- Modify: `src/index.ts` — the `runSetup` function (starting around line 101)

- [ ] **Step 1: Update provider checkbox to show "(configured)" labels and pre-check**

Find the inquirer checkbox prompt in `runSetup` (the one with `name: 'providers'`). The variable `anyExisting` is already defined at line 160 as `currentConfig.models as Record<string, any> | undefined`. Replace the `choices` array with dynamic choices that label and pre-check configured providers:

```typescript
    const { providers } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'providers',
        message: 'Which providers do you want to configure?',
        choices: [
          { name: `OpenAI API Compatible${anyExisting?.['openai-compatible'] ? ' (configured)' : ''}`, value: 'openai-compatible', checked: !!anyExisting?.['openai-compatible'] },
          { name: `OpenAI Official${anyExisting?.openai ? ' (configured)' : ''}`, value: 'openai', checked: !!anyExisting?.openai },
          { name: `Anthropic Official${anyExisting?.anthropic ? ' (configured)' : ''}`, value: 'anthropic', checked: !!anyExisting?.anthropic },
          { name: `GLM Code Plan${anyExisting?.glm ? ' (configured)' : ''}`, value: 'glm', checked: !!anyExisting?.glm },
        ],
        validate: (input) => input.length > 0 ? true : 'Select at least one provider.'
      }
    ]);
```

- [ ] **Step 2: Add post-configure removal step**

After the per-provider configuration loop, find the line:
```typescript
  // Step 3: Default provider
```

Insert this block BEFORE it. Note: `modelsConfig` is built fresh from only selected providers, so unselected providers' configs are lost unless explicitly carried over:

```typescript
  // Preserve or remove unselected providers
  const previouslyConfigured = anyExisting ? Object.keys(anyExisting) : [];
  const unselectedProviders = previouslyConfigured.filter((p: string) => !providers.includes(p));

  if (unselectedProviders.length > 0) {
    const { removeUnselected } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'removeUnselected',
        message: `The following providers are configured but were not selected: ${unselectedProviders.join(', ')}. Remove their configuration?`,
        default: false,
      },
    ]);
    if (!removeUnselected) {
      // Preserve existing config for unselected providers
      for (const p of unselectedProviders) {
        const existingEntry = anyExisting?.[p];
        if (existingEntry) {
          (modelsConfig as any)[p] = existingEntry;
        }
      }
    }
    // If removeUnselected is true, those providers simply aren't in modelsConfig — they're gone
  }
```

- [ ] **Step 3: Build and verify**

Run: `cd /Users/hashanw/Developer/zclaw && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Manual smoke test**

Run: `cd /Users/hashanw/Developer/zclaw && npx tsx src/index.ts setup`
Verify:
1. Already-configured providers show "(configured)" in the checkbox
2. Already-configured providers are pre-checked
3. If you uncheck a configured provider and proceed, you're asked whether to remove it
4. Answering "no" preserves the existing config

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: enhance setup wizard with configured labels and provider removal"
```

---

### Task 4: Final build and verification

- [ ] **Step 1: Full build**

Run: `cd /Users/hashanw/Developer/zclaw && npx tsc`
Expected: Clean build, no errors.

- [ ] **Step 2: End-to-end test of /models flow**

Run `npx tsx src/index.ts`, enter chat, type `/models`:
1. Select a configured provider -> action menu appears
2. "Edit config" -> prompts with current defaults, saves, reloads if active
3. "Remove provider" -> confirms, removes, falls back if active
4. "Back" -> returns to provider selection
5. "Switch model" -> works as before

- [ ] **Step 3: End-to-end test of setup flow**

Run `npx tsx src/index.ts setup`:
1. Configured providers show "(configured)" label
2. Configured providers are pre-checked
3. Unchecking a configured provider triggers removal prompt
4. Saying "no" preserves config

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address issues from final verification"
```
