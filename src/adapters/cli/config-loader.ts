/**
 * ZClaw CLI — Config Loader
 *
 * Handles loading, merging, saving, and validating CLI configuration.
 * Extracted from index.ts for separation of concerns.
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProviderType } from '../../providers/types.js';

// ── Constants ──────────────────────────────────────────────────────────

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.zclaw');
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, 'setting.json');
const LOCAL_CONFIG_FILE = path.join(process.cwd(), '.zclaw', 'setting.json');

// ── Types ──────────────────────────────────────────────────────────────

export interface AppConfig {
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

// ── Config path helpers ────────────────────────────────────────────────

/**
 * Returns the config file path for the given scope.
 * @param global - If true, returns the global config path; otherwise local.
 */
export function getConfigPath(global?: boolean): string {
  return global ? GLOBAL_CONFIG_FILE : LOCAL_CONFIG_FILE;
}

/**
 * Returns the config directory path for the given scope.
 * @param global - If true, returns the global config dir; otherwise local.
 */
export function getConfigDir(global?: boolean): string {
  return global ? GLOBAL_CONFIG_DIR : path.join(process.cwd(), '.zclaw');
}

/**
 * Returns both global and local config paths.
 */
export function getConfigPaths(): { global: string; local: string; globalDir: string } {
  return {
    global: GLOBAL_CONFIG_FILE,
    local: LOCAL_CONFIG_FILE,
    globalDir: GLOBAL_CONFIG_DIR,
  };
}

// ── JSON loading ───────────────────────────────────────────────────────

/**
 * Load and parse a JSON config file, returning {} on failure.
 */
export function loadJsonConfig(filePath: string): AppConfig {
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      console.error(chalk.yellow(`Warning: Failed to parse config file at ${filePath}`));
    }
  }
  return {};
}

// ── Merge & overlay ────────────────────────────────────────────────────

/**
 * Load global and local configs and merge them.
 * Priority: local > global.
 */
export function loadMergedConfig(): AppConfig {
  const globalConfig = loadJsonConfig(GLOBAL_CONFIG_FILE);
  const localConfig = loadJsonConfig(LOCAL_CONFIG_FILE);
  return { ...globalConfig, ...localConfig };
}

/**
 * Apply environment variable overrides to the merged config.
 * Env vars take priority over JSON config for tool settings.
 */
export function applyEnvOverrides(config: AppConfig): AppConfig {
  if (process.env.SMTP_HOST) config.smtpHost = process.env.SMTP_HOST;
  if (process.env.SMTP_PORT) config.smtpPort = process.env.SMTP_PORT;
  if (process.env.SMTP_USER) config.smtpUser = process.env.SMTP_USER;
  if (process.env.SMTP_PASS) config.smtpPass = process.env.SMTP_PASS;
  if (process.env.TAVILY_API_KEY) config.tavilyApiKey = process.env.TAVILY_API_KEY;
  if (process.env.FEISHU_WEBHOOK) config.feishuWebhook = process.env.FEISHU_WEBHOOK;
  if (process.env.FEISHU_KEYWORD) config.feishuKeyword = process.env.FEISHU_KEYWORD;
  if (process.env.DINGTALK_WEBHOOK) config.dingtalkWebhook = process.env.DINGTALK_WEBHOOK;
  if (process.env.DINGTALK_KEYWORD) config.dingtalkKeyword = process.env.DINGTALK_KEYWORD;
  if (process.env.WECOM_WEBHOOK) config.wecomWebhook = process.env.WECOM_WEBHOOK;
  if (process.env.WECOM_KEYWORD) config.wecomKeyword = process.env.WECOM_KEYWORD;
  return config;
}

/**
 * Auto-migrate legacy config format (top-level apiKey/baseUrl/model) to the
 * models map format used by the current architecture.
 */
export function migrateLegacyFormat(
  config: AppConfig,
  options?: { model?: string },
): AppConfig {
  if (!config.models && (config.apiKey || process.env.OPENAI_API_KEY)) {
    config.models = {
      'openai-compatible': {
        apiKey: process.env.OPENAI_API_KEY || config.apiKey || '',
        baseUrl: process.env.OPENAI_BASE_URL || config.baseUrl || 'https://api.openai.com/v1',
        model: options?.model || process.env.OPENAI_MODEL || config.model || 'gpt-4o',
      },
    };
    if (!config.provider) config.provider = 'openai-compatible';
  }
  return config;
}

/**
 * Resolve the active provider type from CLI flags, env vars, and config.
 */
export function resolveActiveProviderType(
  config: AppConfig,
  options?: { provider?: string },
): ProviderType {
  return (
    (options?.provider as ProviderType) ||
    (process.env.ZCLAW_PROVIDER as ProviderType) ||
    config.provider ||
    'openai-compatible'
  );
}

// ── Save ───────────────────────────────────────────────────────────────

/**
 * Save config to disk. If a local config exists, saves there; otherwise global.
 */
export function saveConfig(config: AppConfig): void {
  const targetFile = fs.existsSync(path.join(process.cwd(), '.zclaw', 'setting.json'))
    ? LOCAL_CONFIG_FILE
    : GLOBAL_CONFIG_FILE;

  writeConfigToPath(config, targetFile);
}

/**
 * Save config to a specific path.
 */
export function writeConfigToPath(config: AppConfig, targetFile: string): void {
  try {
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetFile, JSON.stringify(config, null, 2), { mode: 0o600 });
  } catch (e: any) {
    console.error(chalk.red(`Failed to save config: ${e.message}`));
  }
}

// ── Utility ────────────────────────────────────────────────────────────

/**
 * Mask a secret string for display, showing only first 3 and last 4 chars.
 */
export function maskSecret(secret?: string): string {
  if (!secret || secret.length < 8) return '******';
  return `${secret.slice(0, 3)}...${secret.slice(-4)}`;
}
