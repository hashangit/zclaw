/**
 * ZClaw CLI — REPL Functions
 *
 * Interrupt handling, chat-with-interrupt, and the main runChat loop.
 * Extracted from index.ts for single-responsibility.
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'node:readline/promises';

import { Agent } from './agent.js';
import { ProviderType } from '../../providers/types.js';
import { createProvider } from '../../providers/factory.js';
import { resolveProviderConfigFromApp } from '../../core/provider-resolver.js';
import {
  type AppConfig,
  loadJsonConfig,
  applyEnvOverrides,
  migrateLegacyFormat,
  resolveActiveProviderType,
  getConfigPaths,
} from './config-loader.js';
import { runSetup } from './setup.js';
import { isNonInteractive, hasRequiredProviderEnv } from './docker-utils.js';
import { CommandRegistry } from './commands/registry.js';
import { createHelpHandler } from './commands/help.js';
import { clearHandler } from './commands/clear.js';
import { exitHandler } from './commands/exit.js';
import { compactHandler } from './commands/compact.js';
import { skillsHandler } from './commands/skills.js';
import { modelsHandler } from './commands/models.js';

// ── Interrupt handling ───────────────────────────────────────────────

export function setupInterrupt(agent: Agent): { signal: AbortSignal; teardown: () => void } {
  const signal = agent.createAbortSignal();
  const stdin = process.stdin;

  if (!stdin.isTTY) {
    return { signal, teardown: () => agent.clearAbortController() };
  }

  const ESC = '\x1b';
  let wasRaw = false;

  const onData = (data: Buffer) => {
    if (data[0] === ESC.charCodeAt(0)) {
      agent.abort();
    }
  };

  wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', onData);

  const teardown = () => {
    stdin.removeListener('data', onData);
    if (!wasRaw) {
      stdin.setRawMode(false);
    }
    agent.clearAbortController();
  };

  return { signal, teardown };
}

export async function chatWithInterrupt(agent: Agent, input: string): Promise<void> {
  const { signal, teardown } = setupInterrupt(agent);
  try {
    await agent.chat(input, signal);
  } finally {
    teardown();
  }
}

// ── Command registry builder ─────────────────────────────────────────

function buildCommandRegistry(agent: Agent, config: any, activeProviderType: string): CommandRegistry {
  const registry = new CommandRegistry();
  const skillRegistry = agent.getSkillRegistry();

  // Tier 1 — Session Control
  registry.register('help', createHelpHandler(registry, skillRegistry), {
    description: 'Show available commands',
    aliases: ['?'],
  });
  registry.register('clear', clearHandler, {
    description: 'Clear conversation history',
    aliases: ['reset', 'new'],
  });
  registry.register('exit', exitHandler, {
    description: 'End the session',
    aliases: ['quit'],
  });
  registry.register('compact', compactHandler, {
    description: 'Compress conversation to a summary',
    aliases: ['compress'],
  });

  // Tier 2 — Configuration & Discovery
  registry.register('skills', skillsHandler, {
    description: 'List loaded skills',
  });
  registry.register('models', modelsHandler(agent, config, activeProviderType), {
    description: 'Switch providers and models',
    aliases: ['model'],
  });

  return registry;
}

// ── Main chat runner ─────────────────────────────────────────────────

export async function runChat(queryParts: string[], options: any) {
  if (options.interactive) {
    console.log(chalk.bold.cyan("Welcome to ZClaw CLI"));
  }

  const initialQuery = queryParts.join(' ');
  const { global: GLOBAL_CONFIG_FILE, local: LOCAL_CONFIG_FILE } = getConfigPaths();

  // 1. Load and merge configs (local > global)
  const globalConfig = loadJsonConfig(GLOBAL_CONFIG_FILE);
  const localConfig = loadJsonConfig(LOCAL_CONFIG_FILE);
  if (Object.keys(localConfig).length > 0 && options.interactive) {
    console.log(chalk.dim(`Loaded project config from ${LOCAL_CONFIG_FILE}`));
  }

  let fullConfig = { ...globalConfig, ...localConfig };

  // 2. Inject runtime flags
  fullConfig.autoConfirm = options.yes;

  // 3. Apply env var overrides for tool settings
  fullConfig = applyEnvOverrides(fullConfig);

  // 4. Auto-migrate legacy config format (top-level apiKey/baseUrl/model)
  fullConfig = migrateLegacyFormat(fullConfig, { model: options.model });

  // 5. Resolve active provider
  let activeProviderType = resolveActiveProviderType(fullConfig, { provider: options.provider });
  let providerConfig = resolveProviderConfigFromApp(fullConfig, activeProviderType);

  if (!providerConfig) {
    console.log(chalk.yellow("No provider configuration found."));

    if (isNonInteractive()) {
      // Non-interactive: cannot run setup wizard, rely on env vars only
      if (hasRequiredProviderEnv(fullConfig)) {
        // Re-resolve after env var check
        fullConfig = migrateLegacyFormat(fullConfig, { model: options.model });
        activeProviderType = resolveActiveProviderType(fullConfig, { provider: options.provider });
        providerConfig = resolveProviderConfigFromApp(fullConfig, activeProviderType);
      }
      if (!providerConfig) {
        console.error(chalk.red("No provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GLM_API_KEY env vars, or provide a config file."));
        process.exit(1);
      }
    } else {
      // Interactive: ask user
      const inquirer = await import('inquirer');
      const { doSetup } = await inquirer.default.prompt([
        {
          type: 'confirm',
          name: 'doSetup',
          message: 'Would you like to run the setup wizard now?',
          default: true
        }
      ]);

      if (doSetup) {
        await runSetup();
        const newConfig = loadJsonConfig(GLOBAL_CONFIG_FILE);
        Object.assign(fullConfig, newConfig);
        const updatedProviderType = resolveActiveProviderType(fullConfig, { provider: options.provider });
        providerConfig = resolveProviderConfigFromApp(fullConfig, updatedProviderType);
      } else {
        console.error(chalk.red("Provider configuration is required to proceed."));
        process.exit(1);
      }
    }
  }

  if (!providerConfig) {
    console.error(chalk.red("Provider configuration is still missing. Exiting."));
    process.exit(1);
  }

  // CLI --model override
  if (options.model) {
    providerConfig.model = options.model;
  }

  const provider = await createProvider(providerConfig);
  const agent = new Agent(provider, providerConfig.model, fullConfig);

  // Initialize skills system
  await agent.initializeSkills();

  // Ensure ~/zclaw_documents exists
  const docsDir = path.join(os.homedir(), 'zclaw_documents');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
    for (const sub of ['notes', 'templates', 'output', 'knowledge']) {
      fs.mkdirSync(path.join(docsDir, sub), { recursive: true });
    }
  }

  if (options.interactive) {
    console.log(chalk.green(`Agent initialized with ${activeProviderType} (${providerConfig.model})`));
    console.log(chalk.gray("Type /help for commands, /exit to leave."));
  }

  // Handle initial query if present
  if (initialQuery) {
    if (options.interactive) {
        console.log(chalk.blue("\nProcessing initial request: ") + chalk.bold(initialQuery));
    }
    await chatWithInterrupt(agent, initialQuery);

    // Headless mode exit
    if (!options.interactive) {
      process.exit(0);
    }
  }

  // Main chat loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true
  });

  // Build command registry
  const cmdRegistry = buildCommandRegistry(agent, fullConfig, activeProviderType);

  // Lazy-loaded modules (hoisted outside the loop to avoid repeated import overhead)
  const { invokeSkill, createSkillProviderSwitcher } = await import('../../core/skill-invoker.js');
  const { resolveReferences } = await import('../../skills/resolver.js');

  try {
    while (true) {
      const userInput = await rl.question(chalk.green('?') + ' You > ');

      // Bare exit/quit (without /)
      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        console.log(chalk.cyan('Goodbye!'));
        break;
      }

      if (userInput.trim() === '') continue;

      // Slash commands — dispatch through registry
      if (userInput.startsWith('/')) {
        rl.pause();
        try {
          const result = await cmdRegistry.dispatch(
            userInput,
            { agent, args: '', rl, config: fullConfig },
            agent.getSkillRegistry(),
          );

          if (result === 'exit') break;
          if (result === 'handled') continue;

          // 'fallthrough' — try skill invocation
          const skillResult = await invokeSkill({ input: userInput, registry: agent.getSkillRegistry()! });

          if (skillResult) {
            console.log(chalk.cyan(`Loading skill: ${skillResult.skill.name}`));
            const switcher = createSkillProviderSwitcher({
              provider: agent.getProvider(),
              model: agent.getModel(),
              models: fullConfig.models ?? {},
            });
            const switched = await switcher.switchIfNeeded(skillResult);

            if (switched) {
              agent.switchProvider(switcher.activeProvider, switcher.activeModel);
            }

            try {
              await chatWithInterrupt(agent, skillResult.prompt);
            } finally {
              if (switched) {
                switcher.restore();
                agent.switchProvider(switcher.activeProvider, switcher.activeModel);
              }
            }
            continue;
          }

          // No matching command or skill
          console.log(chalk.yellow(`Unknown command: ${userInput.split(' ')[0]}`));
          console.log(chalk.dim('Type /help for available commands.'));
        } finally {
          rl.resume();
        }
        continue;
      }

      // Resolve @path file references in user input
      let resolvedInput = userInput;
      if (userInput.includes('@')) {
        try {
          resolvedInput = await resolveReferences(userInput);
        } catch { /* resolver not available, use raw input */ }
      }

      rl.pause();
      try {
        await chatWithInterrupt(agent, resolvedInput);
      } finally {
        rl.resume();
      }
    }
  } catch (err: any) {
    if (err.message && (err.message.includes('User force closed') || err.message.includes('Prompt was canceled'))) {
       console.log(chalk.cyan("\nGoodbye!"));
    } else {
       console.error(chalk.red("Error in chat loop:"), err);
    }
  } finally {
    rl.close();
  }
}
