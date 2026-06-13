import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { ToolCallEntry } from '../types.js';

const STATUS_GLYPH: Record<ToolCallEntry['status'], string> = {
  running: '⏳',
  ok: '✓',
  fail: '✗',
};

/** One-line preview of a tool's args — `command` shown verbatim, else JSON. */
function formatArgs(args: Record<string, unknown>): string {
  if (typeof args.command === 'string' && args.command.length > 0) return args.command;
  const json = JSON.stringify(args);
  return json === '{}' ? '' : json;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)} … (${text.length - max} more chars)`;
}

/**
 * Bordered tool-execution block: status glyph + name/args header, then the
 * output buffer. Basic rendering here — expand/collapse and live stdout land
 * in US2 (T028).
 */
export function ToolCallBlock({ entry }: { entry: ToolCallEntry }) {
  const glyph = STATUS_GLYPH[entry.status];
  const glyphColor =
    entry.status === 'fail' ? theme.red : entry.status === 'running' ? theme.yellow : theme.green;
  const argsPreview = formatArgs(entry.args);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.fgGutter} paddingLeft={1} paddingRight={1}>
      <Box>
        <Text color={glyphColor} bold>{glyph} </Text>
        <Text color={theme.purple} bold>{entry.name}</Text>
        {argsPreview ? <Text color={theme.fgDim}> {truncate(argsPreview, 120)}</Text> : null}
        {entry.durationMs != null ? (
          <Text color={theme.fgDim}> ({entry.durationMs}ms)</Text>
        ) : null}
      </Box>
      {entry.output ? (
        <Text color={theme.fgDim}>{truncate(entry.output, 2000)}</Text>
      ) : null}
    </Box>
  );
}
