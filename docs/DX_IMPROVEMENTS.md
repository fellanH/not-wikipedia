# Developer Experience Improvements

This document outlines proposed improvements to make the local development experience smoother for new contributors.

## Current State

The project runs via `./ralph.sh` in `lib/agent/`. While the README is comprehensive, several friction points exist for developers setting up the project for the first time.

## Proposed Changes

### 1. Setup Script

**Problem**: No automated way to verify prerequisites or initialize the project.

**Solution**: Add `setup.sh` at project root.

```bash
#!/bin/bash
# setup.sh - Initialize not-wikipedia for local development

set -e

echo "Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found. Install from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "ERROR: Node.js 20+ required (found v$NODE_VERSION)"
    exit 1
fi

# Check Claude CLI
if ! command -v claude &> /dev/null; then
    echo "ERROR: Claude Code CLI not found."
    echo "Install: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

# Install MCP dependencies
echo "Installing MCP dependencies..."
cd lib/mcp
npm install
npm run build
cd ../..

# Verify database
if [ ! -f "lib/meta/ralph.db" ]; then
    echo "Database will be initialized on first run."
fi

echo ""
echo "Setup complete! Run the agent with:"
echo "  cd lib/agent && ./ralph.sh"
echo ""
echo "Or use npm scripts:"
echo "  npm start          # Run agent loop"
echo "  npm run serve      # Preview site locally"
```

---

### 2. Environment Configuration

**Problem**: Configuration variables are buried in `ralph.sh`. No standard `.env` pattern.

**Solution**: Add `.env.example` at project root.

```bash
# .env.example - Copy to .env and customize

# Agent Configuration
PARALLEL_WORKERS=3              # Number of concurrent agent workers
MAX_LOOPS_PER_WORKER=100        # Iterations before worker restarts
LOOP_DELAY=2                    # Seconds between iterations

# Publishing
AUTO_PUBLISH=true               # Push to GitHub after each article
WIKI_CONTENT_REPO=fellanH/wiki-content  # Target repository

# Discovery
MAX_DISCOVERY_DEPTH=3           # Recursive link discovery depth
USE_LIVE_CRAWL=false            # Crawl live site for 404s
MAX_CRAWL_PAGES=10              # Pages to crawl if enabled

# Health Checks
HEALTH_CHECK_INTERVAL=10        # Run health check every N loops

# Development
DRY_RUN=false                   # Skip publishing (for testing)
SINGLE_ITERATION=false          # Run once and exit
```

**Changes to `ralph.sh`**: Load `.env` if present:

```bash
# At top of ralph.sh, after set -e
if [ -f "../../.env" ]; then
    export $(grep -v '^#' ../../.env | xargs)
fi
```

---

### 3. NPM Scripts

**Problem**: Must navigate to `lib/agent/` and know the exact command.

**Solution**: Update root `package.json`:

```json
{
  "name": "not-wikipedia",
  "version": "1.0.0",
  "description": "Autonomous Wikipedia-style article generation system",
  "scripts": {
    "start": "cd lib/agent && ./ralph.sh",
    "start:single": "cd lib/agent && SINGLE_ITERATION=true ./ralph.sh",
    "start:dry": "cd lib/agent && DRY_RUN=true ./ralph.sh",
    "serve": "cd dist && python3 -m http.server 8000",
    "build:mcp": "cd lib/mcp && npm run build",
    "setup": "./setup.sh",
    "health": "cd lib/agent && ./ralph.sh --health-check"
  },
  "private": true
}
```

**Usage**:
```bash
npm start           # Full agent loop
npm run start:dry   # Test without publishing
npm run start:single # One iteration only
npm run serve       # Preview at localhost:8000
npm run setup       # First-time setup
```

---

### 4. Dry Run Mode

**Problem**: No way to test article generation without publishing to GitHub.

**Solution**: Add `--dry-run` flag to `ralph.sh`.

```bash
# Add to ralph.sh argument parsing (new section after configuration)

DRY_RUN=${DRY_RUN:-false}
SINGLE_ITERATION=${SINGLE_ITERATION:-false}

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --single)
            SINGLE_ITERATION=true
            MAX_LOOPS_PER_WORKER=1
            shift
            ;;
        --health-check)
            # Run health check and exit
            run_health_check
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done
```

