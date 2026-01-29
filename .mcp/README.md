# Not-Wikipedia MCP Tools

MCP server providing autonomous agent tools for the Not-Wikipedia ecosystem - an encyclopedia of hallucinations, lost history, and abstract concepts.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AUTONOMOUS AGENT LOOP                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────┐    wiki_next_task    ┌──────────────────────────┐   │
│   │              │ ◄──────────────────► │   MCP Server             │   │
│   │  Claude Code │                      │   ├─ wiki_ecosystem      │   │
│   │    Agent     │    wiki_broken_links │   ├─ wiki_random_topic   │   │
│   │              │ ◄──────────────────► │   ├─ wiki_researcher     │   │
│   └──────────────┘                      │   └─ wiki_broken_links   │   │
│          │                              └──────────────────────────┘   │
│          │                                          │                   │
│          │ creates/repairs                          │ reads             │
│          ▼                                          ▼                   │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │                    FILESYSTEM                                 │     │
│   │  not-wikipedia/     meta/researchers.json     meta/ecosystem.json       │     │
│   │  ├─ *.html          (researcher          (article metadata,   │     │
│   │  └─ wiki-common.css  registry)            categories)         │     │
│   └──────────────────────────────────────────────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# The server is auto-configured via .claude/settings.local.json
# Just run claude code in the ralph/ directory
```

## Wiki Tools

### `wiki_next_task` - Primary Entry Point

Returns a complete task specification using cryptographically secure randomness.

**Priority Order:**
1. `repair_broken_link` (critical) - Fix missing pages
2. `resolve_placeholder` (high) - Replace NEXT_PAGE_PLACEHOLDER
3. `fix_orphan` (medium) - Add links to orphaned articles
4. `create_new` (low) - Ecosystem healthy, expand content

**Response:**
```json
{
  "taskType": "repair_broken_link",
  "priority": "critical",
  "topic": {
    "name": "Semantic Forensics",
    "filename": "semantic-forensics.html",
    "context": "Referenced by 3 article(s): ghost-vocabulary.html, lexical-half-life.html..."
  },
  "researcher": {
    "name": "Dr. Rashid Osman",
    "field": "Stratigraphic Linguistics",
    "institution": "Cairo University",
    "isNew": false
  },
  "articleType": "methodology",
  "category": "linguistics",
  "infoboxColor": "#7b9e89",
  "randomSeed": "a1b2c3d4e5f6g7h8",
  "ecosystemStats": {
    "totalArticles": 20,
    "brokenLinks": 1,
    "orphans": 0,
    "placeholders": 0
  }
}
```

### `wiki_broken_links` - Broken Link Index

Returns indexed list of all broken links, sorted by priority.

**Parameters:**
- `select_index` (number) - Return only the link at this index
- `select_random` (boolean) - Return a randomly selected broken link

**Response:**
```json
{
  "count": 3,
  "links": [
    {
      "index": 0,
      "target": "semantic-forensics.html",
      "suggestedTitle": "Semantic Forensics",
      "sources": ["ghost-vocabulary.html", "lexical-half-life.html"],
      "priority": "high"
    }
  ],
  "randomSelection": 1,
  "randomSeed": "..."
}
```

### `wiki_random_topic` - Topic Selection

Selects next topic using secure randomness.

**Parameters:**
- `force_random` (boolean) - Skip broken links/priorities, pure random

**Priority:** broken links → expansion priorities → random suggestions

### `wiki_researcher_pick` - Researcher Selection

Randomly selects an available researcher, avoiding overused ones.

**Parameters:**
- `prefer_new` (boolean) - Prefer suggesting a new researcher

**Response:**
```json
{
  "researcher": {
    "name": "Dr. Rashid Osman",
    "field": "Stratigraphic Linguistics",
    "institution": "Cairo University"
  },
  "source": "existing_available",
  "suggestion": "Selected from 5 available researchers",
  "randomSeed": "..."
}
```

### `wiki_ecosystem_status` - Health Check

Returns complete ecosystem health status.

**Response:**
```json
{
  "healthy": true,
  "articles": 20,
  "brokenLinks": [],
  "orphanArticles": [],
  "placeholders": [],
  "categoryBalance": {
    "linguistics": 11,
    "consciousness": 5,
    "chronopsychology": 2
  },
  "issues": []
}
```

## True Randomness

All selection uses `crypto.randomBytes()` for cryptographically secure randomness:

```typescript
function secureRandomInt(max: number): number {
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  return randomValue % max;
}
```

Every response includes a `randomSeed` (hex string) for audit/verification.

## Project Structure

```
.mcp/
├── src/
│   ├── index.ts                 # MCP server entry point
│   ├── types.ts                 # TypeScript interfaces
│   └── tools/
│       ├── index.ts             # Tool registry
│       ├── wiki-ecosystem.ts    # Ecosystem health
│       ├── wiki-next-task.ts    # Main task selector
│       ├── wiki-random-topic.ts # Topic selection
│       ├── wiki-researcher.ts   # Researcher picker
│       ├── wiki-broken-links.ts # Broken link index
│       └── ...                  # Utility tools
├── dist/                        # Compiled JavaScript
├── package.json
└── tsconfig.json
```

## Configuration

The server is configured in `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "wiki-tools": {
      "command": "node",
      "args": [".mcp/dist/index.js"],
      "cwd": "/Users/admin/dev/ralph"
    }
  }
}
```

## Development

```bash
# Build after changes
npm run build

# Test tools manually
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"wiki_next_task","arguments":{}}}' | node dist/index.js

# List all tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

## Adding New Tools

1. Create `src/tools/my-tool.ts`:
```typescript
import { ToolModule } from "../types.js";

export const tool: ToolModule = {
  definition: {
    name: "wiki_my_tool",
    description: "What this tool does",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  handler: async (args) => {
    return {
      content: [{ type: "text", text: JSON.stringify(result) }]
    };
  }
};
```

2. Register in `src/tools/index.ts`:
```typescript
import { tool as wikiMyTool } from "./my-tool.js";
// Add to toolModules array
```

3. Rebuild: `npm run build`

## Ecosystem Files

The tools interact with these project files:

| File | Purpose |
|------|---------|
| `not-wikipedia/*.html` | Wiki articles |
| `not-wikipedia/wiki-common.css` | Shared styles |
| `meta/researchers.json` | Researcher registry with usage tracking |
| `meta/ecosystem.json` | Article metadata and categories |

## Self-Healing Loop

The tools enable a self-healing autonomous loop:

```
┌─────────────────────────────────────────────────────┐
│  1. wiki_next_task → Get task with random seed      │
│  2. Execute task (repair/create)                    │
│  3. Update meta/ecosystem.json and meta/researchers.json      │
│  4. Loop back to step 1                             │
└─────────────────────────────────────────────────────┘
```

Priority ensures broken links are always fixed before new content is created.
