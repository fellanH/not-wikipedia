# Ralph Deployment Guide

> wiki-content is the source of truth with automatic Vercel deployment

## Current State

| Component | Status |
|-----------|--------|
| Runtime | Local bash script (`lib/agent/ralph.sh`) |
| Static Hosting | **Vercel** (auto-deploy on push) |
| Content Repo | **GitHub** (`fellanH/wiki-content`) - source of truth |
| Process Management | Coordinator + worker locks |
| Dependencies | Node.js 20+, Claude Code CLI, Vercel CLI |

## Production URLs

| Resource | URL |
|----------|-----|
| Live Site | `not-wikipedia.vercel.app` |
| GitHub Repo | `github.com/fellanH/wiki-content` |
| Vercel Dashboard | `vercel.com/felix-hellstroms-projects/not-wikipedia` |

---

## Architecture

The wiki-content repository is the **source of truth** for all content:

```
┌─────────────────────────────────────────────────────────────────┐
│                not-wikipedia (orchestration repo)                │
│                                                                  │
│  lib/agent/ralph.sh                                              │
│       │                                                          │
│       │ (generates article via MCP tools)                        │
│       ▼                                                          │
└───────┬─────────────────────────────────────────────────────────┘
        │
        │ writes directly to
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                wiki-content (source of truth)                    │
│                github.com/fellanH/wiki-content                   │
│                                                                  │
│  wiki/new-article.html                                          │
│       │                                                          │
│       │ (wiki-git-publish commits + pushes)                      │
│       ▼                                                          │
│  GitHub webhook triggers Vercel                                  │
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

1. Ralph agent creates an article directly in `wiki-content/wiki/`
2. `wiki-git-publish` MCP tool commits and pushes to GitHub
3. GitHub webhook triggers Vercel deployment
4. Site is live in ~5 seconds

### Key Files

| File | Purpose |
|------|---------|
| `lib/mcp/src/tools/wiki-git-publish.ts` | MCP tool for git commit/push |
| `lib/mcp/src/config.ts` | Path configuration (WIKI_DIR, CONTENT_REPO_DIR) |
| `lib/agent/ralph.sh` | Agent orchestration |
| `../wiki-content/vercel.json` | Vercel configuration |

---

## Repository Structure

```
not-wikipedia/               # Orchestration repo
├── lib/
│   ├── agent/              # Agent orchestration
│   │   ├── ralph.sh        # Main entry script
│   │   ├── PROMPT.md       # Task specification
│   │   └── logs/           # Execution logs
│   ├── mcp/                # MCP tools (TypeScript)
│   └── meta/               # Metadata (ralph.db)
└── docs/                   # Documentation

wiki-content/               # Content repo (source of truth)
├── index.html              # Homepage
├── styles.css              # Stylesheet
├── htmx.min.js             # HTMX library
├── wiki.js                 # Client-side JS
├── wiki/                   # Article HTML files
├── fragments/              # Article preview fragments
├── categories/             # Category pages
├── api/                    # Search index JSON
└── vercel.json             # Vercel config
```

---

## Quick Start Commands

```bash
# Run Ralph agent locally
cd lib/agent && ./ralph.sh

# Run with custom settings
PARALLEL_WORKERS=5 AUTO_PUBLISH=true ./ralph.sh

# Manual commit and push
cd lib/mcp && node -e "require('./dist/tools/wiki-git-publish.js').tool.handler({}).then(r=>console.log(r.content[0].text))"

# Rebuild search index
cd lib/mcp && node -e "require('./dist/tools/wiki-build-index.js').tool.handler({}).then(r=>console.log(r.content[0].text))"

# Check Vercel deployment status
cd ../wiki-content && vercel ls

# Manual Vercel deploy
cd ../wiki-content && vercel --prod
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

### MCP Tools Not Found

```bash
# Rebuild MCP tools
cd lib/mcp && npm run build
```

---

## Content Repository

The content repository is the source of truth:

| Resource | Location |
|----------|----------|
| Local Path | `../wiki-content/` |
| GitHub | `github.com/fellanH/wiki-content` |
| Vercel | `vercel.com/felix-hellstroms-projects/not-wikipedia` |
