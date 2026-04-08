/**
 * ZClaw SDK — React hooks for building chat UIs
 *
 * Provides `useChat`, a React hook that manages messages, input, loading state,
 * and SSE streaming against a ZClaw-compatible chat endpoint.
 *
 * Only imports React *types* at compile time — React itself must be available
 * in the consumer's bundle at runtime.
 */

import type { FormEvent, useCallback, useRef, useState } from "react";
import type { Message, ToolCall } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Guards — detect React at runtime without a hard import
// ---------------------------------------------------------------------------

type ReactModule = {
  useState: typeof useState;
  useCallback: typeof useCallback;
  useRef: typeof useRef;
};

let _react: ReactModule | null = null;
let _reactPromise: Promise<ReactModule> | null = null;

async function loadReact(): Promise<ReactModule> {
  if (_react) return _react;
  if (_reactPromise) return _reactPromise;

  _reactPromise = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("react") as ReactModule;
      if (!mod.useState || !mod.useCallback || !mod.useRef) {
        throw new Error("Invalid module");
      }
      _react = mod;
      return mod;
    } catch {
      throw new Error(
        "ZClaw: React is required to use the `useChat` hook, but it could " +
          "not be found. Make sure `react` (>= 18) is installed in your project.",
      );
    }
  })();

  return _reactPromise;
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _idCounter = 0;

function generateId(): string {
  _idCounter += 1;
  try {
    return crypto.randomUUID();
  } catch {
    return `msg-${Date.now()}-${_idCounter}`;
  }
}

// ---------------------------------------------------------------------------
// SSE parser
// ---------------------------------------------------------------------------

interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Parses a raw SSE text chunk into discrete events.
 * Handles partial lines across chunk boundaries via the `buffer` parameter.
 */
function parseSSEChunks(
  chunk: string,
  buffer: string,
): { events: SSEEvent[]; buffer: string } {
  const events: SSEEvent[] = [];
  const lines = (buffer + chunk).split("\n");

  // The last element might be an incomplete line — carry it forward.
  const newBuffer = lines.pop() ?? "";

  let currentEvent = "";
  let currentData = "";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      currentData = line.slice(5).trim();
    } else if (line === "") {
      // Blank line signals end of an SSE message.
      if (currentEvent || currentData) {
        events.push({ event: currentEvent, data: currentData });
        currentEvent = "";
        currentData = "";
      }
    }
  }

  return { events, buffer: newBuffer };
}

// ---------------------------------------------------------------------------
// Hook option / return types
// ---------------------------------------------------------------------------

export interface UseChatOptions {
  /** API endpoint to POST to. Default: `"/api/chat"` */
  api?: string;
  /** Extra HTTP headers sent with every request. */
  headers?: Record<string, string>;
  /** Extra JSON body fields merged into every request. */
  body?: Record<string, unknown>;
  /** Called when a request-level error occurs. */
  onError?: (error: Error) => void;
  /** Called once the assistant finishes a complete response. */
  onFinish?: (message: Message) => void;
  /** Pre-populate the conversation. */
  initialMessages?: Message[];
}

export interface UseChatReturn {
  messages: Message[];
  input: string;
  setInput: (input: string) => void;
  handleSubmit: (e?: FormEvent) => void;
  isLoading: boolean;
  error: Error | null;
  stop: () => void;
  reload: () => void;
  setMessages: (messages: Message[]) => void;
  append: (message: Message) => void;
  toolCalls: ToolCall[];
}

// ---------------------------------------------------------------------------
// useChat hook (async factory — works with React 18 & 19)
// ---------------------------------------------------------------------------

/**
 * Creates and returns a `useChat` hook bound to a lazily-loaded React instance.
 *
 * Because this SDK does not bundle React, the hook is created asynchronously
 * so we can verify React is available before accessing hook APIs.
 *
 * Typical usage:
 * ```ts
 * // src/hooks/useChat.ts
 * import { createUseChat } from "@zclaw/sdk/react";
 * export const useChat = await createUseChat();
 * ```
 *
 * Alternatively, for non-top-level initialisation:
 * ```ts
 * const useChat = await createUseChat();
 * ```
 */
export async function createUseChat(): Promise<
  (options?: UseChatOptions) => UseChatReturn
