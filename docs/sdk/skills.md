---
title: Skills
description: Discover, load, and create reusable skill packages that extend ZClaw's capabilities.
---

# Skills

Skills are reusable instruction packages that give the agent specialized knowledge and procedures. They are loaded at runtime from directories and exposed to the LLM as the `use_skill` built-in tool.

## How skills work

1. Skills are discovered from directories (project, bundled, or custom paths).
2. Discovered skills appear in the agent's system prompt as available capabilities.
3. The LLM decides when to activate a skill by calling the `use_skill` tool.
4. When activated, the skill's instructions are injected into the conversation.

## Loading skills

### Automatic discovery

Skills are loaded automatically when you specify skill names:

```typescript
import { generateText } from "zclaw-core";

const result = await generateText("Deploy the staging environment", {
  skills: ["docker-ops"],
  tools: ["core"],
});
```

### With createAgent

```typescript
import { createAgent } from "zclaw-core";

const agent = await createAgent({
  skills: ["docker-ops", "code-review"],
  tools: ["core", "comm"],
});

const reply = await agent.chat("Review my latest commit");
```

## `initializeSkillRegistry()`

Bootstraps the skill registry by scanning skill directories. This is the public API for initializing skills programmatically:

```typescript
import { initializeSkillRegistry } from "zclaw-core";

// Scan the current working directory and configured paths for skills
await initializeSkillRegistry(process.cwd());
```

Call this at application startup to ensure skills are discovered before the first agent invocation. ZClaw calls this automatically when you pass `skills` to `generateText()` or `createAgent()`, but you may call it explicitly to pre-load skills or inspect the registry.

## Skill search paths

ZClaw searches for skills in the following locations, in priority order:

| Priority | Path                            | Source                        |
| -------- | ------------------------------- | ----------------------------- |
| 1        | `ZCLAW_SKILLS_PATH` env var     | Colon-separated custom paths  |
| 2        | `.zclaw/skills/`                | Project-level skills          |
| 3        | `/mnt/skills/`                  | Docker volume mount           |
| 4        | Bundled `skills/` directory     | Shipped with ZClaw            |

Higher-priority paths override skills with the same name from lower-priority paths.

### Custom skill paths

```bash
# Multiple paths, colon-separated
export ZCLAW_SKILLS_PATH=/opt/skills:/home/user/my-skills
```

```bash
# Disable bundled skills
export ZCLAW_NO_BUNDLED_SKILLS=1
```

## Skill metadata

Each skill exposes metadata for discovery and filtering:

```typescript
interface SkillMetadata {
  name: string;
  description: string;
  version: string;
  tags: string[];
  allowedTools?: string[];
}
```

## Creating custom skills

Skills are defined as `SKILL.md` files inside a named directory. The file uses YAML frontmatter followed by Markdown instructions:

### Directory structure

```
my-skills/
  docker-ops/
    SKILL.md
  code-review/
    SKILL.md
```

### SKILL.md format

```markdown
---
name: docker-ops
description: Docker container and image management operations
version: 1.2.0
author: engineering-team
tags:
  - docker
  - deployment
  - containers
allowedTools:
  - execute_shell_command
  - read_file
  - write_file
priority: 10
args:
  - environment
  - service
---

# Docker Operations Skill

You are a Docker operations specialist. Follow these procedures:

## Building Images

When asked to build a Docker image:
1. Check for an existing Dockerfile using read_file
2. Run: `docker build -t $1-$2 .`
3. Verify the image was created successfully

## Deploying

When deploying to environment $1:
1. Pull the latest image
2. Stop the existing container: `docker stop $2`
3. Start the new container: `docker run -d --name $2 ...`
```

### Frontmatter fields

| Field           | Type       | Required | Description                                                      |
| --------------- | ---------- | -------- | ---------------------------------------------------------------- |
| `name`          | `string`   | Yes      | Unique skill identifier (used in `skills: [...]` option)         |
| `description`   | `string`   | Yes      | Short description shown to the LLM for skill selection           |
| `version`       | `string`   | No       | Semantic version (defaults to `"1.0.0"`)                        |
| `author`        | `string`   | No       | Skill author                                                     |
| `tags`          | `string[]` | No       | Tags for categorization                                          |
| `allowedTools`  | `string[]` | No       | Restrict which tools this skill can use                          |
| `priority`      | `number`   | No       | Higher priority wins when skills have the same name (default: 0) |
| `args`          | `string[]` | No       | Named arguments this skill accepts                               |
| `model`         | `object`   | No       | Per-skill model selection (see below)                            |

### Per-skill model selection

You can specify a preferred provider and model for each skill:

```yaml
---
name: code-review
description: Perform code review
model:
  provider: anthropic
  model: claude-sonnet-4-6-20260320
---
```

## Argument substitution

Skill bodies support template variables that are replaced at invocation time.

### Positional arguments

Use `$1`, `$2`, ..., `$N` for positional arguments:

```markdown
Build and deploy the $2 service to the $1 environment.
```

Invoked as: `use_skill({ skill_name: "docker-ops", args: ["staging", "api-gateway"] })`

### Special variables

| Variable   | Description                                |
| ---------- | ------------------------------------------ |
| `$ALL`     | All arguments joined as a single string    |
| `$COUNT`   | Number of arguments passed                 |
| `$FIRST`   | First argument (same as `$1`)              |
| `$LAST`    | Last argument                              |

### Example with argument substitution

```markdown
---
name: deploy
description: Deploy a service to an environment
args:
  - environment
  - service
---

Deploy the $2 service to $1:

1. Build: `docker build -t $2:$1 .`
2. Push: `docker push registry/$2:$1`
3. Deploy: `kubectl apply -f k8s/$1/$2.yaml --namespace $1`
```

## The `use_skill` tool

Skills are exposed to the LLM as the `use_skill` built-in tool:

```typescript
// The LLM calls this automatically when a user request matches a skill
{
  name: "use_skill",
  arguments: {
    skill_name: "docker-ops",
    args: ["staging", "api-gateway"]
  }
}
```

You do not call `use_skill` directly. The LLM decides when to activate a skill based on the user's request and the skill descriptions in its system prompt.

## @path file references

Skills support `@path` references that inline file contents:

```markdown
Review the code in @src/index.ts and check @package.json for dependencies.
```

Supported patterns:

| Pattern                 | Resolves to                               |
| ----------------------- | ----------------------------------------- |
| `@path/to/file`        | Relative to project root (`process.cwd()`) |
| `@zclaw_documents/file` | `~/zclaw_documents/file`                  |
| `@~/path/to/file`      | Explicit home directory path              |

Files are inlined with syntax highlighting. Maximum 10 references per input, 1MB per file.

## Related APIs

- [generateText()](/sdk/generate-text) -- One-shot execution with skills
- [createAgent()](/sdk/create-agent) -- Stateful agent with skill support
- [Custom Tools](/sdk/custom-tools) -- Build custom tools
- [Types](/sdk/types) -- Full TypeScript type reference
