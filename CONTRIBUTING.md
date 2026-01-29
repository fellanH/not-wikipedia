# Contributing to Not-Wikipedia

Not-Wikipedia is an encyclopedia of hallucinations, lost history, and abstract concepts. Each article is an HTML file that visually mimics Wikipedia while containing fictional content.

## Task Types

| Task | Action |
|------|--------|
| `repair_broken_link` | Create the missing article that other pages link to |
| `resolve_placeholder` | Replace NEXT_PAGE_PLACEHOLDER with a real article link |
| `fix_orphan` | Add incoming links from related articles |
| `create_new` | Create new content inspired by the human seed |

## Agent Interpretation

The agent should infer article content naturally from context:

- **For broken links**: Read the referencing articles to understand what the missing page should contain
- **For new content**: Derive the topic, type, and thematic direction entirely from the human seed passage
- **For orphans**: Read the orphan article and find thematically related articles to link from

Create researchers, institutions, and concepts as needed based on the content being written. Let the article's subject matter guide these decisions organically.

## HTML Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Article Title - Wikipedia</title>
    <link rel="stylesheet" href="wiki-common.css">
    <style>
        .infobox-title { background-color: #UNIQUE_COLOR; }
    </style>
</head>
<body>
    <div id="content">
        <h1 id="firstHeading">Article Title</h1>
        <div id="siteSub">From Wikipedia, the free encyclopedia</div>

        <div class="ambox ambox-warning">
            <strong>Warning:</strong> Unique thematic warning here.
        </div>

        <table class="infobox">
            <tr><td colspan="2" class="infobox-title">Title</td></tr>
            <tr><th scope="row">Type</th><td>As appropriate</td></tr>
            <tr><th scope="row">Field</th><td>As appropriate</td></tr>
        </table>

        <p>Lead paragraph introducing the concept...</p>

        <div id="toc">
            <h2>Contents</h2>
            <ul>
                <li><a href="#Section1">1 Section One</a></li>
            </ul>
        </div>

        <h2 id="Section1">Section One<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>Content with <a href="existing-article.html">internal links</a>...</p>

        <h2 id="See_also">See also</h2>
        <ul>
            <li><a href="related-article.html">Related Article</a></li>
        </ul>

        <h2 id="References">References</h2>
        <ol class="reflist">
            <li id="cite1"><b>^</b> Author (Year). "Title". <i>Journal</i>.</li>
        </ol>

        <div id="catlinks">
            <b>Categories:</b> <a href="#">Category</a>
        </div>
    </div>
</body>
</html>
```

## Article Structure

Each article should have:

- **Title and subtitle** (h1 and siteSub)
- **Warning box** — unique, thematically appropriate
- **Infobox** — with relevant fields for the content
- **Table of contents** — for 3+ sections
- **3-6 main sections** — with substantive content
- **Internal links** — to 3-8 other Not-Wikipedia articles
- **References** — 5-15 plausible academic citations
- **Categories footer**

## Visual Style

Maintain Wikipedia's "Vector" skin aesthetic:

- Background: `#f6f6f6`
- Text: `#202122`
- Links: `#0645ad`
- Content max-width: 900px

## Infobox Colors

Use the provided infobox color from the task, or pick an unused one:

- `#7b9e89` (sage)
- `#c9a86c` (gold)
- `#8b7355` (brown)
- `#d4a87a` (copper)
- `#a6c4d4` (sky)
- `#b8a8d4` (lavender)
- `#98d1a8` (mint)
- `#e6c88a` (wheat)
- `#9fc5e8` (light blue)
- `#f9cb9c` (peach)

## Quality Checklist

- [ ] Unique warning box
- [ ] Infobox with relevant fields
- [ ] 3-8 internal links (all valid)
- [ ] 5-15 references
- [ ] Categories footer
- [ ] Valid HTML5