> {
  const R = await loadReact();

  return function useChat(options: UseChatOptions = {}): UseChatReturn {
    const {
      api = "/api/chat",
      headers,
      body: extraBody,
      onError,
      onFinish,
      initialMessages = [],
    } = options;

    // -- State ----------------------------------------------------------------

    const [messages, setMessages] = R.useState<Message[]>(initialMessages);
    const [input, setInput] = R.useState("");
    const [isLoading, setIsLoading] = R.useState(false);
    const [error, setError] = R.useState<Error | null>(null);
    const [toolCalls, setToolCalls] = R.useState<ToolCall[]>([]);

    // -- Refs -----------------------------------------------------------------

    const abortControllerRef = R.useRef<AbortController | null>(null);
    const sseBufferRef = R.useRef("");
    const onFinishRef = R.useRef(onFinish);
    const onErrorRef = R.useRef(onError);

    // Keep callback refs up-to-date without re-creating the streaming logic.
    onFinishRef.current = onFinish;
    onErrorRef.current = onError;

    // -- Streaming logic ------------------------------------------------------

    const processStream = R.useCallback(
      async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
        const decoder = new TextDecoder();
        sseBufferRef.current = "";

        let assistantId: string | null = null;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            const { events, buffer } = parseSSEChunks(text, sseBufferRef.current);
            sseBufferRef.current = buffer;

            for (const evt of events) {
              switch (evt.event) {
                case "text": {
                  const delta = evt.data;
                  setMessages((prev: Message[]) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === "assistant") {
                      updated[updated.length - 1] = {
                        ...last,
                        content: last.content + delta,
                      };
                    } else {
                      // First text chunk — create the assistant message.
                      assistantId = generateId();
                      updated.push({
                        id: assistantId,
                        role: "assistant",
                        content: delta,
                        timestamp: Date.now(),
                      });
                    }
                    return updated;
                  });
                  break;
                }

                case "tool_call": {
                  try {
                    const call: ToolCall = JSON.parse(evt.data);
                    setToolCalls((prev) => [...prev, call]);
                    setMessages((prev: Message[]) => {
                      const updated = [...prev];
                      const last = updated[updated.length - 1];
                      if (last && last.role === "assistant") {
                        updated[updated.length - 1] = {
                          ...last,
                          toolCalls: [...(last.toolCalls ?? []), call],
                        };
                      }
                      return updated;
                    });
                  } catch {
                    // Ignore malformed tool_call data.
                  }
                  break;
                }

                case "tool_result": {
                  try {
                    const { id, result } = JSON.parse(evt.data) as {
                      id: string;
                      result: string;
                    };
                    setToolCalls((prev) =>
                      prev.map((tc) =>
                        tc.id === id ? { ...tc, result } : tc,
                      ),
                    );
                    setMessages((prev: Message[]) =>
                      prev.map((msg) => {
                        if (msg.role !== "assistant" || !msg.toolCalls) return msg;
                        return {
                          ...msg,
                          toolCalls: msg.toolCalls.map((tc) =>
                            tc.id === id ? { ...tc, result } : tc,
                          ),
                        };
                      }),
                    );
                  } catch {
                    // Ignore malformed tool_result data.
                  }
                  break;
                }

                case "done": {
                  // The server says it's done. We'll let the read loop
                  // terminate naturally via `done: true`.
                  break;
                }

                default:
                  // Ignore unknown SSE events.
                  break;
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      },
      [],
    );

    const sendRequest = R.useCallback(
      async (userMessage: Message) => {
        // Cancel any in-flight request.
        abortControllerRef.current?.abort();

        const controller = new AbortController();
        abortControllerRef.current = controller;

        setMessages((prev: Message[]) => [...prev, userMessage]);
        setToolCalls([]);
        setIsLoading(true);
        setError(null);

        // Snapshot current messages *including* the new one for the payload.
        const messagesForRequest = [...messages, userMessage];

        try {
          const response = await fetch(api, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            body: JSON.stringify({
              messages: messagesForRequest,
              ...extraBody,
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            throw new Error(
              `ZClaw API error (${response.status}): ${errorText}`,
            );
          }

          const body = response.body;
          if (!body) {
            throw new Error("ZClaw API returned an empty response body.");
          }

          await processStream(body.getReader());

          // After streaming completes, retrieve the final assistant message
          // for the onFinish callback. We read from the latest state by
          // using a ref-based approach — grab the last assistant message.
          setMessages((prev: Message[]) => {
            const lastAssistant = [...prev]
              .reverse()
              .find((m) => m.role === "assistant");
            if (lastAssistant && onFinishRef.current) {
              onFinishRef.current(lastAssistant);
            }
            return prev; // Don't mutate — just a side-effect for onFinish.
          });
        } catch (err: unknown) {
          // AbortError is intentional (user called stop()), don't treat as error.
          if (err instanceof DOMException && err.name === "AbortError") {
            return;
          }

          const error =
            err instanceof Error
              ? err
              : new Error(typeof err === "string" ? err : "Unknown error");

          setError(error);
          onErrorRef.current?.(error);
        } finally {
          setIsLoading(false);
          abortControllerRef.current = null;
        }
      },
      [api, headers, extraBody, messages, processStream],
    );

    // -- Public API -----------------------------------------------------------

    const handleSubmit = R.useCallback(
      (e?: FormEvent) => {
        e?.preventDefault();

        const trimmed = input.trim();
        if (!trimmed || isLoading) return;

        const userMessage: Message = {
          id: generateId(),
          role: "user",
          content: trimmed,
          timestamp: Date.now(),
        };

        setInput("");
        sendRequest(userMessage);
      },
      [input, isLoading, sendRequest],
    );

    const stop = R.useCallback(() => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }, []);

    const reload = R.useCallback(() => {
      // Find the last user message and resend it.
      const lastUserIndex = [...messages]
        .reverse()
        .findIndex((m) => m.role === "user");

      if (lastUserIndex === -1) return;

      const actualIndex = messages.length - 1 - lastUserIndex;
      const lastUserMessage = messages[actualIndex];

      // Remove all messages from that index onward (trim the conversation).
      const trimmed = messages.slice(0, actualIndex);
      setMessages(trimmed);
      setToolCalls([]);

      // Resend the last user message on the trimmed conversation.
      // We reassign sendRequest's closure manually.
      const userMessage: Message = {
        ...lastUserMessage,
        id: generateId(),
        timestamp: Date.now(),
      };

      // We need to trigger sendRequest but with the trimmed messages.
      // Easiest: directly call fetch here with trimmed + user message.
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const allMessages = [...trimmed, userMessage];
      setMessages(allMessages);
      setIsLoading(true);
      setError(null);

      (async () => {
        try {
          const response = await fetch(api, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            body: JSON.stringify({
              messages: allMessages,
              ...extraBody,
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            throw new Error(
              `ZClaw API error (${response.status}): ${errorText}`,
            );
          }

          const body = response.body;
          if (!body) {
            throw new Error("ZClaw API returned an empty response body.");
          }

          await processStream(body.getReader());

          setMessages((prev: Message[]) => {
            const lastAssistant = [...prev]
              .reverse()
              .find((m) => m.role === "assistant");
            if (lastAssistant && onFinishRef.current) {
              onFinishRef.current(lastAssistant);
            }
            return prev;
          });
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          const error =
            err instanceof Error
              ? err
              : new Error(typeof err === "string" ? err : "Unknown error");
          setError(error);
          onErrorRef.current?.(error);
        } finally {
          setIsLoading(false);
          abortControllerRef.current = null;
        }
      })();
    }, [api, headers, extraBody, messages, processStream]);

    const append = R.useCallback(
      (message: Message) => {
        const msg: Message = {
          ...message,
          id: message.id ?? generateId(),
          timestamp: message.timestamp ?? Date.now(),
        };
        setMessages((prev: Message[]) => [...prev, msg]);
      },
      [],
    );

    // -- Cleanup on unmount ---------------------------------------------------

    R.useCallback(() => {
      return () => {
        abortControllerRef.current?.abort();
      };
    }, [])();

    return {
      messages,
      input,
      setInput,
      handleSubmit,
      isLoading,
      error,
      stop,
      reload,
      setMessages,
      append,
      toolCalls,
    };
  };
}

// ---------------------------------------------------------------------------
// Default export — a pre-created useChat hook (lazy-initialised).
//
// Most consumers should use `createUseChat()` directly for top-level await
// or dynamic import. This default is provided as a convenience for consumers
// who use React.lazy-compatible patterns or their own async bootstrap.
// ---------------------------------------------------------------------------

export { createUseChat as default };
