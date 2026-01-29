# Ralph Deployment Plan

> Taking Ralph from local script to production infrastructure

## Current State

| Component | Status |
|-----------|--------|
| Runtime | Local bash script (`ralph.sh`) |
| Container | None |
| CI/CD | None |
| Process management | Lock file only |
| Dependencies | Node.js 20+, Claude Code CLI |

---

## Phase 1: Containerization (Local/Development)

### Dockerfile

```dockerfile
FROM node:20-slim

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Copy MCP tools and build
COPY .mcp/package*.json .mcp/
RUN cd .mcp && npm ci

COPY .mcp/ .mcp/
RUN cd .mcp && npm run build

# Copy application files
COPY ralph.sh PROMPT.md CONTRIBUTING.md ./
COPY not-wikipedia/ not-wikipedia/
COPY meta/ meta/
COPY .claude/ .claude/

# Environment
ENV ANTHROPIC_API_KEY=""
ENV MAX_LOOPS=100

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
      - ./not-wikipedia:/app/not-wikipedia
      - ./meta:/app/meta
      - ./.logs:/app/.logs
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
        run: cd .mcp && npm ci && npm run build

      - name: Run tests
        run: cd .mcp && npm test

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
│           VPS (4GB RAM, 2 vCPU)              │
├─────────────────────────────────────────────┤
│  Docker                                      │
│  ├── ralph (main agent loop)                │
│  ├── nginx (static file server)             │
│  └── prometheus (metrics)                   │
├─────────────────────────────────────────────┤
│  Volumes                                     │
│  ├── /data/not-wikipedia (articles)         │
│  ├── /data/meta (ecosystem state)           │
│  └── /data/logs (run logs)                  │
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

Add to `ralph.sh`:

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
| Articles (`not-wikipedia/`) | Docker volume / S3 | Daily S3 sync |
| Metadata (`meta/`) | Docker volume / S3 | Hourly S3 sync |
| Logs (`.logs/`) | Docker volume | Rotate, 7-day retention |
| SQLite DB (future) | Docker volume | Daily snapshot |

### Backup Script

```bash
#!/bin/bash
# backup.sh - Run via cron daily
aws s3 sync /data/not-wikipedia s3://ralph-backups/articles/
aws s3 sync /data/meta s3://ralph-backups/meta/
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
- [ ] Copy existing `not-wikipedia/` and `meta/` data
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
# Build and run locally
docker compose build
docker compose up -d

# View logs
docker compose logs -f ralph

# Stop
docker compose down

# Deploy to remote server
scp -r . user@server:/opt/ralph
ssh user@server "cd /opt/ralph && docker compose up -d"
```

---

## Related Documentation

- [SCALE_ROADMAP.md](SCALE_ROADMAP.md) - Code optimization for 10K-1M+ articles
- [CONTRIBUTING.md](CONTRIBUTING.md) - Article template and style guide
