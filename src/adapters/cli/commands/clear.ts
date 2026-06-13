/**
 * /clear command handler for ZClaw CLI.
 *
 * Aliases: /reset, /new
 */

import chalk from 'chalk';
import type { CommandHandler } from './registry.js';

export const clearHandler: CommandHandler = async (ctx) => {
  ctx.agent.clearConversation();
  return { output: chalk.cyan('Conversation cleared. Starting fresh.') };
};
