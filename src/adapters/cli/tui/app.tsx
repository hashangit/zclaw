import { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from './theme.js';
import { useFeed } from './hooks/use-feed.js';
import { useAgent } from './hooks/use-agent.js';
import { MessageArea } from './components/message-area.js';
import { PromptArea } from './components/prompt-area.js';
import { PermissionPrompt } from './components/permission-prompt.js';
import { AssistantMessage } from './components/assistant-message.js';
import type { Suggestion } from './components/autocomplete.js';
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
  /** Autocomplete sources built from the shared registry + loaded skills. */
  commands: Suggestion[];
  skills: Suggestion[];
  /** Reset Ink's Static accumulator + clear screen before a `<Static>` remount. */
  resetView: () => void;
}

/**
 * TuiApp — full-screen root. `<MessageArea>` grows the scrollback; the live
 * footer swaps between the inline permission prompt, a "working" indicator
 * (while a run is in flight), and the input prompt. ESC aborts the current
 * run; Ctrl+C aborts mid-run or exits when idle (FR-006).
 */
export function TuiApp({ agent, permissionLevel, initialQuery, onExit, dispatchCommand, commands, skills, resetView }: TuiAppProps) {
  const feed = useFeed();
  const { isRunning, pendingPermission, streamingText, submit, resolvePermission, abort } = useAgent({
    agent,
    feed,
    permissionLevel,
  });
  const [input, setInput] = useState('');

  // Bumping `staticKey` remounts `<Static>` (in MessageArea) for a full repaint.
  // On resize we reset Ink's accumulated Static output first (via resetView, see
  // ink-reset.ts) so the remount doesn't duplicate history — this is what makes
  // resize reflow work without phantom remnants. (T028 expand/collapse will bump
  // the same key to re-render tool blocks.)
  const [staticKey, setStaticKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const onResize = () => {
      resetView();
      setStaticKey((k) => k + 1);
    };
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, [resetView]);

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
    // Ctrl+O: toggle expand/collapse of all tool blocks. Bumps staticKey so the
    // frozen <Static> history re-renders with the new expanded state (resetView
    // first so it repaints cleanly).
    if (key.ctrl && (inputChar === 'o' || inputChar === '\x0f')) {
      resetView();
      setExpanded((e) => !e);
      setStaticKey((k) => k + 1);
      return;
    }
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
      <MessageArea entries={feed.entries} staticKey={staticKey} expanded={expanded} />
      {/* Live streaming assistant message — rendered here (not in <Static>) so it
          repaints per token; committed to history when the turn/tool completes. */}
      {streamingText ? (
        <AssistantMessage entry={{ id: '__streaming', kind: 'assistant', content: streamingText }} />
      ) : null}
      <Box flexDirection="column">
        {pendingPermission ? (
          <PermissionPrompt
            toolName={pendingPermission.toolName}
            args={pendingPermission.args}
            onResolve={resolvePermission}
          />
        ) : isRunning && !streamingText ? (
          <Box>
            <Text color={theme.yellow}>⏳ ZClaw is working… </Text>
            <Text color={theme.fgDim}>(Esc to abort)</Text>
          </Box>
        ) : !isRunning ? (
          <PromptArea
            value={input}
            onChange={setInput}
            onSubmit={(v) => { void handleUserInput(v); }}
            commands={commands}
            skills={skills}
          />
        ) : null}
      </Box>
    </Box>
  );
}
