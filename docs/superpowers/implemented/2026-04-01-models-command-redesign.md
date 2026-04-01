# `/models` Command Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `/models` command with a two-step provider-then-model selection flow using a curated model catalog.

**Architecture:** New `src/models-catalog.ts` file holds the curated model list per provider. `handleModelsCommand` in `src/index.ts` is rewritten to show providers first, then models (with a custom option). No changes to the provider factory or agent.

**Tech Stack:** TypeScript, inquirer (already a dependency), existing provider/factory infrastructure.

---

### Task 1: Create the model catalog

**Files:**
- Create: `src/models-catalog.ts`

- [ ] **Step 1: Create `src/models-catalog.ts`**

```ts
import { ProviderType } from './providers/types.js';

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

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/models-catalog.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/models-catalog.ts
git commit -m "feat: add curated model catalog for providers"
```

---

### Task 2: Rewrite `handleModelsCommand`

**Files:**
- Modify: `src/index.ts` (lines 412-437, the `handleModelsCommand` function)

- [ ] **Step 1: Add the import for the catalog at the top of `src/index.ts`**

Add alongside the existing imports (after line 8):

```ts
import { MODEL_CATALOG, CUSTOM_MODEL_VALUE } from './models-catalog.js';
```

- [ ] **Step 2: Replace the `handleModelsCommand` function (lines 412-437) with the new implementation**

```ts
async function handleModelsCommand(agent: Agent, config: AppConfig, activeProvider: ProviderType): Promise<ProviderType> {
  if (!config.models || Object.keys(config.models).length === 0) {
    console.log(chalk.yellow('No providers configured. Run `zclaw setup` first.'));
    return activeProvider;
  }

  try {
    const providers = Object.keys(config.models) as ProviderType[];

    // Step 1: Select provider (skip if only one configured)
    let selected: ProviderType;
    if (providers.length === 1) {
      selected = providers[0];
    } else {
      const answer = await inquirer.prompt<{ selected: ProviderType }>([
        {
          type: 'list',
          name: 'selected',
          message: 'Select a provider:',
          choices: providers.map(p => ({
            name: `${p}${p === activeProvider ? ' (active)' : ''}`,
            value: p,
          })),
        },
      ]);
      selected = answer.selected;
    }

    // Step 2: Select model
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
          type: 'list',
          name: 'model',
          message: `Select a model for ${selected}:`,
          choices: modelChoices,
          default: catalog.findIndex(m => m.id === currentModel) >= 0
            ? catalog.findIndex(m => m.id === currentModel)
            : 0,
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
      // No curated list (e.g. openai-compatible) — go straight to text input
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

    // Step 3: Switch provider
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
    // Gracefully handle Ctrl+C or inquirer cancellation
    if (err.message?.includes('User force closed') || err.message?.includes('Prompt was canceled')) {
      console.log(chalk.dim('\nModel selection cancelled.'));
    } else {
      console.error(chalk.red('Error switching models:'), err.message);
    }
    return activeProvider;
  }
}
```

- [ ] **Step 3: Update the call site to use the return value**

In the chat loop (around line 563), change:

```ts
if (userInput.toLowerCase() === '/models') {
  await handleModelsCommand(agent, fullConfig, activeProviderType);
  continue;
}
```

to:

```ts
if (userInput.toLowerCase() === '/models') {
  activeProviderType = await handleModelsCommand(agent, fullConfig, activeProviderType);
  continue;
}
```

Note: `activeProviderType` is currently declared with `const` on line 488. Change it to `let`:

```ts
let activeProviderType: ProviderType = options.provider || process.env.ZCLAW_PROVIDER || fullConfig.provider || 'openai-compatible';
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev` then type `/models` in the chat loop. Verify:
- Provider list shows with active marker
- Selecting a provider with curated models shows the model list + custom option
- Selecting `openai-compatible` goes straight to text input
- Ctrl+C during selection returns to chat loop without crashing
- Switching shows the confirmation message

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: redesign /models command with two-step provider and model selection"
```
