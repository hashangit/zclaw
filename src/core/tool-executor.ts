/**
 * ZClaw Core — Tool executor
 *
 * Tool registry, resolution, factory, and execution logic.
 * Transport-agnostic: no chalk, no HTTP, no CLI concerns.
 */

import { builtInTools } from "../tools/index.js";
import { ToolModule, ToolDefinition } from "../tools/interface.js";
import {
  UserToolDefinition,
  ToolContext,
  ToolResult,
} from "./types.js";

// ── Internal registry ───────────────────────────────────────────────

const registry: ToolModule[] = [...builtInTools];

/**
 * Return the tool definitions for all registered tools (built-in + custom).
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  return registry.map((t) => t.definition);
}

// ── Tool groups ──────────────────────────────────────────────────────

export const CORE_TOOLS = [
  "execute_shell_command",
  "read_file",
  "write_file",
  "get_current_datetime",
];

export const COMM_TOOLS = [
  "send_email",
  "web_search",
  "send_notification",
];

export const ADVANCED_TOOLS = [
  "read_website",
  "take_screenshot",
  "generate_image",
  "optimize_prompt",
  "use_skill",
];

export const ALL_TOOLS = [...CORE_TOOLS, ...COMM_TOOLS, ...ADVANCED_TOOLS];

// ── Helpers ──────────────────────────────────────────────────────────

let customToolCounter = 0;

/**
 * Convert a Zod-like schema or plain parameter object into JSON Schema.
 *
 * Handles:
 *  - Zod schemas that expose a `.toJsonSchema()` or `_def` shape
 *  - Plain `{ type: "object", properties: {...}, required: [...] }` objects
 *  - Anything else is wrapped in a generic object schema
 */
function parametersToJsonSchema(parameters: unknown): Record<string, unknown> {
  if (parameters == null || typeof parameters !== "object") {
    return { type: "object", properties: {} };
  }

  // Already a plain JSON Schema object
  if (
    "type" in (parameters as Record<string, unknown>) &&
    "properties" in (parameters as Record<string, unknown>)
  ) {
    return parameters as Record<string, unknown>;
  }

  // Zod-like schema with a `.parse` method — try known conversion paths
  const zod = parameters as Record<string, unknown>;
  if (typeof zod.parse === "function" || typeof zod.safeParse === "function") {
    // zod-to-json-schema style: `_def` is the Zod internals marker
    if (typeof zod._def === "object" && zod._def !== null) {
      // Attempt to use zod-to-json-schema if available at runtime
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { zodToJsonSchema } = require("zod-to-json-schema");
        const schema = zodToJsonSchema(parameters);
        // zod-to-json-schema wraps in `{ $schema, ... }`; return the core
        const { $schema, ...rest } = schema as Record<string, unknown>;
        return rest;
      } catch {
        // zod-to-json-schema not installed — fall back to generic schema
      }
    }

    // Fallback: try calling a `toJsonSchema` method if the schema defines one
    if (typeof zod.toJsonSchema === "function") {
      return zod.toJsonSchema() as Record<string, unknown>;
    }

    // Last resort for Zod schemas we can't introspect
    return { type: "object", properties: {} };
  }

  // Unknown shape — wrap generically
  return { type: "object", properties: {} };
}

/**
 * Generate a unique tool name when the user doesn't supply one.
 */
function generateToolName(): string {
  customToolCounter += 1;
  return `custom_tool_${customToolCounter}`;
}

// ── tool() factory ───────────────────────────────────────────────────

/**
 * Create a custom tool module from a Zod-like schema definition.
 *
 * Returns a `ToolModule` compatible with the built-in tool registry,
 * so custom tools can be mixed freely with built-in ones.
 *
 * @example
 * ```ts
 * const myTool = tool({
 *   description: "Greets a person",
 *   parameters: z.object({ name: z.string() }),
 *   execute: async ({ name }) => `Hello, ${name}!`,
 * });
 * ```
 */
export function tool(definition: UserToolDefinition): ToolModule {
  const functionName = definition.name ?? generateToolName();

  const jsonSchema = parametersToJsonSchema(definition.parameters);

  const openaiDefinition: ToolDefinition = {
    type: "function",
    function: {
      name: functionName,
      description: definition.description,
      parameters: {
        type: (jsonSchema.type as "object") ?? "object",
        properties: (jsonSchema.properties as Record<string, unknown>) ?? {},
        required: (jsonSchema.required as string[]) ?? [],
      },
    },
  };

  const handler: ToolModule["handler"] = async (args: unknown, config?: any) => {
    const context: ToolContext = {
      config: config ?? {},
    };

    const raw = await definition.execute(args, context);

    // The execute function may return a plain string or a structured ToolResult
    if (typeof raw === "string") {
      return raw;
    }

    const result = raw as ToolResult;
    if (result && typeof result === "object" && "output" in result) {
      return result.output;
    }

    // Unexpected return shape — coerce to string
    return String(raw);
  };

  return {
    name: functionName,
    definition: openaiDefinition,
    handler,
  };
}

