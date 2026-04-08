/**
 * ZClaw SDK — HTTP response helpers
 *
 * Converts StreamTextResult into HTTP-friendly SSE responses
 * using the Web API Response and ReadableStream interfaces.
 */

import type { StreamTextResult, Usage } from "../../core/types.js";

// ── SSE options ─────────────────────────────────────────────────────────

export interface SSEOptions {
  headers?: Record<string, string>;
}

// ── SSE helpers ─────────────────────────────────────────────────────────

/**
 * Formats a single Server-Sent Events message.
 *
 * @param event  The SSE event name
 * @param data   The payload (will be JSON-serialised)
 * @returns      A string in SSE wire format: `event: ...\ndata: ...\n\n`
 */
export function createSSEMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ── toSSEStream ─────────────────────────────────────────────────────────

/**
 * Converts a StreamTextResult into a SSE-formatted ReadableStream.
 *
 * Emits events:
 *  - `text`      — incremental text deltas
 *  - `tool_call` — tool invocations
 *  - `tool_result` — tool execution results
 *  - `done`      — final usage and finish reason
 *
 * Respects abort signals and closes the stream cleanly.
 */
export function toSSEStream(
  result: StreamTextResult,
  options?: SSEOptions,
): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        // Pipe text deltas
        for await (const delta of result.textStream) {
          controller.enqueue(
            encoder.encode(createSSEMessage("text", { delta })),
          );
        }

        // Pipe steps for tool events
        for await (const step of result.steps) {
          if (step.type === "tool_call" && step.toolCall) {
            controller.enqueue(
              encoder.encode(
                createSSEMessage("tool_call", {
                  callId: step.toolCall.name,
                  name: step.toolCall.name,
                  args: step.toolCall.args,
                }),
              ),
            );

            controller.enqueue(
              encoder.encode(
                createSSEMessage("tool_result", {
                  callId: step.toolCall.name,
                  output: step.toolCall.result,
                  success: true,
                }),
              ),
            );
          }
        }

        // Done event with usage and finish reason
        const [usage, finishReason] = await Promise.all([
          result.usage,
          result.finishReason,
        ]);

        controller.enqueue(
          encoder.encode(
            createSSEMessage("done", {
              usage: {
                totalTokens: usage.totalTokens,
                cost: usage.cost,
              },
              finishReason,
            }),
          ),
        );
      } catch (err) {
        // Abort or stream error — close gracefully
        if (err instanceof Error && err.name !== "AbortError") {
          console.warn("[SDK] SSE stream error:", err);
        }
      } finally {
        controller.close();
      }
    },

    cancel() {
      result.abort();
    },
  });
}

// ── toResponse ──────────────────────────────────────────────────────────

/**
 * Converts a StreamTextResult into a Web API `Response` with an SSE body.
 *
 * Sets standard SSE headers:
 *  - `Content-Type: text/event-stream`
 *  - `Cache-Control: no-cache`
 *  - `Connection: keep-alive`
 *
 * @param result   The streaming result to convert
 * @param options  Optional extra headers to merge into the response
 */
export function toResponse(
  result: StreamTextResult,
  options?: SSEOptions,
): Response {
  const body = toSSEStream(result, options);

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...options?.headers,
  };

  return new Response(body, { headers });
}
