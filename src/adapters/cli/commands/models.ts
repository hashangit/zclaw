/**
 * ZClaw CLI — /models Command Handler
 *
 * Interactive provider/model switching. In non-interactive mode,
 * lists configured providers.
 * Extracted from index.ts for single-responsibility.
 */

import chalk from 'chalk';
import { ProviderType } from '../../../providers/types.js';
import { handleModelsCommand } from '../setup.js';
import { isNonInteractive } from '../docker-utils.js';
import { Agent } from '../agent.js';
import type { CommandHandler } from './registry.js';

export function modelsHandler(agent: Agent, config: any, activeProviderType: string): CommandHandler {
  const handler: CommandHandler = async (ctx) => {
    if (isNonInteractive()) {
      const configured = Object.keys(config.models || {}).filter(
        (k) => (config.models as any)?.[k]?.apiKey,
      );
      if (configured.length === 0) {
        console.log(chalk.yellow('No providers configured. Set API key env vars to add providers.'));
      } else {
        console.log(chalk.bold.cyan('Configured Providers:'));
        for (const p of configured) {
          const model = (config.models as any)?.[p]?.model || 'unknown';
          const marker = p === activeProviderType ? chalk.green(' (active)') : '';
          console.log(`  ${p} (${model})${marker}`);
        }
        console.log(chalk.dim('\nUse --provider <name> flag or LLM_PROVIDER env var to switch.'));
      }
    } else {
      await handleModelsCommand(agent, config, activeProviderType as ProviderType);
    }
  };
  return handler;
}
