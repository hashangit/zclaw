import chalk from 'chalk';
import ora from 'ora';
import * as os from 'os';
import * as path from 'path';
import { getToolDefinitions, executeToolHandler } from './tools/index.js';
import { LLMProvider, ProviderMessage } from './providers/types.js';
import { initializeSkillRegistry, getSkillRegistry } from './skills/index.js';
import type { SkillRegistry } from './skills/types.js';

export class Agent {
  private provider: LLMProvider;
  private messages: ProviderMessage[];
  private model: string;
  private config: any;
  private skillRegistry: SkillRegistry | null = null;
  private originalProvider: LLMProvider | null = null;
  private originalModel: string | null = null;

  constructor(provider: LLMProvider, model: string = 'gpt-4-turbo-preview', config: any = {}) {
    this.provider = provider;
    this.model = model;
    this.config = config;

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

    this.messages = [
      {
        role: "system",
        content: `You are ZClaw, a Docker-Native Autonomous Agent designed for massive scale automation.
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
5. OPTIMIZATION: When asked to generate creative content (images, stories, complex code), use 'optimize_prompt' first to ensure the best possible output quality.
`
      }
    ];
  }

  async initializeSkills(): Promise<void> {
    try {
      this.skillRegistry = await initializeSkillRegistry(process.cwd());
      const metadata = this.skillRegistry.getMetadata();

      if (metadata.length > 0) {
        const skillList = metadata
          .map(s => `- ${s.name}: ${s.description}`)
          .join('\n');

        this.messages[0].content += `\n\nAVAILABLE SKILLS:\n${skillList}\n\nYou can activate a skill by calling the 'use_skill' tool when a user request matches a skill's description. This gives you specialized knowledge and procedures.`;

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
    // Resolve @path file references before sending to LLM
    let resolvedInput = userInput;
    if (userInput.includes('@')) {
      try {
        const { resolveReferences } = await import('./skills/resolver.js');
        resolvedInput = await resolveReferences(userInput);
      } catch {
        // Resolver not available, use raw input
      }
    }

    this.messages.push({ role: "user", content: resolvedInput });

    let active = true;
    while (active) {
      const spinner = ora('Thinking...').start();
      
      try {
        const response = await this.provider.chat(this.messages, getToolDefinitions());

        spinner.stop();

        this.messages.push({ role: "assistant", content: response.content, tool_calls: response.tool_calls });

        if (response.content) {
          console.log(chalk.blue("ZClaw: ") + response.content);
        }

        if (response.tool_calls) {
          for (const toolCall of response.tool_calls) {
            const functionName = toolCall.name;
            const functionArgs = JSON.parse(toolCall.arguments);

            console.log(chalk.gray(`Executing tool: ${functionName}...`));

            // Pass the full config to the tool handler
            const toolResult = await executeToolHandler(functionName, functionArgs, this.config);

            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: toolResult
            });
          }
        } else {
          active = false;
        }

      } catch (error: any) {
        spinner.fail('Error during processing');
        console.error(chalk.red(error.message));
        active = false;
      }
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
      const { createProvider } = await import('./providers/factory.js');

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
