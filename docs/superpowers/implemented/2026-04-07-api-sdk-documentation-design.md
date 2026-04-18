# ZClaw API/SDK + Documentation Design

**Date:** 2026-04-07
**Status:** Draft
**Scope:** Node.js SDK, Remote Server API, VitePress documentation site

---

## 1. Overview

ZClaw is a headless AI agent framework with multi-provider LLM support, 11 built-in tools, and a skills system. This spec defines three deliverables:

1. **Node.js SDK** — developers `npm install zclaw` and use it as a library in their own apps
2. **Remote Server** — deploy zclaw as a container (Docker/Cloud Run) with WebSocket + REST API
3. **Documentation Site** — VitePress site with guides, API reference, and deployment instructions

### Design Principles

- **3-line hello world** — dead simple to start
- **Functional API** — `generateText()` / `streamText()`, not class-heavy
- **Progressive disclosure** — simple functions first, `createAgent()` for stateful, `createSubagent()` for multi-agent
- **Multi-provider first** — OpenAI, Anthropic, GLM, OpenAI-compatible with one-line switching
- **Batteries included** — 11 built-in tools, skills system, cost tracking out of the box
- **Type-safe** — no `any` at boundaries, Zod schemas for tools and structured output

### Competitive Positioning

| Feature | ZClaw | Vercel AI SDK | Claude Agent SDK | Pi Agent | OpenAI Agents |
|---|:---:|:---:|:---:|:---:|:---:|
| Multi-provider | YES | No | No | No | No |
| 11 built-in tools | YES | No | No | No | No |
| Skills system | YES | No | No | No | No |
| Docker-native | YES | No | No | No | No |
| Per-skill model selection | YES | No | No | No | No |
| Functional API | YES | YES | No | No | No |
| WebSocket server | YES | No | No | No | No |

---

## 2. Node.js SDK

### 2.1 Package Structure

```
zclaw/
├── src/sdk/index.ts         # Public exports: generateText, streamText, createAgent, tool
├── src/sdk/types.ts          # All TypeScript interfaces
├── src/sdk/agent.ts          # createAgent() implementation
├── src/sdk/tools.ts          # tool() factory + built-in tool registry
├── src/sdk/hooks.ts          # Lifecycle hooks system
├── src/sdk/http.ts           # toResponse(), toSSEStream() helpers
├── src/sdk/skills.ts         # Skills SDK integration
├── src/sdk/providers.ts      # configureProviders(), provider switching
├── src/sdk/session.ts        # Session persistence
├── src/sdk/react.ts          # useChat() React hook
├── src/server/index.ts       # WebSocket + REST server (zclaw-server package)
├── src/providers/            # Existing provider implementations
├── src/tools/                # Existing tool implementations
├── src/skills/               # Existing skills system
└── docs/                     # VitePress documentation site
```

### 2.2 Core API: `generateText()`

Non-blocking, returns full result. For 90% of use cases.

```typescript
async function generateText(
  prompt: string,
  options?: GenerateTextOptions
): Promise<GenerateTextResult>
```

**Options:**

```typescript
interface GenerateTextOptions {
  // Provider
  model?: string;                          // "claude-sonnet-4-6", "gpt-4o", etc.
  provider?: ProviderType;                 // "openai" | "anthropic" | "glm" | "openai-compatible"
  systemPrompt?: string;

  // Tools & Skills
  tools?: string[] | ToolDefinition[];     // Built-in names or custom tools, "all" for everything
  skills?: string[];                       // Skills to activate

  // Execution control
  maxSteps?: number;                       // Multi-step tool loops (default: 10)
  temperature?: number;
  maxTokens?: number;

  // Structured output
  output?: ZodSchema;                      // Zod schema for typed response

  // Hooks & events
  hooks?: Hooks;
  signal?: AbortSignal;                    // Standard Web API abort

  // Advanced
  config?: AgentConfig;                    // Full config override
}

interface GenerateTextResult {
  text: string;
  data?: unknown;                          // Present when `output` schema provided
  error?: { message: string; issues: any }; // Present when schema validation fails
  steps: StepResult[];
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: "stop" | "length" | "max_steps" | "error";
  messages: Message[];                     // Full conversation for multi-turn
}
```

**Usage:**

