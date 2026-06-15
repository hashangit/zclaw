/**
 * TUI public entry — lazy-loaded by `src/adapters/cli/index.ts` only when
 * `resolveLaunchMode(options) === 'interactive'`. Headless / piped / --docker
 * modes never import this module, so React/Ink stay out of memory there.
 *
 * The `.tsx` extension is required (the file contains JSX); the lazy import
 * specifier `./tui/index.js` resolves to this source under `tsx` dev mode and
 * to the compiled `dist/adapters/cli/tui/index.js` under `tsc`.
 */

import { render } from 'ink';
import { TuiApp, type TuiCommandOutcome } from './app.js';
import type { Suggestion } from './components/autocomplete.js';
import type { SessionListItem } from './overlays/session-selector.js';
import { bootstrapCliSession } from '../bootstrap.js';
import { buildCommandRegistry } from '../commands/build-registry.js';
import { warmInkReset, resetInkStatic } from './ink-reset.js';
import { ThemeProvider } from './hooks/use-theme.js';
import { MODEL_CATALOG } from '../../../models-catalog.js';
import { resolveProviderConfigFromApp } from '../../../core/provider-resolver.js';
import { createProvider } from '../../../providers/factory.js';
import type { ModelOption } from './overlays/model-selector.js';
import type { SettingItem } from './overlays/settings-overlay.js';
import { SettingsManager } from '../../../core/settings-manager.js';
import { SETTINGS_MAP, SETTINGS_SCHEMA } from '../../../core/settings-schema.js';
import { loadMergedConfig, loadJsonConfig, getConfigPaths, applyEnvOverrides } from '../config-loader.js';

export interface StartTuiArgs {
  queryParts: string[];
  options: any;
}

/**
 * Run the shared session setup (same bootstrap as the readline REPL), build the
 * shared command registry, then render the full-screen Ink TUI. `exitOnCtrlC`
 * is false so the app owns Ctrl+C (abort mid-run, exit when idle) per FR-006.
 */
