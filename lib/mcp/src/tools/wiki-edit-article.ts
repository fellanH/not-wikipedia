/**
 * Wiki Edit Article Tool
 *
 * Modifies existing Not-Wikipedia articles with structured operations.
 */

import { ToolModule } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { WIKI_DIR } from "../config.js";

interface EditOperation {
  type: "add_section" | "update_section" | "append_see_also" | "update_infobox" | "add_category" | "set_warning" | "append_content";
  section_id?: string;
  section_title?: string;
  content?: string;
  after_section?: string;
  infobox_field?: string;
  infobox_value?: string;
  category?: string;
  link?: string;
  warning?: string;
}

function findSectionEnd(html: string, sectionId: string): { start: number; end: number } | null {
  const regex = new RegExp(`<h2 id="${sectionId}"[^>]*>`, "i");
  const match = html.match(regex);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  const after = html.slice(start + match[0].length);
  const nextH2 = after.search(/<h2 /i);
  const contentEnd = after.search(/<\/div>\s*<\/body>/i);
  const end = nextH2 !== -1 && (contentEnd === -1 || nextH2 < contentEnd)
    ? start + match[0].length + nextH2
    : contentEnd !== -1 ? start + match[0].length + contentEnd : html.length;
  return { start, end };
}

function addSection(html: string, title: string, content: string, after?: string): string {
  const id = title.replace(/\s+/g, "_");
  const section = `\n        <h2 id="${id}">${title}<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>\n        <p>${content}</p>\n`;
  if (after) { const pos = findSectionEnd(html, after); if (pos) return html.slice(0, pos.end) + section + html.slice(pos.end); }
  const m = html.match(/<h2 id="See_also"/i);
  return m?.index !== undefined ? html.slice(0, m.index) + section + html.slice(m.index) : html;
}

function updateSection(html: string, sectionId: string, content: string): string {
  const pos = findSectionEnd(html, sectionId);
  if (!pos) return html;
  const h2End = html.slice(pos.start).match(/<\/h2>/);
  if (!h2End?.index) return html;
  return html.slice(0, pos.start + h2End.index + 5) + `\n        <p>${content}</p>\n` + html.slice(pos.end);
}

function appendSeeAlso(html: string, link: string): string {
  const fn = link.endsWith(".html") ? link : link + ".html";
  const name = link.replace(/-/g, " ").replace(".html", "").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  if (html.includes(`href="${fn}"`)) return html;
  const m = html.match(/<h2 id="See_also"[^>]*>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
  if (!m?.index) return html;
  let h = html.replace(/<li><i>No related articles yet<\/i><\/li>/g, "");
  const ulEnd = h.indexOf("</ul>", m.index);
  return ulEnd !== -1 ? h.slice(0, ulEnd) + `\n            <li><a href="${fn}">${name}</a></li>\n        ` + h.slice(ulEnd) : html;
}

function updateInfobox(html: string, field: string, value: string): string {
  const m = html.match(/<table class="infobox">/i);
  if (!m?.index) return html;
  const regex = new RegExp(`<th scope="row">${field}</th>\\s*<td>[^<]*</td>`, "i");
  if (regex.test(html)) return html.replace(regex, `<th scope="row">${field}</th><td>${value}</td>`);
  const end = html.indexOf("</table>", m.index);
  return end !== -1 ? html.slice(0, end) + `            <tr><th scope="row">${field}</th><td>${value}</td></tr>\n        ` + html.slice(end) : html;
}

function addCategory(html: string, cat: string): string {
  const m = html.match(/<div id="catlinks">\s*<b>Categories:<\/b>\s*/i);
  if (!m?.index) return html;
  if (html.includes(`>${cat}</a>`)) return html;
  if (html.includes("<i>Uncategorized</i>")) return html.replace("<i>Uncategorized</i>", `<a href="#">${cat}</a>`);
  const pos = m.index + m[0].length;
  const linkEnd = html.slice(pos).indexOf("</a>");
  return linkEnd !== -1 ? html.slice(0, pos + linkEnd + 4) + ` | <a href="#">${cat}</a>` + html.slice(pos + linkEnd + 4) : html;
}

function setWarning(html: string, warning: string): string {
  const box = `\n        <div class="ambox ambox-warning">\n            <strong>Warning:</strong> ${warning}\n        </div>`;
  const existing = html.match(/<div class="ambox ambox-warning">[\s\S]*?<\/div>/i);
  if (existing) return html.replace(existing[0], box.trim());
  const m = html.match(/<div id="siteSub">[^<]*<\/div>/i);
  return m?.index !== undefined ? html.slice(0, m.index + m[0].length) + box + html.slice(m.index + m[0].length) : html;
}

function appendContent(html: string, content: string): string {
  const m = html.match(/<h2 id="See_also"/i);
  return m?.index !== undefined ? html.slice(0, m.index) + `\n        <p>${content}</p>\n\n` + html.slice(m.index) : html;
}

function applyEdit(html: string, op: EditOperation): string {
  switch (op.type) {
    case "add_section": return op.section_title && op.content ? addSection(html, op.section_title, op.content, op.after_section) : html;
    case "update_section": return op.section_id && op.content ? updateSection(html, op.section_id, op.content) : html;
    case "append_see_also": return op.link ? appendSeeAlso(html, op.link) : html;
    case "update_infobox": return op.infobox_field && op.infobox_value ? updateInfobox(html, op.infobox_field, op.infobox_value) : html;
    case "add_category": return op.category ? addCategory(html, op.category) : html;
    case "set_warning": return op.warning ? setWarning(html, op.warning) : html;
    case "append_content": return op.content ? appendContent(html, op.content) : html;
    default: return html;
  }
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_edit_article",
    description: "Edit an existing Not-Wikipedia article. Operations: add_section, update_section, append_see_also, update_infobox, add_category, set_warning, append_content.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Article filename" },
        operations: {
          type: "array", description: "Edit operations to apply",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["add_section", "update_section", "append_see_also", "update_infobox", "add_category", "set_warning", "append_content"] },
              section_id: { type: "string" }, section_title: { type: "string" }, content: { type: "string" },
              after_section: { type: "string" }, infobox_field: { type: "string" }, infobox_value: { type: "string" },
              category: { type: "string" }, link: { type: "string" }, warning: { type: "string" }
            },
            required: ["type"]
          }
        }
      },
      required: ["filename", "operations"]
    }
  },

  handler: async (args) => {
    try {
      let filename = args.filename as string;
      const ops = args.operations as EditOperation[];
      if (!filename || !ops?.length) return { content: [{ type: "text", text: "Error: filename and operations required" }], isError: true };

      if (!filename.endsWith(".html")) filename += ".html";
      const filepath = path.join(WIKI_DIR, filename);

      let html: string;
      try { html = await fs.readFile(filepath, "utf-8"); } catch { return { content: [{ type: "text", text: `Error: '${filename}' not found` }], isError: true }; }

      const applied: string[] = [];
      for (const op of ops) { const before = html; html = applyEdit(html, op); if (html !== before) applied.push(op.type); }

      await fs.writeFile(filepath, html, "utf-8");
      return { content: [{ type: "text", text: JSON.stringify({ success: true, filename, operations_applied: applied }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : e}` }], isError: true };
    }
  }
};
