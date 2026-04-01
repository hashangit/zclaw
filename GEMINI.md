# Project: ZClaw 🦞

## 🚀 Project Overview
**ZClaw** is a hyper-lightweight, engineering-first AI agent framework specifically designed for **massive scale automation** in **headless/containerized environments**.

ZClaw serves as a robust "runtime" for executing LLM-driven tasks within isolated Docker containers (Alpine/Debian/Ubuntu). Its core purpose is to enable the orchestration of thousands of simultaneous agents ("swarms") for complex parallel workflows, CI/CD pipelines, and high-concurrency clusters.

- **GitHub**: [https://github.com/hashangit/zclaw](https://github.com/hashangit/zclaw)
- **Status**: Stable, Production-Ready, Engineering-First.

## 🧬 Core Philosophy
- **Docker-Native**: Designed to run safely and efficiently inside minimal containers (Node.js/Alpine friendly).
- **Massive Scalability**: Low resource footprint (stateless by default) enables high-concurrency agent swarms.
- **Headless & Deterministic**: Zero GUI dependencies. Operates via precise system APIs and shell commands rather than unstable visual recognition (unlike vision-based agents).
- **Non-Interactive by Design**: Optimized for zero-touch automation in CI/CD, K8s, and headless servers.
- **Swarm Ready**: Stateless architecture allows easy orchestration via K8s, Docker Swarm, or simple shell loops.

## 🛠️ Technology Stack
- **Runtime**: Node.js (v18+)
- **Language**: TypeScript
- **Framework**: Commander.js (CLI), Inquirer (Setup/Interactivity), Chalk (Styling), Ora (Spinners)
- **AI**: OpenAI SDK (Compatible with DeepSeek, LocalLLM, and other OpenAI-compatible providers)
- **Integrations**: Tavily (Search), SMTP (Email), Webhooks (Notifications: Feishu, DingTalk, WeCom)

## 📂 Directory Structure
- `src/`: Source code
  - `index.ts`: CLI entry point, command parsing, and main execution loop.
  - `agent.ts`: Core Agent class handling LLM interaction, system prompts, and tool loop logic.
  - `tools/`: Modular tool implementation directory.
    - `core.ts`: Fundamental tools (Shell execution, File I/O: Read/Write, DateTime).
    - `browser.ts`: Headless browser interactions.
    - `email.ts`: SMTP-based email sending.
    - `search.ts`: Real-time web search (via Tavily).
    - `notify.ts`: Multi-platform notification webhooks.
    - `screenshot.ts`: Capturing visual state (optimized for headless).
    - `image.ts`: Image processing and handling.
    - `prompt-optimizer.ts`: Enhancing prompts for creative or complex tasks.
    - `interface.ts`: TypeScript definitions for tool modules.
- `dist/`: Compiled JavaScript output (ignored in git).
- `.zclaw/`: Project-level configuration (Hierarchical priority).

## 📥 Installation

### User (Global)
```bash
pnpm add -g zclaw
```

### Developer (Local)
1.  **Clone**: `git clone https://github.com/hashangit/zclaw.git`
2.  **Install**: `pnpm install`
3.  **Build**: `pnpm run build`
4.  **Dev Run**: `pnpm start` or `node dist/index.js`

## ⚙️ Configuration & Hierarchy
ZClaw uses a hierarchical configuration system (Highest to Lowest priority):
1.  **CLI Arguments**: (`-m`, `-n`, `-y`)
2.  **Environment Variables**: (`OPENAI_API_KEY`, `.env` file)
3.  **Project Config**: `./.zclaw/setting.json` (Per-directory context)
4.  **Global Config**: `~/.zclaw/setting.json`

### Supported Keys (JSON)
- `apiKey`: LLM provider API key.
- `baseUrl`: Custom API endpoint (e.g., DeepSeek, LocalLLM).
- `model`: Default LLM model (e.g., `gpt-4o`).
- `tavilyApiKey`: API key for web search.
- `smtpHost`, `smtpPort`, `smtpUser`, `smtpPass`, `smtpFrom`: Email settings.
- `feishuWebhook`, `dingtalkWebhook`, `wecomWebhook`: Notification targets.

## 🤖 Usage Modes

### 1. Interactive Loop
Standard mode for chat-based automation.
```bash
zclaw
> "Analyze the logs in /var/log/app and summarize errors."
```

### 2. Headless Mode (One-Shot)
Executes a query and exits. Perfect for scripts.
```bash
zclaw "Check disk usage and report to Feishu" --no-interactive
```

### 3. Auto-Confirm (CI/CD)
Bypasses user confirmation for tool execution (e.g., shell commands).
```bash
zclaw "Build the project and deploy" -y
```

## 🐳 Docker & Headless Constraints
When working on ZClaw, adhere to these constraints:
- **No GUI**: Never assume a browser or display is available. Use headless tools (e.g., `ScreenshotTool` with Puppeteer/Playwright in headless mode).
- **Minimal OS**: Assume minimal binaries (Alpine `ash` or Debian `bash`). Use standard POSIX commands.
- **Font Support**: For screenshots in Docker, ensure CJK and Emoji fonts are installed to avoid "tofu" squares.
  - *Debian/Ubuntu*: `apt-get install -y fonts-noto-cjk fonts-noto-color-emoji`
  - *Alpine*: `apk add font-noto-cjk font-noto-emoji`

## 🧠 Agent Development Mandates
When modifying or extending ZClaw, Gemini CLI must:
1.  **Maintain Determinism**: Prefer command-driven tools over visual interpretation.
2.  **Prioritize Efficiency**: Aim for minimal token usage and fast tool-loop cycles.
3.  **Security First**: Never log or commit secrets stored in `.zclaw/` or environment variables.
4.  **Scalability**: Ensure tool handlers are lightweight and do not block the event loop unnecessarily.
5.  **Robust Error Handling**: Agents must gracefully handle tool failures and retry with adjusted parameters if possible.
6.  **Prompt Optimization**: Always utilize `PromptOptimizerTool` when generating prompts for external models or complex task delegations.

---
**Acknowledgments**: ZClaw is a fork of [AutoClaw](https://github.com/tsingliuwin/autoclaw), evolved for engineering-first headless automation.
