import { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './hooks/use-theme.js';
import { useFeed } from './hooks/use-feed.js';
import { useAgent } from './hooks/use-agent.js';
import { useKeybindings } from './hooks/use-keybindings.js';
import { useFileWatcher } from './hooks/use-file-watcher.js';
import { MessageArea } from './components/message-area.js';
import { PromptArea } from './components/prompt-area.js';
import { PermissionPrompt } from './components/permission-prompt.js';
import { AssistantMessage } from './components/assistant-message.js';
import { ToolCallBlock } from './components/tool-call-block.js';
import { GoalStatus } from './components/goal-status.js';
import { Footer } from './components/footer.js';
import Spinner from 'ink-spinner';
import { CommandPalette } from './components/command-palette.js';
import { HelpDialog } from './overlays/help-dialog.js';
import { ModelSelector, type ModelOption } from './overlays/model-selector.js';
import { SessionSelector, type SessionListItem } from './overlays/session-selector.js';
import { SettingsEditor, type SettingItem } from './overlays/settings-overlay.js';
import { messagesToFeedEntries } from './feed-serializer.js';
import type { Suggestion } from './components/autocomplete.js';
import type { Agent } from '../agent.js';
import type { PermissionLevel } from '../../../core/types.js';
import { getModelMeta } from '../../../models-catalog.js';
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

type Overlay = 'palette' | 'help' | 'model' | 'settings' | 'sessions' | null;

/** Strip ANSI escapes — handler output is chalk-styled for the readline path. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

interface TuiAppProps {
  agent: Agent;
  permissionLevel?: PermissionLevel;
  initialQuery?: string;
  onExit: () => void;
  dispatchCommand: (input: string) => Promise<TuiCommandOutcome>;
  commands: Suggestion[];
  skills: Suggestion[];
  resetView: () => void;
  /** Footer status info from the session. */
  providerType: string;
  gatewayOn: boolean;
  skillCount: number;
  mcpCount: number;
  modelOptions: ModelOption[];
  onSwitchModel: (providerType: string, modelId: string) => Promise<void>;
  getSettingsList: () => SettingItem[];
  onSetSetting: (dotKey: string, value: string) => Promise<void>;
  listSessions: () => Promise<SessionListItem[]>;
  onSwitchSession: (sessionId: string) => Promise<{ preview: string; messageCount: number } | null>;
  onDeleteSession: (sessionId: string) => Promise<void>;
  getSessionId: () => string;
}

/**
 * TuiApp — full-screen root. `<MessageArea>` grows the scrollback; the live
 * region swaps between modal overlays (palette/help), the inline permission
 * prompt, a "working" indicator, and the input prompt. A status footer is
 * always pinned at the bottom. ESC aborts; Ctrl+C aborts mid-run or exits when
 * idle (FR-006); Ctrl+P/L/O are global shortcuts (see use-keybindings).
 */
