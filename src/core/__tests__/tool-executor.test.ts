import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveTools,
  getAllToolDefinitions,
  registerTool,
  tool,
  CORE_TOOLS,
  COMM_TOOLS,
  ADVANCED_TOOLS,
  ALL_TOOLS,
} from "../tool-executor.js";

// We test against the real built-in registry.
// registerTool is global so we must be careful not to pollute across tests.

describe("getAllToolDefinitions", () => {
  it("returns at least the core tools", () => {
    const defs = getAllToolDefinitions();
    const names = defs.map((d) => d.function.name);
    for (const name of CORE_TOOLS) {
      expect(names).toContain(name);
    }
  });
});

describe("resolveTools", () => {
  it("defaults to all built-in tools", () => {
    const defs = resolveTools();
    const names = defs.map((d) => d.function.name);
    // Should contain at least the core tools
    for (const name of CORE_TOOLS) {
      expect(names).toContain(name);
    }
  });

  it('expands "core" group', () => {
    const defs = resolveTools(["core"]);
    const names = defs.map((d) => d.function.name);
    expect(names).toEqual(expect.arrayContaining(CORE_TOOLS));
    // Should not contain comm or advanced tools
    for (const name of COMM_TOOLS) {
      expect(names).not.toContain(name);
    }
  });

  it('expands "comm" group', () => {
    const defs = resolveTools(["comm"]);
    const names = defs.map((d) => d.function.name);
    expect(names).toEqual(expect.arrayContaining(COMM_TOOLS));
  });

  it('expands "advanced" group', () => {
    const defs = resolveTools(["advanced"]);
    const names = defs.map((d) => d.function.name);
    expect(names).toEqual(expect.arrayContaining(ADVANCED_TOOLS));
  });

  it("deduplicates when same tool appears in multiple groups", () => {
    const defs = resolveTools(["core", "all"]);
    const names = defs.map((d) => d.function.name);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });

  it("resolves individual built-in tool by name", () => {
    const defs = resolveTools(["read_file"]);
    const names = defs.map((d) => d.function.name);
    expect(names).toEqual(["read_file"]);
  });

  it("throws on unknown tool name", () => {
    expect(() => resolveTools(["nonexistent_tool"])).toThrow('Unknown tool "nonexistent_tool"');
  });

  it("converts UserToolDefinition via factory", () => {
    const defs = resolveTools([
      {
        description: "custom tool",
        parameters: { type: "object", properties: { x: { type: "string" } } },
        execute: vi.fn().mockResolvedValue("ok"),
      },
    ]);
    expect(defs).toHaveLength(1);
    expect(defs[0].function.description).toBe("custom tool");
    // Auto-generated name starts with "custom_tool_"
    expect(defs[0].function.name).toMatch(/^custom_tool_\d+$/);
  });

  it("uses provided name from UserToolDefinition", () => {
    const defs = resolveTools([
      {
        name: "my_tool",
        description: "named tool",
        parameters: { type: "object", properties: {} },
        execute: vi.fn().mockResolvedValue("ok"),
      },
    ]);
    expect(defs[0].function.name).toBe("my_tool");
  });
});

describe("tool() factory", () => {
  it("creates a ToolModule with correct definition shape", () => {
    const mod = tool({
      name: "greeter",
      description: "Says hi",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      execute: async (args) => `Hello, ${(args as { name: string }).name}!`,
    });

    expect(mod.name).toBe("greeter");
    expect(mod.definition.type).toBe("function");
    expect(mod.definition.function.name).toBe("greeter");
    expect(mod.definition.function.description).toBe("Says hi");
  });

  it("handler returns string from execute", async () => {
    const mod = tool({
      name: "echo",
      description: "echo",
      parameters: { type: "object", properties: {} },
      execute: async () => "pong",
    });
    const result = await mod.handler({}, undefined);
    expect(result).toBe("pong");
  });

  it("handler extracts output from ToolResult object", async () => {
    const mod = tool({
      name: "structured",
      description: "returns structured",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ output: "structured result", success: true }),
    });
    const result = await mod.handler({}, undefined);
    expect(result).toBe("structured result");
  });

  it("handler coerces unexpected return to string", async () => {
    const mod = tool({
      name: "weird",
      description: "returns number",
      parameters: { type: "object", properties: {} },
      execute: async () => 42 as any,
    });
    const result = await mod.handler({}, undefined);
    expect(result).toBe("42");
  });
});

describe("registerTool", () => {
  it("adds a tool to the registry", () => {
    const mod = tool({
      name: "test-register-tool",
      description: "test",
      parameters: { type: "object", properties: {} },
      execute: async () => "ok",
    });
    registerTool(mod);

    const defs = getAllToolDefinitions();
    const names = defs.map((d) => d.function.name);
    expect(names).toContain("test-register-tool");
  });
});

describe("tool groups", () => {
  it("CORE_TOOLS contains expected values", () => {
    expect(CORE_TOOLS).toContain("execute_shell_command");
    expect(CORE_TOOLS).toContain("read_file");
    expect(CORE_TOOLS).toContain("write_file");
    expect(CORE_TOOLS).toContain("get_current_datetime");
  });

  it("ALL_TOOLS is union of all groups", () => {
    const expected = [...CORE_TOOLS, ...COMM_TOOLS, ...ADVANCED_TOOLS];
    expect(ALL_TOOLS).toEqual(expected);
  });
});
