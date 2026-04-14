/**
 * `/help` slash command handler.
 *
 * Displays available commands and loaded skills.
 * Use `--all` to include hidden commands and aliases.
 */

import chalk from 'chalk';
import type { CommandHandler } from './registry.js';
import type { CommandRegistry } from './registry.js';
import type { SkillRegistry } from '../../../skills/types.js';

export function createHelpHandler(
  registry: CommandRegistry,
  skillRegistry?: SkillRegistry | null,
): CommandHandler {
  return async (ctx) => {
    const showAll = ctx.args.trim() === '--all';
    const text = registry.help(showAll, skillRegistry);
    console.log(text);
  };
}
