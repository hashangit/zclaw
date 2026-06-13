/**
 * ZClaw CLI — Shared session bootstrap
 *
 * The setup phase that both dispatch paths need: config load + merge,
 * provider resolution (+ interactive setup wizard), permission level,
 * Agent construction, skills init, gateway init, and the documents dir.
 *
 * Extracted verbatim from `runChat()` so the readline fallback and the
 * Ink TUI share one setup path — no duplicated ~175 lines, and
 * `zclaw -n` stays byte-identical (the setup prints only the same
 * interactive-gated status messages as before). UI chrome (welcome
 * banner, "agent initialized", the readline loop) stays in the caller.
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { Agent } from './agent.js';
import { resolveLaunchMode, selectSystemPrompt } from './system-prompts.js';
import { createProvider } from '../../providers/factory.js';
import { resolveProviderConfigFromApp } from '../../core/provider-resolver.js';
import {
  loadJsonConfig,
  applyEnvOverrides,
  migrateLegacyFormat,
  resolveActiveProviderType,
  getConfigPaths,
} from './config-loader.js';
import { runSetup } from './setup.js';
import { isNonInteractive, hasRequiredProviderEnv } from './docker-utils.js';
import type { PermissionLevel } from '../../core/types.js';
import { resolvePermissionLevel } from '../../core/permission.js';
import { SettingsManager } from '../../core/settings-manager.js';
import { loadMergedConfig } from './config-loader.js';

export interface CliSessionContext {
  agent: Agent;
  fullConfig: any;
  activeProviderType: string;
  providerConfig: any;
  permissionLevel: PermissionLevel | undefined;
  gatewayInstance: any;
}

export async function bootstrapCliSession(options: any): Promise<CliSessionContext> {
  const { global: GLOBAL_CONFIG_FILE, local: LOCAL_CONFIG_FILE } = getConfigPaths();

  // 1. Load and merge configs (local > global)
  const globalConfig = loadJsonConfig(GLOBAL_CONFIG_FILE);
  const localConfig = loadJsonConfig(LOCAL_CONFIG_FILE);
  if (Object.keys(localConfig).length > 0 && options.interactive) {
    console.log(chalk.dim(`Loaded project config from ${LOCAL_CONFIG_FILE}`));
  }

  let fullConfig = { ...globalConfig, ...localConfig };

  // 2. Inject runtime flags
  fullConfig.autoConfirm = options.yes || options.headless || options.docker || false;

  // 2b. Resolve permission level from CLI flags, env var, and config
  let permissionLevel: PermissionLevel | undefined;
  const headless = options.headless || options.yes || options.docker;

  if (!headless) {
    const flagLevel = options.yolo ? "permissive"
      : options.strict ? "strict"
      : options.moderate ? "moderate"
      : undefined;
    permissionLevel = resolvePermissionLevel(
      flagLevel,
      process.env.ZCLAW_PERMISSION,
      fullConfig.permissionLevel,
    );
  }

  // Warn about conflicting flags
  if (headless && (options.strict || options.moderate || options.yolo)) {
    const flag = options.strict ? '--strict' : options.moderate ? '--moderate' : '--yolo';
    console.warn(`Warning: --headless overrides ${flag}. All tools will be auto-approved.`);
  }

  // 3. Apply env var overrides for tool settings
  fullConfig = applyEnvOverrides(fullConfig);

  // 4. Auto-migrate legacy config format (top-level apiKey/baseUrl/model)
  fullConfig = migrateLegacyFormat(fullConfig, { model: options.model });

  // 5. Resolve active provider
  let activeProviderType = resolveActiveProviderType(fullConfig, { provider: options.provider });
  let providerConfig = resolveProviderConfigFromApp(fullConfig, activeProviderType);

  if (!providerConfig) {
    console.log(chalk.yellow("No provider configuration found."));

    if (isNonInteractive()) {
      // Non-interactive: cannot run setup wizard, rely on env vars only
      if (hasRequiredProviderEnv(fullConfig)) {
        // Re-resolve after env var check
        fullConfig = migrateLegacyFormat(fullConfig, { model: options.model });
        activeProviderType = resolveActiveProviderType(fullConfig, { provider: options.provider });
        providerConfig = resolveProviderConfigFromApp(fullConfig, activeProviderType);
      }
      if (!providerConfig) {
        console.error(chalk.red("No provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GLM_API_KEY env vars, or provide a config file."));
        process.exit(1);
      }
    } else {
      // Interactive: ask user
      const inquirer = await import('inquirer');
      const { doSetup } = await inquirer.default.prompt([
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
        const updatedProviderType = resolveActiveProviderType(fullConfig, { provider: options.provider });
        providerConfig = resolveProviderConfigFromApp(fullConfig, updatedProviderType);
      } else {
        console.error(chalk.red("Provider configuration is required to proceed."));
        process.exit(1);
      }
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
  // Select system prompt by launch mode: interactive (TUI/readline in a TTY)
  // gets the interactive coding-agent prompt; headless/docker/piped keep
  // the Docker-native prompt unchanged.
  const launchMode = resolveLaunchMode(options);
  const systemPrompt = selectSystemPrompt(launchMode);
  const agent = new Agent(provider, providerConfig.model, fullConfig, systemPrompt);

  // Initialize skills system
  await agent.initializeSkills();

  // Initialize gateway (if enabled)
  let gatewayInstance: any = null;
  try {
    const settingsManager = new SettingsManager({
      config: applyEnvOverrides(loadMergedConfig()),
      projectConfigPath: LOCAL_CONFIG_FILE,
      globalConfigPath: GLOBAL_CONFIG_FILE,
    });
    const gwEnabled = settingsManager.get('gateway.enabled').value as boolean;
    if (gwEnabled) {
      const gatewayConfig = {
        enabled: true,
        semanticTopK: settingsManager.get('gateway.semanticTopK').value as number,
        defaultRateLimitPerMin: settingsManager.get('gateway.defaultRateLimitPerMin').value as number,
        maxAuditLogsInMemory: settingsManager.get('gateway.maxAuditLogs').value as number,
      };
      const { GatewaySettingsAdapter } = await import('../../gateway/settings-adapter.js');
      const gwStorageDir = process.env.ZCLAW_GATEWAY_DIR ?? path.join(os.homedir(), '.zclaw');
      const gwSettingsAdapter = new GatewaySettingsAdapter(gwStorageDir);
      await gwSettingsAdapter.initialize();

      const { createGateway } = await import('../../gateway/index.js');
      gatewayInstance = await createGateway(gatewayConfig, gwSettingsAdapter);

      if (gatewayInstance) {
        const { semanticToolInjectionMiddleware } = await import('../../core/middleware/semantic-tools.js');
        agent.setMiddleware([semanticToolInjectionMiddleware(gatewayInstance, gatewayConfig.semanticTopK)]);
        if (options.interactive) {
          console.log(chalk.green('Gateway initialized'));
        }
      }
    }
  } catch (e) {
    console.warn(chalk.yellow(`Gateway initialization skipped: ${e instanceof Error ? e.message : String(e)}`));
  }

  // Ensure ~/zclaw_documents exists
  const docsDir = path.join(os.homedir(), 'zclaw_documents');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
    for (const sub of ['notes', 'templates', 'output', 'knowledge']) {
      fs.mkdirSync(path.join(docsDir, sub), { recursive: true });
    }
  }

  return { agent, fullConfig, activeProviderType, providerConfig, permissionLevel, gatewayInstance };
}
