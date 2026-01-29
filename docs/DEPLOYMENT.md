# Ralph Deployment Guide

> Dual repository architecture with automatic Vercel deployment

## Current State

| Component | Status |
|-----------|--------|
| Runtime | Local bash script (`lib/agent/ralph.sh`) |
| Static Hosting | **Vercel** (auto-deploy on push) |
| Content Repo | **GitHub** (`fellanH/wiki-content`) |
| Process Management | Coordinator + worker locks |
| Dependencies | Node.js 20+, Claude Code CLI, Vercel CLI |

## Production URLs

| Resource | URL |
|----------|-----|
| Live Site | `not-wikipedia.vercel.app` |
| GitHub Repo | `github.com/fellanH/wiki-content` |
| Vercel Dashboard | `vercel.com/felix-hellstroms-projects/not-wikipedia` |

---

## Auto-Deploy Architecture

Ralph uses a **dual repository** architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                not-wikipedia (source repo)                       │
│                                                                  │
│  lib/agent/ralph.sh                                              │
│       │                                                          │
│       │ (creates article)                                        │
│       ▼                                                          │
│  dist/wiki/new-article.html                                     │
│       │                                                          │
│       │ (wiki-git-publish MCP tool)                              │
│       ▼                                                          │
└───────┬─────────────────────────────────────────────────────────┘
        │
        │ copy + git commit + git push
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                wiki-content (content repo)                       │
│                github.com/fellanH/wiki-content                   │
│                                                                  │
│  wiki/new-article.html                                          │
│       │                                                          │
│       │ (GitHub webhook)                                         │
│       ▼                                                          │
└───────┬─────────────────────────────────────────────────────────┘
        │
        │ auto-deploy (~5 seconds)
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Vercel                                       │
│              not-wikipedia.vercel.app                            │
│                                                                  │
│  Live site automatically updated                                 │
└─────────────────────────────────────────────────────────────────┘
```

### How It Works

1. Ralph agent creates an article in `dist/wiki/`
2. `wiki-git-publish` MCP tool copies to `wiki-content/wiki/`
3. Tool commits and pushes to GitHub
4. GitHub webhook triggers Vercel deployment
5. Site is live in ~5 seconds

### Key Files

| File | Purpose |
|------|---------|
| `lib/mcp/src/tools/wiki-git-publish.ts` | MCP tool for publishing |
| `lib/mcp/src/config.ts` | `CONTENT_REPO_DIR` path |
| `lib/agent/ralph.sh` | `publish_article()` function |
| `../wiki-content/vercel.json` | Vercel configuration |

---

## Repository Structure

```
not-wikipedia/
├── lib/
│   ├── agent/           # Agent orchestration
│   │   ├── ralph.sh     # Main entry script
│   │   ├── PROMPT.md    # Task specification
│   │   └── logs/        # Execution logs
│   ├── mcp/             # MCP tools (TypeScript)
│   ├── meta/            # Metadata (ecosystem.json, ralph.db)
│   └── dashboard/       # Web dashboard
├── dist/                # Generated articles
│   ├── index.html
│   ├── styles
│   └── wiki/           # HTML articles
└── docs/                # Documentation
```

---

## Phase 1: Containerization (Local/Development)

### Dockerfile

```dockerfile
FROM node:20-slim

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Copy MCP tools and build
COPY lib/mcp/package*.json lib/mcp/
RUN cd lib/mcp && npm ci

COPY lib/mcp/ lib/mcp/
RUN cd lib/mcp && npm run build

# Copy application files
COPY lib/agent/ lib/agent/
COPY lib/meta/ lib/meta/
COPY dist/ dist/
COPY CONTRIBUTING.md ./
COPY .claude/ .claude/

# Environment
ENV ANTHROPIC_API_KEY=""
ENV MAX_LOOPS=100

WORKDIR /app/lib/agent
ENTRYPOINT ["./ralph.sh"]
```

### docker-compose.yml

```yaml
version: '3.8'
services:
  ralph:
    build: .
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - MAX_LOOPS=0  # Unlimited
    volumes:
      - ./dist:/app/dist
      - ./lib/meta:/app/lib/meta
      - ./lib/agent/logs:/app/lib/agent/logs
    restart: unless-stopped