export function TuiApp({
  agent, permissionLevel, initialQuery, onExit, dispatchCommand, commands, skills, resetView,
  providerType, gatewayOn, skillCount, mcpCount, modelOptions, onSwitchModel, getSettingsList, onSetSetting,
  listSessions, onSwitchSession, onDeleteSession, getSessionId,
}: TuiAppProps) {
  const theme = useTheme();
  const feed = useFeed();
  const { isRunning, pendingPermission, streamingText, streamingTool, usage, contextTokens, latestTodos, submit, resolvePermission, abort, resetTodos } = useAgent({
    agent,
    feed,
    permissionLevel,
  });
  const [input, setInput] = useState('');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [settingsList, setSettingsList] = useState<SettingItem[]>([]);
  const [sessionsList, setSessionsList] = useState<SessionListItem[]>([]);

  // File-watcher: notifies when project files change externally while idle.
  const { changedFile, clear: clearFileChange } = useFileWatcher(!isRunning);

  // Input history lives here (not in PromptArea) so it survives PromptArea
  // unmounting during a run — otherwise every turn wiped the history.
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  // The in-progress prompt, saved on first ↑ so ↓ back to the present restores
  // it (instead of wiping what the user was typing).
  const draftRef = useRef('');

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

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (initialQuery && initialQuery.trim()) {
      void submit(initialQuery);
    }
  }, [initialQuery, submit]);

  // Run a /command via the shared registry; surface its output in the feed.
  const runSlash = async (raw: string): Promise<void> => {
    const name = raw.split(/\s+/)[0];
    const result = await dispatchCommand(raw);
    if (result.deferred) {
      feed.appendEntry({ kind: 'assistant', content: `${name} is interactive — run it in the readline REPL (zclaw), or wait for the TUI overlay.` });
    } else if (result.exit) {
      onExit();
    } else if (result.output) {
      feed.appendEntry({ kind: 'assistant', content: stripAnsi(result.output) });
    } else if (result.status === 'fallthrough') {
      feed.appendEntry({ kind: 'assistant', content: `${name} skill launch from the TUI arrives in US2 — ask in chat, or run it in the readline REPL.` });
    }
  };

  const handleUserInput = async (value: string): Promise<void> => {
    const trimmed = value.trim();
    if (trimmed) {
      historyRef.current.push(trimmed);
      historyIndexRef.current = -1;
    }
    setInput('');
    clearFileChange();
    if (trimmed === '/?') {
      setOverlay('help');
      return;
    }
    if (trimmed === '/models' || trimmed === '/model') {
      setOverlay('model');
      return;
    }
    if (trimmed === '/sessions' || trimmed === '/session') {
      setSessionsList(await listSessions());
      setOverlay('sessions');
      return;
    }
    // /settings wizard (no args) → open the settings overlay.
    // /settings set <key> (no value) → guide (would inquirer).
    // /settings set <key> <value> + list/get/reset/export/help → dispatch.
    {
      const parts = trimmed.split(/\s+/);
      const cmd = parts[0]?.toLowerCase();
      const sub = parts[1]?.toLowerCase();
      if (['/settings', '/setting', '/config'].includes(cmd)) {
        if (sub === undefined) {
          setSettingsList(getSettingsList());
          setOverlay('settings');
          return;
        }
        if (sub === 'set' && parts.length <= 3) {
          feed.appendEntry({ kind: 'info', content: 'Provide a value: /settings set <key> <value>  (e.g. /settings set gateway.enabled true)' });
          return;
        }
      }
    }
    if (trimmed.startsWith('/')) {
      await runSlash(trimmed);
    } else {
      void submit(value);
    }
  };

  const onHistoryUp = (): void => {
    const h = historyRef.current;
    if (h.length === 0) return;
    if (historyIndexRef.current === -1) {
      draftRef.current = input; // save the in-progress prompt before navigating
    }
    const next = historyIndexRef.current === -1 ? h.length - 1 : Math.max(0, historyIndexRef.current - 1);
    historyIndexRef.current = next;
    setInput(h[next]);
  };
  const onHistoryDown = (): void => {
    const h = historyRef.current;
    if (h.length === 0 || historyIndexRef.current === -1) return;
    const next = historyIndexRef.current + 1;
    if (next >= h.length) {
      historyIndexRef.current = -1;
      setInput(draftRef.current); // restore the in-progress prompt
    } else {
      historyIndexRef.current = next;
      setInput(h[next]);
    }
  };

  // Palette includes a synthetic "shortcuts" entry that opens the help dialog.
  const paletteCommands: Suggestion[] = [
    ...commands,
    { name: 'shortcuts', description: 'Keyboard reference' },
    { name: 'model', description: 'Switch model' },
    { name: 'settings', description: 'View settings' },
    { name: 'sessions', description: 'Resume / delete a session' },
  ];
  const onPaletteRun = (name: string): void => {
    setOverlay(null);
    if (name === 'shortcuts') {
      setOverlay('help');
    } else if (name === 'model') {
      setOverlay('model');
    } else if (name === 'settings') {
      setSettingsList(getSettingsList());
      setOverlay('settings');
    } else if (name === 'sessions') {
      void (async () => {
        setSessionsList(await listSessions());
        setOverlay('sessions');
      })();
    } else {
      void runSlash('/' + name);
    }
  };

  // Save a setting via the settings editor, then refresh the list so the new
  // value is immediately visible.
  const handleSetSetting = async (dotKey: string, value: string): Promise<void> => {
    await onSetSetting(dotKey, value);
    setSettingsList(getSettingsList());
  };

  // Resume a session: load messages into the agent, rebuild the visual feed
  // (full reconstruction incl. tool blocks), and remount <Static> so history
  // repaints without phantom duplicates (same pattern as /clear).
  const handleSelectSession = async (sessionId: string): Promise<void> => {
    const summary = await onSwitchSession(sessionId);
    setOverlay(null);
    if (!summary) {
      feed.appendEntry({ kind: 'info', content: `Session ${sessionId.slice(0, 8)} could not be loaded.` });
      return;
    }
    feed.clear();
    resetTodos();
    const entries = messagesToFeedEntries(agent.getMessages());
    for (const entry of entries) feed.appendEntry(entry);
    resetView();
    setStaticKey((k) => k + 1);
    feed.appendEntry({ kind: 'info', content: `Resumed session: ${summary.preview} (${summary.messageCount} messages)` });
  };

  // Delete a session, then refresh the selector so the row disappears.
  const handleDeleteSession = async (sessionId: string): Promise<void> => {
    await onDeleteSession(sessionId);
    setSessionsList(await listSessions());
  };

  useKeybindings(
    {
      onAbort: abort,
      onExit,
      onExpandToggle: () => { resetView(); setExpanded((e) => !e); setStaticKey((k) => k + 1); },
      onPalette: () => setOverlay('palette'),
      onClear: () => {
        agent.clearConversation();
        feed.clear();
        resetTodos();
        resetView();
        setStaticKey((k) => k + 1);
      },
    },
    { enabled: overlay === null, isRunning },
  );

  return (
    <Box flexDirection="column" paddingLeft={HORIZONTAL_PADDING} paddingRight={HORIZONTAL_PADDING}>
      <MessageArea entries={feed.entries} staticKey={staticKey} expanded={expanded} />
      {/* Persistent todo panel — stays visible; updates on each manage_todos call. */}
      {latestTodos ? <GoalStatus todos={latestTodos} /> : null}
      {streamingText ? (
        <AssistantMessage entry={{ id: '__streaming', kind: 'assistant', content: streamingText }} />
      ) : null}
      {streamingTool ? (
        <ToolCallBlock
          entry={{ id: '__running-tool', kind: 'tool', name: streamingTool.name, args: streamingTool.args, status: 'running', output: streamingTool.output }}
          expanded={true}
        />
      ) : null}
      <Box flexDirection="column">
        {overlay === 'palette' ? (
          <CommandPalette commands={paletteCommands} skills={skills} onRun={onPaletteRun} onClose={() => setOverlay(null)} />
        ) : overlay === 'help' ? (
          <HelpDialog onClose={() => setOverlay(null)} />
        ) : overlay === 'model' ? (
          <ModelSelector
            options={modelOptions}
            currentModel={agent.getModel()}
            onSwitch={(pt, m) => { setOverlay(null); void onSwitchModel(pt, m); }}
            onClose={() => setOverlay(null)}
          />
        ) : overlay === 'settings' ? (
          <SettingsEditor settings={settingsList} onSet={handleSetSetting} onClose={() => setOverlay(null)} />
        ) : overlay === 'sessions' ? (
          <SessionSelector
            sessions={sessionsList}
            currentSessionId={getSessionId()}
            onSelect={(id) => { void handleSelectSession(id); }}
            onDelete={(id) => { void handleDeleteSession(id); }}
            onClose={() => setOverlay(null)}
          />
        ) : pendingPermission ? (
          <PermissionPrompt toolName={pendingPermission.toolName} args={pendingPermission.args} onResolve={resolvePermission} />
        ) : isRunning && !streamingText ? (
          <Box>
            <Text color={theme.yellow}><Spinner type="dots" /> ZClaw is working </Text>
            <Text color={theme.fgDim}>(Esc to abort)</Text>
          </Box>
        ) : !isRunning ? (
          <PromptArea value={input} onChange={setInput} onSubmit={(v) => { void handleUserInput(v); }} onHistoryUp={onHistoryUp} onHistoryDown={onHistoryDown} commands={commands} skills={skills} />
        ) : null}
      </Box>
      {changedFile ? (
        <Text color={theme.yellow}>~ {changedFile} changed externally</Text>
      ) : null}
      <Footer
        providerType={providerType}
        model={agent.getModel()}
        usage={usage}
        permissionLevel={permissionLevel}
        skillCount={skillCount}
        gatewayOn={gatewayOn}
        mcpCount={mcpCount}
        contextTokens={contextTokens}
        contextWindow={getModelMeta(agent.getModel())?.contextWindow}
      />
    </Box>
  );
}
