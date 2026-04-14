/**
 * /exit command handler for ZClaw CLI.
 *
 * Aliases: /quit, /?
 */

import chalk from 'chalk';
import type { CommandHandler } from './registry.js';

export const exitHandler: CommandHandler = async (_ctx) => {
  console.log(chalk.cyan('Goodbye!'));
  return true;
};
