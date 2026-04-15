/**
 * ZClaw Core — Settings Schema
 *
 * Static data structures mapping all user-visible settings to their
 * AppConfig paths, validation rules, env var overrides, and metadata.
 */

// ── Types ──────────────────────────────────────────────────────────────

export type SettingsCategory =
  | 'providers'
  | 'tools'
  | 'agent'
  | 'server'
  | 'persistence'
  | 'skills';

export interface SettingsMapEntry {
  dotKey: string;
  configPath: string[];
  category: SettingsCategory;
  label: string;
}

export interface SettingsSchemaEntry {
  type: 'string' | 'number' | 'boolean' | 'enum';
  secret: boolean;
  enumValues?: string[];
  min?: number;
  max?: number;
  default?: string | number | boolean;
  restartRequired: boolean;
  envVar?: string;
}

// ── Categories ─────────────────────────────────────────────────────────

export const SETTINGS_CATEGORIES: {
  key: SettingsCategory;
  label: string;
  description: string;
}[] = [
  {
    key: 'providers',
    label: 'Providers & Models',
    description: 'LLM provider configuration (API keys, models, base URLs)',
  },
  {
    key: 'tools',
    label: 'Tools',
    description: 'Image generation, SMTP email, web search, and notification settings',
  },
  {
    key: 'agent',
    label: 'Agent Behavior',
    description: 'Permission level, auto-confirm, and agent runtime options',
  },
  {
    key: 'server',
    label: 'Server',
    description: 'HTTP/WS server configuration (reserved for future use)',
  },
  {
    key: 'persistence',
    label: 'Session & Persistence',
    description: 'Session storage backend configuration (reserved for future use)',
  },
  {
    key: 'skills',
    label: 'Skills',
    description: 'Skill system configuration (reserved for future use)',
  },
];

// ── Settings Map ───────────────────────────────────────────────────────