**Modify publish section**:
```bash
if [ "$AUTO_PUBLISH" = "true" ] && [ "$DRY_RUN" = "false" ]; then
    log_worker $worker_id "Publishing to GitHub..."
    # existing publish logic
else
    log_worker $worker_id "Skipping publish (dry-run mode)"
fi
```

---

### 5. Health Check Command

**Problem**: Health check only runs during agent loop. No standalone way to check ecosystem status.

**Solution**: Add `--health-check` flag that runs health check and exits.

```bash
# Add function to ralph.sh

run_health_check() {
    echo "=== Ecosystem Health Check ==="
    echo ""

    cd "$MCP_DIR"
    node -e "
        import('./dist/tools/wiki-ecosystem.js')
            .then(m => m.tool.handler({}))
            .then(r => console.log(r.content[0].text))
            .catch(e => console.error('Error:', e.message))
    "

    echo ""
    echo "=== Broken Links ==="
    node -e "
        import('./dist/tools/wiki-broken-links.js')
            .then(m => m.tool.handler({ limit: 10 }))
            .then(r => console.log(r.content[0].text))
            .catch(e => console.error('Error:', e.message))
    "
}
```

**Usage**:
```bash
./ralph.sh --health-check
# or
npm run health
```

---

### 6. Credential Documentation

**Problem**: GitHub/Vercel setup for auto-publishing not documented.

**Solution**: Add section to README.md:

```markdown
## Publishing Setup

For auto-publishing to work, configure GitHub access:

### Option A: SSH Key (Recommended)

1. Generate SSH key if needed: `ssh-keygen -t ed25519`
2. Add public key to GitHub: Settings → SSH Keys
3. Clone wiki-content repo via SSH: `git clone git@github.com:USER/wiki-content.git`

### Option B: Personal Access Token

1. Create token at GitHub → Settings → Developer Settings → Personal Access Tokens
2. Set in environment:
   ```bash
   export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
   ```

### Vercel Deployment

The wiki-content repository auto-deploys via Vercel:

1. Import `wiki-content` repo in Vercel dashboard
2. Configure:
   - Framework: Other
   - Build Command: (leave empty)
   - Output Directory: `.`
3. Deploy triggers automatically on push
```

---

### 7. MCP Tool CLI Wrapper

**Problem**: Calling MCP tools directly requires verbose Node.js commands.

**Solution**: Add `lib/mcp/cli.js`:

```javascript
#!/usr/bin/env node
// cli.js - Simple CLI wrapper for MCP tools

import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const toolsDir = join(__dirname, 'dist', 'tools');

const [,, toolName, ...args] = process.argv;

if (!toolName || toolName === '--help') {
    console.log('Usage: node cli.js <tool-name> [--param value ...]');
    console.log('');
    console.log('Available tools:');
    const tools = readdirSync(toolsDir)
        .filter(f => f.endsWith('.js'))
        .map(f => '  ' + f.replace('.js', ''));
    console.log(tools.join('\n'));
    process.exit(0);
}

// Parse args into object
const params = {};
for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    params[key] = args[i + 1];
}

// Load and run tool
const toolPath = join(toolsDir, `${toolName}.js`);
import(toolPath)
    .then(m => m.tool.handler(params))
    .then(r => console.log(r.content[0].text))
    .catch(e => {
        console.error('Error:', e.message);
        process.exit(1);
    });
```

**Add to `lib/mcp/package.json`**:
```json
"bin": {
    "mcp": "./cli.js"
},
"scripts": {
    "tool": "node cli.js"
}
```

**Usage**:
```bash
cd lib/mcp
npm run tool wiki-ecosystem
npm run tool wiki-next-task
npm run tool wiki-broken-links -- --limit 5
```

---

## Implementation Priority

| Priority | Change | Effort | Impact |
|----------|--------|--------|--------|
| 1 | `.env.example` | Low | High - immediate clarity |
| 2 | NPM scripts in root | Low | High - standard interface |
| 3 | `--dry-run` flag | Medium | High - safer testing |
| 4 | Setup script | Medium | High - onboarding |
| 5 | Credential docs | Low | Medium - unblocks publishing |
| 6 | `--health-check` flag | Low | Medium - visibility |
| 7 | MCP CLI wrapper | Medium | Low - power users only |

## Summary

These changes would reduce new developer setup from ~30 minutes to ~5 minutes while providing safer ways to test changes locally before publishing.
