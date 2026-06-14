import { Box, Text } from 'ink';
import { useTheme } from '../hooks/use-theme.js';
import { Markdown } from './markdown.js';
import type { ToolCallEntry } from '../types.js';

const STATUS_GLYPH: Record<ToolCallEntry['status'], string> = {
  running: '⏳',
  ok: '✓',
  fail: '✗',
};

/** Tools whose output is markdown-formatted (render via Markdown component). */
const MARKDOWN_TOOLS = new Set(['web_search', 'read_website', 'optimize_prompt']);

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
 * output buffer. Collapsed by default (truncated output + hint); `expanded`
 * shows the full output. Ctrl+O (handled in app.tsx) toggles expand-all and
 * bumps the `<Static>` key so this re-renders.
 */
export function ToolCallBlock({ entry, expanded }: { entry: ToolCallEntry; expanded: boolean }) {
  const theme = useTheme();
  const glyph = STATUS_GLYPH[entry.status];
  const glyphColor =
    entry.status === 'fail' ? theme.red : entry.status === 'running' ? theme.yellow : theme.green;
  const argsPreview = formatArgs(entry.args);

  const output = entry.output ?? '';
  const isMarkdown = MARKDOWN_TOOLS.has(entry.name);
  const limit = expanded ? 50000 : isMarkdown ? 1000 : 400;
  const shown = truncate(output, limit);
  const hasMore = output.length > limit;

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
      {output ? (
        MARKDOWN_TOOLS.has(entry.name) ? (
          <Markdown content={shown} />
        ) : (
          <Text color={theme.fgDim}>{shown}</Text>
        )
      ) : null}
      {hasMore ? (
        <Text color={theme.fgDim}> … {output.length - limit} more chars (Ctrl+O to expand)</Text>
      ) : output && expanded ? (
        <Text color={theme.fgDim}> (Ctrl+O to collapse)</Text>
      ) : null}
    </Box>
  );
}
