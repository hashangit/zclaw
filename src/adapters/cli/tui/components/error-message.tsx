import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { ErrorEntry } from '../types.js';

/** An error entry — red glyph + message. */
export function ErrorMessage({ entry }: { entry: ErrorEntry }) {
  return (
    <Box>
      <Text color={theme.red} bold>✗ </Text>
      <Text color={theme.red}>{entry.message}</Text>
    </Box>
  );
}
