#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { isNonInteractive } from './docker-utils.js';
import { runSetup } from './setup.js';
import { runChat } from './repl.js';

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
  .option('--docker', 'Docker mode: implies --no-interactive, disables all prompts, uses env vars and config only')
  .option('-y, --yes', 'Auto-confirm all tool executions (e.g., shell commands)')
  .option('--headless', 'Bypass permission matrix: auto-approve all tools (for CI/Docker/scripts)')
  .option('--strict', 'Permission level: auto-approve safe tools only')
  .option('--moderate', 'Permission level: auto-approve safe + edit + communications (default)')
  .option('--yolo', 'Permission level: auto-approve all tools');

program
  .command('setup')
  .description('Run the interactive setup wizard to configure API keys')
  .option('-p, --project', 'Save configuration to project-level (.zclaw/setting.json)')
  .action(async (options) => {
    // Setup wizard cannot run in non-interactive mode
    if (isNonInteractive()) {
      console.log(chalk.yellow('Setup wizard requires an interactive terminal.'));
      console.log(chalk.dim('Set API keys via environment variables instead:'));
      console.log(chalk.dim('  OPENAI_API_KEY, ANTHROPIC_API_KEY, GLM_API_KEY'));
      console.log(chalk.dim('  LLM_PROVIDER (openai-compatible|openai|anthropic|glm)'));
      console.log(chalk.dim('Or mount a config file at ~/.zclaw/setting.json'));
      process.exit(1);
    }
    await runSetup(options);
  });

program
  .command('chat [query...]', { isDefault: true })
  .description('Start the AI agent (default)')
  .action(async (queryParts) => {
    const options = program.opts();
    await runChat(queryParts, options);
  });

// Apply --docker flag effects early from raw argv (before Commander parses)
// This ensures isNonInteractive() works correctly during the parse phase
if (process.argv.includes('--docker')) {
  process.env.ZCLAW_DOCKER = 'true';
  process.env.ZCLAW_NO_INTERACTIVE = 'true';
}

program.parse(process.argv);

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
