# Creating Not-Wikipedia Articles

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
