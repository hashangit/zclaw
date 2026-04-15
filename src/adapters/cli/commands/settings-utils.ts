/**
 * ZClaw CLI — Settings Display Utilities
 *
 * Pure formatting functions for settings display.
 * Exported for reuse by future /status command.
 */

import {
  ENV_VAR_MAP,
  SETTINGS_MAP,
  isSecretField,
  SettingsCategory,
} from '../../../core/settings-schema.js';

// ── Value formatting ──────────────────────────────────────────────────────

export function formatSettingValue(value: unknown, secret: boolean): string {
  if (value === undefined || value === null) return '(not set)';
  if (secret) return maskValue(String(value));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function maskValue(value: string): string {
  if (!value || value.length < 8) return '******';
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

// ── Origin resolution ─────────────────────────────────────────────────────

export function getOriginLabel(
  dotKey: string,
  projectConfig?: Record<string, any>,
  globalConfig?: Record<string, any>,
): string {
  const envVar = ENV_VAR_MAP.get(dotKey);
  if (envVar && process.env[envVar]) return `env: ${envVar}`;

  const entry = SETTINGS_MAP.get(dotKey);
  if (!entry) return 'default';

  if (projectConfig && hasPath(projectConfig, entry.configPath)) {
    return 'project config (.zclaw/setting.json)';
  }
  if (globalConfig && hasPath(globalConfig, entry.configPath)) {
    return 'global config (~/.zclaw/setting.json)';
  }
  return 'default';
}

// ── Table formatting ──────────────────────────────────────────────────────

export interface SettingRow {
  dotKey: string;
  value: string;
  origin: string;
  category: string;
  restartRequired: boolean;
}

export function formatSettingTable(settings: SettingRow[]): string {
  if (settings.length === 0) return '  No settings found.';

  const col1 = 24;
  const col2 = 20;
  const lines: string[] = [];

  lines.push(`  ${pad('Setting', col1)} ${pad('Value', col2)} Origin`);
  lines.push(`  ${'─'.repeat(col1)} ${'─'.repeat(col2)} ${'─'.repeat(20)}`);

  for (const s of settings) {
    const originSuffix = s.restartRequired ? '  [restart]' : '';
    lines.push(`  ${pad(s.dotKey, col1)} ${pad(s.value, col2)} ${s.origin}${originSuffix}`);
  }

  return lines.join('\n');
}

// ── Category status ───────────────────────────────────────────────────────

export function getCategoryStatus(
  _category: SettingsCategory,
  settings: Array<{ value: unknown }>,
): string {
  const total = settings.length;
  const configured = settings.filter(s => s.value !== undefined && s.value !== null && s.value !== '').length;

  if (configured === 0) return 'not configured';
  if (configured === total) return 'configured';
  return `${configured} configured / ${total} total`;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len - 1) + ' ' : str + ' '.repeat(len - str.length);
}

function hasPath(obj: Record<string, any>, pathParts: string[]): boolean {
  let current: any = obj;
  for (const part of pathParts) {
    if (current == null || typeof current !== 'object') return false;
    if (!(part in current)) return false;
    current = current[part];
  }
  return true;
}
