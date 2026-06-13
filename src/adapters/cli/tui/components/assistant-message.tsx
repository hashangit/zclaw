import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { AssistantMessageEntry } from '../types.js';

/** An LLM text response entry — blue speaker token + content. */
export function AssistantMessage({ entry }: { entry: AssistantMessageEntry }) {
  return (
    <Box>
      <Text color={theme.blue} bold>ZClaw › </Text>
      <Text color={theme.fg}>{entry.content}</Text>
    </Box>
  );
}
