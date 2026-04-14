/**
 * Slash Command Registry for ZClaw CLI.
 *
 * Provides a flat namespace of `/command` handlers with alias support.
 * Lookup order: exact match → alias match → skill invocation → unknown.
 */

import chalk from 'chalk';
import type { Interface } from 'node:readline/promises';
import type { Agent } from '../agent.js';
import type { SkillRegistry } from '../../../skills/types.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface CommandContext {
  agent: Agent;
  args: string;
  rl: Interface;
  config: any;
}

/** Return true to signal the chat loop should break (e.g., /exit). */
export type CommandResult = void | boolean;

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult>;

export interface CommandEntry {
  name: string;
  handler: CommandHandler;
  description: string;
  aliases: string[];
  hidden?: boolean; // hidden from /help unless --all
}

// ── Registry ───────────────────────────────────────────────────────────

export class CommandRegistry {
  private commands = new Map<string, CommandEntry>();
  private aliasMap = new Map<string, string>(); // alias → canonical name

  register(
    name: string,
    handler: CommandHandler,
    options: { description: string; aliases?: string[]; hidden?: boolean },
  ): void {
    const entry: CommandEntry = {
      name,
      handler,
      description: options.description,
      aliases: options.aliases ?? [],
      hidden: options.hidden,
    };
    this.commands.set(name, entry);
    for (const alias of entry.aliases) {
      this.aliasMap.set(alias, name);
    }
  }

  /**
   * Dispatch a raw user input string.
   * Returns `true` if the input was handled (including unknown-command feedback).
   * Returns `false` if input should fall through to normal chat.
   * Returns `'exit'` if the chat loop should terminate.
   */
  async dispatch(
    input: string,
    ctx: CommandContext,
    skillRegistry: SkillRegistry | null,
  ): Promise<'handled' | 'fallthrough' | 'exit'> {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return 'fallthrough';

    // Parse command and args (strip leading /)
    const withoutSlash = trimmed.slice(1);
    const spaceIdx = withoutSlash.indexOf(' ');
    const cmdName = (spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx)).toLowerCase();
    const args = spaceIdx === -1 ? '' : withoutSlash.slice(spaceIdx + 1);

    // 1. Exact match
    const entry = this.commands.get(cmdName);
    if (entry) {
      const result = await entry.handler({ ...ctx, args });
      return result === true ? 'exit' : 'handled';
    }

    // 2. Alias match
    const canonical = this.aliasMap.get(cmdName);
    if (canonical) {
      const aliasedEntry = this.commands.get(canonical);
      if (aliasedEntry) {
        const result = await aliasedEntry.handler({ ...ctx, args });
        return result === true ? 'exit' : 'handled';
      }
    }

    // 3. Skill invocation — delegate to caller
    if (skillRegistry && cmdName.length > 1) {
      return 'fallthrough'; // let index.ts handle skill invocation
    }

    // 4. Unknown command
    console.log(chalk.yellow(`Unknown command: ${cmdName}`));
    console.log(chalk.dim('Type /help for available commands.'));
    return 'handled';
  }

  /**
   * Generate help text.
   * @param showAll If true, include hidden commands and aliases.
   * @param skillRegistry If provided, list loaded skills.
   */
  help(showAll?: boolean, skillRegistry?: SkillRegistry | null): string {
    const lines: string[] = [];
    lines.push(chalk.bold.cyan('Available Commands:'));
    lines.push('');

    for (const entry of this.commands.values()) {
      if (entry.hidden && !showAll) continue;
      const aliasStr =
        entry.aliases.length > 0
          ? chalk.dim(` (${entry.aliases.join(', ')})`)
          : '';
      lines.push(`  ${chalk.green(`/${entry.name}`)}${aliasStr}  — ${entry.description}`);
    }

    if (skillRegistry && skillRegistry.getAll().length > 0) {
      lines.push('');
      lines.push(chalk.bold.cyan('Loaded Skills:'));
      lines.push(chalk.dim('  Use /<skill-name> [args] to invoke'));
      for (const s of skillRegistry.getAll()) {
        const desc = s.description.split('\n')[0];
        lines.push(`  ${chalk.green(`/${s.name}`)}  — ${desc}`);
      }
    }

    if (!showAll) {
      lines.push('');
      lines.push(chalk.dim('Use /help --all to see aliases and hidden commands.'));
    }

    lines.push('');
    lines.push(chalk.dim('Prefixes: @path (file injection)  !shell (shell passthrough)'));

    return lines.join('\n');
  }

  /** Get all registered command entries. */
  getAll(): CommandEntry[] {
    return [...this.commands.values()];
  }
}

// ── Singleton ──────────────────────────────────────────────────────────

let _registry: CommandRegistry | null = null;

export function getCommandRegistry(): CommandRegistry {
  if (!_registry) {
    _registry = new CommandRegistry();
  }
  return _registry;
}
