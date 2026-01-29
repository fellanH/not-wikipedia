/**
 * Wiki Create Article Tool
 *
 * Creates a new Not-Wikipedia article with proper HTML structure.
 */

import { ToolModule } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { WIKI_DIR, INFOBOX_COLORS } from "../config.js";

interface ArticleInput {
  title: string;
  content: string;
  topic?: string;
  infobox_color?: string;
  infobox_fields?: Record<string, string>;
  categories?: string[];
  see_also?: string[];
  warning_message?: string;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function getRandomColor(): string {
  return INFOBOX_COLORS[Math.floor(Math.random() * INFOBOX_COLORS.length)];
}

function extractSections(content: string): Array<{ id: string; title: string; level: number }> {
  const sections: Array<{ id: string; title: string; level: number }> = [];
  for (const line of content.split("\n")) {
    const h2Match = line.match(/^## (.+)$/);
    const h3Match = line.match(/^### (.+)$/);
    if (h2Match) sections.push({ id: h2Match[1].trim().replace(/\s+/g, "_"), title: h2Match[1].trim(), level: 2 });
    else if (h3Match) sections.push({ id: h3Match[1].trim().replace(/\s+/g, "_"), title: h3Match[1].trim(), level: 3 });
  }
  return sections;
}

function contentToHtml(content: string): string {
  let html = content;
  html = html.replace(/^### (.+)$/gm, (_, t) => `<h3 id="${t.trim().replace(/\s+/g, "_")}">${t.trim()}</h3>`);
  html = html.replace(/^## (.+)$/gm, (_, t) => `<h2 id="${t.trim().replace(/\s+/g, "_")}">${t.trim()}<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>`);
  html = html.replace(/^(?!<|[\s])(.+)$/gm, "<p>$1</p>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/\*(.+?)\*/g, "<i>$1</i>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  const lines = html.split("\n");
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^- (.+)$/);
    if (m) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${m[1]}</li>`); }
    else { if (inList) { out.push("</ul>"); inList = false; } out.push(line); }
  }
  if (inList) out.push("</ul>");
  return out.join("\n").replace(/<p>\s*<\/p>/g, "");
}

function generateArticleHtml(input: ArticleInput): string {
  const color = input.infobox_color || getRandomColor();
  const sections = extractSections(input.content);
  const bodyHtml = contentToHtml(input.content);

  let tocNum = 1;
  let tocHtml = sections.map(s => s.level === 2
    ? `<li><span class="tocnumber">${tocNum++}</span> <a href="#${s.id}">${s.title}</a></li>`
    : `<li style="margin-left: 1em;"><a href="#${s.id}">${s.title}</a></li>`
  ).join("\n                ");
  tocHtml += `\n                <li><span class="tocnumber">${tocNum}</span> <a href="#See_also">See also</a></li>`;
  tocHtml += `\n                <li><span class="tocnumber">${tocNum + 1}</span> <a href="#References">References</a></li>`;

  const infoboxHtml = input.infobox_fields && Object.keys(input.infobox_fields).length
    ? `\n        <table class="infobox">\n            <tr><td colspan="2" class="infobox-title">${input.title}</td></tr>\n            ${Object.entries(input.infobox_fields).map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("\n            ")}\n        </table>` : "";

  const warningHtml = input.warning_message
    ? `\n        <div class="ambox ambox-warning">\n            <strong>Warning:</strong> ${input.warning_message}\n        </div>` : "";

  const seeAlsoHtml = input.see_also?.length
    ? input.see_also.map(l => `<li><a href="${l.endsWith(".html") ? l : l + ".html"}">${l.replace(/-/g, " ").replace(".html", "")}</a></li>`).join("\n            ")
    : "<li><i>No related articles yet</i></li>";

  const categoriesHtml = input.categories?.length
    ? input.categories.map(c => `<a href="#">${c}</a>`).join(" | ") : "<i>Uncategorized</i>";

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${input.title} - Wikipedia</title>
    <link rel="stylesheet" href="../wiki-common.css">
    <style>
        .infobox-title { background-color: ${color}; }
    </style>
</head>
<body>
    <div id="content">
        <h1 id="firstHeading">${input.title}</h1>
        <div id="siteSub">From Wikipedia, the free encyclopedia</div>
${warningHtml}
${infoboxHtml}

        ${bodyHtml}

        <div id="toc">
            <h2>Contents</h2>
            <ul>
                ${tocHtml}
            </ul>
        </div>

        <h2 id="See_also">See also<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <ul>
            ${seeAlsoHtml}
        </ul>

        <h2 id="References">References<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <ol class="reflist">
            <li id="cite1"><b>^</b> <i>Citation needed</i></li>
        </ol>

        <div id="catlinks">
            <b>Categories:</b> ${categoriesHtml}
        </div>
    </div>
</body>
</html>
`;
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_create_article",
    description: "Create a new Not-Wikipedia article with proper HTML structure. Takes title and markdown content, generates complete HTML with infobox, TOC, and references.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Article title" },
        content: { type: "string", description: "Body content using markdown (## h2, ### h3, **bold**, *italic*, [link](url), - lists)" },
        topic: { type: "string", description: "Seed phrase to guide article topic" },
        infobox_color: { type: "string", description: "Hex color for infobox (e.g., '#7b9e89')" },
        infobox_fields: { type: "object", description: "Key-value pairs for infobox" },
        categories: { type: "array", items: { type: "string" }, description: "Category list" },
        see_also: { type: "array", items: { type: "string" }, description: "Related article filenames" },
        warning_message: { type: "string", description: "Warning for ambox" }
      },
      required: ["title", "content"]
    }
  },

  handler: async (args) => {
    try {
      const title = args.title as string;
      const content = args.content as string;
      if (!title || !content) return { content: [{ type: "text", text: "Error: title and content required" }], isError: true };

      const input: ArticleInput = {
        title, content,
        topic: args.topic as string | undefined,
        infobox_color: args.infobox_color as string | undefined,
        infobox_fields: args.infobox_fields as Record<string, string> | undefined,
        categories: args.categories as string[] | undefined,
        see_also: args.see_also as string[] | undefined,
        warning_message: args.warning_message as string | undefined
      };

      const html = generateArticleHtml(input);
      const filename = slugify(title) + ".html";
      const filepath = path.join(WIKI_DIR, filename);

      try { await fs.access(filepath); return { content: [{ type: "text", text: `Error: '${filename}' already exists` }], isError: true }; } catch { /* ok */ }

      await fs.writeFile(filepath, html, "utf-8");
      return { content: [{ type: "text", text: JSON.stringify({ success: true, filename, title, message: `Created ${filename}` }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : e}` }], isError: true };
    }
  }
};
