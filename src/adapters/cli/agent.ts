import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { getAllToolDefinitions } from '../../core/tool-executor.js';
import { buildSystemPrompt } from './system-prompts.js';
import { LLMProvider, ProviderMessage } from '../../providers/types.js';
import { initializeSkillRegistry, getSkillRegistry } from '../../skills/index.js';
import type { SkillRegistry } from '../../skills/types.js';
import { runAgentLoop } from '../../core/agent-loop.js';
import { generateId, now } from '../../core/message-convert.js';
import { createHookExecutor } from '../../core/hooks.js';
import { buildSkillCatalog } from '../../core/skill-catalog.js';
import { DEFAULT_MODELS } from '../../models-catalog.js';
import type { Message, StepResult, Usage, ToolCall, ApproveToolFn, PermissionLevel } from '../../core/types.js';
import type { Middleware } from '../../core/middleware.js';

export class Agent {
  private provider: LLMProvider;
  private messages: Message[];
  private model: string;
  private config: any;
  private autoConfirm: boolean;
  private skillRegistry: SkillRegistry | null = null;
  private skillCatalog: string = '';
  private abortController: AbortController | null = null;
  private _middleware: Middleware[] = [];
  private readonly systemPrompt: string;

  constructor(provider: LLMProvider, model: string = DEFAULT_MODELS['openai-compatible'], config: any = {}, systemPrompt?: string) {
    this.provider = provider;
    this.model = model;
    this.config = config;
    this.autoConfirm = !!config?.autoConfirm;
    // Default to the headless/Docker prompt; the caller (repl.ts) selects the
    // interactive prompt when launching in a TTY. Kept mode-agnostic here so
    // Core's runAgentLoop never needs to know about launch mode.
    this.systemPrompt = systemPrompt ?? buildSystemPrompt();

    this.messages = [{
      id: generateId(),
      role: "system",
      content: this.systemPrompt,
      timestamp: now(),
    }];
  }

  async initializeSkills(): Promise<void> {
    try {
      this.skillRegistry = await initializeSkillRegistry(process.cwd());
      const metadata = this.skillRegistry.getMetadata();

      if (metadata.length > 0) {
        // Build and store skill catalog — will be injected by runAgentLoop
        this.skillCatalog = buildSkillCatalog(metadata);
        console.log(chalk.green(`Loaded ${metadata.length} skill(s):`));
        for (const s of metadata) {
          console.log(chalk.dim(`  - ${s.name}`));
        }
      }
    } catch (error: any) {
      console.warn(chalk.yellow(`Warning: Skills initialization failed: ${error.message}`));
    }
  }

  getSkillRegistry(): SkillRegistry | null {
    return this.skillRegistry;
  }

  /** Set middleware pipeline (e.g., gateway semantic injection). */
  setMiddleware(middleware: Middleware[]): void {
    this._middleware = middleware;
  }

  async chat(userInput: string, signal?: AbortSignal, approveTool?: ApproveToolFn, permissionLevel?: PermissionLevel): Promise<void> {
    // Resolve @path references
    let resolvedInput = userInput;
    if (userInput.includes('@')) {
      try {
        const { resolveReferences } = await import('../../skills/resolver.js');
        resolvedInput = await resolveReferences(userInput);
      } catch { /* resolver not available */ }
    }

    this.messages.push({ id: generateId(), role: "user", content: resolvedInput, timestamp: now() });

    const spinner = ora('Thinking...').start();

    // Wrap approveTool to manage spinner state
    const wrappedApproveTool = approveTool
      ? async (call: Parameters<ApproveToolFn>[0]) => {
          spinner.stop();
          try {
            return await approveTool(call);
          } finally {
            spinner.start();
          }
        }
      : undefined;

    try {
      const result = await runAgentLoop({
        provider: this.provider,
        model: this.model,
        messages: this.messages,
        toolDefs: getAllToolDefinitions(),
        skillCatalog: this.skillCatalog || undefined,
        maxSteps: 30,
        hooks: createHookExecutor(),
        config: { ...this.config, agentName: 'cli' },
        signal,
        approveTool: wrappedApproveTool,
        permissionLevel,
        autoConfirm: this.autoConfirm,
        middleware: this._middleware.length > 0 ? this._middleware : undefined,
        onStep: (step) => {
          if (step.type === "text" && step.content) {
            spinner.stop();
            console.log(chalk.blue("ZClaw: ") + step.content);
            spinner.start();
          } else if (step.type === "tool_call" && step.toolCall) {
            spinner.stop();
            console.log(chalk.gray(`Executing tool: ${step.toolCall.name}...`));
            spinner.start();
          }
        },
      });

      spinner.stop();

      if (result.finishReason === "aborted") {
        console.log(chalk.yellow("\n(Interrupted)"));
      } else if (result.finishReason === "max_steps") {
        console.log(chalk.yellow("\n(Max steps reached — the agent needed more iterations to complete. Try increasing maxSteps or asking a more specific question.)"));
      } else if (result.error) {
        console.error(chalk.red(`Error: ${result.error.message}`));
      }
    } catch (error: any) {
      spinner.stop();
      if (error.name === 'AbortError' || signal?.aborted) {
        console.log(chalk.yellow("\n(Interrupted)"));
      } else {
        console.error(chalk.red(error.message));
      }
    }
  }

  clearConversation(): void {
    const systemPrompt = this.messages.find(m => m.role === 'system');
    this.messages = systemPrompt
      ? [systemPrompt]
      : [{ id: generateId(), role: 'system', content: this.systemPrompt, timestamp: now() }];
  }

  /** Public accessor for the current message history. */
  getMessages(): Message[] {
    return this.messages;
  }

  /** Replace the message history (e.g., after compaction). */
  setMessages(messages: Message[]): void {
    this.messages = messages;
  }

  /** Public accessor for the active LLM provider. */
  getProvider(): LLMProvider {
    return this.provider;
  }

  /** Public accessor for the active model name. */
  getModel(): string {
    return this.model;
  }

  switchProvider(provider: LLMProvider, model: string) {
    this.provider = provider;
    this.model = model;
  }

  abort(): void {
    this.abortController?.abort();
  }

  createAbortSignal(): AbortSignal {
    this.abortController = new AbortController();
    return this.abortController.signal;
  }

  clearAbortController(): void {
    this.abortController = null;
  }
}


