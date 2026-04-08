# Installation

Get ZClaw up and running in your environment. Choose the installation method that fits your workflow.

## Prerequisites

Before installing ZClaw, ensure you have:

- **Node.js 18+** installed ([download here](https://nodejs.org/))
- **npm**, **pnpm**, or **bun** as your package manager
- An API key for your preferred LLM provider (OpenAI, Anthropic, or GLM)

::: tip Recommendation
We recommend using **pnpm** for faster installs and better disk space efficiency, but any package manager works fine.
:::

## Install as an SDK

Use ZClaw as a library in your Node.js projects.

### npm

```bash
npm install zclaw-core
```

### pnpm

```bash
pnpm add zclaw-core
```

### bun

```bash
bun add zclaw-core
```

### Verify Installation

Create a file called `test.js`:

```javascript
import { generateText } from 'zclaw-core'

const result = await generateText('Hello, ZClaw!', {
  provider: 'openai',
  model: 'gpt-5.4'
})

console.log(result.text)
```

Run it with your API key:

```bash
OPENAI_API_KEY=your-key node test.js
```

::: info TypeScript Support
ZClaw is written in TypeScript and includes full type definitions. No additional `@types` package needed.
:::

## Install as a CLI

Install ZClaw globally to use the command-line interface.

### npm

```bash
npm install -g zclaw-core
```

### pnpm

```bash
pnpm add -g zclaw-core
```

### Verify CLI Installation

```bash
zclaw-core --version
```

You should see the version number printed.

## Use with Docker

ZClaw includes a pre-built Docker image for running the server or CLI without Node.js installation.

### Pull the Image

```bash
docker pull ghcr.io/zclaw/zclaw:latest
```

### Run the Server

```bash
docker run -p 7337:7337 \
  -e OPENAI_API_KEY=your-key \
  ghcr.io/zclaw/zclaw:latest
```

The server will start on `http://localhost:7337`.

### Run the CLI

```bash
docker run -it -e OPENAI_API_KEY=your-key \
  ghcr.io/zclaw/zclaw:latest \
  chat
```

## Deploy to Cloud Run

Deploy ZClaw to Google Cloud Run in one command:

```bash
gcloud run deploy zclaw \
  --image ghcr.io/zclaw/zclaw:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars OPENAI_API_KEY=your-key
```

::: tip Environment Variables
For production, use Secret Manager or a similar service to store your API keys securely.
:::

## Development Setup

If you want to contribute to ZClaw or run it from source:

```bash
# Clone the repository
git clone https://github.com/hashangit/zclaw.git
cd zclaw

# Install dependencies
pnpm install

# Build the project
pnpm build

# Link globally for CLI development
pnpm link --global
```

## Next Steps

After installation:

1. [Configure your provider](/getting-started/configuration) with API keys
2. Follow the [Quick Start guide](/getting-started/quick-start) to build your first agent
3. Explore the [SDK Reference](/sdk/overview) for advanced usage

::: info Troubleshooting
If you encounter any issues during installation, check our [GitHub Issues](https://github.com/zclaw/zclaw/issues) or join our community discussions.
:::
