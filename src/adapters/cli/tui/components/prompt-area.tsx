import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../theme.js';
import { TextInput } from './text-input.js';
import { Autocomplete, fuzzyFilter, type Suggestion } from './autocomplete.js';
import { getFileIndex } from '../file-index.js';

interface PromptAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  /** `/command` source (built-in registry). */
  commands: Suggestion[];
  /** `/<skill-name>` source. */
  skills: Suggestion[];
}

interface ActiveCompletion {
  kind: '/' | '@';
  tokenStart: number; // index in `value` where the current token begins
  query: string;      // text typed after the / or @
}

/** Inspect the input's last token; return completion context if it's `/` or `@`. */
function parseCompletion(value: string): ActiveCompletion | null {
  const tokenStart = value.lastIndexOf(' ') + 1;
  const token = value.slice(tokenStart);
  if (token.startsWith('/')) return { kind: '/', tokenStart, query: token.slice(1) };
  if (token.startsWith('@')) return { kind: '@', tokenStart, query: token.slice(1) };
  return null;
}

/**
 * Single-line input (custom TextInput) with a fuzzy autocomplete dropdown:
 * typing `/` suggests slash commands + skills; typing `@` suggests project
 * files via a recursive index, fuzzy-matched against full paths (so `@index`
 * finds `src/.../index.tsx` anywhere). Tab/Enter accepts, ↑/↓ scroll, Esc
 * dismisses. A second Enter (dropdown closed) submits. Multi-line is P2 (PRD 19).
 */
export function PromptArea({ value, onChange, onSubmit, commands, skills }: PromptAreaProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // Project file list (refreshed on mount + whenever '@' is entered, so files
  // created mid-session — e.g. by the agent — appear without a restart).
  const [files, setFiles] = useState<string[]>(() => getFileIndex());

  const active = parseCompletion(value);

  // Reset selection/dismissal when the token target changes.
  useEffect(() => {
    setSelectedIndex(0);
    setDismissed(false);
  }, [active?.kind, active?.query]);

  // Re-walk the project when '@' is entered (files may have changed since mount).
  useEffect(() => {
    if (active?.kind === '@') setFiles(getFileIndex());
  }, [active?.kind]);

  const matches: Suggestion[] =
    active?.kind === '/'
      ? fuzzyFilter([...commands, ...skills], active.query)
      : active?.kind === '@'
        ? fuzzyFilter(files.map((f) => ({ name: f })), active.query)
        : [];

  const showDropdown = !!active && !dismissed && matches.length > 0;

  useInput((inputChar, key) => {
    if (!active || dismissed || matches.length === 0) return;
    if (key.return || key.tab || inputChar === '\t') {
      // Enter or Tab accepts the selection (dropdown is open); a subsequent
      // Enter — with the dropdown closed — submits (handled by TextInput).
      const sel = matches[Math.min(selectedIndex, matches.length - 1)] ?? matches[0];
      if (sel) {
        const completed = (active.kind === '/' ? '/' : '@') + sel.name;
        onChange(value.slice(0, active.tokenStart) + completed + ' ');
      }
    } else if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(matches.length - 1, i + 1));
    } else if (key.escape) {
      setDismissed(true);
    }
  });

  return (
    <Box flexDirection="column">
      {showDropdown && active ? (
        <Autocomplete suggestions={matches} selectedIndex={selectedIndex} prefix={active.kind} />
      ) : null}
      <Box>
        <Text color={theme.green} bold>› </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          ignoreReturn={showDropdown}
          placeholder="Ask ZClaw — type / for commands, @ for files"
        />
      </Box>
    </Box>
  );
}