```

---

## Phase 2: CI/CD Pipeline

### `.github/workflows/deploy.yml`

```yaml
name: Deploy Ralph

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build MCP tools
        run: cd lib/mcp && npm ci && npm run build

      - name: Run tests
        run: cd lib/mcp && npm test

      - name: Build Docker image
        run: docker build -t ralph:${{ github.sha }} .

      - name: Push to registry
        run: |
          docker tag ralph:${{ github.sha }} ${{ secrets.REGISTRY }}/ralph:latest
          docker push ${{ secrets.REGISTRY }}/ralph:latest

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_KEY }}
          script: |
            cd /opt/ralph
            docker compose pull
            docker compose up -d
```

---

## Phase 3: Cloud Hosting Options

| Option | Cost | Complexity | Best For |
|--------|------|------------|----------|
| **VPS (Hetzner/DigitalOcean)** | ~$10-20/mo | Low | Development, small scale |
| **AWS EC2 + EBS** | ~$30-50/mo | Medium | Production single-server |
| **AWS ECS/Fargate** | ~$50-100/mo | Medium | Managed containers |
| **Kubernetes (EKS/GKE)** | ~$100+/mo | High | Multi-writer scale |

### Recommended: VPS with Docker Compose

For initial deployment:

```
┌─────────────────────────────────────────────┐
│           VPS (4GB RAM, 2 vCPU)             │
├─────────────────────────────────────────────┤
│  Docker                                     │
│  ├── ralph (main agent loop)               │
│  ├── nginx (static file server)            │
│  └── prometheus (metrics)                  │
├─────────────────────────────────────────────┤
│  Volumes                                    │
│  ├── /data/dist (articles)                 │
│  ├── /data/lib/meta (ecosystem state)      │
│  └── /data/lib/agent/logs (run logs)       │
└─────────────────────────────────────────────┘
```

---

## Phase 4: Monitoring & Observability

### Metrics to Collect

- Loop duration (alert if > 5 min)
- Articles created per hour
- Broken link count
- Claude API latency
- Memory/CPU usage

### Stack: Prometheus + Grafana

Add to `lib/agent/ralph.sh`:

```bash
# Export metrics for Prometheus
log_prometheus_metrics() {
  local metrics_file="/tmp/ralph_metrics.prom"
  cat > "$metrics_file" << EOF
ralph_loop_duration_seconds $loop_duration
ralph_articles_total $(find "$WIKI_DIR" -name "*.html" | wc -l)
ralph_broken_links_total $broken_links
ralph_loop_count $loop_count
EOF
}
```

### Alerting Rules

```yaml
groups:
  - name: ralph
    rules:
      - alert: RalphLoopTooSlow
        expr: ralph_loop_duration_seconds > 300
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Ralph loop taking > 5 minutes"

      - alert: RalphBrokenLinks
        expr: ralph_broken_links_total > 10
        for: 1h
        labels:
          severity: warning
```

---

## Phase 5: Data Persistence Strategy

| Data Type | Storage | Backup Strategy |
|-----------|---------|-----------------|
| Articles (`dist/`) | Docker volume / S3 | Daily S3 sync |
| Metadata (`lib/meta/`) | Docker volume / S3 | Hourly S3 sync |
| Logs (`lib/agent/logs/`) | Docker volume | Rotate, 7-day retention |

### Backup Script

```bash
#!/bin/bash
# backup.sh - Run via cron daily
aws s3 sync /data/dist s3://ralph-backups/articles/
aws s3 sync /data/lib/meta s3://ralph-backups/meta/
```

---

## Static Website Deployment

### Option 1: Vercel Auto-Deploy (Current Setup)

The current setup uses automatic deployment via GitHub:

```bash
# Content repo location
../wiki-content/

# Check deployment status
cd ../wiki-content && vercel ls