const entries: [string, SettingsMapEntry][] = [
  // Providers
  ['providers.openai.apiKey', { dotKey: 'providers.openai.apiKey', configPath: ['models', 'openai', 'apiKey'], category: 'providers', label: 'OpenAI API Key' }],
  ['providers.openai.model', { dotKey: 'providers.openai.model', configPath: ['models', 'openai', 'model'], category: 'providers', label: 'OpenAI Model' }],
  ['providers.anthropic.apiKey', { dotKey: 'providers.anthropic.apiKey', configPath: ['models', 'anthropic', 'apiKey'], category: 'providers', label: 'Anthropic API Key' }],
  ['providers.anthropic.model', { dotKey: 'providers.anthropic.model', configPath: ['models', 'anthropic', 'model'], category: 'providers', label: 'Anthropic Model' }],
  ['providers.glm.apiKey', { dotKey: 'providers.glm.apiKey', configPath: ['models', 'glm', 'apiKey'], category: 'providers', label: 'GLM API Key' }],
  ['providers.glm.model', { dotKey: 'providers.glm.model', configPath: ['models', 'glm', 'model'], category: 'providers', label: 'GLM Model' }],
  ['providers.openai-compat.apiKey', { dotKey: 'providers.openai-compat.apiKey', configPath: ['models', 'openai-compatible', 'apiKey'], category: 'providers', label: 'OpenAI-Compatible API Key' }],
  ['providers.openai-compat.baseUrl', { dotKey: 'providers.openai-compat.baseUrl', configPath: ['models', 'openai-compatible', 'baseUrl'], category: 'providers', label: 'OpenAI-Compatible Base URL' }],
  ['providers.openai-compat.model', { dotKey: 'providers.openai-compat.model', configPath: ['models', 'openai-compatible', 'model'], category: 'providers', label: 'OpenAI-Compatible Model' }],
  ['provider', { dotKey: 'provider', configPath: ['provider'], category: 'providers', label: 'Active Provider' }],

  // Image
  ['image.apiKey', { dotKey: 'image.apiKey', configPath: ['imageApiKey'], category: 'tools', label: 'Image Generation API Key' }],
  ['image.baseUrl', { dotKey: 'image.baseUrl', configPath: ['imageBaseUrl'], category: 'tools', label: 'Image Generation Base URL' }],
  ['image.model', { dotKey: 'image.model', configPath: ['imageModel'], category: 'tools', label: 'Image Generation Model' }],
  ['image.size', { dotKey: 'image.size', configPath: ['imageSize'], category: 'tools', label: 'Image Size' }],
  ['image.quality', { dotKey: 'image.quality', configPath: ['imageQuality'], category: 'tools', label: 'Image Quality' }],
  ['image.style', { dotKey: 'image.style', configPath: ['imageStyle'], category: 'tools', label: 'Image Style' }],
  ['image.n', { dotKey: 'image.n', configPath: ['imageN'], category: 'tools', label: 'Image Count' }],

  // SMTP
  ['smtp.host', { dotKey: 'smtp.host', configPath: ['smtpHost'], category: 'tools', label: 'SMTP Host' }],
  ['smtp.port', { dotKey: 'smtp.port', configPath: ['smtpPort'], category: 'tools', label: 'SMTP Port' }],
  ['smtp.user', { dotKey: 'smtp.user', configPath: ['smtpUser'], category: 'tools', label: 'SMTP Username' }],
  ['smtp.pass', { dotKey: 'smtp.pass', configPath: ['smtpPass'], category: 'tools', label: 'SMTP Password' }],
  ['smtp.from', { dotKey: 'smtp.from', configPath: ['smtpFrom'], category: 'tools', label: 'SMTP From Address' }],

  // Search
  ['search.tavilyApiKey', { dotKey: 'search.tavilyApiKey', configPath: ['tavilyApiKey'], category: 'tools', label: 'Tavily API Key' }],

  // Notifications
  ['notifications.feishu.webhook', { dotKey: 'notifications.feishu.webhook', configPath: ['feishuWebhook'], category: 'tools', label: 'Feishu Webhook URL' }],
  ['notifications.feishu.keyword', { dotKey: 'notifications.feishu.keyword', configPath: ['feishuKeyword'], category: 'tools', label: 'Feishu Keyword' }],
  ['notifications.dingtalk.webhook', { dotKey: 'notifications.dingtalk.webhook', configPath: ['dingtalkWebhook'], category: 'tools', label: 'DingTalk Webhook URL' }],
  ['notifications.dingtalk.keyword', { dotKey: 'notifications.dingtalk.keyword', configPath: ['dingtalkKeyword'], category: 'tools', label: 'DingTalk Keyword' }],
  ['notifications.wecom.webhook', { dotKey: 'notifications.wecom.webhook', configPath: ['wecomWebhook'], category: 'tools', label: 'WeCom Webhook URL' }],
  ['notifications.wecom.keyword', { dotKey: 'notifications.wecom.keyword', configPath: ['wecomKeyword'], category: 'tools', label: 'WeCom Keyword' }],

  // Agent
  ['agent.permissionLevel', { dotKey: 'agent.permissionLevel', configPath: ['permissionLevel'], category: 'agent', label: 'Permission Level' }],
  ['agent.autoConfirm', { dotKey: 'agent.autoConfirm', configPath: ['autoConfirm'], category: 'agent', label: 'Auto-Confirm All Tools' }],
];

export const SETTINGS_MAP: Map<string, SettingsMapEntry> = new Map(entries);

// ── Reverse lookup ─────────────────────────────────────────────────────

export const CONFIG_PATH_TO_DOTKEY: Map<string, string> = new Map(
  entries.map(([, entry]) => [entry.configPath.join('.'), entry.dotKey]),
);

// ── Settings Schema ────────────────────────────────────────────────────