export async function startTui({ queryParts, options }: StartTuiArgs): Promise<void> {
  const initialQuery = queryParts.join(' ').trim();
  const ctx = await bootstrapCliSession(options);
  const { agent, fullConfig, activeProviderType, gatewayInstance, permissionLevel, persistence } = ctx;

  // Same registry the readline REPL uses — one owner of the command set.
  const registry = buildCommandRegistry(agent, fullConfig, activeProviderType, gatewayInstance);

  // Autocomplete sources: built-in commands + loaded skills.
  const commands: Suggestion[] = registry.getAll()
    .filter((e) => !e.hidden)
    .map((e) => ({ name: e.name, description: e.description }));
  const skills: Suggestion[] = (agent.getSkillRegistry()?.getAll() ?? [])
    .map((s) => ({ name: s.name, description: s.description }));

  // Model-selector options: catalog models for each CONFIGURED provider.
  const modelOptions: ModelOption[] = [];
  for (const pt of ['openai', 'anthropic', 'glm', 'openai-compatible'] as const) {
    if (!resolveProviderConfigFromApp(fullConfig, pt)) continue;
    for (const m of MODEL_CATALOG[pt]) {
      modelOptions.push({ providerType: pt, modelId: m.id, modelName: m.name });
    }
  }
  const onSwitchModel = async (providerType: string, modelId: string): Promise<void> => {
    const pc = resolveProviderConfigFromApp(fullConfig, providerType as any);
    if (!pc) return;
    pc.model = modelId;
    const provider = await createProvider(pc);
    agent.switchProvider(provider, modelId);
  };

  // Fresh settings list each time the overlay opens (so edits via /settings set
  // are reflected without a restart).
  const getSettingsList = (): SettingItem[] => {
    const paths = getConfigPaths();
    const sm = new SettingsManager({
      config: applyEnvOverrides(loadMergedConfig()),
      projectConfigPath: paths.local,
      globalConfigPath: paths.global,
      projectConfig: loadJsonConfig(paths.local) as Record<string, any>,
      globalConfig: loadJsonConfig(paths.global) as Record<string, any>,
    });
    return sm.list().map((s) => {
      const mapEntry = SETTINGS_MAP.get(s.dotKey);
      const schemaEntry = SETTINGS_SCHEMA.get(s.dotKey);
      return {
        dotKey: s.dotKey,
        value: s.masked ? '******' : String(s.value),
        category: s.category,
        label: mapEntry?.label ?? s.dotKey,
        type: schemaEntry?.type ?? 'string' as const,
        secret: schemaEntry?.secret ?? false,
        enumValues: schemaEntry?.enumValues,
        restartRequired: schemaEntry?.restartRequired ?? false,
      };
    });
  };
  const onSetSetting = async (dotKey: string, value: string): Promise<void> => {
    const paths = getConfigPaths();
    const sm = new SettingsManager({
      config: applyEnvOverrides(loadMergedConfig()),
      projectConfigPath: paths.local,
      globalConfigPath: paths.global,
      projectConfig: loadJsonConfig(paths.local) as Record<string, any>,
      globalConfig: loadJsonConfig(paths.global) as Record<string, any>,
    });
    await sm.set(dotKey, value);
  };

  // ── Sessions ────────────────────────────────────────────────────────────
  // list() returns bare ids; load() each to get metadata for the selector.
  // N+1 I/O is fine for O(10s) of local sessions. Derive a preview from the
  // first user message (SessionData has no title field). Forward-compatible:
  // swap this closure for registry.sessionsForUser() once 002 lands (see
  // specs/002-channels-integration migration note).
  const PREVIEW_LEN = 80;
  const listSessions = async (): Promise<SessionListItem[]> => {
    const ids = await persistence.list();
    const loaded = await Promise.all(ids.map((id) => persistence.load(id)));
    return loaded
      .filter((s): s is NonNullable<typeof s> => s != null)
      .map((s) => {
        const firstUser = s.messages.find((m) => m.role === 'user');
        const preview = (firstUser?.content ?? s.id).split('\n')[0].trim();
        return {
          id: s.id,
          preview: preview.length > PREVIEW_LEN ? preview.slice(0, PREVIEW_LEN - 1) + '…' : preview,
          updatedAt: s.updatedAt,
          messageCount: s.messages.length,
          provider: s.provider,
          model: s.model,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };

  // Load the session into the agent and return a short summary for the info
  // notice. The caller (TuiApp) rebuilds the feed from agent.getMessages().
  const onSwitchSession = async (sessionId: string): Promise<{ preview: string; messageCount: number } | null> => {
    const ok = await agent.loadSession(sessionId);
    if (!ok) return null;
    const msgs = agent.getMessages();
    const firstUser = msgs.find((m) => m.role === 'user');
    const preview = (firstUser?.content ?? sessionId).split('\n')[0].trim();
    return { preview, messageCount: msgs.length };
  };

  const onDeleteSession = async (sessionId: string): Promise<void> => {
    await persistence.delete(sessionId);
  };

  // Bridge the registry to the TUI: defer interactive (stdin/stdout-owning)
  // commands; otherwise dispatch and surface the returned output.
  const dispatchCommand = async (input: string): Promise<TuiCommandOutcome> => {
    const entry = registry.resolveCommand(input);
    if (entry?.interactive) return { status: 'handled', deferred: true };
    const { status, output } = await registry.dispatch(
      input,
      { agent, args: '', config: fullConfig },
      agent.getSkillRegistry(),
    );
    const isExit = status === 'exit';
    return { status: isExit ? 'handled' : status, output, exit: isExit };
  };

  // Clear any bootstrap status output (Loaded config / Gateway initialized) so
  // the TUI launches on a clean screen.
  process.stdout.write('\x1B[2J\x1B[1;1H');

  // Pre-load Ink's internal instances store (absolute-path import; see
  // ink-reset.ts) so resize/expand resets are synchronous.
  await warmInkReset();

  let instance: ReturnType<typeof render>;
  const onExit = (): void => {
    instance.unmount();
    process.exit(0);
  };
  // Reset Ink's accumulated Static output + clear the screen before a `<Static>`
  // remount (resize / expand-toggle), so history repaints cleanly without
  // phantom duplicates. (Command Code's fullStaticOutput reset pattern.)
  const resetView = (): void => {
    resetInkStatic(process.stdout);
    instance.clear();
    process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
  };
  instance = render(
    <ThemeProvider>
    <TuiApp
      agent={agent}
      permissionLevel={permissionLevel}
      initialQuery={initialQuery}
      onExit={onExit}
      dispatchCommand={dispatchCommand}
      commands={commands}
      skills={skills}
      resetView={resetView}
      providerType={activeProviderType}
      gatewayOn={!!gatewayInstance}
      skillCount={skills.length}
      mcpCount={gatewayInstance?.getTargets ? Object.keys(gatewayInstance.getTargets()).length : 0}
      modelOptions={modelOptions}
      onSwitchModel={onSwitchModel}
      getSettingsList={getSettingsList}
      onSetSetting={onSetSetting}
      listSessions={listSessions}
      onSwitchSession={onSwitchSession}
      onDeleteSession={onDeleteSession}
      getSessionId={() => agent.getSessionId()}
    />
    </ThemeProvider>,
    { exitOnCtrlC: false },
  );
}
