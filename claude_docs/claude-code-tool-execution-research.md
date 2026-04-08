# Claude Code Tool Execution Research

## Executive Summary

**Key Finding**: Claude Code does **NOT** parse tool calls from text using regex. Instead, it uses the structured `tool_use` content blocks provided by the Anthropic API. This is the deterministic, reliable approach that your "direct executor" should adopt.

## Current Problem with zclaw

Your current implementation tries to parse freeform text:
```typescript
// Fragile regex-based parsing
/```bash\n([\s\S]*?)```/g  // Extract shell commands
/write_file\(\s*path:\s*["']([^"']+)["']\s*,\s*content:\s*["']([\s\S]*?)["']\s*\)/g  // Extract file writes
```

**Problems**:
- Breaks if LLM formats output differently
- No structured validation
- Fragile to prompt variations
- Violates "precise system APIs" principle

## How Claude Code Solves This

### 1. Structured API Response Format

The Anthropic API returns **structured content blocks**, not text:

```typescript
// API response structure
{
  stop_reason: "tool_use",
  content: [
    {
      type: "tool_use",
      id: "toolu_01A1B2C3D4E5F6G7H8I9J0K1",
      name: "execute_shell_command",
      input: {
        command: "ls -la",
        rationale: "List files in current directory"
      }
    }
  ]
}
```

### 2. Deterministic Extraction Pattern

```typescript
// From Anthropic SDK examples
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const message = await client.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 1024,
  tools: [...],  // Your tool definitions
  messages: [{ role: 'user', content: 'Your prompt here' }]
});

// Check if Claude wants to use a tool
if (message.stop_reason === 'tool_use') {
  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  );

  if (toolUse) {
    console.log(`Tool: ${toolUse.name}`);
    console.log(`Input: ${JSON.stringify(toolUse.input)}`);

    // Execute tool deterministically
    const result = await executeTool(toolUse.name, toolUse.input);

    // Send result back
    await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      tools,
      messages: [
        { role: 'user', content: '...' },
        { role: 'assistant', content: message.content },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result
          }]
        }
      ]
    });
  }
}
```

### 3. ToolUseBlock Structure

```typescript
interface ToolUseBlock {
  type: 'tool_use';
  id: string;              // Unique tool call ID
  name: string;            // Tool function name
  input: Record<string, any>;  // Structured parameters
}
```

**No regex needed** - all data is structured!

## Claude Code's Tool Execution Pipeline

### 1. Tool Registration

```typescript
// Tools registered with JSON Schema
const tools = [
  {
    name: 'execute_shell_command',
    description: 'Execute a shell command',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        rationale: { type: 'string' }
      },
      required: ['command', 'rationale']
    }
  }
];
```

### 2. Pre-Tool Execution Hooks (Claude Code Feature)

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "python3 /path/to/validator.py"
      }]
    }]
  }
}
```

The hook receives **structured input**:

```python
import json
import sys

input_data = json.load(sys.stdin)
tool_name = input_data.get("tool_name")
tool_input = input_data.get("tool_input", {})

command = tool_input.get("command", "")
# Validate and return decision
```

### 3. Tool Dispatch

```typescript
// Claude Code internally structures calls like this:
{
  toolName: "mcp__plugin_asana_asana__asana_create_task",
  input: {
    name: "Review PR #123",
    notes: "Code review for new feature",
    workspace: "12345"
  }
}
```

## Recommended Pattern for zclaw

### Option 1: Use Anthropic SDK Properly (Recommended)

```typescript
import Anthropic from '@anthropic-ai/sdk';

class ToolExecutor {
  private client: Anthropic;
  private tools: Map<string, ToolModule>;

  constructor(apiKey: string, tools: ToolModule[]) {
    this.client = new Anthropic({ apiKey });
    this.tools = new Map(tools.map(t => [t.definition.function.name, t]));
  }

  async processUserMessage(userMessage: string): Promise<string> {
    // Convert tools to Anthropic format
    const anthropicTools = Array.from(this.tools.values()).map(
      t => t.definition
    );

    // Get response from Claude
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      tools: anthropicTools,
      messages: [{ role: 'user', content: userMessage }]
    });

    // Handle tool use deterministically
    if (response.stop_reason === 'tool_use') {
      return await this.handleToolUse(response, anthropicTools);
    }

    return response.content[0].text;
  }

  private async handleToolUse(
    response: Anthropic.Message,
    tools: Anthropic.Tool[]
  ): Promise<string> {
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    // Execute all tools in parallel
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const tool = this.tools.get(block.name);
        if (!tool) {
          throw new Error(`Unknown tool: ${block.name}`);
        }

        const result = await tool.handler(block.input, this.config);
        return {
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: result
        };
      })
    );

    // Send results back to Claude
    const finalResponse = await this.client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      tools,
      messages: [
        { role: 'user', content: this.lastUserMessage },
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults }
      ]
    });

    return finalResponse.content[0].text;
  }
}
```

### Option 2: Direct API Integration

If you want to avoid the SDK overhead:

```typescript
async function callAnthropicAPI(
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[]
): Promise<Anthropic.Message> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      tools,
      messages
    })
  });

  return response.json();
}

