/** ZClaw Core — Message conversion helpers */

import type { Message, ToolCall, ZclawError } from "./types.js";
import type { ProviderMessage, ProviderToolCall } from "../providers/types.js";

/**
 * Generate a unique identifier using crypto.randomUUID().
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get the current Unix timestamp in milliseconds.
 */
export function now(): number {
  return Date.now();
}

/**
 * Rough token estimate: ~4 characters per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Create a ZclawError from a plain Error or unknown value.
 */
export function toZclawError(err: unknown, code: string): ZclawError {
  const error = err instanceof Error ? err : new Error(String(err));
  const zclawErr = error as ZclawError;
  zclawErr.code = code;
  zclawErr.retryable = code === "PROVIDER_ERROR";
  return zclawErr;
}

/**
 * Convert an SDK Message to ProviderMessage format.
 */
export function messageToProviderMessage(msg: Message): ProviderMessage {
  const pm: ProviderMessage = { role: msg.role, content: msg.content };
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    pm.tool_calls = msg.toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: JSON.stringify(tc.arguments),
    }));
  }
  if (msg.toolCallId) {
    pm.tool_call_id = msg.toolCallId;
  }
  return pm;
}

/**
 * Convert a ProviderToolCall to SDK ToolCall format.
 */
export function providerToolCallToToolCall(tc: ProviderToolCall): ToolCall {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(tc.arguments);
  } catch {
    args = { raw: tc.arguments };
  }
  return {
    id: tc.id,
    name: tc.name,
    arguments: args,
  };
}
