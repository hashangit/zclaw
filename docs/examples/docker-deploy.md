---
title: Docker Deployment
description: Deploy ZClaw as a Docker container with complete configuration and Docker Compose example.
---

# Docker Deployment

Run ZClaw as a containerized backend service. This example covers building the image, running it locally, persisting sessions, and using Docker Compose.

## Prerequisites

- Docker installed and running
- At least one LLM provider API key

## Dockerfile

ZClaw includes a Dockerfile in the repository. Build it from source:

```bash
git clone https://github.com/zclaw/zclaw.git
cd zclaw
docker build -t zclaw-server .
```

## Build and Run

### Basic Run

Start the server on port 7337:

```bash
docker run -d \
  --name zclaw \
  -p 7337:7337 \
  -e OPENAI_API_KEY=sk-... \
  zclaw-server
```

Verify it is running:

```bash
curl http://localhost:7337/v1/health
# {"status":"ok","version":"0.1.1","uptime":5}
```

### With Environment File

Create a `.env` file with your configuration:

```bash
# .env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
LLM_PROVIDER=openai
OPENAI_MODEL=gpt-5.4
TAVILY_API_KEY=tvly-...
```

Run with the environment file:

```bash
docker run -d \
  --name zclaw \
  -p 7337:7337 \
  --env-file .env \
  zclaw-server
```

## Environment Variable Configuration

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | At least one | OpenAI API key |
| `ANTHROPIC_API_KEY` | At least one | Anthropic API key |
| `GLM_API_KEY` | At least one | GLM API key |
| `LLM_PROVIDER` | No | Default provider (default: auto-detected) |
| `OPENAI_MODEL` | No | Default OpenAI model (default: `gpt-5.4`) |
| `ANTHROPIC_MODEL` | No | Default Anthropic model (default: `claude-sonnet-4-6-20260320`) |
| `GLM_MODEL` | No | Default GLM model (default: `opus`) |
| `ZCLAW_PORT` | No | Server port (default: `7337`) |
| `TAVILY_API_KEY` | No | Required for `web_search` tool |
| `SMTP_HOST` | No | SMTP server for `send_email` |
| `SMTP_PORT` | No | SMTP port (default: `587`) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |
| `ZCLAW_SESSION_DIR` | No | Session storage directory (default: `./.zclaw/sessions`) |
| `ZCLAW_SESSION_TTL` | No | Session TTL in seconds (default: `86400`) |

## Volume Mounting for Sessions

Persist sessions to the host filesystem so they survive container restarts:

```bash
docker run -d \
  --name zclaw \
  -p 7337:7337 \
  --env-file .env \
  -v zclaw-sessions:/data/sessions \
  zclaw-server
```

Or bind-mount a specific directory:

```bash
docker run -d \
  --name zclaw \
  -p 7337:7337 \
  --env-file .env \
  -v $(pwd)/sessions:/data/sessions \
  zclaw-server
```

## Docker Compose

Create a `docker-compose.yml` for a complete deployment with Redis for session storage:

```yaml
version: "3.8"

services:
  zclaw:
    image: zclaw-server
    build: .
    ports:
      - "7337:7337"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - LLM_PROVIDER=openai
      - OPENAI_MODEL=gpt-5.4
      - TAVILY_API_KEY=${TAVILY_API_KEY}
      - ZCLAW_SESSION_DIR=/data/sessions
      - ZCLAW_SESSION_TTL=86400
    volumes:
      - ./skills:/mnt/skills
      - ./sessions:/data/sessions
    restart: unless-stopped
```

Run with Docker Compose:

```bash
docker compose up -d
```

Check logs:

```bash
docker compose logs -f zclaw
```

Stop all services:

```bash
docker compose down
```

## Mounting Custom Skills

Mount a directory of custom skills into the container:

```bash
docker run -d \
  --name zclaw \
  -p 7337:7337 \
  --env-file .env \
  -v $(pwd)/my-skills:/mnt/skills \
  zclaw-server
```

Skills in `/mnt/skills/` are automatically discovered. Each skill is a subdirectory containing a `SKILL.md` file:

```
my-skills/
  code-review/
    SKILL.md
  deploy/
    SKILL.md
```

## Connecting to the Deployed Instance

### cURL

```bash
curl -X POST http://localhost:7337/v1/chat \
  -H "Content-Type: application/json" \
  -H "X-Zclaw-API-Key: sk_zclaw_..." \
  -d '{
    "message": "List files in the current directory",
    "tools": ["execute_shell_command"],
    "maxSteps": 3
  }'
```

### SDK

```typescript
import { generateText } from "zclaw-core";

// Point at the Docker instance
const result = await generateText("Analyze the server logs", {
  tools: ["core"],
});
```

### Health Check

```bash
curl http://localhost:7337/v1/health
```

## Common Operations

```bash
# View logs
docker logs -f zclaw

# Restart
docker restart zclaw

# Stop
docker stop zclaw

# Remove
docker rm zclaw

# Update to latest
docker pull zclaw-server:latest
docker stop zclaw && docker rm zclaw
docker run -d --name zclaw ... zclaw-server:latest
```

## Next Steps

- [Cloud Run Deployment](/examples/cloud-run-deploy) -- deploy to Google Cloud Run
- [Deploy as Backend Guide](/guides/deploy-as-backend) -- production deployment guide
- [Production Checklist](/guides/production-checklist) -- pre-deployment checklist