```typescript
import { generateText } from 'zclaw';

// Hello world (3 lines)
const { text } = await generateText("What's 2+2?");
console.log(text);

// With tools + multi-step
const { text, steps } = await generateText(
  "Read package.json and list all dependencies",
  { tools: ["read_file"], maxSteps: 5 }
);

// Structured output
import { z } from 'zod';
const { data, error } = await generateText("Analyze the logs", {
  output: z.object({
    errors: z.array(z.object({ line: z.number(), message: z.string() })),
    summary: z.string(),
    severity: z.enum(["low", "medium", "high"]),
  }),
});
if (data) console.log(data.errors); // fully typed
```

### 2.3 Streaming API: `streamText()`

Real-time streaming with tool execution visibility.

```typescript
async function streamText(
  prompt: string,
  options?: StreamTextOptions
): Promise<StreamTextResult>
```

**Options extend GenerateTextOptions with callbacks:**

```typescript
interface StreamTextOptions extends GenerateTextOptions {
  onText?: (delta: string) => void;
  onToolCall?: (tool: { name: string; args: Record<string, unknown>; callId: string }) => void;
  onToolResult?: (result: { callId: string; output: string; success: boolean }) => void;
  onStep?: (step: StepResult) => void;
  onError?: (error: ZclawError) => void;
}

interface StreamTextResult {
  textStream: AsyncIterable<string>;
  steps: AsyncIterable<StepResult>;
  fullText: Promise<string>;
  usage: Promise<Usage>;
  finishReason: Promise<string>;
  abort: () => void;
  toResponse: (res?: ServerResponse) => Response;   // HTTP SSE helper
  toSSEStream: () => ReadableStream;                 // Raw SSE stream
}
```

**Usage:**

```typescript
import { streamText } from 'zclaw';

// CLI streaming
const result = await streamText("Deploy the app", {
  tools: ["execute_shell_command"],
  onText: (chunk) => process.stdout.write(chunk),
  onToolCall: (tool) => console.log(`Running: ${tool.name}`),
  onToolResult: (r) => console.log(`Done: ${r.output}`),
});

// Abort mid-execution
result.abort();

// HTTP one-liner (Express/Next.js/Hono)
app.post('/api/chat', async (req, res) => {
  const result = await streamText(req.body.prompt);
  return result.toResponse(res);
});

// Async iteration
for await (const step of result.steps) {
  if (step.type === "tool_call") console.log(step.toolCall);
}
const final = await result.fullText;
```

### 2.4 Persistent Agent: `createAgent()`

Stateful agent with session memory, provider switching, and abort.

```typescript
function createAgent(options?: AgentCreateOptions): Agent

interface AgentCreateOptions {
  model?: string;
  provider?: ProviderType;
  systemPrompt?: string;
  tools?: string[] | ToolDefinition[];
  skills?: string[];
  maxSteps?: number;
  permissionMode?: "auto" | "confirm";      // auto-approve tools vs ask
  persist?: string | SessionStore;           // File path or custom store
  hooks?: Hooks;
}

interface Agent {
  chat(message: string): Promise<AgentResponse>;
  chatStream(message: string, options?: StreamTextOptions): StreamTextResult;
  switchProvider(provider: ProviderType, model?: string): void;
  setSystemPrompt(prompt: string): void;
  setTools(tools: string[]): void;
  abort(): void;
  clear(): void;
  getHistory(): Message[];
  getUsage(): CumulativeUsage;
}

interface AgentResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
}
```

**Usage:**

```typescript
import { createAgent } from 'zclaw';

const agent = createAgent({
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  systemPrompt: "You are a DevOps engineer.",
  tools: ["execute_shell_command", "read_file", "write_file"],
  skills: ["docker-ops"],
  persist: "./sessions",                   // File-based session store
});

// Multi-turn (remembers context)
await agent.chat("Check git status");
await agent.chat("Create branch feature/auth");
await agent.chat("Commit and push");

// Streaming turn
const stream = agent.chatStream("Deploy to staging");
for await (const step of stream.steps) {
  console.log(step);
}

// Swap provider mid-session
agent.switchProvider("openai", "gpt-4o");
await agent.chat("Now analyze with OpenAI");

// Session persistence — resume later
agent.clear();                              // Reset conversation
```

### 2.5 Custom Tools

