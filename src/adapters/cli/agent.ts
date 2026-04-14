import chalk from 'chalk';
import ora from 'ora';
import * as os from 'os';
import * as path from 'path';
import { getAllToolDefinitions } from '../../core/tool-executor.js';
import { LLMProvider, ProviderMessage } from '../../providers/types.js';
import { initializeSkillRegistry, getSkillRegistry } from '../../skills/index.js';
import type { SkillRegistry } from '../../skills/types.js';
import { runAgentLoop } from '../../core/agent-loop.js';
import { generateId, now } from '../../core/message-convert.js';
import { createHookExecutor } from '../../core/hooks.js';
import { buildSkillCatalog } from '../../core/skill-catalog.js';
import type { Message, StepResult, Usage, ToolCall } from '../../core/types.js';

export class Agent {
  private provider: LLMProvider;
  private messages: Message[];
  private model: string;
  private config: any;
  private skillRegistry: SkillRegistry | null = null;
  private skillCatalog: string = '';
  private abortController: AbortController | null = null;

  constructor(provider: LLMProvider, model: string = 'gpt-4-turbo-preview', config: any = {}) {
    this.provider = provider;
    this.model = model;
    this.config = config;

    this.messages = [{
      id: generateId(),
      role: "system",
      content: buildSystemPrompt(),
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

  async chat(userInput: string, signal?: AbortSignal): Promise<void> {
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

    try {
      const result = await runAgentLoop({
        provider: this.provider,
        model: this.model,
        messages: this.messages,
        toolDefs: getAllToolDefinitions(),
        skillCatalog: this.skillCatalog || undefined,
        maxSteps: 10,
        hooks: createHookExecutor(),
        config: this.config,
        signal,
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
      : [{ id: generateId(), role: 'system', content: buildSystemPrompt(), timestamp: now() }];
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

/**
 * Build the system prompt for ZClaw.
 * This is extracted as a standalone function for testability and reuse.
 */
export function buildSystemPrompt(): string {
  const systemInfo = `
System Information:
- OS: ${os.type()} ${os.release()} (${os.platform()})
- Architecture: ${os.arch()}
- Node.js Version: ${process.version}
- Current Working Directory: ${process.cwd()}
- User: ${os.userInfo().username}
- Home Directory: ${os.homedir()}
- Current Date: ${new Date().toLocaleString()}
`;

  return `You are ZClaw, a Docker-Native Autonomous Agent designed for massive scale automation.
You are likely running inside a container or headless server, possibly as one of thousands of parallel units in a swarm.

CONTEXT:
${systemInfo}

ENVIRONMENT CONSTRAINTS:
1. HEADLESS: No GUI available. Do not try to open browsers or apps.
2. CONTAINER-OPTIMIZED: Assume you are in a sandbox. You can be aggressive with file creation but robust with errors.
3. NON-INTERACTIVE: Always use flags to suppress prompts (e.g., 'apt-get -y', 'rm -rf').

GUIDELINES:
1. EFFICIENCY: Your goal is speed and success. Write scripts that just work.
2. ROBUSTNESS: Use standard Linux/Unix tools found in minimal images (Alpine/Debian).
3. TOOLS: Use 'execute_shell_command' for actions, 'write_file' for code generation.
4. CLARITY: Output concise logs. You are a worker unit, not a chat bot.
5. OPTIMIZATION: When asked to generate creative content (images, stories, complex code), use 'optimize_prompt' first to ensure the best possible output quality.`;
}
