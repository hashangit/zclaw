/**
 * ZClaw SDK — Public entry point
 *
 * Exports `generateText`, `streamText`, `createAgent`, and all public types,
 * tool factories, provider helpers, and skill utilities.
 */

import type { LLMProvider, ProviderMessage, ProviderToolCall } from "../../providers/types.js";
import type {
  GenerateTextOptions,
  GenerateTextResult,
  StreamTextOptions,
  StreamTextResult,
  Message,
  StepResult,
  ToolCall,
  Usage,
  ZclawError,
} from "../../core/types.js";
import { getProvider } from "../../core/provider-resolver.js";
import { createHookExecutor } from "../../core/hooks.js";
import { resolveTools } from "./tools.js";
import { getToolDefinitions } from "../../tools/index.js";
import { runAgentLoop } from "../../core/agent-loop.js";
import {
  generateId,
  now,
  toZclawError,
} from "../../core/message-convert.js";

// ── Re-exports ───────────────────────────────────────────────────────────

export { createAgent } from "./agent.js";
export { tool, CORE_TOOLS, COMM_TOOLS, ADVANCED_TOOLS, ALL_TOOLS } from "./tools.js";
export { configureProviders, provider } from "../../core/provider-resolver.js";
export type { SSEOptions } from "./http.js";

// Re-export all types
export type {
  ProviderType,
  MultiProviderConfig,
  Message,
  ToolCall,
  StepResult,
  Usage,
  CumulativeUsage,
  UserToolDefinition,
  ToolContext,
  ToolResult,
  Hooks,
  GenerateTextOptions,
  GenerateTextResult,
  StreamTextOptions,
  StreamTextResult,
  AgentCreateOptions,
  SdkAgent,
  AgentResponse,
  SessionStore,
  SessionData,
  SkillMetadata,
  ZclawError,
} from "../../core/types.js";

// ── generateText ─────────────────────────────────────────────────────────

/**
 * Run a one-shot agent loop and return the structured result.
 *
 * Creates fresh state for each call (stateless). Handles tool calls
 * automatically until the provider returns no more tool calls or
 * `maxSteps` is reached.
 *
 * @example
 * ```ts
 * const result = await generateText("What is the weather in SF?", {
 *   tools: ["web_search"],
 *   maxSteps: 5,
 * });
 * console.log(result.text);
 * ```
 */
export async function generateText(
  prompt: string,
  options?: GenerateTextOptions,
): Promise<GenerateTextResult> {
  const opts = options ?? {};
  const maxSteps = opts.maxSteps ?? 10;

  // Resolve provider
  const { provider: llmProvider, model } = await getProvider(opts.provider);

  // Resolve tools
  const toolDefs = opts.tools ? resolveTools(opts.tools) : getToolDefinitions();

  // Hooks
  const hooks = createHookExecutor(opts.hooks);

  // Build message list
  const messages: Message[] = [];
  messages.push({
    id: generateId(),
    role: "user" as const,
    content: prompt,
    timestamp: now(),
  });

  // Run the agent loop
  const result = await runAgentLoop({
    provider: llmProvider,
    model,
    messages,
    toolDefs,
    systemPrompt: opts.systemPrompt,
    maxSteps,
    hooks,
    signal: opts.signal,
    config: opts.config,
  });

  // Get the final text
  const lastAssistant = [...result.messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content);
  const text = lastAssistant?.content ?? "";

  const genResult: GenerateTextResult = {
    text,
    steps: result.steps,
    toolCalls: result.toolCalls,
    usage: result.usage,
    finishReason: result.finishReason as GenerateTextResult["finishReason"],
    messages: result.messages,
  };

  await hooks.onFinish(genResult);
  return genResult;
}

// ── streamText ───────────────────────────────────────────────────────────

/**
 * Run a one-shot agent loop with streaming callbacks.
 *
 * Returns AsyncIterables for text and steps, plus `toResponse()` and
 * `toSSEStream()` for HTTP server integration.
 *
 * Note: The current provider.chat() API returns full responses (not deltas),
 * so onText receives the complete text at once. Future versions will integrate
 * with provider-level streaming.
 *
 * @example
 * ```ts
 * const stream = await streamText("Explain quantum computing", {
 *   onText: (delta) => process.stdout.write(delta),
 * });
 * const finalText = await stream.fullText;
 * ```
 */