```typescript
function tool(definition: ToolDefinition): ToolModule

interface ToolDefinition {
  name?: string;                            // Inferred from variable if omitted
  description: string;
  parameters: ZodSchema;                    // Zod schema for args
  execute: (args: T, context: ToolContext) => Promise<string | ToolResult>;
}

interface ToolContext {
  onUpdate?: (progress: { percentage: number; message?: string }) => void;
  signal?: AbortSignal;
  config?: Record<string, unknown>;
}
```

**Usage:**

```typescript
import { tool, generateText } from 'zclaw';
import { z } from 'zod';

const deployTool = tool({
  description: "Deploy project to Vercel",
  parameters: z.object({
    project: z.string().describe("Project path"),
    env: z.enum(["staging", "production"]).describe("Target environment"),
  }),
  execute: async ({ project, env }, { onUpdate }) => {
    onUpdate({ percentage: 0.1, message: "Building..." });
    const result = await deploy(project, env);
    onUpdate({ percentage: 1.0, message: "Done" });
    return result;
  },
});

// Mix custom + built-in tools
const { text } = await generateText("Deploy my app to staging", {
  tools: [deployTool, "execute_shell_command", "read_file"],
});
```

### 2.6 Multi-Provider Configuration

```typescript
function configureProviders(config: MultiProviderConfig): void

interface MultiProviderConfig {
  openai?: { apiKey: string; model?: string };
  anthropic?: { apiKey: string; model?: string };
  glm?: { apiKey: string; model?: string };
  "openai-compatible"?: { apiKey: string; baseUrl: string; model?: string };
  default: ProviderType;
}

function provider(type: ProviderType, apiKey: string, options?: {
  model?: string;
  baseUrl?: string;
}): ProviderConfig
```

**Usage:**

```typescript
import { configureProviders, generateText } from 'zclaw';

// Multi-provider setup
configureProviders({
  openai: { apiKey: process.env.OPENAI_API_KEY, model: "gpt-4o" },
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY, model: "claude-sonnet-4-6" },
  glm: { apiKey: process.env.GLM_API_KEY, model: "sonnet" },
  "openai-compatible": {
    apiKey: process.env.LOCAL_KEY,
    baseUrl: "http://localhost:11434/v1",
    model: "llama3:70b",
  },
  default: "anthropic",
});

// Use specific provider per request
const quick = await generateText("Simple question", { provider: "glm" });
const complex = await generateText("Deep analysis", { provider: "anthropic" });

// Or rely on environment variables (zero config)
// OPENAI_API_KEY, ANTHROPIC_API_KEY, etc., ZCLAW_PROVIDER, ZCLAW_MODEL
const { text } = await generateText("Hello");   // reads from env
```

### 2.7 Hooks & Events

```typescript
interface Hooks {
  beforeToolCall?: (call: { name: string; args: Record<string, unknown> }) => void | Promise<void>;
  afterToolCall?: (result: { name: string; output: string; duration: number }) => void | Promise<void>;
  onStep?: (step: StepResult) => void | Promise<void>;
  onError?: (error: ZclawError) => void | Promise<void>;
  onFinish?: (result: GenerateTextResult) => void | Promise<void>;
}
```

**Usage:**

```typescript
const result = await generateText("Deploy the app", {
  tools: ["execute_shell_command"],
  hooks: {
    beforeToolCall: (call) => logger.info(`Running: ${call.name}`, call.args),
    afterToolCall: (result) => logger.info(`Done in ${result.duration}ms`),
    onStep: (step) => ws.send(step),
    onError: (err) => alerting.send(err),
    onFinish: (result) => analytics.track("agent_run", result.usage),
  },
});
```

### 2.8 Skills Integration

```typescript
async function loadSkills(skillsPath?: string): Promise<void>;
function listSkills(): SkillMetadata[];
```

**Usage:**

```typescript
import { generateText, loadSkills, listSkills } from 'zclaw';

await loadSkills("./skills");                  // Discover skills from directory
const skills = listSkills();                   // [{ name, description, tags }]

const { text } = await generateText("Create a Dockerfile", {
  skills: ["docker-ops"],                      // Activate skill
  tools: ["write_file"],                        // Skill may require specific tools
});
```

### 2.9 Built-in Tools

11 production-ready tools available by name:

| Tool | Name | Category |
|---|---|---|
| Shell execution | `execute_shell_command` | Core |
| File read | `read_file` | Core |
| File write | `write_file` | Core |
| Date/time | `get_current_datetime` | Core |
| Web search | `web_search` | Search |
| Browser reader | `read_website` | Browser |
| Screenshots | `take_screenshot` | Browser |
| Email | `send_email` | Communication |
| Notifications | `send_notification` | Communication |
| Image generation | `generate_image` | Media |
| Prompt optimizer | `optimize_prompt` | Utility |
| Skill invocation | `use_skill` | Skills |

