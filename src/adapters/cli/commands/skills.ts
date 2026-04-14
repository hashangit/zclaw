/**
 * ZClaw CLI — /skills Command Handler
 *
 * Lists loaded skills with descriptions.
 * Extracted from index.ts for single-responsibility.
 */

import chalk from 'chalk';
import type { CommandHandler } from './registry.js';

export const skillsHandler: CommandHandler = async (ctx) => {
  const { agent } = ctx;
  const registry = agent.getSkillRegistry();
  if (!registry || registry.getAll().length === 0) {
    console.log(chalk.yellow('No skills loaded.'));
    console.log(chalk.dim('Add skills to .zclaw/skills/ or set ZCLAW_SKILLS_PATH env var.'));
  } else {
    console.log(chalk.bold.cyan('Loaded Skills:'));
    for (const s of registry.getAll()) {
      console.log(chalk.green(`  ${s.name}`) + chalk.dim(` — ${s.description.split('\n')[0]}`));
    }
    console.log(chalk.dim('\nUse /<skill-name> <query> to invoke a skill directly.'));
  }
};
