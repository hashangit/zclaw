import { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from './theme.js';
import { useFeed } from './hooks/use-feed.js';
import { useAgent } from './hooks/use-agent.js';
import { MessageArea } from './components/message-area.js';
import { PromptArea } from './components/prompt-area.js';
import { PermissionPrompt } from './components/permission-prompt.js';
import type { Agent } from '../agent.js';
import type { PermissionLevel } from '../../../core/types.js';
import { HORIZONTAL_PADDING } from './layout.js';

/** Outcome of dispatching a slash command in the TUI (built in startTui). */
export interface TuiCommandOutcome {
  status: 'handled' | 'fallthrough';
  /** Command owns stdin/stdout — the TUI can't run it (deferred to a later phase). */
  deferred?: boolean;
  /** ANSI-styled text; the TUI strips ANSI before rendering. */
  output?: string;
  /** Session should terminate. */
  exit?: boolean;
}

/** Strip ANSI escapes — handler output is chalk-styled for the readline path. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

interface TuiAppProps {
  agent: Agent;
  permissionLevel?: PermissionLevel;
  /** A prompt passed on the command line, auto-submitted once on mount. */
  initialQuery?: string;
  /** Clean exit from the idle state (unmounts Ink + exits the process). */
  onExit: () => void;
  /** Dispatch a `/command` via the shared registry (one owner, no duplication). */
  dispatchCommand: (input: string) => Promise<TuiCommandOutcome>;
}

/**
 * TuiApp — full-screen root. `<MessageArea>` grows the scrollback; the live
 * footer swaps between the inline permission prompt, a "working" indicator
 * (while a run is in flight), and the input prompt. ESC aborts the current
 * run; Ctrl+C aborts mid-run or exits when idle (FR-006).
 */
export function TuiApp({ agent, permissionLevel, initialQuery, onExit, dispatchCommand }: TuiAppProps) {
  const feed = useFeed();
  const { isRunning, pendingPermission, submit, resolvePermission, abort } = useAgent({
    agent,
    feed,
    permissionLevel,
  });
  const [input, setInput] = useState('');

  // Auto-submit a command-line prompt exactly once on mount.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (initialQuery && initialQuery.trim()) {
      void submit(initialQuery);
    }
  }, [initialQuery, submit]);

  useInput((inputChar, key) => {
    if (key.escape) {
      abort();
      return;
    }
    if (key.ctrl && inputChar === 'c') {
      if (isRunning) {
        abort();
      } else {
        onExit();
      }
    }
  });

  const handleUserInput = async (value: string): Promise<void> => {
    setInput('');
    const trimmed = value.trim();
    if (!trimmed.startsWith('/')) {
      void submit(value);
      return;
    }
    const name = trimmed.split(/\s+/)[0];
    const result = await dispatchCommand(trimmed);
    if (result.deferred) {
      feed.appendEntry({
        kind: 'assistant',
        content: `${name} is interactive — run it in the readline REPL (zclaw), or wait for the TUI overlay.`,
      });
    } else if (result.exit) {
      onExit();
    } else if (result.output) {
      feed.appendEntry({ kind: 'assistant', content: stripAnsi(result.output) });
    } else if (result.status === 'fallthrough') {
      feed.appendEntry({
        kind: 'assistant',
        content: `${name} skill launch from the TUI arrives in US2 — ask in chat, or run it in the readline REPL.`,
      });
    }
  };

  return (
    <Box flexDirection="column" paddingLeft={HORIZONTAL_PADDING} paddingRight={HORIZONTAL_PADDING}>
      <MessageArea entries={feed.entries} />
      <Box flexDirection="column">
        {pendingPermission ? (
          <PermissionPrompt
            toolName={pendingPermission.toolName}
            args={pendingPermission.args}
            onResolve={resolvePermission}
          />
        ) : isRunning ? (
          <Box>
            <Text color={theme.yellow}>⏳ ZClaw is working… </Text>
            <Text color={theme.fgDim}>(Esc to abort)</Text>
          </Box>
        ) : (
          <PromptArea value={input} onChange={setInput} onSubmit={(v) => { void handleUserInput(v); }} />
        )}
      </Box>
    </Box>
  );
}