Tool groups for quick config:
```typescript
import { CORE_TOOLS, COMM_TOOLS, ADVANCED_TOOLS } from 'zclaw';
// CORE_TOOLS = ["execute_shell_command", "read_file", "write_file", "get_current_datetime"]
// COMM_TOOLS = ["send_email", "web_search", "send_notification"]
// ADVANCED_TOOLS = ["read_website", "take_screenshot", "generate_image", "optimize_prompt", "use_skill"]
```

### 2.10 React Frontend Hook

```typescript
import { useChat } from 'zclaw/react';

function Chat() {
  const { messages, input, handleSubmit, toolCalls, isLoading, error } = useChat({
    api: '/api/chat',
  });

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>
          <strong>{msg.role}:</strong> {msg.content}
          {msg.toolCalls?.map((tc) => (
            <div key={tc.id}>Running: {tc.name}</div>
          ))}
        </div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

### 2.11 Shared Types

```typescript
type ProviderType = "openai" | "anthropic" | "glm" | "openai-compatible";

interface Message {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp: number;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
}

interface StepResult {
  type: "text" | "tool_call";
  content?: string;
  toolCall?: { name: string; args: Record<string, unknown>; result: string; duration: number };
  timestamp: number;
}

interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;                             // USD, calculated from model pricing
}

interface ZclawError extends Error {
  code: string;                             // "PROVIDER_ERROR" | "TOOL_FAILED" | "MAX_STEPS" | "ABORTED"
  retryable: boolean;
  provider?: string;
  tool?: string;
}
```

### 2.12 Complete Export Map

```typescript
// zclaw
export { generateText, streamText, createAgent, tool, configureProviders, loadSkills, listSkills } from './sdk/index.js';
export { CORE_TOOLS, COMM_TOOLS, ADVANCED_TOOLS } from './sdk/tools.js';
export type { GenerateTextOptions, GenerateTextResult, StreamTextOptions, StreamTextResult, AgentCreateOptions, Agent, AgentResponse, ToolDefinition, ToolContext, Hooks, StepResult, Usage, Message, ToolCall, ZclawError, MultiProviderConfig, SkillMetadata } from './sdk/types.js';

// zclaw/react
export { useChat } from './sdk/react.js';
```

---

## 3. Remote Server API

### 3.1 Overview

The remote server wraps the SDK as a deployable container with WebSocket + REST API. Default port: **7337**.

### 3.2 Server Startup

```bash
# Docker
docker run -p 7337:7337 \
  -e ANTHROPIC_API_KEY=sk-... \
  -e OPENAI_API_KEY=sk-... \
  zclaw/server

# Cloud Run
gcloud run deploy zclaw --image zclaw/server --port 7337 \
  --set-env-vars ANTHROPIC_API_KEY=sk-...

# npm
npx zclaw-server --port 7337
```

### 3.3 Authentication

All requests require an API key. WebSocket passes key on connect.

```
# REST: header
X-Zclaw-API-Key: sk_zclaw_...

# WebSocket: query param
ws://host:7337/v1/ws?token=sk_zclaw_...
```

API keys are generated via CLI:

```bash
zclaw server keygen                    # outputs: sk_zclaw_abc123...
zclaw server keygen --scopes agent:run,agent:read   # scoped keys
```

### 3.4 REST Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/health` | Health check |
| `GET` | `/v1/models` | List available models per provider |
| `GET` | `/v1/skills` | List available skills |
| `POST` | `/v1/chat` | Simple request-response (blocks until done) |
| `GET` | `/v1/sessions/:id` | Get session history |

**POST /v1/chat example:**

```json
// Request
{
  "message": "Deploy to staging",
  "model": "claude-sonnet-4-6",
  "tools": ["execute_shell_command"],
  "maxSteps": 10
}

// Response
{
  "text": "Deployed successfully to staging...",
  "toolCalls": [...],
  "usage": { "promptTokens": 500, "completionTokens": 200, "totalTokens": 700, "cost": 0.003 },
  "finishReason": "stop"
}
```

### 3.5 WebSocket Protocol

