#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { Agent } from './agent.js';
import { ProviderType } from './providers/types.js';
import { createProvider, ProviderConfig } from './providers/factory.js';
import { MODEL_CATALOG, CUSTOM_MODEL_VALUE } from './models-catalog.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'node:readline/promises';
import { fileURLToPath } from 'url';

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

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.zclaw');
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, 'setting.json');
const LOCAL_CONFIG_FILE = path.join(process.cwd(), '.zclaw', 'setting.json');

interface AppConfig {
  provider?: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  models?: {
    'openai-compatible'?: { apiKey: string; baseUrl: string; model: string; };
    openai?: { apiKey: string; model: string; };
    anthropic?: { apiKey: string; model: string; };
    glm?: { apiKey: string; model: string; };
  };
  // Image gen (always OpenAI)
  imageApiKey?: string;
  imageBaseUrl?: string;
  imageModel?: string;
  imageSize?: string;
  imageQuality?: string;
  imageStyle?: string;
  imageN?: number;
  // Existing tools (unchanged)
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  tavilyApiKey?: string;
  autoConfirm?: boolean;
  feishuWebhook?: string;
  feishuKeyword?: string;
  dingtalkWebhook?: string;
  dingtalkKeyword?: string;
  wecomWebhook?: string;
  wecomKeyword?: string;
}

function loadJsonConfig(filePath: string): AppConfig {
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      console.error(chalk.yellow(`Warning: Failed to parse config file at ${filePath}`));
    }
  }
  return {};
}

function maskSecret(secret?: string): string {
  if (!secret || secret.length < 8) return '******';
  return `${secret.slice(0, 3)}...${secret.slice(-4)}`;
}

// Load local env vars (lowest priority of env vars, but env vars override JSON)
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In dist/index.js, package.json is usually up one level in the root
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

