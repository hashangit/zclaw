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
import { bootstrapCliSession } from '../bootstrap.js';
import { buildCommandRegistry } from '../commands/build-registry.js';

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

  let instance: ReturnType<typeof render>;
  const onExit = (): void => {
    instance.unmount();
    process.exit(0);
  };
  instance = render(
    <TuiApp
      agent={agent}
      permissionLevel={permissionLevel}
      initialQuery={initialQuery}
      onExit={onExit}
      dispatchCommand={dispatchCommand}
    />,
    { exitOnCtrlC: false },
  );
}
