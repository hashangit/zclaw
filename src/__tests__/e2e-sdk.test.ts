import { describe, it, expect, vi, beforeEach } from "vitest";

import type { LLMProvider, ProviderResponse } from "../providers/types.js";

// Mock provider that returns a canned response
function mockProvider(response?: Partial<ProviderResponse>): LLMProvider {
  return {
    chat: vi.fn().mockResolvedValue({
      content: "Hello from zClaw!",
      ...response,
    }),
  } as unknown as LLMProvider;
}

describe("SDK e2e — generateText with mock provider", () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear any provider config singleton state between tests
    vi.restoreAllMocks();
  });

  it("runs generateText end-to-end", async () => {
    const provider = mockProvider();

    // Mock the provider-resolver module to inject our mock provider
    vi.doMock("../core/provider-resolver.js", () => ({
      getProvider: vi.fn().mockResolvedValue({
        provider,
        model: "mock-model",
      }),
      configureProviders: vi.fn(),
      provider: vi.fn(),
      getProviderConfig: vi.fn(),
      getDefaultProvider: vi.fn(),
      getDefaultProviderType: vi.fn(),
      saveConfig: vi.fn(),
    }));

    const { generateText } = await import("../adapters/sdk/index.js");

    const result = await generateText("Say hello", {
      tools: [],
      maxSteps: 1,
    });

    expect(result.text).toBe("Hello from zClaw!");
    expect(result.finishReason).toBe("stop");
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("fires hooks through the loop", async () => {
    const provider = mockProvider();

    vi.doMock("../core/provider-resolver.js", () => ({
      getProvider: vi.fn().mockResolvedValue({
        provider,
        model: "mock-model",
      }),
      configureProviders: vi.fn(),
      provider: vi.fn(),
      getProviderConfig: vi.fn(),
      getDefaultProvider: vi.fn(),
      getDefaultProviderType: vi.fn(),
      saveConfig: vi.fn(),
    }));

    const { generateText } = await import("../adapters/sdk/index.js");

    const onStep = vi.fn();
    const onError = vi.fn();
    const onFinish = vi.fn();

    await generateText("Ping", {
      tools: [],
      maxSteps: 1,
      hooks: { onStep, onError, onFinish },
    });

    expect(onStep).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalled();
  });

  it("passes system prompt to the provider", async () => {
    const chatFn = vi.fn().mockResolvedValue({
      content: "System acknowledged",
    });
    const provider = { chat: chatFn } as unknown as LLMProvider;

    vi.doMock("../core/provider-resolver.js", () => ({
      getProvider: vi.fn().mockResolvedValue({
        provider,
        model: "mock-model",
      }),
      configureProviders: vi.fn(),
      provider: vi.fn(),
      getProviderConfig: vi.fn(),
      getDefaultProvider: vi.fn(),
      getDefaultProviderType: vi.fn(),
      saveConfig: vi.fn(),
    }));

    const { generateText } = await import("../adapters/sdk/index.js");

    await generateText("Hello", {
      tools: [],
      maxSteps: 1,
      systemPrompt: "You are a test assistant.",
    });

    // First arg to chat() is messages array — should have a system message
    const messages = chatFn.mock.calls[0][0];
    const systemMsg = messages.find((m: any) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain("You are a test assistant.");
  });
});
