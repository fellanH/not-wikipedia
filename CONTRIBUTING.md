# Not-Wikipedia HTML Structure

## Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Article Title - Wikipedia</title>
    <link rel="stylesheet" href="wiki-common.css">
    <style>
        .infobox-title { background-color: #INFOBOX_COLOR; }
    </style>
</head>
<body>
    <div id="content">
        <h1 id="firstHeading">Article Title</h1>
        <div id="siteSub">From Wikipedia, the free encyclopedia</div>

        <div class="ambox ambox-warning">
            <strong>Warning:</strong> ...
        </div>

        <table class="infobox">
            <tr><td colspan="2" class="infobox-title">Title</td></tr>
            <tr><th scope="row">Field</th><td>Value</td></tr>
        </table>

        <p>Lead paragraph...</p>

        <div id="toc">
            <h2>Contents</h2>
            <ul>
                <li><a href="#Section1">1 Section</a></li>
            </ul>
        </div>

        <h2 id="Section1">Section<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>Content with <a href="other-article.html">links</a>...</p>

        <h2 id="See_also">See also</h2>
        <ul>
            <li><a href="related.html">Related</a></li>
        </ul>

        <h2 id="References">References</h2>
        <ol class="reflist">
            <li id="cite1"><b>^</b> Citation.</li>
        </ol>

        <div id="catlinks">
            <b>Categories:</b> <a href="#">Category</a>
        </div>
    </div>
</body>
</html>
```

## Visual Style

| Property | Value |
|----------|-------|
| Background | `#f6f6f6` |
| Text | `#202122` |
| Links | `#0645ad` |
| Max-width | 900px |

## Infobox Colors

`#7b9e89` `#c9a86c` `#8b7355` `#d4a87a` `#a6c4d4` `#b8a8d4` `#98d1a8` `#e6c88a` `#9fc5e8` `#f9cb9c`
