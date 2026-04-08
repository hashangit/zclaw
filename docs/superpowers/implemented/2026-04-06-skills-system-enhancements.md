# Skills System Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic arguments, @path file references, ~/zclaw_documents/ workspace, per-skill model selection, and disable-model-invocation to the zclaw skills system.

**Architecture:** Extend the existing skills pipeline (types → parser → registry → tool handler → agent) with new capabilities. Each feature adds new fields to frontmatter types, new processing in the UseSkillTool handler, and new utilities in `src/skills/`. All features are backward-compatible — skills without new fields work exactly as before.

**Tech Stack:** TypeScript, Node.js fs/path, existing zclaw provider/tool system.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/skills/args.ts` | Argument parsing & template substitution |
| Create | `src/skills/resolver.ts` | @path file reference resolution |
| Create | `src/skills/direct-executor.ts` | Direct tool-flow execution (bypass LLM) |
| Modify | `src/skills/types.ts` | New frontmatter fields |
| Modify | `src/skills/parser.ts` | Parse new frontmatter fields |
| Modify | `src/skills/index.ts` | Export new modules |
| Modify | `src/tools/index.ts` | Enhanced UseSkillTool handler |
| Modify | `src/agent.ts` | Per-skill model switching, @path resolution in chat |
| Modify | `src/index.ts` | ~/zclaw_documents/ creation in setup, @path in chat loop |

---

## Task 1: Extend SkillFrontmatter Types

**Files:**
- Modify: `src/skills/types.ts`

- [ ] **Step 1: Add new frontmatter fields to types.ts**

```typescript
export interface SkillModelConfig {
  provider?: string;   // e.g., 'openai', 'anthropic', 'glm', 'openai-compatible'
  model: string;       // model id or nickname (e.g., 'gpt-5.4', 'sonnet', 'claude-haiku-4-5-20251001')
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  allowedTools?: string[];
  priority?: number;
  // NEW: Dynamic arguments
  args?: string[];               // Declared argument names, e.g., ['environment', 'service']
  // NEW: Per-skill model selection
  model?: SkillModelConfig;      // Preferred model for this skill
  // NEW: Disable LLM invocation
  disableModelInvocation?: boolean;  // If true, execute tool calls directly without LLM
}

export interface Skill {
  name: string;
  description: string;
  version: string;
  author?: string;
  tags: string[];
  allowedTools?: string[];
  priority: number;
  basePath: string;
  source: string;
  frontmatter: SkillFrontmatter;
  bodyCache?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/skills/types.ts
git commit -m "feat(skills): extend SkillFrontmatter with args, model, disableModelInvocation fields"
```

---

## Task 2: Create ~/zclaw_documents/ in Setup

**Files:**
- Modify: `src/index.ts:414-424` (end of `runSetup` function)

- [ ] **Step 1: Add zclaw_documents creation after config save in `runSetup()`**

Add the following code inside `runSetup()`, after the `try` block that saves config (line 423), before the closing `}` of the try block:

```typescript
    // Create ~/zclaw_documents workspace
    const docsDir = path.join(os.homedir(), 'zclaw_documents');
    const subdirs = ['notes', 'templates', 'output', 'knowledge'];
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
      for (const sub of subdirs) {
        fs.mkdirSync(path.join(docsDir, sub), { recursive: true });
      }
      // Write README explaining the workspace
      fs.writeFileSync(
        path.join(docsDir, 'README.md'),
        `# zclaw_documents\n\nThis is your ZClaw agent workspace. Files here are accessible across all projects.\n\n- \`notes/\` — Agent-created notes and session logs\n- \`templates/\` — Reusable templates you or the agent can reference\n- \`output/\` — Generated artifacts (reports, summaries)\n- \`knowledge/\` — Reference documents for the agent to use\n\nReference files in conversation with \`@zclaw_documents/path/to/file\`\n`,
        'utf-8'
      );
      console.log(chalk.green(`Created agent workspace at ${docsDir}`));
    }
