import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import util from 'util';
import { ToolModule } from './interface.js';

const execAsync = util.promisify(exec);

/**
 * Determine shell command approval mode from config and environment.
 *
 * Priority:
 *   1. config.autoConfirm (--yes flag)  → auto-approve
 *   2. ZCLAW_SHELL_APPROVE=auto         → auto-approve (for Docker/CI)
 *   3. ZCLAW_SHELL_APPROVE=deny         → auto-deny (safest non-interactive)
 *   4. Interactive TTY                   → prompt with inquirer
 *   5. Non-interactive (Docker/pipe)     → auto-deny with guidance
 */
function getShellApprovalMode(config: any): 'auto' | 'prompt' | 'deny' {
  // Explicit auto-confirm via --yes flag
  if (config?.autoConfirm) return 'auto';

  // Env var override for non-interactive environments
  const envMode = process.env.ZCLAW_SHELL_APPROVE;
  if (envMode === 'auto' || envMode === 'true' || envMode === '1') return 'auto';
  if (envMode === 'deny' || envMode === 'false' || envMode === '0') return 'deny';

  // Interactive: use inquirer prompt
  if (process.stdin.isTTY) return 'prompt';

  // Non-interactive without explicit override: auto-deny for safety
  return 'deny';
}

export const ShellTool: ToolModule = {
  name: "Shell Execution",
  definition: {
    type: "function",
    function: {
      name: "execute_shell_command",
      description: "Execute a shell command on the host machine. Use this to run scripts, list files, or interact with the system.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to execute." },
          rationale: { type: "string", description: "Explain why you are running this command." }
        },
        required: ["command", "rationale"]
      }
    }
  },
  handler: async (args: any, config: any) => {
    console.log(chalk.yellow(`\nAI wants to execute: `) + chalk.bold(args.command));
    console.log(chalk.dim(`Reason: ${args.rationale}`));

    const mode = getShellApprovalMode(config);

    if (mode === 'deny') {
      console.log(chalk.red('Command denied (non-interactive mode).'));
      console.log(chalk.dim('Set ZCLAW_SHELL_APPROVE=auto to auto-approve, or use --yes flag.'));
      return "Command denied: running in non-interactive mode without auto-approve. Set ZCLAW_SHELL_APPROVE=auto or pass --yes flag to allow command execution.";
    }

    if (mode === 'prompt') {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Do you want to run this command?',
          default: false
        }
      ]);
      if (!confirm) return "User denied command execution.";
    } else {
      console.log(chalk.gray(`(Auto-approved: ${config?.autoConfirm ? '--yes flag' : 'ZCLAW_SHELL_APPROVE=auto'})`));
    }

    try {
      const { stdout, stderr } = await execAsync(args.command);
      return stdout + (stderr ? `\nStderr: ${stderr}` : '');
    } catch (error: any) {
      return `Command failed: ${error.message}\nStdout: ${error.stdout}\nStderr: ${error.stderr}`;
    }
  }
};

export const ReadFileTool: ToolModule = {
  name: "File Reader",
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the content of a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to read." }
        },
        required: ["path"]
      }
    }
  },
  handler: async (args: any) => {
    try {
      const content = await fs.readFile(args.path, 'utf-8');
      return content;
    } catch (error: any) {
      return `Error reading file: ${error.message}`;
    }
  }
};

export const WriteFileTool: ToolModule = {
  name: "File Writer",
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file. Overwrites existing files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to write." },
          content: { type: "string", description: "The content to write." }
        },
        required: ["path", "content"]
      }
    }
  },
  handler: async (args: any) => {
    try {
      await fs.mkdir(path.dirname(args.path), { recursive: true });
      await fs.writeFile(args.path, args.content, 'utf-8');
      return `Successfully wrote to ${args.path}`;
    } catch (error: any) {
      return `Error writing file: ${error.message}`;
    }
  }
};

export const DateTimeTool: ToolModule = {
  name: "Date & Time",
  definition: {
    type: "function",
    function: {
      name: "get_current_datetime",
      description: "Get the current system date and time. Use this when the user refers to relative dates (like 'today', 'next week', 'this March') to ensure accuracy.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  handler: async () => {
    const now = new Date();
    return JSON.stringify({
      iso: now.toISOString(),
      local: now.toLocaleString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      weekday: now.toLocaleDateString('en-US', { weekday: 'long' })
    }, null, 2);
  }
};
