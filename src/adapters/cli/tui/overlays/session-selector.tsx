import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTheme } from '../hooks/use-theme.js';

/** A saved session, projected for the selector. */
export interface SessionListItem {
  id: string;
  /** Searchable display text — first user message, truncated. */
  preview: string;
  /** Epoch ms of the last update. */
  updatedAt: number;
  messageCount: number;
  provider?: string;
  model?: string;
}

interface SessionSelectorProps {
  sessions: SessionListItem[];
  currentSessionId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const MAX_VISIBLE = 10;
const PREVIEW_LEN = 60;

/** `/sessions` overlay: fuzzy search to filter, ↑/↓ navigate, Enter resumes,
 *  `d` deletes (stays in overlay), Esc closes. Mirrors model-selector windowing
 *  + command-palette char-by-char input. */
export function SessionSelector({ sessions, currentSessionId, onSelect, onDelete, onClose }: SessionSelectorProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => {
    const idx = sessions.findIndex((s) => s.id === currentSessionId);
    return idx >= 0 ? idx : 0;
  });
  const [deletedHint, setDeletedHint] = useState<string | null>(null);

  // Subsequence match on preview (case-insensitive). Keeps the component
  // self-contained — sessions carry their own id, no projection needed.
  const matches = query
    ? sessions.filter((s) => isSubsequence(s.preview.toLowerCase(), query.toLowerCase()))
    : sessions;

  // Clamp the cursor when the list shrinks (delete, filter) so it never points
  // past the last row — otherwise the highlight silently disappears.
  useEffect(() => {
    setSelected((i) => Math.min(i, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  useInput((input, key) => {
    if (deletedHint) setDeletedHint(null);
    if (key.escape) { onClose(); return; }
    if (key.return) {
      const m = matches[Math.min(selected, matches.length - 1)] ?? matches[0];
      if (m) onSelect(m.id);
      return;
    }
    if (key.upArrow) { setSelected((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setSelected((i) => Math.min(matches.length - 1, i + 1)); return; }
    if (input === 'd' && !key.ctrl && !key.meta) {
      const m = matches[Math.min(selected, matches.length - 1)] ?? matches[0];
      if (m && m.id !== currentSessionId) {
        onDelete(m.id);
        setDeletedHint(`Deleted session ${m.id.slice(0, 8)}`);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setSelected(0);
    } else if (input && !key.ctrl && !key.meta && input >= ' ') {
      setQuery((q) => q + input);
      setSelected(0);
    }
  });

  const half = Math.floor(MAX_VISIBLE / 2);
  const start = matches.length > MAX_VISIBLE
    ? Math.max(0, Math.min(selected - half, matches.length - MAX_VISIBLE))
    : 0;
  const visible = matches.slice(start, start + MAX_VISIBLE);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.purple} paddingLeft={1} paddingRight={1}>
      <Text color={theme.purple} bold>Sessions</Text>
      <Box>
        <Text color={theme.purple} bold>❯ </Text>
        <Text color={theme.fg}>{query}</Text>
        <Text color={theme.fgDim}> {matches.length > 0 ? '(↑↓ select, Enter resume, d delete, Esc close)' : '— no matches'}</Text>
      </Box>
      {deletedHint ? <Text color={theme.yellow}>  {deletedHint}</Text> : null}
      {visible.length === 0 ? (
        <Text color={theme.fgDim}>  No saved sessions yet. Chat to create one.</Text>
      ) : (
        visible.map((s, i) => {
          const absIdx = start + i;
          const sel = absIdx === selected;
          const isCurrent = s.id === currentSessionId;
          const preview = truncate(s.preview, PREVIEW_LEN);
          return (
            <Box key={s.id} flexDirection="column">
              <Box>
                <Text backgroundColor={sel ? theme.blue : undefined} color={sel ? theme.bg : isCurrent ? theme.green : theme.fg}>
                  {sel ? '▶ ' : '  '}{isCurrent ? '✓ ' : '  '}{preview}
                </Text>
              </Box>
              <Text color={theme.fgDim}>      {relativeTime(s.updatedAt)} · {s.messageCount} msg{s.model ? ` · ${s.model}` : ''}</Text>
            </Box>
          );
        })
      )}
      {matches.length > MAX_VISIBLE ? (
        <Text color={theme.fgDim}>  {matches.length - MAX_VISIBLE} more</Text>
      ) : null}
    </Box>
  );
}

function truncate(s: string, n: number): string {
  const oneLine = s.split('\n')[0].trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + '…' : oneLine;
}

/** Do query's chars appear in order within text? (empty query matches all) */
function isSubsequence(text: string, query: string): boolean {
  if (!query) return true;
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

/** Compact relative time, e.g. "2h ago", "3d ago". No deps. */
function relativeTime(epochMs: number): string {
  const sec = Math.floor((Date.now() - epochMs) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