```

- [ ] **Step 2: Also create zclaw_documents on first run if it doesn't exist**

In `runChat()`, after the agent is created and skills initialized (around line 841), add:

```typescript
  // Ensure ~/zclaw_documents exists
  const docsDir = path.join(os.homedir(), 'zclaw_documents');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
    for (const sub of ['notes', 'templates', 'output', 'knowledge']) {
      fs.mkdirSync(path.join(docsDir, sub), { recursive: true });
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: create ~/zclaw_documents workspace during setup and first run"
```

---

## Task 3: Dynamic Arguments — Parser & Substitution Engine

**Files:**
- Create: `src/skills/args.ts`

- [ ] **Step 1: Create `src/skills/args.ts`**

```typescript
/**
 * Dynamic argument parsing and template substitution for skills.
 * 
 * Supports:
 * - $1, $2, ... — positional arguments
 * - $ALL — all arguments as a single string
 * - $COUNT — number of arguments
 * - $FIRST — first argument
 * - $LAST — last argument
 */

export interface ParsedArgs {
  positional: string[];
  raw: string;
}

/**
 * Parse a user input string into a skill name and arguments.
 * Handles quoted strings for multi-word arguments.
 * 
 * @example
 * parseInvocation('/docker-ops build myapp:1.2.0 --no-cache')
 * // => { skillName: 'docker-ops', args: { positional: ['build', 'myapp:1.2.0', '--no-cache'], raw: 'build myapp:1.2.0 --no-cache' } }
 */
export function parseInvocation(input: string): { skillName: string; args: ParsedArgs } | null {
  if (!input.startsWith('/') || input.length < 2) return null;

  const body = input.slice(1);
  const firstSpace = body.search(/\s/);

  if (firstSpace === -1) {
    return { skillName: body, args: { positional: [], raw: '' } };
  }

  const skillName = body.slice(0, firstSpace);
  const argsRaw = body.slice(firstSpace + 1).trim();

  return {
    skillName,
    args: {
      positional: splitArgs(argsRaw),
      raw: argsRaw,
    },
  };
}

/**
 * Split argument string respecting quoted strings.
 */
function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) args.push(current);
  return args;
}

/**
 * Substitute template variables in a skill body with actual arguments.
 * 
 * Supported variables:
 * - $1, $2, ..., $N — positional arguments (1-indexed)
 * - $ALL — all arguments joined as a string
 * - $COUNT — number of arguments
 * - $FIRST — first argument (same as $1)
 * - $LAST — last argument
 */
