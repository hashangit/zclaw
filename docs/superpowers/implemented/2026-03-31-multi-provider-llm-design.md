# Multi-Provider LLM Design

## Goal

Support 4 LLM inference providers in ZClaw, selectable during setup and switchable at runtime via `/models` command.

## Providers

| # | Name | SDK | Config |
|---|------|-----|--------|
| 1 | OpenAI API Compatible | `openai` | User sets apiKey, baseUrl, model |
| 2 | OpenAI Official | `openai` | User sets apiKey; baseUrl hardcoded to `https://api.openai.com/v1` |
| 3 | Anthropic Official | `@anthropic-ai/sdk` | User sets apiKey, model |
| 4 | GLM Code Plan | `@anthropic-ai/sdk` | User sets apiKey; baseUrl=`https://api.z.ai/api/anthropic`, timeout=3000000ms, model mapping (haiku→glm-4.5-air, sonnet→glm-4.7, opus→glm-5.1) |

## Architecture: Provider Abstraction Layer

### New files

```
src/providers/
  types.ts       — ProviderType, unified message/response types, LLMProvider interface
  openai.ts      — OpenAIProvider (handles both official + compatible)
  anthropic.ts   — AnthropicProvider (official Anthropic + reused by GLM)
  factory.ts     — createProvider(config) → LLMProvider
```

### Modified files

- `src/agent.ts` — depends on `LLMProvider` interface instead of `OpenAI` directly; adds `switchProvider()` method
- `src/index.ts` — new config shape, revised setup wizard, `/models` command in chat loop, `--provider` CLI flag
- `src/tools/image.ts` — no changes (stays OpenAI SDK)
- `package.json` — add `@anthropic-ai/sdk` dependency

## Unified Types (src/providers/types.ts)

```typescript
export type ProviderType = 'openai-compatible' | 'openai' | 'anthropic' | 'glm';

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: ProviderToolCall[];
  tool_call_id?: string;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProviderResponse {
  content?: string;
  tool_calls?: ProviderToolCall[];
}

export interface LLMProvider {
  chat(messages: ProviderMessage[], tools: any[]): Promise<ProviderResponse>;
}
```

## Provider Implementations

### OpenAI Provider (src/providers/openai.ts)

- Uses existing `openai` SDK
- `openai-compatible`: user-provided baseURL
- `openai`: hardcoded baseURL `https://api.openai.com/v1`
- Tool definitions pass through directly (already in OpenAI function calling format)
- Maps OpenAI response to `ProviderResponse`:
  - `message.content` → `response.content`
  - `message.tool_calls` → `response.tool_calls` (rename `function.name`/`function.arguments`)

### Anthropic Provider (src/providers/anthropic.ts)

- Uses `@anthropic-ai/sdk`
- Message format translation:
  - `system` messages → separate `system` param in `client.messages.create()`
  - `assistant` with `tool_calls` → content block `tool_use`
  - `tool` role messages → `user` role with `tool_result` content block
- Tool definition translation:
  - OpenAI `{type:"function", function:{name, description, parameters}}` → Anthropic `{name, description, input_schema}`
- Response translation:
  - `content` blocks of type `text` → `response.content`
  - `content` blocks of type `tool_use` → `response.tool_calls`

### GLM Code Plan (reuses anthropic.ts via factory)

Factory creates AnthropicProvider with pre-configured values:
- `baseURL: "https://api.z.ai/api/anthropic"`
- `timeout: 3000000`
- Model mapping: user selects tier (`haiku`/`sonnet`/`opus`) → mapped to actual model ID

### Factory (src/providers/factory.ts)

Single function `createProvider(type, apiKey, model, options?)` that returns the correct `LLLMProvider` instance.

## Config Structure

```typescript
interface AppConfig {
  provider: ProviderType;           // active provider
  apiKey: string;                   // active provider's key
  baseUrl?: string;                 // for openai-compatible
  model: string;                    // active model

  models: {
    openai?: { apiKey: string; model: string; };
    'openai-compatible'?: { apiKey: string; baseUrl: string; model: string; };
    anthropic?: { apiKey: string; model: string; };
    glm?: { apiKey: string; model: string; };  // model = 'haiku'|'sonnet'|'opus'
  };

  // Image gen (always OpenAI)
  imageApiKey?: string;
  imageBaseUrl?: string;
  imageModel?: string;

  // Existing tools (unchanged)
  smtpHost?: string;
  // ... etc
}
```

## Setup Wizard Changes

1. **Multi-select**: "Which providers do you want to configure?" (checkbox)
   - OpenAI API Compatible
   - OpenAI Official
   - Anthropic Official
   - GLM Code Plan

2. **Per-provider questions**: For each selected, ask apiKey, model (and baseUrl for openai-compatible)
   - GLM: model selection is tier (haiku/sonnet/opus), internally mapped
   - Anthropic: model selection from list (claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001, etc.)

3. **Default provider**: "Which provider should be active by default?"

4. **Optional extras**: Image gen (requires OpenAI key), Email, Search, Notifications

## /models Slash Command

Available in the interactive chat loop. Behavior:

1. User types `/models`
2. Lists all configured providers with their models, marking the active one
3. User selects a provider to switch to
4. Agent calls `agent.switchProvider(newProvider)` which:
   - Creates new LLMProvider via factory
   - Resets message history (or keeps it — system prompt preserved)
   - Updates spinner text to show new provider

## CLI Flag

`--provider` flag overrides the config default for that session:
```
zclaw --provider anthropic "Hello"
zclaw --provider glm -m sonnet "Write code"
```

Priority: CLI `--provider` > env `ZCLAW_PROVIDER` > config `provider`

## Agent Class Changes

```typescript
class Agent {
  private provider: LLMProvider;
  private messages: ProviderMessage[];
  private config: any;

  constructor(provider: LLMProvider, model: string, config: any) { ... }

  switchProvider(provider: LLMProvider, model: string) {
    this.provider = provider;
    this.model = model;
  }

  async chat(userInput: string) {
    // Uses this.provider.chat() instead of OpenAI client
    // Rest of loop logic is the same, just using unified types
  }
}
```

## Image Generation

No changes. `src/tools/image.ts` continues using OpenAI SDK directly. If user hasn't configured `imageApiKey` (OpenAI key), image generation tool is unavailable.

## Dependencies

Add: `@anthropic-ai/sdk` (latest)
Keep: `openai` (existing)
