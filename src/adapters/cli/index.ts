#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'node:readline/promises';
import { fileURLToPath } from 'url';

import { Agent } from './agent.js';
import { ProviderType } from '../../providers/types.js';
import { createProvider, ProviderConfig } from '../../providers/factory.js';
import { resolveProviderConfigFromApp } from '../../core/provider-resolver.js';
import {
  type AppConfig,
  loadJsonConfig,
  loadMergedConfig,
  applyEnvOverrides,
  migrateLegacyFormat,
  resolveActiveProviderType,
  getConfigPaths,
} from './config-loader.js';
import { runSetup, handleModelsCommand } from './setup.js';

// Handle Ctrl+C gracefully
function handleExit() {
  console.log(chalk.cyan("\n\nGoodbye! (Interrupted)"));
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
  process.exit(0);
}

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);

// Load local env vars (lowest priority of env vars, but env vars override JSON)
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.join(__dirname, '..', 'package.json');
let version = '1.0.2';

try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  version = pkg.version;
} catch (e) {
  // Fallback if package.json not found in expected location
}

const program = new Command();

program
  .name('zclaw')
  .description('A lightweight AI agent CLI tool')
  .version(version)
  .option('-m, --model <model>', 'Model to use')
  .option('-p, --provider <provider>', 'Provider to use (openai-compatible|openai|anthropic|glm)')
  .option('-n, --no-interactive', 'Exit after processing the initial query (Headless mode)')
  .option('-y, --yes', 'Auto-confirm all tool executions (e.g., shell commands)');

program
  .command('setup')
  .description('Run the interactive setup wizard to configure API keys')
  .option('-p, --project', 'Save configuration to project-level (.zclaw/setting.json)')
  .action(async (options) => {
    await runSetup(options);
  });

program
  .command('chat [query...]', { isDefault: true })
  .description('Start the AI agent (default)')
  .action(async (queryParts) => {
    const options = program.opts();
    await runChat(queryParts, options);
  });

program.parse(process.argv);

async function runChat(queryParts: string[], options: any) {
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
    const { doSetup } = await inquirer.prompt([
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
    console.log(chalk.gray("Type 'exit' or 'quit' to leave. Type '/models' to switch provider. Type '/skills' to list skills."));
  }

  // Handle initial query if present
  if (initialQuery) {
    if (options.interactive) {
        console.log(chalk.blue("\nProcessing initial request: ") + chalk.bold(initialQuery));
    }
    await agent.chat(initialQuery);

    // Headless mode exit
    if (!options.interactive) {
      process.exit(0);
    }
  }

  // Main chat loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  try {
    while (true) {
      const userInput = await rl.question(chalk.green('?') + ' You > ');

      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        console.log(chalk.cyan("Goodbye!"));
        break;
      }

      if (userInput.toLowerCase() === '/models') {
        rl.pause();
        try {
          activeProviderType = await handleModelsCommand(agent, fullConfig, activeProviderType);
        } finally {
          rl.resume();
        }
        continue;
      }

      // /skills — list available skills
      if (userInput.toLowerCase() === '/skills') {
        const registry = agent.getSkillRegistry();
        if (!registry || registry.getAll().length === 0) {
          console.log(chalk.yellow('No skills loaded.'));
          console.log(chalk.dim('Add skills to .zclaw/skills/ or set ZCLAW_SKILLS_PATH env var.'));
        } else {
          console.log(chalk.bold.cyan('Loaded Skills:'));
          for (const s of registry.getAll()) {
            console.log(chalk.green(`  ${s.name}`) + chalk.dim(` — ${s.description.split('\n')[0]}`));
          }
          console.log(chalk.dim(`\nUse /<skill-name> <query> to invoke a skill directly.`));
        }
        continue;
      }

      // /<skill-name> — user-invoked skill activation with dynamic arguments
      if (userInput.startsWith('/') && userInput.length > 1) {
        const { invokeSkill } = await import('../../core/skill-invoker.js');
        const result = await invokeSkill({ input: userInput, registry: agent.getSkillRegistry()! });

        if (result) {
          console.log(chalk.cyan(`Loading skill: ${result.skill.name}`));
          // Switch to skill's preferred model if needed
          const switchedModel = result.providerSwitchNeeded ? await agent.switchToSkillModel(result.skill) : false;

          rl.pause();
          try {
            await agent.chat(result.prompt);
          } finally {
            rl.resume();
            if (switchedModel) agent.restoreProvider();
          }
          continue;
        }
        // If no skill matches, fall through to treat as normal input
      }

      if (userInput.trim() === '') continue;

      // Resolve @path file references in user input
      let resolvedInput = userInput;
      if (userInput.includes('@') && !userInput.startsWith('/')) {
        try {
          const { resolveReferences } = await import('../../skills/resolver.js');
          resolvedInput = await resolveReferences(userInput);
        } catch { /* resolver not available, use raw input */ }
      }

      rl.pause();
      try {
        await agent.chat(resolvedInput);
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

// Global error handler
main().catch(err => {
  if (err.message && (err.message.includes('User force closed') || err.message.includes('Prompt was canceled'))) {
    console.log(chalk.cyan("\nGoodbye!"));
    process.exit(0);
  }
  console.error(chalk.red("Fatal Error:"), err);
  process.exit(1);
});

async function main() {
  // Just a wrapper to keep the promise chain clean if needed,
  // but currently logic is triggered by program.parse()
}
