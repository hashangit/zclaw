/**
 * ZClaw SDK — createAgent()
 *
 * A persistent agent with session memory, provider switching, and abort support.
 * Wraps the LLMProvider directly (not the CLI-oriented Agent class) so results
 * are structured rather than printed to the console.
 */

import type { LLMProvider, ProviderMessage, ProviderToolCall } from "../../providers/types.js";
import type {
  AgentCreateOptions,
  AgentResponse,
  CumulativeUsage,
  Message,
  SessionStore,
  SdkAgent,
  StreamTextOptions,
  StreamTextResult,
  StepResult,
  ToolCall,
  Usage,
  ZclawError,
} from "../../core/types.js";
import { getProvider } from "../../core/provider-resolver.js";
import { createHookExecutor } from "../../core/hooks.js";
import { resolveTools } from "./tools.js";
import { getToolDefinitions } from "../../tools/index.js";
import { createSessionStore } from "../../core/session-store.js";
import { runAgentLoop } from "../../core/agent-loop.js";
import type { AgentLoopOptions } from "../../core/agent-loop.js";
import {
  generateId,
  now,
  toZclawError,
} from "../../core/message-convert.js";

// ── Session persistence helpers ──────────────────────────────────────────
// Session store is now imported from ./session.js (createSessionStore)


// ── createAgent ──────────────────────────────────────────────────────────

/**
 * Create a persistent agent with session memory, provider switching,
 * and abort support.
 *
 * @example
 * ```ts
 * const agent = await createAgent({ model: "gpt-4o" });
 * const result = await agent.chat("Hello!");
 * console.log(result.text);
 * ```
 */
