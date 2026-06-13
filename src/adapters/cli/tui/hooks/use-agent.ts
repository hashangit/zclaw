/**
 * use-agent — agent run state for the TUI.
 *
 * Drives the existing `Agent.chat(input, signal, approveTool, permissionLevel,
 * onStep)` (US1; US2 swaps `chat()` for `chatStream()`). The loop's `onStep`
 * callback is mapped to feed entries; ESC/Ctrl+C calls `agent.abort()`.
 *
 * `approveTool` runs inside the detached `runAgentLoop` promise, so it must
 * pause and wait for the user to press y/n in `<PermissionPrompt>`. This hook
 * owns that bridge: it stores the pending resolver in a ref (stable across
 * renders, not a stale closure) and the pending prompt's view in state (so
 * the component re-renders). The caller — this hook — creates the promise and
 * GCs stale resolvers on abort, regardless of the underlying call.
 */

import { useCallback, useRef, useState } from 'react';
import { Agent, type ChatResult } from '../../agent.js';
import type { ApproveToolFn, PermissionLevel, StepResult } from '../../../../core/types.js';
import type { FeedApi } from './use-feed.js';

export interface PendingPermissionView {
  toolName: string;
  args: Record<string, unknown>;
}

export interface AgentApi {
  isRunning: boolean;
  pendingPermission: PendingPermissionView | null;
  submit: (input: string) => Promise<void>;
  resolvePermission: (approve: boolean) => void;
  abort: () => void;
}

export interface UseAgentArgs {
  agent: Agent;
  feed: FeedApi;
  permissionLevel?: PermissionLevel;
}

export function useAgent({ agent, feed, permissionLevel }: UseAgentArgs): AgentApi {
  const [isRunning, setIsRunning] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<PendingPermissionView | null>(null);

  // Refs hold the latest values so the stable callbacks never close over
  // stale state (CLAUDE.md §6: long-lived callbacks read through refs).
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const permissionLevelRef = useRef(permissionLevel);
  permissionLevelRef.current = permissionLevel;
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const submit = useCallback(async (input: string): Promise<void> => {
    const trimmed = input.trim();
    if (!trimmed) return;

    setIsRunning(true);
    feedRef.current.appendEntry({ kind: 'user', content: trimmed });

    // Resolve @path file references at the caller, not inside Agent.chat (T022).
    let resolvedInput = trimmed;
    if (trimmed.includes('@')) {
      try {
        const { resolveReferences } = await import('../../../../skills/resolver.js');
        resolvedInput = await resolveReferences(trimmed);
      } catch { /* resolver not available — use raw input */ }
    }

    const signal = agent.createAbortSignal();

    const approveTool: ApproveToolFn = async (call) => {
      setPendingPermission({ toolName: call.name, args: call.args });

      const decision = await new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
      });

      resolverRef.current = null;
      setPendingPermission(null);
      return decision;
    };

    const onStep = (step: StepResult): void => {
      if (step.type === 'text' && step.content != null) {
        feedRef.current.appendEntry({ kind: 'assistant', content: step.content });
      } else if (step.type === 'tool_call' && step.toolCall) {
        const tc = step.toolCall;
        feedRef.current.appendEntry({
          kind: 'tool',
          name: tc.name,
          args: tc.args,
          status: 'ok',
          output: tc.result,
          durationMs: tc.duration,
        });
      }
    };

    try {
      const result: ChatResult = await agent.chat(
        resolvedInput,
        signal,
        approveTool,
        permissionLevelRef.current,
        onStep,
      );
      if (result.finishReason === 'error' && result.error) {
        feedRef.current.appendEntry({ kind: 'error', message: result.error });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      feedRef.current.appendEntry({ kind: 'error', message });
    } finally {
      // Unblock the loop if the agent was aborted mid-approval.
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
      setPendingPermission(null);
      setIsRunning(false);
    }
  }, [agent]);

  const resolvePermission = useCallback((approve: boolean): void => {
    const resolve = resolverRef.current;
    if (resolve) {
      resolverRef.current = null;
      resolve(approve);
    }
  }, []);

  const abort = useCallback((): void => {
    // A pending approval is resolved as a deny so the loop unblocks before abort.
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
      setPendingPermission(null);
    }
    agent.abort();
  }, [agent]);

  return { isRunning, pendingPermission, submit, resolvePermission, abort };
}