async function runSetup(options: any = {}) {
  const isProject = options.project;
  const targetFile = isProject ? LOCAL_CONFIG_FILE : GLOBAL_CONFIG_FILE;
  const targetDir = isProject ? path.join(process.cwd(), '.zclaw') : GLOBAL_CONFIG_DIR;

  console.log(chalk.bold.cyan("ZClaw Setup Wizard 🦞\n"));
  console.log(chalk.dim(`Config will be saved to: ${targetFile}`));

  const globalConfig = loadJsonConfig(GLOBAL_CONFIG_FILE);
  const localConfig = loadJsonConfig(LOCAL_CONFIG_FILE);
  const currentConfig = isProject
    ? { ...globalConfig, ...localConfig }
    : { ...localConfig, ...globalConfig };

  const anyExisting = currentConfig.models as Record<string, any> | undefined;

  // Step 1: Select providers to configure
  const { providers } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'providers',
      message: 'Which providers do you want to configure?',
      choices: [
        { name: `OpenAI API Compatible${anyExisting?.['openai-compatible'] ? ' (configured)' : ''}`, value: 'openai-compatible', checked: !!anyExisting?.['openai-compatible'] },
        { name: `OpenAI Official${anyExisting?.openai ? ' (configured)' : ''}`, value: 'openai', checked: !!anyExisting?.openai },
        { name: `Anthropic Official${anyExisting?.anthropic ? ' (configured)' : ''}`, value: 'anthropic', checked: !!anyExisting?.anthropic },
        { name: `GLM Code Plan${anyExisting?.glm ? ' (configured)' : ''}`, value: 'glm', checked: !!anyExisting?.glm },
      ],
      validate: (input) => input.length > 0 ? true : 'Select at least one provider.'
    }
  ]);

  // Step 2: Per-provider configuration
  const modelsConfig: NonNullable<AppConfig['models']> = {};

  for (const p of providers as string[]) {
    const ex = anyExisting?.[p] as { apiKey?: string; baseUrl?: string; model?: string } | undefined;

    if (p === 'openai-compatible') {
      const answers = await inquirer.prompt([
        { type: 'password', name: 'apiKey', message: ex?.apiKey ? `OpenAI-Compatible API Key (Leave empty to keep ${maskSecret(ex.apiKey)}):` : 'OpenAI-Compatible API Key:', mask: '*', validate: (input: string) => (input || ex?.apiKey) ? true : 'API Key cannot be empty.' },
        { type: 'input', name: 'baseUrl', message: 'API Base URL:', default: ex?.baseUrl || currentConfig.baseUrl || 'https://api.openai.com/v1' },
        { type: 'input', name: 'model', message: 'Default Model:', default: ex?.model || currentConfig.model || 'gpt-4o' }
      ]);
      modelsConfig['openai-compatible'] = { apiKey: answers.apiKey || ex?.apiKey || '', baseUrl: answers.baseUrl, model: answers.model };
    } else if (p === 'openai') {
      const answers = await inquirer.prompt([
        { type: 'password', name: 'apiKey', message: ex?.apiKey ? `OpenAI API Key (Leave empty to keep ${maskSecret(ex.apiKey)}):` : 'OpenAI API Key:', mask: '*', validate: (input: string) => (input || ex?.apiKey) ? true : 'API Key cannot be empty.' },
        { type: 'input', name: 'model', message: 'Default Model:', default: ex?.model || 'gpt-4o' }
      ]);
      modelsConfig.openai = { apiKey: answers.apiKey || ex?.apiKey || '', model: answers.model };
    } else if (p === 'anthropic') {
      const answers = await inquirer.prompt([
        { type: 'password', name: 'apiKey', message: ex?.apiKey ? `Anthropic API Key (Leave empty to keep ${maskSecret(ex.apiKey)}):` : 'Anthropic API Key:', mask: '*', validate: (input: string) => (input || ex?.apiKey) ? true : 'API Key cannot be empty.' },
        { type: 'input', name: 'model', message: 'Default Model:', default: ex?.model || 'claude-sonnet-4-5-20250929' }
      ]);
      modelsConfig.anthropic = { apiKey: answers.apiKey || ex?.apiKey || '', model: answers.model };
    } else if (p === 'glm') {
      const keyAnswer = await inquirer.prompt<{ apiKey: string }>([{ type: 'password', name: 'apiKey', message: ex?.apiKey ? `GLM API Key (Leave empty to keep ${maskSecret(ex.apiKey)}):` : 'GLM API Key:', mask: '*', validate: (input: string) => (input || ex?.apiKey) ? true : 'API Key cannot be empty.' }]);
      const modelAnswer = await inquirer.prompt<{ model: string }>([{ type: 'list', name: 'model', message: 'Select Model:', choices: ['haiku', 'sonnet', 'opus'], default: ex?.model || 'sonnet' }]);
      modelsConfig.glm = { apiKey: keyAnswer.apiKey || ex?.apiKey || '', model: modelAnswer.model };
    }
  }

  // Preserve or remove unselected providers
  const previouslyConfigured = anyExisting ? Object.keys(anyExisting) : [];
  const unselectedProviders = previouslyConfigured.filter((p: string) => !providers.includes(p));

  if (unselectedProviders.length > 0) {
    const { removeUnselected } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'removeUnselected',
        message: `The following providers are configured but were not selected: ${unselectedProviders.join(', ')}. Remove their configuration?`,
        default: false,
      },
    ]);
    if (!removeUnselected) {
      // Preserve existing config for unselected providers
      for (const p of unselectedProviders) {
        const existingEntry = anyExisting?.[p];
        if (existingEntry) {
          (modelsConfig as any)[p] = existingEntry;
        }
      }
    }
    // If removeUnselected is true, those providers simply aren't in modelsConfig — they're gone
  }

  // Step 3: Default provider
  const { defaultProvider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'defaultProvider',
      message: 'Which provider should be active by default?',
      choices: Object.keys(modelsConfig).map((p: string) => ({ name: p, value: p })),
      default: currentConfig.provider || providers[0]
    }
  ]);

  // Step 4: Optional extras
  const { configureImage } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureImage',
      message: 'Do you want to configure a separate Image Generation Service (DALL-E)?',
      default: !!currentConfig.imageApiKey
    }
  ]);
  const { configureEmail } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureEmail',
      message: 'Do you want to configure the Email Tool (SMTP)?',
      default: !!currentConfig.smtpHost
    }
  ]);
  const { configureSearch } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureSearch',
      message: 'Do you want to configure Web Search (Tavily)?',
      default: !!currentConfig.tavilyApiKey
    }
  ]);
  const { configureNotify } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureNotify',
      message: 'Do you want to configure Group Bots (Feishu/DingTalk/WeCom)?',
      default: !!(currentConfig.feishuWebhook || currentConfig.dingtalkWebhook || currentConfig.wecomWebhook)
    }
  ]);

  let imageConfig: any = {};
  if (configureImage) {
    const imageAnswers = await inquirer.prompt([
      {
        type: 'password',
        name: 'imageApiKey',
        message: currentConfig.imageApiKey
          ? `Enter Image Service API Key (Leave empty to keep ${maskSecret(currentConfig.imageApiKey)}, or leave empty to use main API key):`
          : 'Enter Image Service API Key (Leave empty to use main API key):',
        mask: '*'
      },
      {
        type: 'input',
        name: 'imageBaseUrl',
        message: 'Enter Image Service Base URL:',
        default: currentConfig.imageBaseUrl || currentConfig.baseUrl || 'https://api.openai.com/v1'
      },
      {
        type: 'input',
        name: 'imageModel',
        message: 'Default Image Model:',
        default: currentConfig.imageModel || 'dall-e-3'
      }
    ]);
    imageConfig = {
      imageApiKey: imageAnswers.imageApiKey || currentConfig.imageApiKey,
      imageBaseUrl: imageAnswers.imageBaseUrl,
      imageModel: imageAnswers.imageModel
    };
  }

  let emailConfig: any = {};
  if (configureEmail) {
     const emailAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'smtpHost',
        message: 'SMTP Host:',
        default: currentConfig.smtpHost
      },
      {
        type: 'input',
        name: 'smtpPort',
        message: 'SMTP Port:',
        default: currentConfig.smtpPort || '587'
      },
      {
        type: 'input',
        name: 'smtpUser',
        message: 'SMTP Username:',
        default: currentConfig.smtpUser
      },
      {
        type: 'password',
        name: 'smtpPass',
        message: currentConfig.smtpPass
          ? `SMTP Password (Leave empty to keep ${maskSecret(currentConfig.smtpPass)}):`
          : 'SMTP Password:',
        mask: '*',
        validate: (input) => { return true; }
      },
      {
        type: 'input',
        name: 'smtpFrom',
        message: 'Sender Email Address (From):',
        default: currentConfig.smtpFrom || currentConfig.smtpUser
      }
    ]);
    emailConfig = { ...emailAnswers, smtpPass: emailAnswers.smtpPass || currentConfig.smtpPass };
    if (!emailConfig.smtpFrom && emailConfig.smtpUser) { emailConfig.smtpFrom = emailConfig.smtpUser; }
  }

  let searchConfig: any = {};
  if (configureSearch) {
    const searchAnswers = await inquirer.prompt([
      {
        type: 'password',
        name: 'tavilyApiKey',
        message: currentConfig.tavilyApiKey
          ? `Tavily API Key (Leave empty to keep ${maskSecret(currentConfig.tavilyApiKey)}):`
          : 'Tavily API Key (Free at tavily.com):',
        mask: '*'
      }
    ]);
    searchConfig = { tavilyApiKey: searchAnswers.tavilyApiKey || currentConfig.tavilyApiKey };
  }

  let notifyConfig: any = {};
  if (configureNotify) {
    const notifyAnswers = await inquirer.prompt([
      {
        type: 'password',
        name: 'feishuWebhook',
        message: currentConfig.feishuWebhook
          ? `Feishu Webhook (Leave empty to keep ${maskSecret(currentConfig.feishuWebhook)}):`
          : 'Feishu Webhook (Optional):',
        mask: '*'
      },
      {
        type: 'input',
        name: 'feishuKeyword',
        message: 'Feishu Security Keyword (Optional):',
        default: currentConfig.feishuKeyword
      },
      {
        type: 'password',
        name: 'dingtalkWebhook',
        message: currentConfig.dingtalkWebhook
          ? `DingTalk Webhook (Leave empty to keep ${maskSecret(currentConfig.dingtalkWebhook)}):`
          : 'DingTalk Webhook (Optional):',
        mask: '*'
      },
      {
        type: 'input',
        name: 'dingtalkKeyword',
        message: 'DingTalk Security Keyword (Optional):',
        default: currentConfig.dingtalkKeyword
      },
      {
        type: 'password',
        name: 'wecomWebhook',
        message: currentConfig.wecomWebhook
          ? `WeCom Webhook (Leave empty to keep ${maskSecret(currentConfig.wecomWebhook)}):`
          : 'WeCom Webhook (Optional):',
        mask: '*'
      },
      {
        type: 'input',
        name: 'wecomKeyword',
        message: 'WeCom Security Keyword (Optional):',
        default: currentConfig.wecomKeyword
      }
    ]);
    notifyConfig = {
      feishuWebhook: notifyAnswers.feishuWebhook || currentConfig.feishuWebhook,
      feishuKeyword: notifyAnswers.feishuKeyword || currentConfig.feishuKeyword,
      dingtalkWebhook: notifyAnswers.dingtalkWebhook || currentConfig.dingtalkWebhook,
      dingtalkKeyword: notifyAnswers.dingtalkKeyword || currentConfig.dingtalkKeyword,
      wecomWebhook: notifyAnswers.wecomWebhook || currentConfig.wecomWebhook,
      wecomKeyword: notifyAnswers.wecomKeyword || currentConfig.wecomKeyword
    };
  }

  const newConfig: AppConfig = {
    provider: defaultProvider,
    models: modelsConfig,
    ...imageConfig,
    ...emailConfig,
    ...searchConfig,
    ...notifyConfig
  };

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.writeFileSync(targetFile, JSON.stringify(newConfig, null, 2), { mode: 0o600 });
    console.log(chalk.green(`\n✅ Configuration saved to ${targetFile}`));
    console.log(chalk.cyan("You can now run 'zclaw' to start using the agent."));
  } catch (error: any) {
    console.error(chalk.red(`Failed to write config: ${error.message}`));
  }
}

