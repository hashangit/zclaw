/**
 * Skill Invoker — Central orchestrator for skill invocation flow.
 *
 * This module consolidates the skill invocation logic that was previously
 * scattered across the CLI (src/index.ts) and agent (src/agent.ts).
 *
 * Invocation flow:
 * 1. Parse input → extract skill name and arguments
 * 2. Registry lookup → resolve skill metadata
 * 3. @path resolution → inline file references
 * 4. Prompt construction → build the final prompt
 * 5. Return result with provider switching metadata
 *
 * The invoker does NOT handle provider switching itself — it returns
 * metadata so the adapter can decide whether to switch.
 */

import { parseInvocation, substituteArgs, type ParsedArgs } from '../skills/args.js';
import { type SkillRegistry } from '../skills/types.js';
import { type SkillMetadata } from './types.js';
import { resolveReferences } from '../skills/resolver.js';

/**
 * Result of a skill invocation.
 *
 * Contains the constructed prompt along with metadata about
 * whether the skill has a preferred provider/model configuration.
 */
export interface SkillInvocationResult {
  /** The constructed prompt to send to the agent */
  prompt: string;
  /** Resolved skill metadata */
  skill: SkillMetadata;
  /** Whether the skill has a preferredProvider that needs switching */
  providerSwitchNeeded: boolean;
  /** The preferred provider type (if any) */
  preferredProvider?: string;
  /** The preferred model (if any) */
  preferredModel?: string;
}

/**
 * Extended skill interface that includes frontmatter for provider switching.
 * This is internal to the invoker and not exposed in the SDK.
 */
interface ExtendedSkillMetadata extends SkillMetadata {
  frontmatter?: {
    model?: {
      provider?: string;
      model: string;
    };
  };
}

/**
 * Invoke a skill by name with the provided arguments.
 *
 * This function orchestrates the complete skill invocation flow:
 * 1. Parses the input to extract skill name and arguments
 * 2. Looks up the skill in the registry
 * 3. Substitutes arguments into the skill body
 * 4. Resolves @path references
 * 5. Constructs the final prompt
 * 6. Returns metadata about provider switching if needed
 *
 * @param options - Invocation options
 * @param options.input - Raw "/skillname args" input from user
 * @param options.registry - The skill registry to look up skills from
 * @param options.skillsPath - Optional path for @path resolution (defaults to cwd)
 * @returns SkillInvocationResult or null if no skill matches
 *
 * @example
 * ```ts
 * const result = await invokeSkill({
 *   input: '/code-review src/app.ts',
 *   registry: skillRegistry,
 * });
 *
 * if (result) {
 *   if (result.providerSwitchNeeded) {
 *     await switchProvider(result.preferredProvider!, result.preferredModel!);
 *   }
 *   await agent.chat(result.prompt);
 * }
 * ```
 */
export async function invokeSkill(options: {
  input: string;
  registry: SkillRegistry;
  skillsPath?: string;
}): Promise<SkillInvocationResult | null> {
  const { input, registry, skillsPath } = options;

  // Step 1: Parse the input to extract skill name and arguments
  const parsed = parseInvocation(input);
  if (!parsed) {
    return null;
  }

  const { skillName, args } = parsed;

  // Step 2: Registry lookup
  const skill = registry.get(skillName);
  if (!skill) {
    return null;
  }

  // Step 3: Get the skill body
  const skillBody = await registry.getBody(skillName);
  if (!skillBody) {
    return null;
  }

  // Step 4: Substitute arguments into skill body
  const resolvedBody = substituteArgs(skillBody, args);

  // Step 5: Resolve @path references in the query
  let resolvedQuery = args.raw;
  if (args.raw.includes('@')) {
    try {
      resolvedQuery = await resolveReferences(args.raw, skillsPath);
    } catch {
      // Resolver failed, use raw args
    }
  }

  // Step 6: Construct the final prompt
  const prompt = resolvedQuery
    ? `[Skill: ${skill.name} activated]\n\n${resolvedBody}\n\nUser request: ${resolvedQuery}`
    : `[Skill: ${skill.name} activated]\n\n${resolvedBody}\n\nSkill loaded. What would you like me to do?`;

  // Step 7: Extract provider switching metadata
  const extendedSkill = skill as unknown as ExtendedSkillMetadata;
  const modelConfig = extendedSkill.frontmatter?.model;
  const providerSwitchNeeded = !!modelConfig?.provider;

  return {
    prompt,
    skill: {
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
    },
    providerSwitchNeeded,
    preferredProvider: modelConfig?.provider,
    preferredModel: modelConfig?.model,
  };
}
