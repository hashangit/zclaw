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
import { bootstrapCliSession } from '../bootstrap.js';
import { buildCommandRegistry } from '../commands/build-registry.js';
import { warmInkReset, resetInkStatic } from './ink-reset.js';

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
  const { agent, fullConfig, activeProviderType, gatewayInstance, permissionLevel } = ctx;

  // Same registry the readline REPL uses — one owner of the command set.
  const registry = buildCommandRegistry(agent, fullConfig, activeProviderType, gatewayInstance);

  // Autocomplete sources: built-in commands + loaded skills.
  const commands: Suggestion[] = registry.getAll()
    .filter((e) => !e.hidden)
    .map((e) => ({ name: e.name, description: e.description }));
  const skills: Suggestion[] = (agent.getSkillRegistry()?.getAll() ?? [])
    .map((s) => ({ name: s.name, description: s.description }));

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
    />,
    { exitOnCtrlC: false },
  );
}