# Manual deploy (if needed)
cd ../wiki-content && vercel --prod
```

#### Initial Setup (Already Done)

```bash
# 1. Create content repo
mkdir ../wiki-content && cd ../wiki-content
git init
cp -r ../not-wikipedia/dist/* .

# 2. Create GitHub repo
gh repo create wiki-content --public --source=. --push

# 3. Connect to Vercel
vercel --yes
vercel git connect https://github.com/fellanH/wiki-content
```

#### Vercel Configuration (`wiki-content/vercel.json`)

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    { "source": "/styles", "destination": "/styles.css" }
  ]
}
```

### Option 2: Nginx on VPS

For self-hosted deployments, add an `nginx` service to docker-compose.yml:

```yaml
services:
  ralph:
    # ... (as above)

  nginx:
    image: nginx:alpine
    volumes:
      - ./dist:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    ports:
      - "80:80"
    restart: unless-stopped
```

### Option 3: GitHub Pages

```yaml
# GitHub Actions step to push dist/ to gh-pages
- name: Publish to gh-pages
  run: |
    git config user.name "github-actions"
    git config user.email "github-actions@users.noreply.github.com"
    cp -R dist out
    git checkout --orphan gh-pages
    git rm -rf .
    cp -R out/. .
    rm -rf out
    git add . && git commit -m "Update site"
    git push -f origin gh-pages
```

---

## Deployment Checklist

### Pre-deployment

- [ ] Set `ANTHROPIC_API_KEY` in secrets/env
- [ ] Configure Docker registry credentials
- [ ] Provision server with Docker installed
- [ ] Set up DNS (if serving articles publicly)

### First deployment

- [ ] Clone repo to server
- [ ] Copy existing `dist/` and `lib/meta/` data
- [ ] Run `docker compose up -d`
- [ ] Verify health check passes
- [ ] Set up monitoring endpoints

### Ongoing

- [ ] Configure backup cron job
- [ ] Set up alerting (PagerDuty/Slack)
- [ ] Review logs weekly

---

## Security Considerations

1. **API Key Protection**
   - Never commit `ANTHROPIC_API_KEY`
   - Use Docker secrets or environment injection

2. **File Permissions**
   - Run container as non-root user
   - Mount volumes with minimal permissions

3. **Network**
   - Keep Claude API calls internal
   - Use firewall to restrict access

---

## Quick Start Commands

```bash
# Run Ralph agent locally
cd lib/agent && ./ralph.sh

# Run with custom settings
PARALLEL_WORKERS=5 AUTO_PUBLISH=true ./ralph.sh

# Manual publish single article
cd lib/mcp && node -e "require('./dist/tools/wiki-git-publish.js').tool.handler({filename:'article.html'}).then(r=>console.log(r.content[0].text))"

# Sync all articles to content repo
cd lib/mcp && node -e "require('./dist/tools/wiki-git-publish.js').tool.handler({sync_all:true}).then(r=>console.log(r.content[0].text))"

# Check Vercel deployment status
cd ../wiki-content && vercel ls

# Manual Vercel deploy
cd ../wiki-content && vercel --prod

# Build and run with Docker
docker compose build
docker compose up -d

# View logs
docker compose logs -f ralph
```

---

## Troubleshooting

### Auto-Deploy Not Working

```bash
# Check if content repo has remote
cd ../wiki-content && git remote -v

# Check if Vercel is connected to GitHub
cd ../wiki-content && vercel git status

# Manually trigger deploy
cd ../wiki-content && git add -A && git commit -m "Manual sync" && git push
```

### Vercel Deployment Protection (401 errors)

If the site returns 401 Unauthorized:
1. Go to Vercel Dashboard → Project Settings
2. Scroll to "Deployment Protection"
3. Set to "Disabled" for public access

### Content Out of Sync

```bash
# Full sync from dist to content repo
cd lib/mcp && node -e "require('./dist/tools/wiki-git-publish.js').tool.handler({sync_all:true}).then(r=>console.log(r.content[0].text))"
```

### MCP Tools Not Found

```bash
# Rebuild MCP tools
cd lib/mcp && npm run build
```

---

## Related Documentation

- [README.md](../README.md) - Project overview and usage
- [CONTRIBUTING.md](../lib/agent/CONTRIBUTING.md) - Article template and style guide

## Content Repository

The content repository is maintained separately:

| Resource | Location |
|----------|----------|
| Local Path | `../wiki-content/` |
| GitHub | `github.com/fellanH/wiki-content` |
| Vercel | `vercel.com/felix-hellstroms-projects/not-wikipedia` |