export function substituteArgs(body: string, args: ParsedArgs): string {
  let result = body;

  // $ALL — all arguments as a single string
  result = result.replace(/\$ALL\b/g, args.raw);

  // $COUNT — number of arguments
  result = result.replace(/\$COUNT\b/g, String(args.positional.length));

  // $FIRST — first argument
  result = result.replace(/\$FIRST\b/g, args.positional[0] || '');

  // $LAST — last argument
  result = result.replace(/\$LAST\b/g, args.positional[args.positional.length - 1] || '');

  // $N — positional arguments (must process AFTER $ALL, $COUNT etc. to avoid conflicts)
  // Replace from highest index down to avoid $10 being matched as $1
  for (let i = args.positional.length; i >= 1; i--) {
    result = result.replace(new RegExp(`\\$${i}\\b`, 'g'), args.positional[i - 1]);
  }

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/skills/args.ts
git commit -m "feat(skills): add dynamic argument parsing and template substitution"
```

---

## Task 4: Dynamic Arguments — Integration

**Files:**
- Modify: `src/skills/index.ts` — export new module
- Modify: `src/index.ts:904-929` — skill invocation in chat loop
- Modify: `src/tools/index.ts:36-56` — UseSkillTool handler

- [ ] **Step 1: Export args module from `src/skills/index.ts`**

Add this line at the top of `src/skills/index.ts`:

```typescript
export { parseInvocation, substituteArgs } from './args.js';
export type { ParsedArgs } from './args.js';
```

- [ ] **Step 2: Update `/skill-name` invocation in `src/index.ts` to use argument substitution**

Replace the skill invocation block in the chat loop (lines 904-929) with:

```typescript
      // /<skill-name> — user-invoked skill activation
      if (userInput.startsWith('/') && userInput.length > 1) {
        const { parseInvocation, substituteArgs } = await import('./skills/args.js');
        const parsed = parseInvocation(userInput);

        if (parsed) {
          const skillName = parsed.skillName;
          const registry = agent.getSkillRegistry();
          const skill = registry?.get(skillName);

          if (skill) {
            console.log(chalk.cyan(`Loading skill: ${skill.name}`));
            const skillBody = await registry!.getBody(skillName);

            // Substitute arguments into skill body
            const resolvedBody = substituteArgs(skillBody || '', parsed.args);

            const prompt = parsed.args.raw
              ? `[Skill: ${skill.name} activated]\n\n${resolvedBody}\n\nUser request: ${parsed.args.raw}`
              : `[Skill: ${skill.name} activated]\n\n${resolvedBody}\n\nSkill loaded. What would you like me to do?`;

            rl.pause();
            try {
              await agent.chat(prompt);
            } finally {
              rl.resume();
            }
            continue;
          }
        }
        // If no skill matches, fall through to treat as normal input
      }
```

- [ ] **Step 3: Update UseSkillTool handler to support argument substitution**

Replace the `UseSkillTool` handler in `src/tools/index.ts` (lines 36-56) with:

```typescript
  handler: async (args: any) => {
    const registry = getSkillRegistry();
    if (!registry) return "Error: Skill system not initialized.";

    const { skill_name, args: skillArgs } = args;
    const skill = registry.get(skill_name);
    if (!skill) {
      return `Error: Skill '${skill_name}' not found. Available skills: ${registry.getAll().map(s => s.name).join(', ')}`;
    }

    const body = await registry.getBody(skill_name);
    if (!body) return `Error: Skill '${skill_name}' has no content.`;

    // If skillArgs provided, substitute positional variables
    let resolvedBody = body;
    if (skillArgs && typeof skillArgs === 'object') {
      const argsValues = Object.values(skillArgs);
      if (argsValues.length > 0) {
        const { substituteArgs } = await import('../skills/args.js');
        resolvedBody = substituteArgs(body, {
          positional: argsValues.map(String),
          raw: argsValues.join(' '),
        });
      }
    }

    let result = `# ${skill.name} Skill Activated\n\n${resolvedBody}`;
    if (skillArgs && Object.keys(skillArgs).length > 0) {
      result += `\n\n## Skill Arguments\n${JSON.stringify(skillArgs, null, 2)}`;
    }

    return result;
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/skills/index.ts src/index.ts src/tools/index.ts
git commit -m "feat(skills): integrate dynamic arguments into skill invocation and UseSkillTool"
```

---

## Task 5: @path File Reference Resolver

**Files:**
- Create: `src/skills/resolver.ts`

- [ ] **Step 1: Create `src/skills/resolver.ts`**

```typescript
/**
 * @path file reference resolver for skills and chat.
 * 
 * Supported patterns:
 * - @path/to/file         — relative to project root (process.cwd())
 * - @zclaw_documents/file — resolves to ~/zclaw_documents/file
 * - @~/path/to/file       — explicit home directory path
 * 
 * Resolution flow:
 * 1. Scan text for @reference patterns
 * 2. Resolve each path
 * 3. Read file content
 * 4. Replace @reference with inlined content
 */

import { readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB per file
const MAX_REFERENCES = 10; // Max @references per input

interface ResolvedRef {
  original: string;  // e.g., "@src/index.ts"
  filePath: string;  // resolved absolute path
}

/**
 * Extract all @reference patterns from text.
 * Matches @path/to/file, @zclaw_documents/foo, @~/foo/bar
 * Does NOT match email addresses (requires word boundary before @)
 */
function extractReferences(text: string): string[] {
  // Match @path patterns but exclude email addresses
  // Pattern: @ followed by a path-like string (no spaces, starts with alphanumeric or ~ or zclaw_documents)
  const pattern = /(?:^|[^a-zA-Z0-9])@(~?\/?[a-zA-Z0-9_][a-zA-Z0-9_./-]*)/g;
  const matches: string[] = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    matches.push(match[1]); // The path part without @
  }

  return matches.slice(0, MAX_REFERENCES);
}

/**
 * Resolve a reference path to an absolute file path.
 */
function resolveReference(refPath: string, projectRoot: string): string {
  // @~/... → explicit home directory
  if (refPath.startsWith('~/')) {
    return resolve(join(homedir(), refPath.slice(2)));
  }

  // @zclaw_documents/... → ~/zclaw_documents/...
  if (refPath.startsWith('zclaw_documents/') || refPath === 'zclaw_documents') {
    return resolve(join(homedir(), refPath));
  }

  // @path/to/file → relative to project root
  return resolve(join(projectRoot, refPath));
}

/**
 * Validate a resolved path is within allowed boundaries.
 * Prevents path traversal attacks.
 */
function isPathAllowed(resolvedPath: string, projectRoot: string): boolean {
  const home = homedir();
  const allowedPrefixes = [
    projectRoot,                    // Project files (read-only via @)
    join(home, 'zclaw_documents'),  // Agent workspace
    join(home, '.zclaw'),           // Config/skills
  ];

  return allowedPrefixes.some(prefix => resolvedPath.startsWith(prefix));
}

/**
 * Resolve all @path references in a text string, inlining file contents.
 * Returns the text with references replaced by file contents.
 */
export async function resolveReferences(text: string, projectRoot?: string): Promise<string> {
  const root = projectRoot || process.cwd();
  const refs = extractReferences(text);

  if (refs.length === 0) return text;

  let result = text;

  for (const ref of refs) {
    const resolvedPath = resolveReference(ref, root);

    // Security check
    if (!isPathAllowed(resolvedPath, root)) {
      result = result.replace(`@${ref}`, `[Error: Access denied — path outside allowed boundaries: @${ref}]`);
      continue;
    }

    // Existence check
    if (!existsSync(resolvedPath)) {
      result = result.replace(`@${ref}`, `[Error: File not found: @${ref}]`);
      continue;
    }

    try {
      const stat = await import('fs').then(fs => fs.statSync(resolvedPath));
      if (stat.size > MAX_FILE_SIZE) {
        result = result.replace(`@${ref}`, `[Error: File too large (${Math.round(stat.size / 1024)}KB exceeds 1MB limit): @${ref}]`);
        continue;
      }

      const content = await readFile(resolvedPath, 'utf-8');
      const ext = resolvedPath.split('.').pop() || '';
      const langMap: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        py: 'python', rs: 'rust', go: 'go', json: 'json', yaml: 'yaml', yml: 'yaml',
        md: 'markdown', html: 'html', css: 'css', sh: 'bash', sql: 'sql',
      };
      const lang = langMap[ext] || ext;

      result = result.replace(`@${ref}`, `\n---\n**File: ${ref}**\n\`\`\`${lang}\n${content}\n\`\`\`\n---\n`);
    } catch (error: any) {
      result = result.replace(`@${ref}`, `[Error: Failed to read @${ref}: ${error.message}]`);
    }
  }

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/skills/resolver.ts
git commit -m "feat(skills): add @path file reference resolver with security checks"
```

---

## Task 6: @path — Integration with Chat & Skills

**Files:**
- Modify: `src/skills/index.ts` — export resolver
- Modify: `src/index.ts` — resolve @path in chat input
- Modify: `src/agent.ts` — resolve @path in agent chat method

- [ ] **Step 1: Export resolver from `src/skills/index.ts`**

Add this export:

```typescript
export { resolveReferences } from './resolver.js';
```

- [ ] **Step 2: Resolve @path in the main chat loop (`src/index.ts`)**

In the main chat loop, before sending user input to the agent, resolve @references. Add this before the normal chat path (around line 931, before `if (userInput.trim() === '') continue;`):

```typescript
      // Resolve @path file references in user input
      let resolvedInput = userInput;
      if (userInput.includes('@') && !userInput.startsWith('/')) {
        const { resolveReferences } = await import('./skills/resolver.js');
        resolvedInput = await resolveReferences(userInput);
      }
```

Then change the chat call to use `resolvedInput`:

```typescript
      rl.pause();
      try {
        await agent.chat(resolvedInput);
      } finally {
        rl.resume();
      }
```

- [ ] **Step 3: Resolve @path in skill invocation too**

In the updated skill invocation block from Task 4, also resolve @references in the skill query. Update the prompt construction:

```typescript
            // Resolve @path references in the query
            let resolvedQuery = parsed.args.raw;
            if (parsed.args.raw.includes('@')) {
              const { resolveReferences } = await import('./skills/resolver.js');
              resolvedQuery = await resolveReferences(parsed.args.raw);
            }

            const prompt = resolvedQuery
              ? `[Skill: ${skill.name} activated]\n\n${resolvedBody}\n\nUser request: ${resolvedQuery}`
              : `[Skill: ${skill.name} activated]\n\n${resolvedBody}\n\nSkill loaded. What would you like me to do?`;
```

- [ ] **Step 4: Commit**

```bash
git add src/skills/index.ts src/index.ts
git commit -m "feat(skills): integrate @path file references into chat loop and skill invocation"
```

---

## Task 7: Per-Skill Model Selection

**Files:**
- Modify: `src/agent.ts` — model resolution and switching

- [ ] **Step 1: Add skill model resolution to Agent class**

Add these methods to the `Agent` class in `src/agent.ts`:

```typescript
  private originalProvider: LLMProvider | null = null;
  private originalModel: string | null = null;

  /**
   * Temporarily switch to a skill's preferred model if configured.
   * Returns true if a switch was made, false otherwise.
   */
  async switchToSkillModel(skill: any): Promise<boolean> {
    if (!skill.frontmatter?.model) return false;

    const modelConfig = skill.frontmatter.model;
    const providerType = modelConfig.provider;

    // Need the config to create a provider
    if (!this.config?.models?.[providerType]?.apiKey) {
      console.log(chalk.dim(`Skill '${skill.name}' prefers ${providerType}/${modelConfig.model} but provider not configured. Using default.`));
      return false;
    }

    try {
      const { createProvider } = await import('./providers/factory.js');
      const { resolveProviderConfig } = await import('./index.js');

      // Build a minimal config for the target provider
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
```

- [ ] **Step 2: Use per-skill model in the `/skill-name` invocation path**

In `src/index.ts`, update the skill invocation block to use model switching. After getting the skill body and before `agent.chat(prompt)`, add:

```typescript
            // Switch to skill's preferred model if configured
            const switchedModel = await agent.switchToSkillModel(skill);

            rl.pause();
            try {
              await agent.chat(prompt);
            } finally {
              rl.resume();
              // Restore original provider
              if (switchedModel) agent.restoreProvider();
            }
            continue;
```

- [ ] **Step 3: Commit**

```bash
git add src/agent.ts src/index.ts
git commit -m "feat(skills): add per-skill model selection with provider switching"
```

---

## Task 8: Disable Model Invocation — Direct Executor

**Files:**
- Create: `src/skills/direct-executor.ts`
- Modify: `src/tools/index.ts` — check flag in UseSkillTool

- [ ] **Step 1: Create `src/skills/direct-executor.ts`**

```typescript
/**
 * Direct executor for skills with disableModelInvocation: true.
 * Parses skill body for recognizable tool call patterns and executes them directly,
 * bypassing LLM reasoning. Falls back to LLM on parse failure.
 */

import { executeToolHandler } from '../tools/index.js';

interface ParsedToolCall {
  tool: string;
  args: Record<string, any>;
}

// Patterns to extract tool calls from skill body
const TOOL_PATTERNS: { tool: string; pattern: RegExp; extract: (match: RegExpMatchArray) => Record<string, any> }[] = [
  {
    tool: 'execute_shell_command',
    pattern: /```bash\n([\s\S]*?)```/g,
    extract: (match) => ({ command: match[1].trim() }),
  },
  {
    tool: 'write_file',
    pattern: /write_file\(\s*path:\s*["']([^"']+)["']\s*,\s*content:\s*["']([\s\S]*?)["']\s*\)/g,
    extract: (match) => ({ path: match[1], content: match[2] }),
  },
  {
    tool: 'read_file',
    pattern: /read_file\(\s*path:\s*["']([^"']+)["']\s*\)/g,
    extract: (match) => ({ path: match[1] }),
  },
];

/**
 * Execute a skill directly without LLM invocation.
 * Parses the skill body for tool call patterns and executes them.
 * Returns aggregated results or null if no patterns found (caller should fall back to LLM).
 */
export async function executeDirect(
  skillBody: string,
  skillName: string,
  config: any
): Promise<string | null> {
  const results: string[] = [];

  for (const { tool, pattern, extract } of TOOL_PATTERNS) {
    // Reset regex lastIndex
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(skillBody)) !== null) {
      try {
        const args = extract(match);
        const result = await executeToolHandler(tool, args, config);
        results.push(`[${tool}] ${result}`);
      } catch (error: any) {
        results.push(`[${tool}] Error: ${error.message}`);
      }
    }
  }

  if (results.length === 0) {
    // No recognizable patterns — caller should fall back to LLM
    return null;
  }

  return `# ${skillName} (Direct Execution)\n\n${results.join('\n\n')}`;
}
```

- [ ] **Step 2: Integrate direct execution into skill invocation**

In `src/index.ts`, in the skill invocation block, add direct execution check before the LLM call:

```typescript
            // Check for direct execution mode
            if (skill.frontmatter?.disableModelInvocation) {
              const { executeDirect } = await import('./skills/direct-executor.js');
              const directResult = await executeDirect(resolvedBody || '', skill.name, fullConfig);
              if (directResult) {
                console.log(chalk.blue("ZClaw: ") + directResult);
                continue;
              }
              // Fall through to LLM if direct execution found no patterns
              console.log(chalk.dim('Direct execution found no tool patterns, using LLM instead.'));
            }
```

- [ ] **Step 3: Commit**

```bash
git add src/skills/direct-executor.ts src/index.ts
git commit -m "feat(skills): add disable-model-invocation with direct tool-flow execution"
```

---

## Task 9: Export New Modules & Final Wiring

**Files:**
- Modify: `src/skills/index.ts` — export all new modules
- Modify: `src/agent.ts` — add @path resolution in chat method

- [ ] **Step 1: Update `src/skills/index.ts` exports**

```typescript
export type { Skill, SkillFrontmatter, SkillMetadata, SkillRegistry, SkillModelConfig } from './types.js';
export { parseSkillFile } from './parser.js';
export { discoverSkills, getSkillPaths } from './loader.js';
export { DefaultSkillRegistry } from './registry.js';
export { parseInvocation, substituteArgs } from './args.js';
export type { ParsedArgs } from './args.js';
export { resolveReferences } from './resolver.js';
export { executeDirect } from './direct-executor.js';

import { discoverSkills } from './loader.js';
import { DefaultSkillRegistry } from './registry.js';
import { SkillRegistry } from './types.js';

let registry: SkillRegistry | null = null;

export async function initializeSkillRegistry(cwd: string): Promise<SkillRegistry> {
  const skills = await discoverSkills(cwd);
  registry = new DefaultSkillRegistry(skills);

  if (process.env.ZCLAW_SKILLS_DEBUG) {
    console.log(`[SKILLS] Loaded ${skills.length} skills`);
    for (const s of skills) {
      console.log(`[SKILLS]   - ${s.name} from ${s.source}`);
    }
  }

  return registry;
}

export function getSkillRegistry(): SkillRegistry | null {
  return registry;
}
```

- [ ] **Step 2: Add @path resolution inside `agent.chat()` for LLM-initiated skill activations**

In `src/agent.ts`, inside the `chat()` method, resolve @references in user messages before sending to the LLM. After `this.messages.push({ role: "user", content: userInput });`, add resolution:

```typescript
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
    // ... rest of existing chat method unchanged
```

Note: Remove the original `this.messages.push({ role: "user", content: userInput });` on line 85 since it's now replaced.

- [ ] **Step 3: Commit**

```bash
git add src/skills/index.ts src/agent.ts
git commit -m "feat(skills): export all new modules and add @path resolution in agent.chat()"
```

---

## Task 10: Build & Smoke Test

**Files:**
- None (verification only)

- [ ] **Step 1: Build the project**

```bash
npm run build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 2: Verify skills load correctly**

```bash
ZCLAW_SKILLS_DEBUG=1 node dist/index.js --no-interactive "hello"
```

Expected: `[SKILLS] Loaded N skills` with all existing skills listed. No errors from new types.

- [ ] **Step 3: Verify ~/zclaw_documents/ was created**

```bash
ls ~/zclaw_documents/
```

Expected: `notes/ templates/ output/ knowledge/ README.md`

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address build issues from skills system enhancement"
```

---

## Self-Review

### Spec Coverage
- Dynamic arguments ($1, $ALL, etc.): Tasks 3-4 ✓
- @path file references: Tasks 5-6 ✓
- ~/zclaw_documents/ workspace: Task 2 ✓
- Per-skill model selection: Task 7 ✓
- Disable model invocation: Task 8 ✓
- Backward compatibility: All tasks preserve existing behavior ✓

### Placeholder Scan
- No TBD/TODO/fill-in-later found ✓
- All code steps have complete implementations ✓
- All file paths are exact ✓

### Type Consistency
- `SkillFrontmatter.model` uses `SkillModelConfig` (defined in types.ts, used in agent.ts) ✓
- `ParsedArgs` exported from args.ts, used in index.ts ✓
- `parseInvocation` returns `{ skillName, args }` consistently ✓
