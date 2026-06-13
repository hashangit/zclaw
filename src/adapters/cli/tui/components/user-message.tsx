import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { UserMessageEntry } from '../types.js';

/** A user input entry — green speaker token + content. */
export function UserMessage({ entry }: { entry: UserMessageEntry }) {
  return (
    <Box>
      <Text color={theme.green} bold>You › </Text>
      <Text color={theme.fg}>{entry.content}</Text>
    </Box>
  );
}
