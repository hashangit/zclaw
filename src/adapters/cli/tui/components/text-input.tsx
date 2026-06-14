import { useEffect, useRef, useState } from 'react';
import { Text, useInput } from 'ink';
import { theme } from '../theme.js';

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  /** When true, Enter does not submit — the parent owns it (e.g. autocomplete accept). */
  ignoreReturn?: boolean;
}

/**
 * Minimal controlled text input with cursor control.
 *
 * Why custom: `ink-text-input` doesn't reposition its cursor when the value
 * changes externally (e.g. autocomplete Tab-completion), so the cursor gets
 * stranded mid-string after a completion. This owns the cursor and — for any
 * value change it didn't initiate itself (flagged via `selfUpdate`) — moves the
 * cursor to the end, so Tab-completion lands the cursor after the inserted text.
 *
 * Key handling covers what a chat prompt needs: printable chars, backspace,
 * left/right cursor movement, Enter to submit. Tab/↑/↓/Esc are intentionally
 * NOT handled here so `prompt-area` can use them for autocomplete.
 */
export function TextInput({ value, onChange, onSubmit, placeholder, ignoreReturn }: TextInputProps) {
  const [cursor, setCursor] = useState(value.length);
  const selfUpdate = useRef(false);

  // External value change (completion, post-submit clear, initial query) → cursor to end.
  useEffect(() => {
    if (selfUpdate.current) {
      selfUpdate.current = false;
      return;
    }
    setCursor(value.length);
  }, [value]);

  const at = Math.min(cursor, value.length);

  useInput((inputChar, key) => {
    if (key.return) {
      if (!ignoreReturn) onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      if (at === 0) return;
      selfUpdate.current = true;
      onChange(value.slice(0, at - 1) + value.slice(at));
      setCursor(at - 1);
      return;
    }
    if (key.leftArrow) {
      setCursor(Math.max(0, at - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor(Math.min(value.length, at + 1));
      return;
    }
    if (inputChar && !key.ctrl && !key.meta && inputChar.length === 1 && inputChar >= ' ') {
      selfUpdate.current = true;
      onChange(value.slice(0, at) + inputChar + value.slice(at));
      setCursor(at + 1);
    }
  });

  if (value.length === 0) {
    return <Text color={theme.fgDim}>{placeholder ?? ''}</Text>;
  }
  const before = value.slice(0, at);
  const cur = value.slice(at, at + 1);
  const after = value.slice(at + 1);
  return (
    <Text>
      {before}
      <Text backgroundColor={theme.fg} color={theme.bg}>{cur || ' '}</Text>
      {after}
    </Text>
  );
}
