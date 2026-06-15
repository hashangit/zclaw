/**
 * feed-serializer — rebuild the TUI feed from persisted messages.
 *
 * When a session is resumed, its `Message[]` history must be projected back
 * into the `FeedEntry` union the feed renders. During a live run, entries are
 * built imperatively from `StepResult` callbacks (see use-agent.ts); on replay
 * there is no loop, so this pure function does the equivalent mapping in one
 * pass.
 *
 * Tool results are NOT stored on the assistant message's toolCalls[].result —
 * runAgentLoop emits them as separate role:"tool" messages linked by
 * toolCallId (agent-loop.ts:459). This serializer joins the two so replayed
 * tool blocks show their output. Tool durationMs is not persisted, so
 * replayed blocks render without duration (cosmetic only).
 */

import type { Message } from '../../../core/types.js';
import type { FeedEntryInput } from './types.js';

export function messagesToFeedEntries(messages: Message[]): FeedEntryInput[] {
  // Index tool results by toolCallId for O(1) lookup when rendering tool calls.
  const toolResults = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'tool' && m.toolCallId) {
      toolResults.set(m.toolCallId, m.content);
    }
  }

  const entries: FeedEntryInput[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      entries.push({ kind: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      if (m.content) entries.push({ kind: 'assistant', content: m.content });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          const result = tc.result ?? toolResults.get(tc.id);
          entries.push({
            kind: 'tool',
            name: tc.name,
            args: tc.arguments,
            status: result != null ? 'ok' : 'fail',
            output: result,
          });
        }
      }
    }
    // role: 'tool' messages are consumed above via the toolResults index —
    // they are provider-facing duplicates, not feed entries.
  }
  return entries;
}
