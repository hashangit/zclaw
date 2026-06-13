import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { theme } from '../theme.js';

interface PromptAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

/**
 * Single-line input that submits on Enter (ink-text-input). Multi-line editing
 * (Shift+Enter / soft wrap) is a P2 enhancement (PRD item 19); US1 ships the
 * submit-on-Enter chat prompt. Parent owns the value so it can clear on submit.
 */
export function PromptArea({ value, onChange, onSubmit }: PromptAreaProps) {
  return (
    <Box>
      <Text color={theme.green} bold>› </Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder="Ask ZClaw (Enter to send)"
      />
    </Box>
  );
}
