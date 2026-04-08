import chalk from 'chalk';
import ora from 'ora';
import * as os from 'os';
import * as path from 'path';
import { getToolDefinitions, executeToolHandler } from '../../tools/index.js';
import { LLMProvider, ProviderMessage } from '../../providers/types.js';
import { initializeSkillRegistry, getSkillRegistry } from '../../skills/index.js';
import type { SkillRegistry, SkillMetadata } from '../../skills/types.js';
import { runAgentLoop } from '../../core/agent-loop.js';
import { generateId, now } from '../../core/message-convert.js';
import { createHookExecutor } from '../../core/hooks.js';
import type { Message, StepResult, Usage, ToolCall } from '../../core/types.js';

export class Agent {
  private provider: LLMProvider;
  private messages: Message[];
  private model: string;
  private config: any;
  private skillRegistry: SkillRegistry | null = null;
  private originalProvider: LLMProvider | null = null;
  private originalModel: string | null = null;

  constructor(provider: LLMProvider, model: string = 'gpt-4-turbo-preview', config: any = {}) {
    this.provider = provider;
    this.model = model;
    this.config = config;

    this.messages = [{
      id: generateId(),
      role: "system",
      content: buildSystemPrompt([]),
      timestamp: now(),
    }];
  }

  async initializeSkills(): Promise<void> {
    try {
      this.skillRegistry = await initializeSkillRegistry(process.cwd());
      const metadata = this.skillRegistry.getMetadata();

      if (metadata.length > 0) {
        // Update system prompt with skills
        this.messages[0] = {
          ...this.messages[0],
          content: buildSystemPrompt(metadata),
        };
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

  async chat(userInput: string): Promise<void> {
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
        toolDefs: getToolDefinitions(),
        maxSteps: 10,
        hooks: createHookExecutor(),
        config: this.config,
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

      if (result.error) {
        console.error(chalk.red(`Error: ${result.error.message}`));
      }
    } catch (error: any) {
      spinner.fail('Error during processing');
      console.error(chalk.red(error.message));
    }
  }

  /**
   * Temporarily switch to a skill's preferred model if configured.
   * Returns true if a switch was made, false otherwise.
   */
  async switchToSkillModel(skill: any): Promise<boolean> {
    if (!skill.frontmatter?.model) return false;

    const modelConfig = skill.frontmatter.model;
    const providerType = modelConfig.provider;

    if (!this.config?.models?.[providerType]?.apiKey) {
      console.log(chalk.dim(`Skill '${skill.name}' prefers ${providerType}/${modelConfig.model} but provider not configured. Using default.`));
      return false;
    }

    try {
      const { createProvider } = await import('../../providers/factory.js');

      const providerModelConfig = this.config.models[providerType];
      const providerConfig = {
        type: providerType,
        apiKey: providerModelConfig.apiKey,
        model: modelConfig.model,
        baseUrl: providerModelConfig.baseUrl,
      };

      const newProvider = await createProvider(providerConfig);

      // Save original state
      this.originalProvider = this.provider;
      this.originalModel = this.model;

      // Switch
      this.provider = newProvider;
      this.model = modelConfig.model;

      console.log(chalk.dim(`Skill '${skill.name}' using ${providerType}/${modelConfig.model}`));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restore the original provider after skill model switching.
   */
  restoreProvider(): void {
    if (this.originalProvider) {
      this.provider = this.originalProvider;
      this.model = this.originalModel || this.model;
      this.originalProvider = null;
      this.originalModel = null;
    }
  }

  switchProvider(provider: LLMProvider, model: string) {
    this.provider = provider;
    this.model = model;
  }
}

/**
 * Build the system prompt for ZClaw.
 * This is extracted as a standalone function for testability and reuse.
 */
function buildSystemPrompt(skills: SkillMetadata[]): string {
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

  let prompt = `You are ZClaw, a Docker-Native Autonomous Agent designed for massive scale automation.
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

  if (skills.length > 0) {
    const skillList = skills.map(s => `- ${s.name}: ${s.description}`).join('\n');
    prompt += `\n\nAVAILABLE SKILLS:\n${skillList}\n\nYou can activate a skill by calling the 'use_skill' tool when a user request matches a skill's description. This gives you specialized knowledge and procedures.`;
  }

  return prompt;
}