function resolveProviderConfig(config: AppConfig, providerType: ProviderType): ProviderConfig | null {
  const modelConfig = config.models?.[providerType];
  if (!modelConfig) return null;

  const apiKey = ('apiKey' in modelConfig) ? modelConfig.apiKey : config.apiKey;
  if (!apiKey) return null;

  const model = 'model' in modelConfig ? modelConfig.model : config.model || 'gpt-4o';
  const baseUrl = 'baseUrl' in modelConfig ? modelConfig.baseUrl : config.baseUrl;

  return { type: providerType, apiKey, model, baseUrl };
}

const ALL_PROVIDER_TYPES: ProviderType[] = ['openai-compatible', 'openai', 'anthropic', 'glm'];

const ADD_PROVIDER_VALUE = '__add_provider__';

type ProviderAction = 'switch' | 'edit' | 'remove' | 'back';

async function addProviderInline(config: AppConfig): Promise<ProviderType | null> {
  const configured = Object.keys(config.models || {}) as ProviderType[];
  const available = ALL_PROVIDER_TYPES.filter(p => !configured.includes(p));

  if (available.length === 0) {
    console.log(chalk.yellow('All available providers are already configured.'));
    return null;
  }

  const { provider } = await inquirer.prompt<{ provider: ProviderType }>([
    {
      type: 'select',
      name: 'provider',
      message: 'Which provider to add?',
      choices: available.map(p => ({ name: p, value: p })),
    },
  ]);

  if (!config.models) config.models = {};

  if (provider === 'openai-compatible') {
    const answers = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: 'API Key:', mask: '*', validate: (input: string) => input ? true : 'API Key cannot be empty.' },
      { type: 'input', name: 'baseUrl', message: 'API Base URL:', default: 'https://api.openai.com/v1' },
      { type: 'input', name: 'model', message: 'Default Model:', default: 'gpt-4o' },
    ]);
    config.models['openai-compatible'] = { apiKey: answers.apiKey, baseUrl: answers.baseUrl, model: answers.model };
  } else if (provider === 'openai') {
    const answers = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: 'OpenAI API Key:', mask: '*', validate: (input: string) => input ? true : 'API Key cannot be empty.' },
      { type: 'input', name: 'model', message: 'Default Model:', default: 'gpt-5.4' },
    ]);
    config.models.openai = { apiKey: answers.apiKey, model: answers.model };
  } else if (provider === 'anthropic') {
    const answers = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: 'Anthropic API Key:', mask: '*', validate: (input: string) => input ? true : 'API Key cannot be empty.' },
      { type: 'input', name: 'model', message: 'Default Model:', default: 'claude-sonnet-4-6-20260320' },
    ]);
    config.models.anthropic = { apiKey: answers.apiKey, model: answers.model };
  } else if (provider === 'glm') {
    const keyAnswer = await inquirer.prompt<{ apiKey: string }>([
      { type: 'password', name: 'apiKey', message: 'GLM API Key:', mask: '*', validate: (input: string) => input ? true : 'API Key cannot be empty.' },
    ]);
    const modelAnswer = await inquirer.prompt<{ model: string }>([
      { type: 'select', name: 'model', message: 'Select Model:', choices: ['haiku', 'sonnet', 'opus'], default: 'sonnet' },
    ]);
    config.models.glm = { apiKey: keyAnswer.apiKey, model: modelAnswer.model };
  }

  // Persist to disk
  saveConfig(config);
  console.log(chalk.green(`Added ${provider} to your configuration.`));
  return provider;
}