**Endpoint:** `ws://host:7337/v1/ws?token=sk_zclaw_...`

#### Client → Server Messages

```typescript
// Start a conversation
{ "type": "chat", "id": "msg-1", "message": "Deploy the app", "options": {
  "tools": ["execute_shell_command"],
  "maxSteps": 10,
  "skills": ["docker-ops"]
}}

// Multi-turn (continues existing session)
{ "type": "chat", "id": "msg-2", "message": "Run smoke tests", "sessionId": "ses-abc123" }

// Abort current task
{ "type": "abort", "reason": "user_cancelled" }

// Resume a saved session
{ "type": "resume", "sessionId": "ses-abc123", "lastMessageId": "msg-5" }

// Reconnect after disconnect
{ "type": "reconnect", "sessionId": "ses-abc123", "lastSeenId": "srv-msg-10" }

// Switch provider mid-session
{ "type": "switch_provider", "provider": "openai", "model": "gpt-4o" }

// Metadata queries
{ "type": "list_models" }
{ "type": "list_skills" }

// Heartbeat (every 30 seconds)
{ "type": "ping", "clientTime": "2026-04-07T12:34:56Z" }
```

#### Server → Client Messages

```typescript
// Acknowledgment
{ "type": "ack", "clientMsgId": "msg-1", "serverMsgId": "srv-msg-1", "timestamp": "..." }

// Text streaming
{ "type": "text", "delta": "I'll deploy the app...", "serverMsgId": "srv-msg-1" }

// Tool execution
{ "type": "tool_call", "callId": "tc-1", "name": "execute_shell_command", "args": {"command": "docker build..."} }
{ "type": "tool_progress", "callId": "tc-1", "percentage": 0.5, "output": "Building step 3/5..." }
{ "type": "tool_result", "callId": "tc-1", "output": "Built successfully", "success": true }

// Overall progress
{ "type": "progress", "step": 2, "totalSteps": 5, "percentage": 40, "activity": "Running deployment" }

// Token usage (incremental)
{ "type": "usage", "promptTokens": 500, "completionTokens": 200, "cost": 0.003 }

// Completion
{ "type": "done", "serverMsgId": "srv-msg-1", "usage": { "totalTokens": 1234, "cost": 0.042 }, "finishReason": "stop" }

// Session management
{ "type": "session_created", "sessionId": "ses-abc123", "expiresAt": "..." }
{ "type": "session_resumed", "sessionId": "ses-abc123", "messages": [...] }
{ "type": "replay", "messages": [...], "currentStatus": "running" }

// Errors
{ "type": "error", "code": "PROVIDER_ERROR", "retryable": true, "message": "Rate limited", "provider": "anthropic" }
{ "type": "error", "code": "TOOL_EXECUTION_FAILED", "retryable": false, "message": "Command not found", "tool": "execute_shell_command" }
{ "type": "error", "code": "MAX_STEPS_EXCEEDED", "retryable": false, "message": "Agent exceeded 10 steps" }
{ "type": "error", "code": "UNAUTHORIZED", "retryable": false, "message": "Invalid API key" }

// Heartbeat
{ "type": "pong", "serverTime": "2026-04-07T12:34:56Z" }
```

### 3.6 Session Management

- Sessions persist for **24 hours** by default (configurable)
- Auto-close after **30 minutes** of inactivity
- Maximum **5 concurrent sessions** per API key
- Session state stored in:
  - **Local:** file-based (`~/.zclaw/sessions/`)
  - **Docker:** volume mount (`/data/sessions/`)
  - **Cloud Run:** externalized to Redis/Firestore (required for container recycling)

### 3.7 Reconnection Protocol

When a client disconnects (network blip, app backgrounded):

1. Client reconnects with `{ "type": "reconnect", "sessionId": "...", "lastSeenId": "srv-msg-10" }`
2. Server replies with `{ "type": "replay", "messages": [...missed messages...], "currentStatus": "running" | "completed" }`
3. If agent task completed while disconnected, replay includes the final `done` message
4. Client resumes normal operation

### 3.8 Error Handling