export async function streamText(
  prompt: string,
  options?: StreamTextOptions,
): Promise<StreamTextResult> {
  const opts = options ?? {};
  const maxSteps = opts.maxSteps ?? 10;

  // Resolve provider
  const { provider: llmProvider, model } = await getProvider(opts.provider);

  // Resolve tools
  const toolDefs = opts.tools ? resolveTools(opts.tools) : getToolDefinitions();

  // Hooks — merge stream-level callbacks with any base hooks
  const mergedHooks = { ...opts.hooks };
  const hooks = createHookExecutor(mergedHooks);

  // Build message list
  const messages: Message[] = [];
  messages.push({
    id: generateId(),
    role: "user",
    content: prompt,
    timestamp: now(),
  });

  // Abort controller
  const abortController = new AbortController();

  // Promises for results
  let textResolve!: (text: string) => void;
  let usageResolve!: (usage: Usage) => void;
  let finishResolve!: (reason: string) => void;
  const fullTextPromise = new Promise<string>((r) => { textResolve = r; });
  const usagePromise = new Promise<Usage>((r) => { usageResolve = r; });
  const finishReasonPromise = new Promise<string>((r) => { finishResolve = r; });

  // Queues for async iterables
  const textQueue: string[] = [];
  const stepQueue: StepResult[] = [];
  let textDone = false;
  let stepsDone = false;
  let textQueueResolver: any = null;
  let stepQueueResolver: any = null;

  function enqueueText(delta: string): void {
    textQueue.push(delta);
    if (textQueueResolver) {
      textQueueResolver();
      textQueueResolver = null;
    }
  }

  function enqueueStep(step: StepResult): void {
    stepQueue.push(step);
    if (stepQueueResolver) {
      stepQueueResolver();
      stepQueueResolver = null;
    }
  }

  // Run loop in background
  const loopPromise = (async () => {
    try {
      const result = await runAgentLoop({
        provider: llmProvider,
        model,
        messages,
        toolDefs,
        systemPrompt: opts.systemPrompt,
        maxSteps,
        hooks,
        signal: abortController.signal,
        config: opts.config,
        onStep: (step) => {
          if (opts.onStep) opts.onStep(step);
          if (step.type === "text" && step.content) {
            if (opts.onText) opts.onText(step.content);
            enqueueText(step.content);
          }
          if (step.type === "tool_call" && step.toolCall) {
            if (opts.onToolCall) {
              opts.onToolCall({ name: step.toolCall.name, args: step.toolCall.args, callId: step.toolCall.name });
            }
            if (opts.onToolResult) {
              opts.onToolResult({ callId: step.toolCall.name, output: step.toolCall.result, success: true });
            }
          }
          enqueueStep(step);
        },
      });

      textResolve!(textQueue.join(""));
      usageResolve!(result.usage);
      finishResolve!(result.finishReason);
    } catch (err) {
      const zclawErr = toZclawError(err, "PROVIDER_ERROR");
      if (opts.onError) opts.onError(zclawErr);
      textResolve!("");
      usageResolve!({ promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 });
      finishResolve!("error");
    } finally {
      textDone = true;
      stepsDone = true;
      // Trigger any pending queue resolvers
      if (textQueueResolver !== null) {
        textQueueResolver();
        textQueueResolver = null;
      }
      if (stepQueueResolver !== null) {
        stepQueueResolver();
        stepQueueResolver = null;
      }
    }
  })();

  // Async iterable for text
  const textStream: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          while (textQueue.length === 0 && !textDone) {
            await new Promise<void>((r) => { textQueueResolver = r; });
          }
          if (textQueue.length > 0) {
            return { value: textQueue.shift()!, done: false };
          }
          return { value: undefined, done: true } as any;
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
            await new Promise<void>((r) => { stepQueueResolver = r; });
          }
          if (stepQueue.length > 0) {
            return { value: stepQueue.shift()!, done: false };
          }
          return { value: undefined, done: true } as any;
        },
      };
    },
  };

  // SSE stream helper
  function toSSEStream(): ReadableStream {
    const encoder = new TextEncoder();

    return new ReadableStream({
      async start(controller) {
        // Wait for the loop to complete
        await loopPromise;

        // Emit all text chunks as SSE events
        for (const chunk of textQueue) {
          const event = JSON.stringify({ type: "text", content: chunk });
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        }

        // Emit all steps as SSE events
        for (const step of stepQueue) {
          const event = JSON.stringify({ type: "step", data: step });
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        }

        // Emit final usage
        const usageVal = await usagePromise;
        const usageEvent = JSON.stringify({ type: "usage", data: usageVal });
        controller.enqueue(encoder.encode(`data: ${usageEvent}\n\n`));

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
      cancel() {
        abortController.abort();
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
    abort: () => abortController.abort(),
    toResponse,
    toSSEStream,
  };
}
