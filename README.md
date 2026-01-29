# Ralph

An autonomous Claude Code loop that builds **Not-Wikipedia** — a fictional encyclopedia.

## What It Does

Ralph continuously runs Claude Code to generate and maintain a fictional Wikipedia-style encyclopedia. Each article mimics Wikipedia's visual style while containing entirely fabricated content.

The system:
- Fetches tasks via MCP tools (create articles, repair broken links, resolve placeholders, fix orphans)
- Injects human seed passages as the **sole creative driver**
- Runs Claude to create HTML articles following Wikipedia's aesthetic
- Validates ecosystem health (broken links, orphans, unresolved placeholders)
- Logs all runs for debugging and analysis

---

## Meta Rules: Non-Deterministic Generation

> **Core Principle**: Maximum variance across agent iterations. The agent receives minimal context and must derive everything from the human seed alone.

### Agent Context (STRICT)

The agent receives ONLY:

| Input | Purpose |
|-------|---------|
| **Human seed** | The sole creative input — a passage, quote, or text |
| **Task type** | What action to take (`create_new`, `repair_broken_link`, etc.) |
| **Target path** | Where to write the file |
| **HTML template** | Structural skeleton only — no example content |
| **CSS reference** | Visual styling (colors, fonts, layout) |

**Nothing else.** No interpretation hints. No vocabulary guidance. No thematic suggestions.

### Forbidden in Context Files

These create deterministic patterns and MUST NOT appear:

| Forbidden | Why |
|-----------|-----|
| Interpretation instructions | "Derive the topic from..." steers inference |
| Vocabulary guidance | "Avoid these words..." or "Use varied..." biases output |
| Thematic hints | "Connection can be metaphorical..." primes specific modes |
| Category examples | Lists of topics constrain imagination |
| Numeric requirements | "3-6 sections" creates formulas |
| Writing style rules | "Read distinctly" is subjective instruction |

### Allowed in Context Files

| Allowed | Why |
|---------|-----|
| HTML skeleton | `<h1>`, `<table class="infobox">` — pure structure |
| CSS styling | Colors, fonts, layout — visual only |
| File conventions | `.html`, kebab-case — technical |
| Link validation | "Must point to existing files" — ecosystem integrity |
| Structural checklist | "Has infobox, has references" — binary checks |

### File Responsibilities

**PROMPT.md** — Generated per task, contains:
- Task type and priority
- Human seed (quoted, with attribution)
- Infobox color
- Link to CONTRIBUTING.md
- **NOTHING ELSE**

**CONTRIBUTING.md** — Static reference, contains:
- HTML template (empty structure)
- CSS specifications
- File naming rules
- Quality checklist (structural items only)
- **NO interpretation guidance**
- **NO writing style instructions**

**ralph.sh** — Orchestration, must:
- Generate minimal PROMPT.md
- NOT inject guidance text
- NOT add vocabulary reminders
- NOT explain how to interpret the seed

### Why This Matters

Two agents given the same human seed should produce **completely different** articles. If they produce similar content, the prompt is too deterministic.

The human seed is raw material. The agent's interpretation is unconstrained. The output is unpredictable.

```
Human Seed ─────► Agent (minimal context) ─────► Unique Article
                        │
                        └── No steering, no hints, no patterns
```

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
| `MAX_DISCOVERY_DEPTH` | 3 | Maximum recursion depth for Content Fractal |
| `HEALTH_CHECK_INTERVAL` | 5 | Full health check every N loops |

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
2. **Fetch Task** — Gets next task from MCP tool (prioritizes discovery queue → broken links → fresh seeds)
3. **Generate Prompt** — Writes task details to `PROMPT.md`
4. **Run Claude** — Executes `claude -p` with the prompt
5. **Recursive Discovery** — Scans new article for concepts and queues them
6. **Validate** — Post-loop health check
7. **Repeat**

---

## Recursive Discovery (Content Fractal)

Ralph uses **Recursive Discovery** to transform from a reactive system (fixing broken links one at a time) into an **explosive growth engine** (each article spawns multiple new concepts).

### How It Works

```
Article A is created
       ↓
Discovery scans A, finds links to [B, C, D]
       ↓
B, C, D are queued at depth 1
       ↓
Article B is created (from queue)
       ↓
Discovery scans B, finds links to [E, F]
       ↓
E, F are queued at depth 2
       ↓
... continues until max depth reached
```

### Priority System

The discovery queue uses intelligent prioritization:

| Factor | Effect |
|--------|--------|
| Lower depth | Higher priority (closer to root concepts) |
| Multiple references | Higher priority (more demanded) |
| Queue order | FIFO within same priority |

### Configuration

Edit `ralph.sh` to adjust:

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_DISCOVERY_DEPTH` | 3 | Maximum recursion layers |

### Relevance Filtering

To prevent topic drift (e.g., starting at "Linguistics" and ending at "Quantum Mechanics"), the discovery tool supports optional filters:

```javascript
// Example: Stay focused on linguistics topics
{
  relevance_filter: {
    required_keywords: ["linguistic", "language", "semantic"],
    excluded_keywords: ["quantum", "physics"],
    min_filename_length: 8
  }
}
```

### Safeguards

- **Depth Limit**: Prevents infinite recursion (default: 3 layers)
- **Duplicate Detection**: Already-queued concepts are skipped
- **Article Existence Check**: Existing articles are not re-queued
- **Priority Decay**: Deeper concepts have lower priority

Each generated article includes:
- Wikipedia-style warning box (unique per article)
- Infobox with themed color
- Content sections
- Internal links to other Not-Wikipedia articles
- Academic-style references
- Category footer

## Dashboard

Open `dashboard/index.html` in a browser to browse the encyclopedia with search and filtering.

## License

This project generates fictional content. All "facts" in Not-Wikipedia are fabricated.
