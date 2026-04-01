# ZClaw 🦞

[![NPM Version](https://img.shields.io/npm/v/zclaw-core.svg?style=flat-square)](https://www.npmjs.com/package/zclaw-core)
[![NPM Downloads](https://img.shields.io/npm/dm/zclaw-core.svg?style=flat-square)](https://www.npmjs.com/package/zclaw-core)
[![GitHub Release](https://img.shields.io/github/v/tag/hashangit/zclaw?style=flat-square&label=release)](https://github.com/hashangit/zclaw/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://github.com/hashangit/zclaw/blob/main/LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

**The Engineering-First Headless Agent Framework: Stable, Scalable Automation for the Post-Vision Era.**

---

🔗 **GitHub Repository**: [https://github.com/hashangit/zclaw](https://github.com/hashangit/zclaw)

---

ZClaw is a high-stability, open-source automation framework specifically engineered for **headless systems**.

Unlike "screen-seeing" agents (such as OpenClaw) that rely on visual interpretation, ZClaw is built on a foundation of precise command-driven execution. This makes it significantly more **stable**, **robust from an engineering perspective**, and **easier to scale** across complex environments—whether it's a local server, a CI/CD pipeline, or thousands of containerized nodes.

## Why ZClaw?
- 🐳 **Docker Native**: Built to run safely inside containers. Minimal footprint (Node.js/Alpine friendly).
- 🚀 **Better Engineering**: Operates via precise system APIs and shell commands rather than unstable visual recognition, ensuring deterministic outcomes.
- 🛡️ **Superior Stability**: Immune to issues like UI rendering, screen resolution, or network lag that plague vision-based agents.
- 📈 **Massive Scalability**: Low resource consumption allows orchestrating thousands of instances (e.g., in K8s) for true automation swarms.
- 🔌 **Swarm Ready**: Stateless design allows for easy orchestration via K8s, Docker Swarm, or simple shell loops.
- 🧩 **Extensible Integrations**: Built-in support for Web Search (Tavily), Email (SMTP), and Notification Webhooks (Feishu, DingTalk, WeCom).

## Features

- 🤖 **Multi-Provider Support**: Switch between OpenAI, Anthropic Claude, GLM, or any OpenAI-compatible endpoint
- 🔄 **Runtime Provider Switching**: Change AI providers mid-conversation with `/models` command
- 📜 **Headless Execution**: No browsers, no GUIs. Pure terminal efficiency.
- 🚀 **Non-Interactive Mode**: Intelligent flag handling (`-y`, `--no-interactive`) for zero-touch automation.
- 📂 **Universal Control**: From simple file I/O to complex system administration.
- 🧠 **Context Aware**: Detects container environments and provides accurate system time for relative date queries.
- 🌐 **Web Search**: Integrated with Tavily for real-time information retrieval.
- 🕒 **Time Accuracy**: Built-in tool to get precise system date and time for correct temporal context.
- 📧 **Communication**: Send emails and push notifications to chat groups automatically.

## Tech Stack
- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Commander.js
- **UI**: Inquirer (interactivity), Chalk (styling), Ora (spinners)
- **AI**: Multi-Provider (OpenAI, Anthropic Claude, GLM, OpenAI-Compatible)

## Installation

### npm
```bash
npm install -g zclaw-core
```

### pnpm
```bash
pnpm add -g zclaw-core
```

### Homebrew (macOS & Linux)
```bash
brew tap hashangit/tap
brew install zclaw
```

> **Note:** Requires [Node.js](https://nodejs.org/) 20 or later.

### Development Installation
1.  Clone the repository:
    ```bash
    git clone https://github.com/hashangit/zclaw.git
    cd zclaw
    ```
2.  Install dependencies:
    ```bash
    pnpm install
    ```
3.  Build the project:
    ```bash
    pnpm run build
    ```
4.  Link globally (optional):
    ```bash
    pnpm link
    ```

## Quick Start

1.  **Setup**: Run the interactive setup wizard to configure your API keys and integrations.
    ```bash
    zclaw setup
    ```
    The wizard now supports configuring multiple providers (OpenAI, Anthropic, GLM) in a single session.

2.  **Run**: Start the agent in interactive mode.
    ```bash
    zclaw
    ```

## Usage

### Interactive Mode
Simply run `zclaw` to enter the chat loop.
```bash
zclaw
> List all TypeScript files in the src folder.
```

### Headless Mode (One-Shot)
Run a single command and exit.
```bash
zclaw "Check disk usage and save the report to usage.txt" --no-interactive
```

### Auto-Confirm (CI/CD)
Automatically approve all tool executions (dangerous, use with caution or in sandboxes).
```bash
zclaw "Refactor src/index.ts to use ES modules" -y
```

### Provider Selection
Use a specific provider for a single command:
```bash
zclaw -p anthropic "Analyze this code for security issues"
```

### Switch Providers Mid-Conversation
In interactive mode, type `/models` to switch between configured providers:
```bash
zclaw
> /models  # Select Anthropic from the list
> Now analyze this with Claude...
```

### CLI Options
- `-m, --model <model>`: Specify the LLM model (default: `gpt-4o`).
- `-p, --provider <provider>`: Specify the LLM provider (`openai-compatible`, `openai`, `anthropic`, `glm`).
- `-n, --no-interactive`: Exit after processing the initial query (Headless mode).
- `-y, --yes`: Auto-confirm all tool executions (e.g., shell commands).

### Interactive Commands
- `/models`: Switch between configured providers during a conversation.
- `/exit` or `/quit`: End the session.

## Configuration

ZClaw uses a hierarchical configuration system.

**Priority Order (Highest to Lowest):**
1.  **CLI Arguments**: (e.g., `-m gpt-4o`)
2.  **Environment Variables**: (`OPENAI_API_KEY`, `.env` file)
3.  **Project Config**: (`./.zclaw/setting.json` in current directory)
4.  **Global Config**: (`~/.zclaw/setting.json`)

### Supported Configuration Keys (JSON)

**Multi-Provider Configuration (New):**
- `provider`: Active provider type (`openai-compatible`, `openai`, `anthropic`, `glm`)
- `models`: Object containing per-provider configurations:
  ```json
  {
    "models": {
      "openai-compatible": { "apiKey": "...", "baseUrl": "...", "model": "gpt-4o" },
      "openai": { "apiKey": "...", "model": "gpt-4o" },
      "anthropic": { "apiKey": "...", "model": "claude-sonnet-4-5-20250929" },
      "glm": { "apiKey": "...", "model": "sonnet" }
    }
  }
  ```

**Legacy Keys (Backward Compatible):**
- `apiKey`: Your OpenAI API Key (legacy, treated as `openai-compatible`).
- `baseUrl`: Custom Base URL (e.g., for DeepSeek or LocalLLM).
- `model`: Default model to use.
- `tavilyApiKey`: API Key for Tavily Web Search.
- `smtpHost`, `smtpPort`, `smtpUser`, `smtpPass`, `smtpFrom`: SMTP Email settings.
- `feishuWebhook`, `dingtalkWebhook`, `wecomWebhook`: Notification webhooks.

### Project-Level Config Example

**Multi-Provider Configuration:**
```json
{
  "provider": "anthropic",
  "models": {
    "openai": { "apiKey": "sk-...", "model": "gpt-4o" },
    "anthropic": { "apiKey": "sk-ant-...", "model": "claude-sonnet-4-5-20250929" }
  }
}
```

**Legacy Configuration (Still Supported):**
Create a file at `.zclaw/setting.json`:
```json
{
  "model": "gpt-3.5-turbo",
  "baseUrl": "https://api.deepseek.com/v1"
}
```

> **⚠️ Security Warning**: If you store your `apiKey` or secrets in `.zclaw/setting.json`, make sure to add `.zclaw/` to your `.gitignore` file to prevent leaking secrets!

## Integrations

### Multi-Provider LLM Support
ZClaw supports multiple AI providers with seamless switching:
- **OpenAI**: GPT-4, GPT-3.5-turbo, and latest models
- **Anthropic**: Claude Sonnet, Haiku, Opus models
- **GLM**: Z.ai GLM-4.5, GLM-4.7, GLM-5.1 models
- **OpenAI-Compatible**: DeepSeek, LocalLLM, Ollama, LM Studio, and any OpenAI-compatible endpoint

Configure multiple providers during setup and switch between them using `/models` command or `-p` flag.

### Web Search (Tavily)
ZClaw can search the web if you provide a Tavily API Key during setup or in config.
- **Usage**: "Search for the latest Node.js release notes."

### Email (SMTP)
Configure SMTP settings to let the agent send emails.
- **Usage**: "Send an email to user@example.com with the summary of the log file."

### Notifications (Feishu/DingTalk/WeCom)
Configure webhooks to receive alerts or reports in your team chat apps.
- **Usage**: "Notify the team on Feishu that the build has finished."

### Date & Time
Built-in utility to provide the agent with the current system time, ensuring accurate handling of relative time requests.
- **Usage**: "What's the date today?" or "Remind me to check the logs next Monday."

## Docker Support

### Non-Latin Font Issues in Screenshots
When running ZClaw inside a Docker container (especially Alpine or Debian Slim), screenshots of websites with non-Latin text (e.g., CJK characters) may display text as square boxes ("tofu") due to missing fonts. Emojis (e.g., 🔥) may also appear as squares.

**Solution:** Install CJK (Chinese/Japanese/Korean) and Emoji fonts in your container.

**For Debian/Ubuntu:**
```bash
apt-get update && apt-get install -y fonts-noto-cjk fonts-wqy-zenhei fonts-noto-color-emoji
```

**For Alpine Linux:**
```apk add font-noto-cjk font-noto-emoji```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

---
GitHub: [https://github.com/hashangit/zclaw](https://github.com/hashangit/zclaw)

---

## Acknowledgments

ZClaw is a standalone project forked from the original [AutoClaw](https://github.com/tsingliuwin/autoclaw) project by **tsingliuwin** under the MIT License on **March 31st, 2026**. 

We would like to express our sincere gratitude to **tsingliuwin** and all the contributors of the original AutoClaw project for their exceptional work and vision, which served as the foundation for this repository.

