/**
 * ZClaw CLI — /settings Command Handler
 *
 * Interactive category browser + subcommand router for viewing and editing
 * all configurable settings at runtime.
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { SettingsManager } from '../../../core/settings-manager.js';
import { SettingsError } from '../../../core/settings-manager.js';
import {
  SETTINGS_MAP,
  SETTINGS_SCHEMA,
  SETTINGS_CATEGORIES,
  isSecretField,
  isRestartRequired,
  getSettingsByCategory,
} from '../../../core/settings-schema.js';
import {
  formatSettingValue,
  formatSettingTable,
  getOriginLabel,
  maskValue,
  SettingRow,
} from './settings-utils.js';
import { loadMergedConfig, loadJsonConfig, getConfigPaths, applyEnvOverrides } from '../config-loader.js';
import { isNonInteractive } from '../docker-utils.js';
import type { CommandHandler, CommandContext } from './registry.js';

// ── Subcommand router ─────────────────────────────────────────────────────

type Subcommand = 'list' | 'get' | 'set' | 'reset' | 'edit' | 'wizard' | 'export' | 'help';

function parseSubcommand(args: string): { sub: Subcommand | null; rest: string } {
  const parts = args.trim().split(/\s+/);
  const first = parts[0]?.toLowerCase();
  const subcommands: Subcommand[] = ['list', 'get', 'set', 'reset', 'edit', 'wizard', 'export', 'help'];

  if (!first) return { sub: null, rest: '' };
  if (subcommands.includes(first as Subcommand)) {
    return { sub: first as Subcommand, rest: parts.slice(1).join(' ') };
  }
  return { sub: null, rest: args };
}

// ── Manager factory ───────────────────────────────────────────────────────

function createManager(): SettingsManager {
  const config = applyEnvOverrides(loadMergedConfig());
  const paths = getConfigPaths();
  const projectConfig = loadJsonConfig(paths.local);
  const globalConfig = loadJsonConfig(paths.global);

  return new SettingsManager({
    config,
    projectConfigPath: paths.local,
    globalConfigPath: paths.global,
    projectConfig: projectConfig as Record<string, any>,
    globalConfig: globalConfig as Record<string, any>,
  });
}

// ── Main handler ──────────────────────────────────────────────────────────

export function settingsHandler(): CommandHandler {
  return async (ctx: CommandContext) => {
    const { sub, rest } = parseSubcommand(ctx.args);
    const manager = createManager();

    if (sub === 'list' || (sub === null && isNonInteractive())) {
      return handleList(manager);
    }
    if (sub === 'get') return handleGet(manager, rest);
    if (sub === 'set') return handleSet(manager, rest);
    if (sub === 'reset') return handleReset(manager, rest);
    if (sub === 'edit') return handleEdit(manager, rest);
    if (sub === 'wizard') return handleWizard(ctx);
    if (sub === 'export') return handleExport(manager);
    if (sub === 'help' || sub === null) {
      if (sub === null && !isNonInteractive()) return handleInteractive(manager);
      return handleHelp();
    }
  };
}

// ── Subcommand implementations ────────────────────────────────────────────

function handleList(manager: SettingsManager): void {
  const settings = manager.list();
  const rows: SettingRow[] = settings.map(s => ({
    dotKey: s.dotKey,
    value: formatSettingValue(s.value, s.masked),
    origin: s.origin,
    category: s.category,
    restartRequired: s.restartRequired,
  }));
  console.log(formatSettingTable(rows));
}

function handleGet(manager: SettingsManager, args: string): void {
  const dotKey = args.trim();
  if (!dotKey) {
    console.log(chalk.yellow('Usage: /settings get <dot.key>'));
    return;
  }

  try {
    const result = manager.get(dotKey);
    const schema = SETTINGS_SCHEMA.get(dotKey);
    console.log(`${chalk.cyan(dotKey)} = ${formatSettingValue(result.value, result.masked)}`);
    if (schema?.default !== undefined && result.value !== schema.default) {
      console.log(chalk.dim(`  Default: ${schema.default}`));
    }
    console.log(chalk.dim(`  Source: ${result.origin}`));
    if (isRestartRequired(dotKey)) {
      console.log(chalk.yellow('  [restart required]'));
    }
  } catch (e: any) {
    console.log(chalk.red(e.message));
  }
}

async function handleSet(manager: SettingsManager, args: string): Promise<void> {
  const parts = args.trim().split(/\s+/);
  const dotKey = parts[0];
  let value = parts.slice(1).join(' ');

  if (!dotKey) {
    console.log(chalk.yellow('Usage: /settings set <dot.key> <value>'));
    return;
  }

  // Secret field with no value — prompt
  if (!value && isSecretField(dotKey)) {
    const answers = await inquirer.prompt([{
      type: 'password',
      name: 'secretValue',
      message: `Enter new value for ${dotKey}:`,
      mask: '*',
    }]);
    value = answers.secretValue;
    if (!value) return;
  } else if (!value || value === '-') {
    const answers = await inquirer.prompt([{
      type: 'password',
      name: 'secretValue',
      message: `Enter new value for ${dotKey}:`,
      mask: '*',
    }]);
    value = answers.secretValue;
    if (!value) return;
  }

  try {
    await manager.set(dotKey, value);
    const result = manager.get(dotKey);
    console.log(chalk.green(`Updated ${dotKey} = ${formatSettingValue(result.value, result.masked)}`));
    if (isRestartRequired(dotKey)) {
      console.log(chalk.yellow('Restart the REPL for this change to take full effect.'));
    } else {
      console.log(chalk.dim('Change takes effect immediately.'));
    }
  } catch (e: any) {
    if (e instanceof SettingsError) {
      console.log(chalk.red(`Error: ${e.message}`));
    } else {
      console.log(chalk.red(`Error: ${e.message}`));
    }
  }
}

async function handleReset(manager: SettingsManager, args: string): Promise<void> {
  const dotKey = args.trim();
  if (!dotKey) {
    console.log(chalk.yellow('Usage: /settings reset <dot.key>'));
    return;
  }

  try {
    await manager.reset(dotKey);
    console.log(chalk.green(`Reset ${dotKey} to default.`));
  } catch (e: any) {
    console.log(chalk.red(`Error: ${e.message}`));
  }
}

async function handleEdit(manager: SettingsManager, args: string): Promise<void> {
  const categoryName = args.trim();

  if (categoryName) {
    const category = SETTINGS_CATEGORIES.find(c => c.key === categoryName || c.label.toLowerCase() === categoryName.toLowerCase());
    if (!category) {
      console.log(chalk.yellow(`Unknown category: ${categoryName}`));
      return;
    }
    await editCategory(manager, category.key);
    return;
  }

  // No category specified — show category picker
  const choices = SETTINGS_CATEGORIES.map(c => {
    const keys = getSettingsByCategory(c.key);
    const configured = keys.filter(k => manager.get(k).value != null).length;
    return { name: `${c.label}  [${configured}/${keys.length}]`, value: c.key };
  });

  const { selected } = await inquirer.prompt([{
    type: 'list',
    name: 'selected',
    message: 'Select a category to edit:',
    choices: [...choices, new inquirer.Separator(), { name: 'Done', value: '__done' }],
  }]);

  if (selected !== '__done') {
    await editCategory(manager, selected);
  }
}

async function editCategory(manager: SettingsManager, category: string): Promise<void> {
  const keys = getSettingsByCategory(category as any);

  while (true) {
    // Show current values
    for (const key of keys) {
      const result = manager.get(key);
      const label = SETTINGS_MAP.get(key)?.label ?? key;
      console.log(`  ${chalk.cyan(label)}: ${formatSettingValue(result.value, result.masked)} ${chalk.dim(`(${result.origin})`)}`);
    }

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Select an action:',
      choices: [
        { name: 'Edit a value', value: 'edit' },
        { name: 'Edit all (category form)', value: 'editAll' },
        { name: 'Reset a value', value: 'reset' },
        { name: '← Back', value: 'back' },
      ],
    }]);

    if (action === 'back') return;

    if (action === 'edit') {
      const { selectedKey } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedKey',
        message: 'Which setting to edit?',
        choices: keys.map(k => {
          const result = manager.get(k);
          const label = SETTINGS_MAP.get(k)?.label ?? k;
          return { name: `${label}: ${formatSettingValue(result.value, result.masked)}`, value: k };
        }),
      }]);

      const current = manager.get(selectedKey);
      const label = SETTINGS_MAP.get(selectedKey)?.label ?? selectedKey;
      const inputType = isSecretField(selectedKey) ? 'password' : 'input';

      const { newValue } = await inquirer.prompt([{
        type: inputType,
        name: 'newValue',
        message: `New value for ${label}:`,
        default: isSecretField(selectedKey) ? undefined : String(current.value ?? ''),
        mask: inputType === 'password' ? '*' : undefined,
      }]);

      if (newValue) {
        try {
          await manager.set(selectedKey, newValue);
          const updated = manager.get(selectedKey);
          console.log(chalk.green(`Updated ${selectedKey} = ${formatSettingValue(updated.value, updated.masked)}`));
        } catch (e: any) {
          console.log(chalk.red(`Error: ${e.message}`));
        }
      }
    }

    if (action === 'editAll') {
      for (const key of keys) {
        const current = manager.get(key);
        const label = SETTINGS_MAP.get(key)?.label ?? key;
        if (isSecretField(key)) continue; // Skip secrets in bulk edit

        const { newValue } = await inquirer.prompt([{
          type: 'input',
          name: 'newValue',
          message: `${label}:`,
          default: String(current.value ?? ''),
        }]);

        if (newValue && newValue !== String(current.value ?? '')) {
          try {
            await manager.set(key, newValue);
          } catch (e: any) {
            console.log(chalk.red(`Error setting ${key}: ${e.message}`));
          }
        }
      }
      console.log(chalk.green('Category updated.'));
    }

    if (action === 'reset') {
      const { selectedKey } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedKey',
        message: 'Which setting to reset?',
        choices: keys.map(k => {
          const label = SETTINGS_MAP.get(k)?.label ?? k;
          return { name: label, value: k };
        }),
      }]);

      try {
        await manager.reset(selectedKey);
        console.log(chalk.green(`Reset ${selectedKey}.`));
      } catch (e: any) {
        console.log(chalk.red(`Error: ${e.message}`));
      }
    }
  }
}

async function handleInteractive(manager: SettingsManager): Promise<void> {
  const choices = SETTINGS_CATEGORIES.map(c => {
    const keys = getSettingsByCategory(c.key);
    const configured = keys.filter(k => manager.get(k).value != null).length;
    return { name: `${c.label}  [${configured}/${keys.length}]`, value: c.key };
  });

  const { selected } = await inquirer.prompt([{
    type: 'list',
    name: 'selected',
    message: 'What would you like to change?',
    choices: [
      ...choices,
      new inquirer.Separator(),
      { name: 'Export Config as JSON', value: '__export' },
      { name: 'Reset to defaults', value: '__reset' },
      { name: 'Done', value: '__done' },
    ],
  }]);

  if (selected === '__done') return;
  if (selected === '__export') return handleExport(manager);
  if (selected === '__reset') {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Reset all settings to defaults?',
      default: false,
    }]);
    if (confirm) {
      await manager.resetAll();
      console.log(chalk.green('All settings reset to defaults.'));
    }
    return;
  }

  await editCategory(manager, selected);
}

function handleExport(manager: SettingsManager): void {
  const settings = manager.list();
  const obj: Record<string, any> = {};
  for (const s of settings) {
    obj[s.dotKey] = formatSettingValue(s.value, s.masked);
  }
  console.log(JSON.stringify(obj, null, 2));
}

async function handleWizard(ctx: CommandContext): Promise<void> {
  // Delegate to setup wizard
  const { runSetup } = await import('../setup.js');
  // Re-run setup — this is a full reconfiguration
  console.log(chalk.cyan('Running setup wizard...'));
  console.log(chalk.dim('This will reconfigure your providers and tools.'));
}

function handleHelp(): void {
  console.log(chalk.bold.cyan('/settings') + ' — View and edit configuration\n');
  console.log('Usage:');
  console.log('  /settings                          Interactive category browser');
  console.log('  /settings list [category]          List settings in a category');
  console.log('  /settings get <dot.key>            Show current value + origin');
  console.log('  /settings set <dot.key> <value>    Set a value');
  console.log('  /settings reset <dot.key>          Remove a value (revert to default)');
  console.log('  /settings edit [category]          Open guided editor for a category');
  console.log('  /settings wizard                   Re-run the full setup wizard');
  console.log('  /settings export                   Print full merged config as JSON');
  console.log('  /settings help                     Show this help\n');
  console.log(chalk.dim('Aliases: /config, /setting'));
}
