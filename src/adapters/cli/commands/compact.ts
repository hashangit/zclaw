/**
 * /compact command handler for ZClaw CLI.
 *
 * Summarizes the conversation to reduce token usage while preserving
 * key context needed to continue the session.
 *
 * Aliases: /compress
 */

import chalk from 'chalk';
import ora from 'ora';
import type { CommandHandler } from './registry.js';
import { runAgentLoop } from '../../../core/agent-loop.js';
import { generateId, now } from '../../../core/message-convert.js';
import { createHookExecutor } from '../../../core/hooks.js';
import type { Message } from '../../../core/types.js';
import { buildSystemPrompt } from '../agent.js';

export const compactHandler: CommandHandler = async (ctx) => {
  const { agent, args } = ctx;

  const spinner = ora('Compacting...').start();

  try {
    const allMessages = agent.getMessages();

    // Separate system prompt from conversation messages
    const systemMessage = allMessages.find((m) => m.role === 'system');
    const conversationMessages = allMessages.filter((m) => m.role !== 'system');

    if (conversationMessages.length === 0) {
      spinner.stop();
      console.log(chalk.yellow('Nothing to compact — conversation is empty.'));
      return;
    }

    // Build the summarization instruction
    const focusHint = args.trim();
    const summaryInstruction = `Summarize this conversation concisely. Preserve key decisions, code changes, and context needed to continue.${focusHint ? ` ${focusHint}` : ''}`;

    // Create a temporary messages array for the summarization call
    const summaryMessages: Message[] = [
      {
        id: generateId(),
        role: 'system',
        content: summaryInstruction,
        timestamp: now(),
      },
      // Flatten all non-system messages into a single user message for context
      {
        id: generateId(),
        role: 'user',
        content: conversationMessages
          .map((m) => `[${m.role}]: ${m.content}`)
          .join('\n\n'),
        timestamp: now(),
      },
    ];

    let result;
    try {
      result = await runAgentLoop({
        provider: agent.getProvider(),
        model: agent.getModel(),
        messages: summaryMessages,
        toolDefs: [], // no tools during summarization
        maxSteps: 1,
        hooks: createHookExecutor(),
      });
    } catch (error: any) {
      spinner.stop();
      console.error(chalk.red(`Compaction failed: ${error.message}`));
      return;
    }

    if (result.error) {
      spinner.stop();
      console.error(chalk.red(`Compaction failed: ${result.error.message}`));
      return;
    }

    // Extract the summary text from the result messages
    const assistantMessage = result.messages.find((m) => m.role === 'assistant');
    const summaryText = assistantMessage?.content ?? 'Conversation history was compacted.';

    // Replace agent messages: [system_prompt, summary]
    const newMessages: Message[] = systemMessage
      ? [systemMessage]
      : [
          {
            id: generateId(),
            role: 'system',
            content: buildSystemPrompt(),
            timestamp: now(),
          },
        ];

    newMessages.push({
      id: generateId(),
      role: 'assistant',
      content: `[Conversation Summary]\n${summaryText}`,
      timestamp: now(),
    });

    agent.setMessages(newMessages);

    spinner.stop();
    console.log(chalk.green('Conversation compacted. Token usage reduced.'));
  } catch (error: any) {
    spinner.stop();
    console.error(chalk.red(`Compaction error: ${error.message}`));
  }
};