const schemaEntries: [string, SettingsSchemaEntry][] = [
  // Providers
  ['providers.openai.apiKey', { type: 'string', secret: true, restartRequired: true, envVar: 'OPENAI_API_KEY' }],
  ['providers.openai.model', { type: 'string', secret: false, default: 'gpt-5.4', restartRequired: false, envVar: 'OPENAI_MODEL' }],
  ['providers.anthropic.apiKey', { type: 'string', secret: true, restartRequired: true, envVar: 'ANTHROPIC_API_KEY' }],
  ['providers.anthropic.model', { type: 'string', secret: false, default: 'claude-sonnet-4-6-20260320', restartRequired: false, envVar: 'ANTHROPIC_MODEL' }],
  ['providers.glm.apiKey', { type: 'string', secret: true, restartRequired: true, envVar: 'GLM_API_KEY' }],
  ['providers.glm.model', { type: 'string', secret: false, default: 'opus', restartRequired: false, envVar: 'GLM_MODEL' }],
  ['providers.openai-compat.apiKey', { type: 'string', secret: true, restartRequired: true, envVar: 'OPENAI_COMPAT_API_KEY' }],
  ['providers.openai-compat.baseUrl', { type: 'string', secret: false, restartRequired: true, envVar: 'OPENAI_COMPAT_BASE_URL' }],
  ['providers.openai-compat.model', { type: 'string', secret: false, default: 'gpt-5.4', restartRequired: false, envVar: 'OPENAI_MODEL' }],
  ['provider', { type: 'enum', secret: false, enumValues: ['openai', 'openai-compatible', 'anthropic', 'glm'], default: 'openai-compatible', restartRequired: true, envVar: 'LLM_PROVIDER' }],

  // Image
  ['image.apiKey', { type: 'string', secret: true, restartRequired: false }],
  ['image.baseUrl', { type: 'string', secret: false, restartRequired: false }],
  ['image.model', { type: 'string', secret: false, default: 'dall-e-3', restartRequired: false }],
  ['image.size', { type: 'string', secret: false, default: '1024x1024', restartRequired: false }],
  ['image.quality', { type: 'enum', secret: false, enumValues: ['standard', 'hd'], default: 'standard', restartRequired: false }],
  ['image.style', { type: 'enum', secret: false, enumValues: ['vivid', 'natural'], default: 'vivid', restartRequired: false }],
  ['image.n', { type: 'number', secret: false, default: 1, min: 1, max: 10, restartRequired: false }],

  // SMTP
  ['smtp.host', { type: 'string', secret: false, restartRequired: false, envVar: 'SMTP_HOST' }],
  ['smtp.port', { type: 'string', secret: false, restartRequired: false, envVar: 'SMTP_PORT' }],
  ['smtp.user', { type: 'string', secret: false, restartRequired: false, envVar: 'SMTP_USER' }],
  ['smtp.pass', { type: 'string', secret: true, restartRequired: false, envVar: 'SMTP_PASS' }],
  ['smtp.from', { type: 'string', secret: false, restartRequired: false }],

  // Search
  ['search.tavilyApiKey', { type: 'string', secret: true, restartRequired: false, envVar: 'TAVILY_API_KEY' }],

  // Notifications
  ['notifications.feishu.webhook', { type: 'string', secret: true, restartRequired: false, envVar: 'FEISHU_WEBHOOK' }],
  ['notifications.feishu.keyword', { type: 'string', secret: false, restartRequired: false, envVar: 'FEISHU_KEYWORD' }],
  ['notifications.dingtalk.webhook', { type: 'string', secret: true, restartRequired: false, envVar: 'DINGTALK_WEBHOOK' }],
  ['notifications.dingtalk.keyword', { type: 'string', secret: false, restartRequired: false, envVar: 'DINGTALK_KEYWORD' }],
  ['notifications.wecom.webhook', { type: 'string', secret: true, restartRequired: false, envVar: 'WECOM_WEBHOOK' }],
  ['notifications.wecom.keyword', { type: 'string', secret: false, restartRequired: false, envVar: 'WECOM_KEYWORD' }],

  // Agent
  ['agent.permissionLevel', { type: 'enum', secret: false, enumValues: ['strict', 'moderate', 'permissive'], default: 'moderate', restartRequired: false, envVar: 'ZCLAW_PERMISSION' }],
  ['agent.autoConfirm', { type: 'boolean', secret: false, default: false, restartRequired: false }],
];

export const SETTINGS_SCHEMA: Map<string, SettingsSchemaEntry> = new Map(schemaEntries);

// ── Env Var Map ────────────────────────────────────────────────────────

export const ENV_VAR_MAP: Map<string, string> = new Map(
  schemaEntries
    .filter(([, s]) => s.envVar !== undefined)
    .map(([dotKey, s]) => [dotKey, s.envVar!]),
);

// ── Helpers ────────────────────────────────────────────────────────────

export function getSettingEntry(dotKey: string): SettingsMapEntry | undefined {
  return SETTINGS_MAP.get(dotKey);
}

export function getSettingSchema(dotKey: string): SettingsSchemaEntry | undefined {
  return SETTINGS_SCHEMA.get(dotKey);
}

export function getDotKeyForConfigPath(path: string[]): string | undefined {
  return CONFIG_PATH_TO_DOTKEY.get(path.join('.'));
}

export function isSecretField(dotKey: string): boolean {
  return SETTINGS_SCHEMA.get(dotKey)?.secret ?? false;
}

export function isRestartRequired(dotKey: string): boolean {
  return SETTINGS_SCHEMA.get(dotKey)?.restartRequired ?? false;
}

export function getSettingsByCategory(category: SettingsCategory): string[] {
  const keys: string[] = [];
  for (const entry of SETTINGS_MAP.values()) {
    if (entry.category === category) keys.push(entry.dotKey);
  }
  return keys;
}
