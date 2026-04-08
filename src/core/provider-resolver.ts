/**
 * ZClaw Core — Unified Provider Resolver
 *
 * This is the SINGLE source of truth for all provider configuration and resolution.
 * It consolidates logic that was previously duplicated across:
 * - src/sdk/providers.ts (SDK provider resolution)
 * - src/index.ts (CLI resolveProviderConfig)
 * - src/server/index.ts (server initializeProvidersFromEnv)
 *
 * Phase 1: Create this file with all existing functionality
 * Phase 2: Rewire existing modules to import from here
 */

import { createProvider, GLM_MODEL_MAP, type ProviderConfig } from "../providers/factory.js";
import type { LLMProvider, ProviderType as InternalProviderType } from "../providers/types.js";
import type { MultiProviderConfig, ProviderType } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Resolved provider configuration with all required fields.
 * This is what consumers receive after resolution.
 */
export interface ResolvedProviderConfig {
  type: ProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeout?: number;
}

/**
 * Legacy AppConfig format from CLI (src/index.ts).
 * This supports the old-style config with top-level apiKey/baseUrl/model
 * plus the newer models map format.
 */
export interface AppConfig {
  provider?: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  models?: {
    "openai-compatible"?: { apiKey: string; baseUrl: string; model: string };
    openai?: { apiKey: string; model: string };
    anthropic?: { apiKey: string; model: string };
    glm?: { apiKey: string; model: string };
  };
}

// ── Module-level singleton ────────────────────────────────────────────────

let providerConfig: MultiProviderConfig | null = null;

// ── Default models per provider ───────────────────────────────────────────

const DEFAULT_MODELS: Record<ProviderType, string> = {
  openai: "gpt-5.4",
  anthropic: "claude-sonnet-4-6-20260320",
  glm: "opus",
  "openai-compatible": "gpt-5.4",
};

// ── Env var keys per provider ────────────────────────────────────────────

const PROVIDER_ENV_KEYS: Record<
  ProviderType,
  { apiKey: string; baseUrl?: string }
> = {
  openai: { apiKey: "OPENAI_API_KEY" },
  anthropic: { apiKey: "ANTHROPIC_API_KEY" },
  glm: { apiKey: "GLM_API_KEY" },
  "openai-compatible": {
    apiKey: "OPENAI_COMPAT_API_KEY",
    baseUrl: "OPENAI_COMPAT_BASE_URL",
  },
};

// ── Internal helpers ──────────────────────────────────────────────────────

function env(name: string): string | undefined {
  return process.env[name];
}

function resolveApiKey(type: ProviderType): string | undefined {
  // Per-provider env var takes priority
  const envKeys = PROVIDER_ENV_KEYS[type];
  if (envKeys.apiKey) {
    const key = env(envKeys.apiKey);
    if (key) return key;
  }
  // Backward compat: check deprecated env vars
  if (type === "openai-compatible") {
    const legacy = env("ZCLAW_API_KEY");
    if (legacy) {
      console.warn("[zclaw] ZCLAW_API_KEY is deprecated. Use OPENAI_COMPAT_API_KEY instead.");
      return legacy;
    }
  }
  return undefined;
}

function resolveBaseUrl(type: ProviderType): string | undefined {
  const envKeys = PROVIDER_ENV_KEYS[type];
  if (envKeys.baseUrl) {
    const url = env(envKeys.baseUrl);
    if (url) return url;
  }
  // Backward compat: check deprecated env var for openai-compatible
  if (type === "openai-compatible") {
    const legacy = env("OPENAI_BASE_URL");
    if (legacy) {
      console.warn("[zclaw] OPENAI_BASE_URL is deprecated. Use OPENAI_COMPAT_BASE_URL instead.");
      return legacy;
    }
  }
  return undefined;
}

function resolveDefaultType(): ProviderType {
  const fromEnv = env("LLM_PROVIDER") ?? env("ZCLAW_PROVIDER");
  if (
    fromEnv &&
    (fromEnv === "openai" ||
      fromEnv === "anthropic" ||
      fromEnv === "glm" ||
      fromEnv === "openai-compatible")
  ) {
    return fromEnv;
  }
  return "openai";
}

function resolveDefaultModel(type: ProviderType): string {
  return env("LLM_MODEL") ?? env("ZCLAW_MODEL") ?? DEFAULT_MODELS[type];
}