export async function createAgent(options?: AgentCreateOptions): Promise<SdkAgent> {
  const opts = options ?? {};

  // Resolve provider
  let { provider: llmProvider, model } = await getProvider(opts.provider);

  // System prompt
  let systemPrompt = opts.systemPrompt ?? "You are a helpful assistant.";

  // Tools
  let toolDefs = opts.tools ? resolveTools(opts.tools) : getToolDefinitions();

  // Hooks
  const hookExecutor = createHookExecutor(opts.hooks);

  // State
  const messages: Message[] = [];
  const sessionId = generateId();
  let abortController = new AbortController();

  // Cumulative usage
  const cumulativeUsage: CumulativeUsage = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
    requestCount: 0,
  };

  // Session store
  let sessionStore: SessionStore | null = null;
  if (opts.persist) {
    if (typeof opts.persist === "string") {
      sessionStore = createSessionStore(opts.persist);
    } else {
      sessionStore = opts.persist;
    }

    // Try loading existing session
    const existing = await sessionStore.load(sessionId);
    if (existing) {
      messages.push(...existing);
    }
  }

  // Add initial system prompt if no messages exist
  if (messages.length === 0 && systemPrompt) {
    messages.push({
      id: generateId(),
      role: "system",
      content: systemPrompt,
      timestamp: now(),
    });
  }

  // ── Helper: persist messages ────────────────────────────────────────────
  async function persistMessages(): Promise<void> {
    if (sessionStore) {
      await sessionStore.save(sessionId, messages);
    }
  }

  // ── chat() ──────────────────────────────────────────────────────────────

  async function chat(userMessage: string): Promise<AgentResponse> {
    // Reset abort controller for this call
    abortController = new AbortController();

    // Add user message
    messages.push({
      id: generateId(),
      role: "user",
      content: userMessage,
      timestamp: now(),
    });

    const maxSteps = opts.maxSteps ?? 10;

    const result = await runAgentLoop({
      provider: llmProvider,
      model: model,
      messages,
      toolDefs,
      systemPrompt: systemPrompt,
      maxSteps,
      hooks: hookExecutor,
      signal: abortController.signal,
      config: opts.config,
    });

    // Update cumulative usage from result
    cumulativeUsage.totalPromptTokens += result.usage.promptTokens;
    cumulativeUsage.totalCompletionTokens += result.usage.completionTokens;
    cumulativeUsage.totalCost += result.usage.cost;
    cumulativeUsage.requestCount += 1;

    // Persist
    await persistMessages();

    // Get the final text
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content);
    const text = lastAssistant?.content ?? "";

    return {
      text,
      toolCalls: result.toolCalls,
      usage: result.usage,
    };
  }

  // ── chatStream() ────────────────────────────────────────────────────────

  async function chatStream(
    message: string,
    streamOptions?: StreamTextOptions,
  ): Promise<StreamTextResult> {
    const streamAbort = new AbortController();
    const mergedHooks = {
      ...opts.hooks,
      ...streamOptions,
    };
    const streamHookExecutor = createHookExecutor(mergedHooks);

    // Add user message
    messages.push({
      id: generateId(),
      role: "user",
      content: message,
      timestamp: now(),
    });

    const maxSteps = streamOptions?.maxSteps ?? opts.maxSteps ?? 10;

    // Collect text and steps for the async iterables
    let textResolve: (text: string) => void;
    let usageResolve: (usage: Usage) => void;
    let finishResolve: (reason: string) => void;

    const fullTextPromise = new Promise<string>((r) => { textResolve = r; });
    const usagePromise = new Promise<Usage>((r) => { usageResolve = r; });
    const finishReasonPromise = new Promise<string>((r) => { finishResolve = r; });

    // Steps queue for async iteration
    const stepQueue: StepResult[] = [];
    let stepQueueResolve: (() => void) | null = null;
    let stepsDone = false;

    function enqueueStep(step: StepResult): void {
      stepQueue.push(step);
      if (stepQueueResolve) {
        stepQueueResolve();
        stepQueueResolve = null;
      }
    }

    // Text queue for async iteration
    const textQueue: string[] = [];
    let textQueueResolve: (() => void) | null = null;
    let textDone = false;

    function enqueueText(delta: string): void {
      textQueue.push(delta);
      if (textQueueResolve) {
        textQueueResolve();
        textQueueResolve = null;
      }
    }

    // Run the loop in the background
    const loopPromise = (async () => {
      try {
        const result = await runAgentLoop({
          provider: llmProvider,
          model: model,
          messages,
          toolDefs,
          systemPrompt: systemPrompt,
          maxSteps,
          hooks: streamHookExecutor,
          signal: streamAbort.signal,
          config: opts.config,
          onStep: (step) => {
            if (streamOptions?.onStep) streamOptions.onStep(step);
            if (step.type === "text" && step.content) {
              if (streamOptions?.onText) streamOptions.onText(step.content);
              enqueueText(step.content);
            }
            if (step.type === "tool_call" && step.toolCall) {
              if (streamOptions?.onToolCall) {
                streamOptions.onToolCall({
                  name: step.toolCall.name,
                  args: step.toolCall.args,
                  callId: step.toolCall.name, // approximate
                });
              }
              if (streamOptions?.onToolResult) {
                streamOptions.onToolResult({
                  callId: step.toolCall.name,
                  output: step.toolCall.result,
                  success: true,
                });
              }
            }
            enqueueStep(step);
          },
        });

        // Update cumulative usage from result
        cumulativeUsage.totalPromptTokens += result.usage.promptTokens;
        cumulativeUsage.totalCompletionTokens += result.usage.completionTokens;
        cumulativeUsage.totalCost += result.usage.cost;
        cumulativeUsage.requestCount += 1;

        const finalText = result.steps
          .filter((s) => s.type === "text")
          .map((s) => s.content ?? "")
          .join("");

        textResolve!(finalText);
        usageResolve!(result.usage);
        finishResolve!(result.finishReason);
      } catch (err) {
        const zclawErr = toZclawError(err, "PROVIDER_ERROR");
        if (streamOptions?.onError) streamOptions.onError(zclawErr);
        textResolve!("");
        usageResolve!({ promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 });
        finishResolve!("error");
      } finally {
        textDone = true;
        stepsDone = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tr = textQueueResolve as any;
        if (tr) tr();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sr = stepQueueResolve as any;
        if (sr) sr();
        await persistMessages();
      }
    })();

    // Async iterable for text
    const textStream: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            while (textQueue.length === 0 && !textDone) {
              await new Promise<void>((r) => { textQueueResolve = r; });
            }
            if (textQueue.length > 0) {
              return { value: textQueue.shift()!, done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };

    // Async iterable for steps
    const stepsStream: AsyncIterable<StepResult> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            while (stepQueue.length === 0 && !stepsDone) {
              await new Promise<void>((r) => { stepQueueResolve = r; });
            }
            if (stepQueue.length > 0) {
              return { value: stepQueue.shift()!, done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };

    // SSE helper
    function toSSEStream(): ReadableStream {
      const encoder = new TextEncoder();
      let sseDone = false;

      return new ReadableStream({
        async pull(controller) {
          const textIter = textStream[Symbol.asyncIterator]();
          const stepIter = stepsStream[Symbol.asyncIterator]();

          // Yield text events
          while (!sseDone) {
            const { value, done } = await Promise.race([
              textIter.next(),
              stepIter.next().then((s) => ({ value: (s as any)?.value?.content ?? "", done: (s as any)?.done ?? false })),
            ]);

            if (done) {
              sseDone = true;
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }

            if (value) {
              const event = JSON.stringify({ type: "text", content: value });
              controller.enqueue(encoder.encode(`data: ${event}\n\n`));
            }
          }
        },
        cancel() {
          sseDone = true;
        },
      });
    }

    // Response helper for HTTP servers
    function toResponse(): Response {
      return new Response(toSSEStream(), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    return {
      textStream,
      steps: stepsStream,
      fullText: fullTextPromise,
      usage: usagePromise,
      finishReason: finishReasonPromise,
      abort: () => streamAbort.abort(),
      toResponse,
      toSSEStream,
    };
  }

  // ── switchProvider() ────────────────────────────────────────────────────

  async function switchProvider(providerType: string, newModel?: string): Promise<void> {
    const result = await getProvider(providerType as any);
    llmProvider = result.provider;
    model = newModel ?? result.model;
  }

  // ── setSystemPrompt() ───────────────────────────────────────────────────

  function setSystemPrompt(prompt: string): void {
    systemPrompt = prompt;
    // Replace existing system message or add new one
    const sysIdx = messages.findIndex((m) => m.role === "system");
    if (sysIdx >= 0) {
      messages[sysIdx] = {
        id: messages[sysIdx].id,
        role: "system",
        content: prompt,
        timestamp: now(),
      };
    } else {
      messages.unshift({
        id: generateId(),
        role: "system",
        content: prompt,
        timestamp: now(),
      });
    }
  }

  // ── setTools() ──────────────────────────────────────────────────────────

  function setTools(tools: string[]): void {
    toolDefs = resolveTools(tools);
  }

  // ── abort() ─────────────────────────────────────────────────────────────

  function abort(): void {
    abortController.abort();
  }

  // ── clear() ─────────────────────────────────────────────────────────────

  function clear(): void {
    messages.length = 0;
    if (systemPrompt) {
      messages.push({
        id: generateId(),
        role: "system",
        content: systemPrompt,
        timestamp: now(),
      });
    }
  }

  // ── getHistory() ────────────────────────────────────────────────────────

  function getHistory(): Message[] {
    return [...messages];
  }

  // ── getUsage() ──────────────────────────────────────────────────────────

  function getUsage(): CumulativeUsage {
    return { ...cumulativeUsage };
  }

  // ── Return the SdkAgent interface ───────────────────────────────────────

  return {
    chat,
    chatStream,
    switchProvider,
    setSystemPrompt,
    setTools,
    abort,
    clear,
    getHistory,
    getUsage,
  };
}