| Code | Category | Retryable | Description |
|---|---|---|---|
| `UNAUTHORIZED` | Auth | No | Invalid or missing API key |
| `RATE_LIMITED` | Rate | Yes (after retryAfter) | Too many requests |
| `INVALID_REQUEST` | Validation | No | Malformed message |
| `PROVIDER_ERROR` | LLM | Yes | Provider API failure |
| `TOOL_EXECUTION_FAILED` | Tool | Maybe | Tool returned error |
| `MAX_STEPS_EXCEEDED` | Agent | No | Hit maxSteps limit |
| `AGENT_ABORTED` | Agent | No | Task cancelled |
| `SESSION_EXPIRED` | Session | No | Session too old |
| `TIMEOUT_SOON` | Cloud | No | Container about to timeout |

### 3.9 Security

- **Input validation:** All messages validated against schema before processing
- **CORS:** Configurable allowed origins for browser clients
- **Rate limiting:** Per API key, configurable (default: 100 req/min)
- **Tool scoping:** API keys can restrict which tools are available
- **Command sanitization:** Shell commands validated against allowed list when `permissionMode: "confirm"`

### 3.10 Cloud Deployment Notes

#### Docker

```bash
docker run -d -p 7337:7337 \
  -e ANTHROPIC_API_KEY=sk-... \
  -v ~/.zclaw:/root/.zclaw \
  zclaw/server
```

#### Google Cloud Run

```bash
gcloud run deploy zclaw-agent \
  --image zclaw/server \
  --port 7337 \
  --min-instances 1 \
  --max-instances 10 \
  --timeout 3600 \
  --set-env-vars "ANTHROPIC_API_KEY=sk-..." \
  --set-env-vars "ZCLAW_SESSION_STORE=redis" \
  --set-env-vars "REDIS_URL=redis://..."
```

> **Cloud Run note:** WebSocket works but needs heartbeat every 30s + session state externalized (Redis/Firestore) so containers can be recycled without losing state. Set `--min-instances 1` to prevent cold starts from killing active WebSocket connections. The server emits a `{ "type": "warning", "code": "TIMEOUT_SOON" }` message at the 50-minute mark so clients can save state before the 60-minute Cloud Run request limit.

#### AWS ECS / Fargate

```bash
aws ecs create-service \
  --task-definition zclaw-agent \
  --load-balancer targetGroupArn=...,containerPort=7337
```

---

## 4. Documentation Site (VitePress)

### 4.1 Site Structure

```
docs/
├── .vitepress/
│   └── config.ts
├── index.md                              # Landing page
├── getting-started/
│   ├── installation.md                   # npm install, Docker, Cloud Run
│   ├── quick-start.md                    # 5-minute setup guide
│   └── configuration.md                  # Multi-provider config reference
├── sdk/
│   ├── overview.md                       # SDK architecture & philosophy
│   ├── generate-text.md                  # generateText() API reference
│   ├── stream-text.md                    # streamText() API reference
│   ├── create-agent.md                   # createAgent() API reference
│   ├── custom-tools.md                   # tool() factory & custom tools
│   ├── providers.md                      # Multi-provider system
│   ├── skills.md                         # Skills system integration
│   ├── hooks.md                          # Hooks & events reference
│   ├── structured-output.md              # Zod-based structured output
│   ├── session-persistence.md            # Session management
│   ├── react-hook.md                     # useChat() React integration
│   └── types.md                          # TypeScript types reference
├── server/
│   ├── overview.md                       # Server architecture
│   ├── rest-api.md                       # REST endpoint reference
│   ├── websocket-api.md                  # WebSocket protocol reference
│   ├── authentication.md                 # API key auth & scoping
│   ├── session-management.md             # Sessions, reconnection, replay
│   └── deployment.md                     # Docker, Cloud Run, ECS
├── guides/
│   ├── build-your-own-ui.md             # Tutorial: Build a chat UI
│   ├── deploy-as-backend.md             # Tutorial: Deploy zclaw as backend
│   ├── custom-tools-guide.md            # Tutorial: Create custom tools
│   ├── custom-skills-guide.md           # Tutorial: Create custom skills
│   └── production-checklist.md          # Production deployment checklist
├── tools/
│   └── reference.md                      # All 11 built-in tools with params
└── examples/
    ├── minimal-chat.md                   # Simplest possible chat
    ├── react-chat-app.md                 # Full React chat with tools
    ├── docker-deploy.md                  # Docker deployment example
    └── cloud-run-deploy.md               # Cloud Run deployment example
```

### 4.2 Documentation Pages (Content Outline)

Each API reference page follows this structure:

```
1. One-line description
2. Signature (TypeScript)
3. Quick example (3-5 lines)
4. Parameters table (name, type, required, default, description)
5. Return type
6. Full examples (basic, advanced, edge cases)
7. Related APIs
```

Each guide page follows this structure:

```
1. Goal (what you'll build)
2. Prerequisites
3. Step-by-step with code blocks
4. Common pitfalls
5. Next steps
```

### 4.3 Landing Page Content

The landing page should communicate:

- **What zclaw is:** Headless AI agent framework for building automation tools
- **3 ways to use:** CLI, SDK (library), Server (container)
- **Key differentiators:** Multi-provider, built-in tools, skills, Docker-native
- **Quick start code:** Copy-paste 3-line example
- **Links:** Getting Started, SDK Reference, Server API, Guides

---

## 5. Implementation Phases

### Phase 1: Core SDK (Week 1-2)

1. Create `src/sdk/types.ts` with all interfaces
2. Implement `generateText()` wrapping existing Agent class
3. Implement `streamText()` with async generators
4. Refactor Agent to return structured responses (not `void`)
5. Add `maxSteps` to agent loop
6. Add `abort()` via AbortSignal
7. Add cost tracking to all responses
8. Add `tool()` factory for custom tools
9. Add `systemPrompt` option
10. Export map in `package.json`

### Phase 2: Agent + Sessions (Week 3)

11. Implement `createAgent()` with persistent sessions
12. File-based session store
13. Runtime mutation (switchProvider, setSystemPrompt, setTools)
14. Hooks system (beforeToolCall, afterToolCall, onStep, onError, onFinish)
15. Tool progress streaming via `onUpdate` context

### Phase 3: Server (Week 4)

16. WebSocket server on port 7337
17. REST endpoints (health, models, skills, chat)
18. Authentication (API key generation + validation)
19. Session persistence (file + Redis)
20. Reconnection + message replay
21. Rate limiting
22. Error handling with structured codes
23. Docker image build

### Phase 4: React + HTTP Helpers (Week 5)

24. `useChat()` React hook
25. `toResponse()` / `toSSEStream()` HTTP helpers
26. Frontend example app

### Phase 5: Documentation (Week 6)

27. VitePress site setup
28. SDK reference pages
29. Server API reference pages
30. Guides and tutorials
31. Examples
32. Deployment instructions (Docker, Cloud Run, ECS)

---

## 6. File Impact Summary

### New files to create

```
src/sdk/index.ts
src/sdk/types.ts
src/sdk/agent.ts
src/sdk/tools.ts
src/sdk/hooks.ts
src/sdk/http.ts
src/sdk/skills.ts
src/sdk/providers.ts
src/sdk/session.ts
src/sdk/react.ts
src/server/index.ts
src/server/websocket.ts
src/server/rest.ts
src/server/auth.ts
src/server/session-store.ts
docs/.vitepress/config.ts
docs/index.md
docs/getting-started/installation.md
docs/getting-started/quick-start.md
docs/getting-started/configuration.md
docs/sdk/overview.md
docs/sdk/generate-text.md
docs/sdk/stream-text.md
docs/sdk/create-agent.md
docs/sdk/custom-tools.md
docs/sdk/providers.md
docs/sdk/skills.md
docs/sdk/hooks.md
docs/sdk/structured-output.md
docs/sdk/session-persistence.md
docs/sdk/react-hook.md
docs/sdk/types.md
docs/server/overview.md
docs/server/rest-api.md
docs/server/websocket-api.md
docs/server/authentication.md
docs/server/session-management.md
docs/server/deployment.md
docs/guides/build-your-own-ui.md
docs/guides/deploy-as-backend.md
docs/guides/custom-tools-guide.md
docs/guides/custom-skills-guide.md
docs/guides/production-checklist.md
docs/tools/reference.md
docs/examples/minimal-chat.md
docs/examples/react-chat-app.md
docs/examples/docker-deploy.md
docs/examples/cloud-run-deploy.md
```

### Existing files to modify

```
src/agent.ts           — Refactor to return structured responses, add hooks, add abort
src/index.ts           — Add SDK exports, keep CLI as separate entry
src/tools/index.ts     — Add type-safe registry, export for SDK
src/skills/index.ts    — Export loadSkills/listSkills for SDK
src/providers/types.ts — Add cost tracking data
package.json           — Add "exports" field for SDK + react subpath
tsconfig.json          — Update for SDK compilation targets
```