function toInternalType(type: ProviderType): InternalProviderType {
  return type as InternalProviderType;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Creates a single provider configuration object.
 * Useful for building `MultiProviderConfig` declaratively.
 *
 * @example
 * ```ts
 * import { provider, configureProviders } from '@zclaw/core';
 *
 * configureProviders({
 *   openai: provider('openai', 'sk-...', { model: 'gpt-4o' }),
 *   anthropic: provider('anthropic', 'sk-ant-...'),
 *   default: 'openai',
 * });
 * ```
 */
export function provider(
  type: ProviderType,
  apiKey: string,
  options?: { model?: string; baseUrl?: string; timeout?: number },
): {
  type: ProviderType;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeout?: number;
} {
  return {
    type,
    apiKey,
    ...options,
  };
}

/**
 * Stores multi-provider configuration globally.
 * Can be called once at application startup.
 *
 * @example
 * ```ts
 * import { configureProviders } from '@zclaw/core';
 *
 * configureProviders({
 *   openai: { apiKey: 'sk-...', model: 'gpt-4o' },
 *   anthropic: { apiKey: 'sk-ant-...' },
 *   default: 'openai',
 * });
 * ```
 */
export function configureProviders(config: MultiProviderConfig): void {
  providerConfig = config;
}

/**
 * Returns the raw configuration for a given provider type.
 * Falls back to environment variables when no explicit config is set.
 *
 * @param type - Provider type. If omitted, uses the default provider.
 * @returns Resolved provider configuration with apiKey, model, and optional baseUrl.
 * @throws Error if the provider is not configured and no env var is available.
 */
export function getProviderConfig(
  type?: ProviderType,
): { apiKey: string; model: string; baseUrl?: string; type: ProviderType } {
  const resolvedType = type ?? getDefaultProviderType();

  // 1. Check explicit config first
  if (providerConfig) {
    const entry = providerConfig[resolvedType];
    if (entry && "apiKey" in entry) {
      const cfg = entry as { apiKey: string; model?: string; baseUrl?: string };
      return {
        type: resolvedType,
        apiKey: cfg.apiKey,
        model: cfg.model ?? resolveDefaultModel(resolvedType),
        baseUrl: cfg.baseUrl,
      };
    }
  }

  // 2. Fall back to environment variables
  const apiKey = resolveApiKey(resolvedType);
  if (!apiKey) {
    const envHint = PROVIDER_ENV_KEYS[resolvedType].apiKey;
    throw new Error(
      `Provider "${resolvedType}" is not configured. ` +
        `Set ${envHint} or call configureProviders() with an apiKey for "${resolvedType}".`,
    );
  }

  return {
    type: resolvedType,
    apiKey,
    model: resolveDefaultModel(resolvedType),
    baseUrl: resolveBaseUrl(resolvedType),
  };
}

/**
 * Resolves which provider type is the default.
 * Checks explicit config, then LLM_PROVIDER env var, then falls back to "openai".
 *
 * @returns The default provider type.
 */
export function getDefaultProviderType(): ProviderType {
  if (providerConfig?.default) {
    return providerConfig.default;
  }
  return resolveDefaultType();
}

/**
 * Returns the default configured provider type (alias for getDefaultProviderType).
 *
 * @returns The default provider type.
 */
export function getDefaultProvider(): ProviderType {
  return getDefaultProviderType();
}

/**
 * Creates and returns an LLMProvider instance using the existing factory.
 * If type is omitted, uses the default provider.
 *
 * @param type - Provider type. If omitted, uses the default provider.
 * @returns The initialized LLMProvider and the resolved model name.
 *
 * @example
 * ```ts
 * import { getProvider } from '@zclaw/core';
 *
 * const { provider, model } = await getProvider('anthropic');
 * const response = await provider.chat(messages, []);
 * ```
 */
export async function getProvider(
  type?: ProviderType,
): Promise<{ provider: LLMProvider; model: string }> {
  const config = getProviderConfig(type);

  const factoryConfig: ProviderConfig = {
    type: toInternalType(config.type),
    apiKey: config.apiKey,
    model: config.model,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  };

  const llmProvider = await createProvider(factoryConfig);

  return {
    provider: llmProvider,
    model: config.model,
  };
}

/**
 * Resolve a GLM model alias or model name to the actual model identifier.
 *
 * Looks up the model in the GLM_MODEL_MAP (e.g. "haiku" -> "glm-4.5-air",
 * "sonnet" -> "glm-4.7", "opus" -> "glm-5.1"). If the model is not found in
 * the map, it is returned unchanged.
 *
 * @param model - Model name or alias to resolve.
 * @returns The resolved model identifier.
 *
 * @example
 * ```ts
 * import { resolveGLMModel } from '@zclaw/core';
 *
 * resolveGLMModel('sonnet'); // "glm-4.7"
 * resolveGLMModel('glm-5.1'); // "glm-5.1" (passthrough)
 * ```
 */
export function resolveGLMModel(model: string): string {
  return GLM_MODEL_MAP[model] ?? model;
}

// ── CLI-specific functions (from src/index.ts) ─────────────────────────────

/**
 * Resolves provider configuration from legacy AppConfig (CLI format).
 * This handles both old-style top-level config and new models map format.
 *
 * @param config - The AppConfig object from CLI config file.
 * @param providerType - The provider type to resolve.
 * @returns ProviderConfig if found, null otherwise.
 *
 * @example
 * ```ts
 * import { resolveProviderConfigFromApp } from '@zclaw/core';
 *
 * const config = loadConfigFile('~/.zclawrc.json');
 * const providerCfg = resolveProviderConfigFromApp(config, 'openai');
 * if (providerCfg) {
 *   const provider = await createProvider(providerCfg);
 * }
 * ```
 */
export function resolveProviderConfigFromApp(
  config: AppConfig,
  providerType: ProviderType,
): ProviderConfig | null {
  const modelConfig = config.models?.[providerType];
  if (!modelConfig) return null;

  const apiKey = ("apiKey" in modelConfig) ? modelConfig.apiKey : config.apiKey;
  if (!apiKey) return null;

  const model = "model" in modelConfig ? modelConfig.model : config.model || "gpt-4o";
  const baseUrl = "baseUrl" in modelConfig ? modelConfig.baseUrl : config.baseUrl;

  return { type: providerType, apiKey, model, baseUrl };
}

// ── Server-specific functions (from src/server/index.ts) ───────────────────

/**
 * Scans environment variables and builds a MultiProviderConfig from them.
 * This replaces the server's `initializeProvidersFromEnv()` function.
 *
 * Note: This function only RETURNS the config. To actually configure providers,
 * call `configureProviders(resolveFromEnv())`.
 *
 * @returns MultiProviderConfig if any env vars are set, null otherwise.
 *
 * @example
 * ```ts
 * import { configureProviders, resolveFromEnv } from '@zclaw/core';
 *
 * const envConfig = resolveFromEnv();
 * if (envConfig) {
 *   configureProviders(envConfig);
 * }
 * ```
 */
export function resolveFromEnv(): MultiProviderConfig | null {
  const config: Record<string, { apiKey: string; model?: string; baseUrl?: string }> = {};

  if (process.env.OPENAI_API_KEY) {
    config.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-5.4",
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    config.anthropic = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6-20260320",
    };
  }
  if (process.env.GLM_API_KEY) {
    config.glm = {
      apiKey: process.env.GLM_API_KEY,
      model: process.env.GLM_MODEL ?? "opus",
    };
  }
  const compatApiKey = process.env.OPENAI_COMPAT_API_KEY || process.env.ZCLAW_API_KEY;
  const compatBaseUrl = process.env.OPENAI_COMPAT_BASE_URL || process.env.OPENAI_BASE_URL;
  if (compatApiKey && compatBaseUrl) {
    if (process.env.ZCLAW_API_KEY && !process.env.OPENAI_COMPAT_API_KEY) {
      console.warn("[zclaw] ZCLAW_API_KEY is deprecated. Use OPENAI_COMPAT_API_KEY instead.");
    }
    if (process.env.OPENAI_BASE_URL && !process.env.OPENAI_COMPAT_BASE_URL) {
      console.warn("[zclaw] OPENAI_BASE_URL is deprecated. Use OPENAI_COMPAT_BASE_URL instead.");
    }
    config["openai-compatible"] = {
      apiKey: compatApiKey,
      baseUrl: compatBaseUrl,
      model: process.env.OPENAI_COMPAT_MODEL ?? process.env.LLM_MODEL ?? process.env.ZCLAW_MODEL ?? "gpt-5.4",
    };
  }

  if (Object.keys(config).length > 0) {
    const defaultProvider = ((process.env.LLM_PROVIDER ?? process.env.ZCLAW_PROVIDER) as ProviderType) ??
      ((config.openai ? "openai" : Object.keys(config)[0]) as ProviderType);

    return {
      ...config,
      default: defaultProvider,
    } as MultiProviderConfig;
  }

  return null;
}

