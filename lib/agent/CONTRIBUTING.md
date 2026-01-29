# Creating Not-Wikipedia Articles

## Agent Loop Architecture

The autonomous agent (`ralph.sh`) runs in a minimal-context mode to maximize creative variance:

### Design Principles

1. **Human Seed Dominance**: The agent's context is dominated by a literary quote (the "human seed"), not existing articles
2. **No File Reading**: Agent cannot read existing wiki articles - prevents pattern matching
3. **MCP Tool for HTML**: Agent calls `wiki_create_article` via Bash/Node - tool handles HTML structure
4. **Isolated Environment**: Each worker runs in an empty temp directory

### Agent Flow

```
1. Fetch task from wiki_next_task (includes human seed quote)
2. Generate minimal PROMPT.md (~500 bytes: seed + tool example)
3. Run Claude with --allowedTools "Bash" only
4. Agent invents article inspired by seed, calls MCP tool
5. Post-process: run discovery, publish to content repo
```

### Configuration

```bash
PARALLEL_WORKERS=3        # Concurrent agents
MAX_LOOPS_PER_WORKER=100  # Loops before exit
AUTO_PUBLISH=true         # Push to content repo
USE_LIVE_CRAWL=false      # Check live site for 404s
```

---

## MCP Tools

Use these tools to create and manage articles programmatically.

### `wiki_create_article` - Create new articles

Creates a new article with proper HTML structure.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `title` | Yes | Article title (e.g., "Semantic Drift") |
| `content` | Yes | Article body using markdown formatting |
| `topic` | No | Seed phrase to guide article topic |
| `infobox_color` | No | Hex color for infobox (e.g., `#7b9e89`) |
| `infobox_fields` | No | Key-value pairs for the infobox |
| `categories` | No | List of category names |
| `see_also` | No | List of related article filenames |
| `warning_message` | No | Warning text for an ambox |

### `wiki_edit_article` - Modify existing articles

Edit articles with structured operations.

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `add_section` | `section_title`, `content`, `after_section` | Add a new section |
| `update_section` | `section_id`, `content` | Replace section content |
| `append_see_also` | `link` | Add to See Also section |
| `update_infobox` | `infobox_field`, `infobox_value` | Add/update infobox field |
| `add_category` | `category` | Add a category |
| `set_warning` | `warning` | Set/update warning ambox |
| `append_content` | `content` | Append paragraph before See Also |

### `wiki_add_link` - Cross-reference articles

Create links between articles.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `source` | Yes | Source article filename |
| `target` | Yes | Target article to link to |
| `link_type` | No | `see_also`, `inline`, or `both` (default: `see_also`) |
| `bidirectional` | No | Also add reverse link (default: false) |
| `anchor_text` | No | Text to convert to inline link |
| `in_section` | No | Limit inline search to this section |

### `wiki_get_article` - Parse article metadata

Returns structured data about an article: title, sections, links, infobox, categories, word count.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `filename` | Yes | Article filename |
| `include_content_preview` | No | Include section previews (default: true) |
| `include_links` | No | Include link analysis (default: true) |

### `wiki_crawl_404s` - Find broken links on live site

Crawls the live not-wikipedia.org site via HTTP to find pages that return 404 errors.
Unlike `wiki_broken_links` (which checks the local database), this makes actual HTTP requests.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `max_pages` | No | Maximum pages to crawl (default: 50) |
| `return_first` | No | Return only the highest priority 404 for immediate action |

Returns broken links with their source pages and suggested filenames for creation.

### `wiki_next_task` - Get next agent task

Returns the next task for the autonomous agent. Supports live 404 detection.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `use_live_crawl` | No | Crawl live site for 404s instead of using database |
| `max_crawl_pages` | No | Max pages to crawl when using live mode (default: 20) |

Task types returned:
- `create_from_live_404` - Create a page that returns 404 on the live site
- `repair_broken_link` - Create a page referenced in the database but missing
- `resolve_placeholder` - Replace NEXT_PAGE_PLACEHOLDER markers
- `fix_orphan` - Add links to orphaned articles
- `create_new` - Create new content inspired by human seed

## Content Formatting

Use markdown-style formatting in content:

```markdown
## Section Header
### Subsection

This is a paragraph with **bold** and *italic* text.

- Bullet point one
- Bullet point two

Link to [another article](semantic-drift.html).
```

## Visual Style Reference

| Property | Value |
|----------|-------|
| Background | `#f6f6f6` |
| Text | `#202122` |
| Links | `#0645ad` |
| Max-width | 900px |

## Infobox Colors

`#7b9e89` `#c9a86c` `#8b7355` `#d4a87a` `#a6c4d4` `#b8a8d4` `#98d1a8` `#e6c88a` `#9fc5e8` `#f9cb9c`