// ── registerTool ──────────────────────────────────────────────────────

/**
 * Register a tool module in the global tool registry.
 *
 * @param module  A `ToolModule` to add to the registry
 */
export function registerTool(module: ToolModule): void {
  registry.push(module);
}

// ── executeTool ───────────────────────────────────────────────────────

/**
 * Execute a tool by name with the given arguments and optional config.
 *
 * @param name    Tool function name (e.g. "execute_shell_command")
 * @param args    Arguments object for the tool
 * @param config  Optional runtime config passed to the tool handler
 * @returns       Tool output as a string
 * @throws        Error if the tool name is not found in the registry
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  config?: Record<string, unknown>,
): Promise<string> {
  const found = registry.find(
    (t) => t.definition.function.name === name,
  );
  if (!found) {
    throw new Error(
      `Unknown tool "${name}". Available: ${registry
        .map((t) => t.definition.function.name)
        .join(", ")}`,
    );
  }
  return found.handler(args, config);
}

// ── getToolGroup ─────────────────────────────────────────────────────

/**
 * Return the built-in tool definitions belonging to a named group.
 *
 * @param group  One of "core", "comm", "advanced", or "all"
 * @returns      Array of OpenAI function definitions for the matching tools
 * @throws       Error if the group name is not recognised
 */
export function getToolGroup(
  group: "core" | "comm" | "advanced" | "all",
): ToolDefinition[] {
  let names: string[];

  switch (group) {
    case "core":
      names = CORE_TOOLS;
      break;
    case "comm":
      names = COMM_TOOLS;
      break;
    case "advanced":
      names = ADVANCED_TOOLS;
      break;
    case "all":
      names = ALL_TOOLS;
      break;
    default:
      throw new Error(
        `Unknown tool group "${group}". Valid groups: core, comm, advanced, all`,
      );
  }

  const defs: ToolDefinition[] = [];

  for (const name of names) {
    const found = registry.find(
      (t) => t.definition.function.name === name,
    );
    if (found) {
      defs.push(found.definition);
    }
  }

  return defs;
}

// ── resolveTools ─────────────────────────────────────────────────────

type ToolInput = string | UserToolDefinition;

/**
 * Resolve a mixed array of tool references into concrete OpenAI function
 * definitions ready to send to the LLM.
 *
 * Accepted input shapes:
 *  - `"all"`                     — expands to all built-in tools
 *  - `"core"` / `"comm"` / `"advanced"` — expands to the named group
 *  - A built-in tool name string — looked up from the internal registry
 *  - A `UserToolDefinition` object   — converted via `tool()` factory
 *
 * @param tools  Array of tool references (defaults to all built-in tools)
 * @returns      Deduplicated array of OpenAI function definitions
 * @throws       Error if a string name is not found in the built-in registry
 */
export function resolveTools(tools?: ToolInput[]): ToolDefinition[] {
  const inputs = tools ?? ["all"];

  const seen = new Set<string>();
  const result: ToolDefinition[] = [];

  for (const input of inputs) {
    // String reference — group name or built-in tool name
    if (typeof input === "string") {
      // Group expansion
      if (input === "all" || input === "core" || input === "comm" || input === "advanced") {
        const groupDefs = getToolGroup(input);
        for (const def of groupDefs) {
          const name = def.function.name;
          if (!seen.has(name)) {
            seen.add(name);
            result.push(def);
          }
        }
        continue;
      }

      // Individual built-in tool lookup
      const found = registry.find(
        (t) => t.definition.function.name === input,
      );
      if (!found) {
        throw new Error(
          `Unknown tool "${input}". Available: ${registry
            .map((t) => t.definition.function.name)
            .join(", ")}`,
        );
      }
      const name = found.definition.function.name;
      if (!seen.has(name)) {
        seen.add(name);
        result.push(found.definition);
      }
      continue;
    }

    // ToolDefinition object — convert via factory
    const module = tool(input);
    const name = module.definition.function.name;
    if (!seen.has(name)) {
      seen.add(name);
      result.push(module.definition);
    }
  }

  return result;
}