// ── New functions for future migration ────────────────────────────────────

/**
 * Resolves provider configuration from a config file object.
 * Supports both legacy AppConfig format and new MultiProviderConfig format.
 *
 * @param config - The parsed config file object (JSON/YAML).
 * @param type - Optional provider type to resolve. If omitted, uses the default.
 * @returns Resolved provider config or null if not found.
 */
export function resolveFromConfigFile(
  config: any,
  type?: ProviderType,
): ResolvedProviderConfig | null {
  // First, try to treat it as MultiProviderConfig (new format)
  if (config.models || config.default) {
    const multiConfig = config as MultiProviderConfig;
    const resolvedType = type ?? multiConfig.default ?? "openai";
    const entry = multiConfig[resolvedType];

    if (entry && "apiKey" in entry) {
      return {
        type: resolvedType,
        apiKey: entry.apiKey,
        model: entry.model ?? DEFAULT_MODELS[resolvedType],
        baseUrl: "baseUrl" in entry ? entry.baseUrl : undefined,
      };
    }
  }

  // Fall back to legacy AppConfig format
  if (config.apiKey || config.models) {
    const appConfig = migrateLegacyConfig(config);
    return resolveFromConfigFile(appConfig, type);
  }

  return null;
}

/**
 * Migrates legacy top-level config to the new models map format.
 * Detects top-level apiKey/baseUrl/model and converts to models map.
 *
 * @param config - Legacy config with top-level apiKey/baseUrl/model.
 * @returns MultiProviderConfig in the new format.
 *
 * @example
 * ```ts
 * // Before (legacy):
 * { apiKey: "sk-...", model: "gpt-4o", provider: "openai" }
 *
 * // After (migrated):
 * {
 *   openai: { apiKey: "sk-...", model: "gpt-4o" },
 *   default: "openai"
 * }
 * ```
 */