function saveConfig(config: AppConfig) {
  const targetFile = fs.existsSync(path.join(process.cwd(), '.zclaw', 'setting.json'))
    ? LOCAL_CONFIG_FILE
    : GLOBAL_CONFIG_FILE;

  try {
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetFile, JSON.stringify(config, null, 2), { mode: 0o600 });
  } catch (e: any) {
    console.error(chalk.red(`Failed to save config: ${e.message}`));
  }
}

async function editProviderConfig(config: AppConfig, providerType: ProviderType): Promise<void> {
  if (!config.models) config.models = {};
  const ex = config.models?.[providerType] as { apiKey?: string; baseUrl?: string; model?: string } | undefined;

  if (providerType === 'openai-compatible') {
    const answers = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: ex?.apiKey ? `API Key (Leave empty to keep ${maskSecret(ex.apiKey)}):` : 'API Key:', mask: '*', validate: (input: string) => (input || ex?.apiKey) ? true : 'API Key cannot be empty.' },
      { type: 'input', name: 'baseUrl', message: 'API Base URL:', default: ex?.baseUrl || 'https://api.openai.com/v1' },
      { type: 'input', name: 'model', message: 'Default Model:', default: ex?.model || 'gpt-4o' },
    ]);
    config.models!['openai-compatible'] = { apiKey: answers.apiKey || ex?.apiKey || '', baseUrl: answers.baseUrl, model: answers.model };
  } else if (providerType === 'openai') {
    const answers = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: ex?.apiKey ? `OpenAI API Key (Leave empty to keep ${maskSecret(ex.apiKey)}):` : 'OpenAI API Key:', mask: '*', validate: (input: string) => (input || ex?.apiKey) ? true : 'API Key cannot be empty.' },
      { type: 'input', name: 'model', message: 'Default Model:', default: ex?.model || 'gpt-5.4' },
    ]);
    config.models!.openai = { apiKey: answers.apiKey || ex?.apiKey || '', model: answers.model };
  } else if (providerType === 'anthropic') {
    const answers = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: ex?.apiKey ? `Anthropic API Key (Leave empty to keep ${maskSecret(ex.apiKey)}):` : 'Anthropic API Key:', mask: '*', validate: (input: string) => (input || ex?.apiKey) ? true : 'API Key cannot be empty.' },
      { type: 'input', name: 'model', message: 'Default Model:', default: ex?.model || 'claude-sonnet-4-5-20250929' },
    ]);
    config.models!.anthropic = { apiKey: answers.apiKey || ex?.apiKey || '', model: answers.model };
  } else if (providerType === 'glm') {
    const keyAnswer = await inquirer.prompt<{ apiKey: string }>([
      { type: 'password', name: 'apiKey', message: ex?.apiKey ? `GLM API Key (Leave empty to keep ${maskSecret(ex.apiKey)}):` : 'GLM API Key:', mask: '*', validate: (input: string) => (input || ex?.apiKey) ? true : 'API Key cannot be empty.' },
    ]);
    const modelAnswer = await inquirer.prompt<{ model: string }>([
      { type: 'list', name: 'model', message: 'Select Model:', choices: ['haiku', 'sonnet', 'opus'], default: ex?.model || 'sonnet' },
    ]);
    config.models!.glm = { apiKey: keyAnswer.apiKey || ex?.apiKey || '', model: modelAnswer.model };
  }

  saveConfig(config);
  console.log(chalk.green(`Updated ${providerType} configuration.`));
}