// Process response
const response = await callAnthropicAPI(messages, tools);

if (response.stop_reason === 'tool_use') {
  for (const block of response.content) {
    if (block.type === 'tool_use') {
      // Direct access to structured data
      const toolName = block.name;
      const toolInput = block.input;
      const toolId = block.id;

      // Execute
      const result = await executeTool(toolName, toolInput);

      // Send back
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolId,
          content: result
        }]
      });
    }
  }
}
```

## Key Differences: Text Parsing vs Structured Blocks

| Aspect | Text Parsing (Current) | Structured Blocks (Recommended) |
|--------|----------------------|--------------------------------|
| **Reliability** | Fragile, breaks on format changes | 100% reliable |
| **Validation** | Manual regex validation | Built-in schema validation |
| **Type Safety** | None | Full TypeScript types |
| **Error Handling** | Parse errors | Structured error responses |
| **Multi-tool** | Complex regex chains | Natural iteration |
| **Maintenance** | High (update regexes) | Low (API handles it) |

## Migration Path

### Step 1: Update Tool Definitions

```typescript
// Current
export const ShellTool: ToolModule = {
  name: "Shell Execution",
  definition: {
    type: "function",
    function: {
      name: "execute_shell_command",
      description: "...",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          rationale: { type: "string" }
        },
        required: ["command", "rationale"]
      }
    }
  },
  handler: async (args: any) => { ... }
};

// This format is actually compatible with Anthropic's format!
// Just need to use it properly
```

### Step 2: Replace Direct Executor

```typescript
// Remove: src/skills/direct-executor.ts (regex-based)

// Replace with: src/agent/tool-executor.ts
export class ToolExecutor {
  async executeToolsFromResponse(
    response: Anthropic.Message
  ): Promise<ToolResult[]> {
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    return Promise.all(
      toolUseBlocks.map(block => this.executeSingleTool(block))
    );
  }

  private async executeSingleTool(
    block: Anthropic.ToolUseBlock
  ): Promise<ToolResult> {
    const tool = this.registry.get(block.name);
    if (!tool) {
      throw new Error(`Tool not found: ${block.name}`);
    }

    const result = await tool.handler(block.input, this.config);

    return {
      toolUseId: block.id,
      content: result,
      isError: false
    };
  }
}
```

### Step 3: Update Agent Loop

```typescript
async function runAgent(userMessage: string): Promise<void> {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage }
  ];

  while (true) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      tools: toolRegistry.toAnthropicFormat(),
      messages
    });

    if (response.stop_reason === 'tool_use') {
      const toolResults = await toolExecutor.executeToolsFromResponse(response);

      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: toolResults.map(r => ({
          type: 'tool_result',
          tool_use_id: r.toolUseId,
          content: r.content,
          is_error: r.isError
        }))
      });
    } else {
      // Final response
      console.log(response.content[0].text);
      break;
    }
  }
}
```

## Summary

**Does Claude Code parse tool calls from text?**
**NO** - It uses structured `tool_use` content blocks from the Anthropic API.

**How does the SDK deliver tool calls?**
As structured `ToolUseBlock` objects with `type`, `id`, `name`, and `input` fields.

**Recommended pattern for deterministic tool execution:**
1. Define tools with JSON Schema
2. Send tools to API in `tools` parameter
3. Check if `stop_reason === 'tool_use'`
4. Filter content blocks for `type === 'tool_use'`
5. Extract `name` and `input` directly (no parsing!)
6. Execute tool and send back `tool_result` block
7. Continue conversation loop

This approach is:
- **Deterministic**: No regex, no parsing
- **Type-safe**: Full TypeScript support
- **Reliable**: API guarantees structure
- **Maintainable**: Schema-driven
- **Scalable**: Handles multi-tool calls naturally

## Files Referenced

- `/Users/hashanw/Developer/zclaw/src/tools/core.ts` - Current tool definitions
- `/Users/hashanw/Developer/zclaw/src/tools/image.ts` - Example complex tool
- `/Users/hashanw/Developer/zclaw/src/tools/screenshot.ts` - Example tool with validation

## Next Steps

1. Review current agent implementation in `/Users/hashanw/Developer/zclaw/src/agent.ts`
2. Identify where text parsing is happening
3. Replace with structured `tool_use` block processing
4. Test with existing tools (they're already compatible!)
5. Remove regex-based direct executor