export function migrateLegacyConfig(config: any): MultiProviderConfig {
  const result: any = {};

  // If config already has models map, it's not legacy
  if (config.models) {
    return config as MultiProviderConfig;
  }

  // Migrate top-level provider config
  const providerType = config.provider || "openai";
  if (config.apiKey) {
    result[providerType] = {
      apiKey: config.apiKey,
      ...(config.model ? { model: config.model } : {}),
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    };
  }

  result.default = providerType;
  return result as MultiProviderConfig;
}

/**
 * Adds or updates a provider configuration.
 * Modifies the global providerConfig singleton.
 *
 * @param type - The provider type to add/update.
 * @param config - The provider configuration (apiKey, model, baseUrl).
 *
 * @example
 * ```ts
 * import { addProvider } from '@zclaw/core';
 *
 * addProvider('anthropic', { apiKey: 'sk-ant-...', model: 'claude-sonnet-4-20250514' });
 * ```
 */
export function addProvider(
  type: ProviderType,
  config: { apiKey: string; model?: string; baseUrl?: string },
): void {
  if (!providerConfig) {
    providerConfig = { default: type } as MultiProviderConfig;
  }
  // For openai-compatible, baseUrl is required
  if (type === "openai-compatible" && !config.baseUrl) {
    throw new Error('Provider "openai-compatible" requires a baseUrl.');
  }
  (providerConfig as any)[type] = config;
}

/**
 * Updates an existing provider configuration.
 * Only updates the specified fields, preserving others.
 *
 * @param type - The provider type to update.
 * @param updates - Partial configuration updates to apply.
 *
 * @example
 * ```ts
 * import { updateProviderConfig } from '@zclaw/core';
 *
 * // Update just the model, keep existing apiKey
 * updateProviderConfig('openai', { model: 'gpt-4o-mini' });
 * ```
 */
export function updateProviderConfig(
  type: ProviderType,
  updates: Partial<{ model: string; baseUrl: string }>,
): void {
  if (!providerConfig?.[type]) {
    throw new Error(`Provider "${type}" is not configured. Use addProvider() first.`);
  }

  const existing = providerConfig[type] as any;
  providerConfig[type] = {
    ...existing,
    ...updates,
  };
}

/**
 * Removes a provider configuration.
 *
 * @param type - The provider type to remove.
 *
 * @example
 * ```ts
 * import { removeProvider } from '@zclaw/core';
 *
 * removeProvider('glm');
 * ```
 */
export function removeProvider(type: ProviderType): void {
  if (!providerConfig) {
    return;
  }

  delete providerConfig[type];

  // If we removed the default, switch to another available provider
  if (providerConfig.default === type) {
    const remaining = Object.keys(providerConfig).filter(k => k !== "default") as ProviderType[];
    if (remaining.length > 0) {
      providerConfig.default = remaining[0];
    }
  }
}

/**
 * Saves the current provider configuration to a file.
 * Useful for persisting runtime configuration changes.
 *
 * @param configPath - Path to save the config file. Defaults to ~/.zclawrc.json.
 *
 * @example
 * ```ts
 * import { saveConfig } from '@zclaw/core';
 * import { configureProviders } from '@zclaw/core';
 *
 * configureProviders({
 *   openai: { apiKey: 'sk-...', model: 'gpt-4o' },
 *   default: 'openai',
 * });
 *
 * await saveConfig(); // Saves to ~/.zclawrc.json
 * ```
 */
export async function saveConfig(configPath?: string): Promise<void> {
  if (!providerConfig) {
    throw new Error("No provider configuration to save. Call configureProviders() first.");
  }

  const fs = await import("fs");
  const path = await import("path");
  const os = await import("os");

  const targetPath = configPath ?? path.join(os.homedir(), ".zclawrc.json");
  const dir = path.dirname(targetPath);

  // Ensure directory exists
  await fs.promises.mkdir(dir, { recursive: true });

  // Write config file
  await fs.promises.writeFile(
    targetPath,
    JSON.stringify(providerConfig, null, 2),
    "utf-8",
  );
}
