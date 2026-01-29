# Ralph

An autonomous Claude Code loop that builds **Not-Wikipedia** — an encyclopedia of hallucinations, lost history, and abstract concepts.

## What It Does

Ralph continuously runs Claude Code to generate and maintain a fictional Wikipedia-style encyclopedia. Each article mimics Wikipedia's visual style while containing entirely fabricated content — invented researchers, impossible phenomena, and conceptual frameworks that never existed.

The system:
- Fetches tasks via MCP tools (create articles, repair broken links, resolve placeholders, fix orphans)
- Generates prompts from human seed passages (literary quotes, philosophical fragments)
- Runs Claude to create HTML articles following Wikipedia's aesthetic
- Validates ecosystem health (broken links, orphans, unresolved placeholders)
- Logs all runs for debugging and analysis

## Project Structure

```
ralph/
├── ralph.sh              # Main orchestration script
├── PROMPT.md             # Current task (auto-generated)
├── CONTRIBUTING.md       # Article template and guidelines
├── not-wikipedia/        # Generated HTML articles
│   ├── wiki-common.css   # Shared Wikipedia-style CSS
│   └── *.html            # Individual articles
├── dashboard/            # Web dashboard for browsing
├── .mcp/                 # MCP tools (task fetching, validation)
├── .logs/                # Run logs (JSON)
└── meta/                 # Ecosystem metadata
```

## Usage

```bash
./ralph.sh
```

The script runs indefinitely (or until `MAX_LOOPS` is reached), creating one article per loop. Press `Ctrl+C` to stop gracefully.

### Configuration

Edit variables at the top of `ralph.sh`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_LOOPS` | 100 | Maximum iterations (0 = unlimited) |
| `MAX_LOGS` | 100 | Log files to keep |
| `WIKI_DIR` | not-wikipedia | Article output directory |

## Task Types

| Task | Description |
|------|-------------|
| `create_new` | Create new content from a human seed passage |
| `repair_broken_link` | Create missing article that other pages link to |
| `resolve_placeholder` | Replace `NEXT_PAGE_PLACEHOLDER` with real links |
| `fix_orphan` | Add incoming links to isolated articles |

## Requirements

- [Claude Code CLI](https://github.com/anthropics/claude-code)
- Node.js (for MCP tools)
- Bash

## How It Works

1. **Health Check** — Scans for broken links, orphans, and placeholders
2. **Fetch Task** — Gets next task from MCP tool (prioritizes repairs)
3. **Generate Prompt** — Writes task details to `PROMPT.md`
4. **Run Claude** — Executes `claude -p` with the prompt
5. **Validate** — Post-loop health check
6. **Repeat**

Each generated article includes:
- Wikipedia-style warning box (unique per article)
- Infobox with themed color
- 3-6 content sections
- 3-8 internal links to other Not-Wikipedia articles
- 5-15 fictional academic references
- Category footer

## Dashboard

Open `dashboard/index.html` in a browser to browse the encyclopedia with search and filtering.

## License

This project generates fictional content. All "facts" in Not-Wikipedia are fabricated.
