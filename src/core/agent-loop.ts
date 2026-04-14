/** ZClaw Core — THE Agent Loop (single implementation) */

import type { Message, StepResult, ToolCall, Usage, ZclawError } from "./types.js";
import type { LLMProvider, ProviderMessage, ProviderToolCall } from "../providers/types.js";
import type { ToolDefinition } from "../tools/interface.js";
import { generateId, now, estimateTokens, toZclawError, messageToProviderMessage, providerToolCallToToolCall } from "./message-convert.js";
import { executeTool } from "./tool-executor.js";
import type { HookExecutor } from "./hooks.js";
import type { Middleware, PipelineContext } from "./middleware.js";
import { compose } from "./middleware.js";

// ProviderFactory for per-skill model switching
export interface ProviderFactory {
  resolve(skillName?: string): Promise<{ provider: LLMProvider; model: string }>;
  restore(): void;
}

export interface AgentLoopOptions {
  provider: LLMProvider;
  model: string;
  messages: Message[];
  toolDefs: ToolDefinition[];
  systemPrompt?: string;          // Prepended as system message if provided
  skillCatalog?: string;          // Appended to existing system message
  maxSteps: number;
  hooks: HookExecutor;
  signal?: AbortSignal;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  onStep?: (step: StepResult) => void;
  providerFactory?: ProviderFactory;
  middleware?: Middleware[];
}

export interface AgentLoopError {
  message: string;
  code: string;          // "PROVIDER_ERROR" | "TOOL_FAILED" | "MAX_STEPS" | "ABORTED"
  retryable: boolean;
  provider?: string;
  tool?: string;
}

export interface AgentLoopResult {
  messages: Message[];
  steps: StepResult[];
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: "stop" | "max_steps" | "error" | "aborted";
  error?: AgentLoopError;
}

/**
 * Run the ZClaw agent loop - THE single implementation.
 *
 * This is the canonical agent loop that all other entry points (createAgent,
 * generateText, streamText, CLI Agent) will delegate to. It handles:
 *
 * - Multi-step reasoning with tool execution
 * - Provider resolution (including per-skill switching via providerFactory)
 * - System prompt injection
 * - Abort signal handling
 * - Hook execution
 * - Usage estimation
 * - Structured error reporting
 * - Middleware pipeline (when provided)
 *
 * @param options - Agent loop configuration
 * @returns AgentLoopResult with messages, steps, tool calls, usage, and finish reason
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    provider,
    model,
    messages,
    toolDefs,
    systemPrompt,
    skillCatalog,
    maxSteps,
    hooks,
    signal,
    config = {},
    metadata = {},
    onStep,
    providerFactory,
    middleware,
  } = options;

  // ── No middleware: run loop directly (backward compatible) ────────────
  if (!middleware || middleware.length === 0) {
    return executeLoop(options);
  }

  // ── With middleware: wrap loop in pipeline ────────────────────────────
  const ctx: PipelineContext = {
    requestId: generateId(),
    messages,
    provider,
    model,
    toolDefs,
    metadata,
    signal,
    startedAt: Date.now(),
  };

  try {
    await compose(middleware)(ctx, async () => {
      const result = await executeLoop(options);
      ctx.result = {
        messages: result.messages,
        steps: result.steps,
        toolCalls: result.toolCalls,
        usage: result.usage,
        finishReason: result.finishReason,
      };
    });

    // ctx.result is populated by the final handler
    if (ctx.result) {
      return {
        messages: ctx.result.messages,
        steps: ctx.result.steps,
        toolCalls: ctx.result.toolCalls,
        usage: ctx.result.usage,
        finishReason: ctx.result.finishReason as AgentLoopResult["finishReason"],
      };
    }

    // Middleware completed without populating result (shouldn't happen)
    return {
      messages,
      steps: [],
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
      finishReason: "error",
      error: {
        message: "Middleware completed without producing a result",
        code: "MIDDLEWARE_ERROR",
        retryable: false,
      },
    };
  } catch (err) {
    // Middleware threw (e.g., auth rejection, rate limit)
    return {
      messages,
      steps: [],
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
      finishReason: "error",
      error: {
        message: err instanceof Error ? err.message : String(err),
        code: (err as any)?.code ?? "MIDDLEWARE_ERROR",
        retryable: false,
      },
    };
  }
}

/**
 * Execute the core agent loop (no middleware wrapping).
 * Extracted from runAgentLoop for clarity.
 */