async function removeProviderConfig(config: AppConfig, providerType: ProviderType): Promise<boolean> {
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Remove ${providerType} config? This cannot be undone.`,
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.dim('Removal cancelled.'));
    return false;
  }

  if (config.models) {
    delete config.models[providerType];
  }
  console.log(chalk.green(`Removed ${providerType} configuration.`));
  return true;
}

async function handleModelsCommand(agent: Agent, config: AppConfig, activeProvider: ProviderType): Promise<ProviderType> {
  if (!config.models) config.models = {};

  try {
    const configured = Object.keys(config.models).filter(
      k => (config.models as any)[k]?.apiKey
    ) as ProviderType[];

    if (configured.length === 0) {
      console.log(chalk.yellow('No providers configured. Let\'s add one.'));
      const added = await addProviderInline(config);
      if (!added) return activeProvider;
      return handleModelsCommand(agent, config, added);
    }

    // Step 1: Select provider
    const providerChoices = configured.map(p => ({
      name: `${p}${p === activeProvider ? ' (active)' : ''}`,
      value: p as ProviderType | typeof ADD_PROVIDER_VALUE,
    }));
    providerChoices.push({ name: 'Add a new provider...', value: ADD_PROVIDER_VALUE });

    const providerAnswer = await inquirer.prompt<{ selected: ProviderType | typeof ADD_PROVIDER_VALUE }>([
      {
        type: 'select',
        name: 'selected',
        message: 'Select a provider:',
        choices: providerChoices,
        default: activeProvider,
      },
    ]);

    if (providerAnswer.selected === ADD_PROVIDER_VALUE) {
      const added = await addProviderInline(config);
      if (!added) return handleModelsCommand(agent, config, activeProvider);
      return handleModelsCommand(agent, config, added);
    }

    const selected = providerAnswer.selected as ProviderType;

    // Step 2: Select action
    const actionAnswer = await inquirer.prompt<{ action: ProviderAction }>([
      {
        type: 'select',
        name: 'action',
        message: `Choose action for ${selected}:`,
        choices: [
          { name: 'Switch model', value: 'switch' as ProviderAction },
          { name: 'Edit config', value: 'edit' as ProviderAction },
          { name: 'Remove provider', value: 'remove' as ProviderAction },
          { name: '\u2190 Back', value: 'back' as ProviderAction },
        ],
      },
    ]);

    if (actionAnswer.action === 'back') {
      return handleModelsCommand(agent, config, activeProvider);
    }

    if (actionAnswer.action === 'edit') {
      await editProviderConfig(config, selected);
      // If editing the active provider, reload it
      if (selected === activeProvider) {
        const providerConfig = resolveProviderConfig(config, selected);
        if (providerConfig) {
          const newProvider = await createProvider(providerConfig);
          agent.switchProvider(newProvider, providerConfig.model);
          console.log(chalk.green(`Reloaded ${selected} with updated config.`));
        }
      }
      return activeProvider;
    }

    if (actionAnswer.action === 'remove') {
      const removed = await removeProviderConfig(config, selected);
      if (removed) {
        if (selected === activeProvider) {
          // Fall back to first remaining configured provider
          const remaining = Object.keys(config.models || {}).filter(
            k => (config.models as any)[k]?.apiKey
          ) as ProviderType[];
          if (remaining.length > 0) {
            activeProvider = remaining[0];
            const providerConfig = resolveProviderConfig(config, activeProvider);
            if (providerConfig) {
              const newProvider = await createProvider(providerConfig);
              agent.switchProvider(newProvider, providerConfig.model);
              console.log(chalk.green(`Switched active provider to ${activeProvider}.`));
            }
            // Update config.provider to reflect new active provider
            config.provider = activeProvider;
          } else {
            console.log(chalk.yellow('No providers remaining. Use /models to add one.'));
          }
        }
        // Ensure config.provider doesn't reference a removed provider
        if (config.provider && !config.models?.[config.provider as ProviderType]?.apiKey) {
          const remaining = Object.keys(config.models || {}).filter(
            k => (config.models as any)[k]?.apiKey
          ) as ProviderType[];
          config.provider = remaining.length > 0 ? remaining[0] : undefined;
        }
        saveConfig(config);
        return activeProvider;
      }
      return activeProvider;
    }

    // action === 'switch' — existing model selection flow
    const catalog = MODEL_CATALOG[selected];
    let model: string;

    if (catalog.length > 0) {
      const currentModel = config.models[selected]?.model || '';
      const modelChoices = catalog.map(m => ({
        name: m.name,
        value: m.id,
      }));
      modelChoices.push({ name: 'Type custom model...', value: CUSTOM_MODEL_VALUE });

      const modelAnswer = await inquirer.prompt<{ model: string }>([
        {
          type: 'select',
          name: 'model',
          message: `Select a model for ${selected}:`,
          choices: modelChoices,
          default: currentModel,
        },
      ]);

      if (modelAnswer.model === CUSTOM_MODEL_VALUE) {
        const customAnswer = await inquirer.prompt<{ model: string }>([
          {
            type: 'input',
            name: 'model',
            message: 'Enter model name:',
            default: currentModel,
          },
        ]);
        model = customAnswer.model;
      } else {
        model = modelAnswer.model;
      }
    } else {
      const customAnswer = await inquirer.prompt<{ model: string }>([
        {
          type: 'input',
          name: 'model',
          message: 'Enter model name:',
          default: config.models[selected]?.model || 'gpt-4o',
        },
      ]);
      model = customAnswer.model;
    }

    config.models[selected]!.model = model;
    const providerConfig = resolveProviderConfig(config, selected);
    if (providerConfig) {
      const newProvider = await createProvider(providerConfig);
      agent.switchProvider(newProvider, model);
      console.log(chalk.green(`Switched to ${selected} (${model})`));
      return selected;
    } else {
      console.log(chalk.red(`Failed to resolve provider config for ${selected}`));
      return activeProvider;
    }
  } catch (err: any) {
    if (err.message?.includes('User force closed') || err.message?.includes('Prompt was canceled')) {
      console.log(chalk.dim('\nModel selection cancelled.'));
    } else {
      console.error(chalk.red('Error in models command:'), err.message);
    }
    return activeProvider;
  }
}

async function runChat(queryParts: string[], options: any) {
  if (options.interactive) {
    console.log(chalk.bold.cyan("Welcome to ZClaw CLI 🦞"));
  }

  const initialQuery = queryParts.join(' ');

  // 1. Load Global JSON
  const globalConfig = loadJsonConfig(GLOBAL_CONFIG_FILE);

  // 2. Load Local JSON (Project Level)
  const localConfig = loadJsonConfig(LOCAL_CONFIG_FILE);
  if (Object.keys(localConfig).length > 0 && options.interactive) {
    console.log(chalk.dim(`Loaded project config from ${LOCAL_CONFIG_FILE}`));
  }

  // 3. Merge Configs for Tool Usage
  // Priority: Local > Global
  const fullConfig = { ...globalConfig, ...localConfig };

  // 4. Inject Runtime Flags
  fullConfig.autoConfirm = options.yes;

  // Inject Env vars
  if (process.env.SMTP_HOST) fullConfig.smtpHost = process.env.SMTP_HOST;
  if (process.env.SMTP_PORT) fullConfig.smtpPort = process.env.SMTP_PORT;
  if (process.env.SMTP_USER) fullConfig.smtpUser = process.env.SMTP_USER;
  if (process.env.SMTP_PASS) fullConfig.smtpPass = process.env.SMTP_PASS;
  if (process.env.TAVILY_API_KEY) fullConfig.tavilyApiKey = process.env.TAVILY_API_KEY;
  if (process.env.FEISHU_WEBHOOK) fullConfig.feishuWebhook = process.env.FEISHU_WEBHOOK;
  if (process.env.FEISHU_KEYWORD) fullConfig.feishuKeyword = process.env.FEISHU_KEYWORD;
  if (process.env.DINGTALK_WEBHOOK) fullConfig.dingtalkWebhook = process.env.DINGTALK_WEBHOOK;
  if (process.env.DINGTALK_KEYWORD) fullConfig.dingtalkKeyword = process.env.DINGTALK_KEYWORD;
  if (process.env.WECOM_WEBHOOK) fullConfig.wecomWebhook = process.env.WECOM_WEBHOOK;
  if (process.env.WECOM_KEYWORD) fullConfig.wecomKeyword = process.env.WECOM_KEYWORD;

  // 5. Resolve active provider
  // Backward compat: if old config format (top-level apiKey/baseUrl/model) exists without models map, treat as openai-compatible
  if (!fullConfig.models && (fullConfig.apiKey || process.env.OPENAI_API_KEY)) {
    fullConfig.models = {
      'openai-compatible': {
        apiKey: process.env.OPENAI_API_KEY || fullConfig.apiKey || '',
        baseUrl: process.env.OPENAI_BASE_URL || fullConfig.baseUrl || 'https://api.openai.com/v1',
        model: options.model || process.env.OPENAI_MODEL || fullConfig.model || 'gpt-4o'
      }
    };
    if (!fullConfig.provider) fullConfig.provider = 'openai-compatible';
  }

  let activeProviderType: ProviderType = options.provider || process.env.ZCLAW_PROVIDER || fullConfig.provider || 'openai-compatible';

  let providerConfig = resolveProviderConfig(fullConfig, activeProviderType);

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
      // Re-resolve active provider after setup — user may have changed default
      const updatedProviderType: ProviderType = options.provider || process.env.ZCLAW_PROVIDER || fullConfig.provider || 'openai-compatible';
      providerConfig = resolveProviderConfig(fullConfig, updatedProviderType);
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

  if (options.interactive) {
    console.log(chalk.green(`Agent initialized with ${activeProviderType} (${providerConfig.model})`));
    console.log(chalk.gray("Type 'exit' or 'quit' to leave. Type '/models' to switch provider."));
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

      if (userInput.trim() === '') continue;

      rl.pause();
      try {
        await agent.chat(userInput);
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