async function executeLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    provider,
    model,
    messages,
    toolDefs,
    systemPrompt,
    skillCatalog,
    maxSteps,
    hooks,
    signal,
    config = {},
    onStep,
    providerFactory,
  } = options;

  // Prepend system prompt if provided and messages[0] is not already a system message
  if (systemPrompt && messages.length > 0 && messages[0].role !== "system") {
    messages.unshift({
      id: generateId(),
      role: "system",
      content: systemPrompt,
      timestamp: now(),
    });
  }

  // Append skill catalog to existing system message
  if (skillCatalog && messages.length > 0 && messages[0].role === 'system') {
    messages[0] = { ...messages[0], content: messages[0].content + '\n\n' + skillCatalog };
  }

  const steps: StepResult[] = [];
  const allToolCalls: ToolCall[] = [];
  let finishReason: "stop" | "max_steps" | "error" | "aborted" = "stop";
  let loopError: AgentLoopError | undefined;

  // For usage calculation
  let totalPromptChars = 0;
  let totalCompletionChars = 0;

  // Track current provider (may change per step if providerFactory is used)
  let currentProvider = provider;
  let currentModel = model;

  for (let step = 0; step < maxSteps; step++) {
    // Check abort
    if (signal?.aborted) {
      finishReason = "aborted";
      loopError = {
        message: "Operation was aborted",
        code: "ABORTED",
        retryable: false,
      };
      break;
    }

    // Resolve provider for this step (for skill-driven provider switching)
    if (providerFactory) {
      try {
        const resolved = await providerFactory.resolve();
        currentProvider = resolved.provider;
        currentModel = resolved.model;
      } catch (err) {
        finishReason = "error";
        loopError = {
          message: err instanceof Error ? err.message : String(err),
          code: "PROVIDER_ERROR",
          retryable: true,
          provider: currentModel,
        };
        const zclawErr = toZclawError(err, "PROVIDER_ERROR");
        await hooks.onError(zclawErr);
        break;
      }
    }

    // Convert messages to provider format
    const providerMessages: ProviderMessage[] = messages.map(messageToProviderMessage);

    // Call provider
    let response;
    try {
      response = await currentProvider.chat(providerMessages, toolDefs, { signal });
    } catch (err) {
      finishReason = "error";
      const zclawErr = toZclawError(err, "PROVIDER_ERROR");
      loopError = {
        message: zclawErr.message,
        code: "PROVIDER_ERROR",
        retryable: zclawErr.retryable,
        provider: currentModel,
      };
      await hooks.onError(zclawErr);
      break;
    }

    // Track prompt chars for usage
    for (const msg of providerMessages) {
      totalPromptChars += (msg.content ?? "").length;
    }

    // Text content
    if (response.content) {
      totalCompletionChars += response.content.length;

      const textStep: StepResult = {
        type: "text",
        content: response.content,
        timestamp: now(),
      };
      steps.push(textStep);
      await hooks.onStep(textStep);
      if (onStep) onStep(textStep);

      // Add assistant message with text content
      messages.push({
        id: generateId(),
        role: "assistant",
        content: response.content,
        timestamp: now(),
      });
    }

    // Tool calls
    if (response.tool_calls && response.tool_calls.length > 0) {
      const assistantToolCalls = response.tool_calls.map(providerToolCallToToolCall);
      allToolCalls.push(...assistantToolCalls);

      // Add assistant message with tool calls
      const assistantMsg: Message = {
        id: generateId(),
        role: "assistant",
        content: response.content ?? "",
        toolCalls: assistantToolCalls,
        timestamp: now(),
      };
      messages.push(assistantMsg);

      // Execute each tool call
      for (const tc of response.tool_calls) {
        if (signal?.aborted) {
          finishReason = "aborted";
          loopError = {
            message: "Operation was aborted during tool execution",
            code: "ABORTED",
            retryable: false,
          };
          break;
        }

        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = JSON.parse(tc.arguments);
        } catch {
          parsedArgs = { raw: tc.arguments };
        }

        await hooks.beforeToolCall({ name: tc.name, args: parsedArgs });

        const start = now();
        let output: string;
        try {
          output = await executeTool(tc.name, parsedArgs, config);
        } catch (err) {
          output = `Error: ${err instanceof Error ? err.message : String(err)}`;

          // Track tool failures but continue loop
          if (output.startsWith("Error:")) {
            const toolErr: AgentLoopError = {
              message: output,
              code: "TOOL_FAILED",
              retryable: true,
              tool: tc.name,
            };
            // Don't set loopError here - we want to continue the loop
            // But we could log it if needed
          }
        }
        const duration = now() - start;

        totalCompletionChars += output.length;

        // Add tool result message
        messages.push({
          id: generateId(),
          role: "tool",
          content: output,
          toolCallId: tc.id,
          timestamp: now(),
        });

        // Record step
        const toolStep: StepResult = {
          type: "tool_call",
          toolCall: {
            name: tc.name,
            args: parsedArgs,
            result: output,
            duration,
          },
          timestamp: now(),
        };
        steps.push(toolStep);
        await hooks.onStep(toolStep);
        await hooks.afterToolCall({ name: tc.name, output, duration });
        if (onStep) onStep(toolStep);
      }

      if (finishReason === "aborted") break;

      // Restore provider after tool execution if factory was used
      if (providerFactory) {
        providerFactory.restore();
      }

      // Continue the loop to get the next response
      continue;
    }

    // No tool calls — we're done
    finishReason = "stop";
    break;
  }

  // Check if we exited because of maxSteps
  if (finishReason === "stop" && steps.length >= maxSteps) {
    finishReason = "max_steps";
  }

  // Calculate usage
  const promptTokens = estimateTokens("p".repeat(totalPromptChars));
  const completionTokens = estimateTokens("p".repeat(totalCompletionChars));
  const usage: Usage = {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cost: 0,    // TODO: Implement cost calculation based on provider/model
  };

  return {
    messages,
    steps,
    toolCalls: allToolCalls,
    usage,
    finishReason,
    error: loopError,
  };
}
