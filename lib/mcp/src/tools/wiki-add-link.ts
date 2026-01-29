/**
 * Wiki Add Link Tool
 *
 * Creates cross-references between Not-Wikipedia articles.
 */

import { ToolModule } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { WIKI_DIR } from "../config.js";

function norm(name: string): string { return name.endsWith(".html") ? name : name + ".html"; }
function display(fn: string): string {
  return fn.replace(".html", "").replace(/-/g, " ").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function addToSeeAlso(html: string, target: string): { html: string; added: boolean } {
  if (html.includes(`href="${target}"`)) return { html, added: false };
  const m = html.match(/<h2 id="See_also"[^>]*>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
  if (!m?.index) return { html, added: false };
  let h = html.replace(/<li><i>No related articles yet<\/i><\/li>/i, "");
  const ulEnd = h.indexOf("</ul>", m.index);
  if (ulEnd === -1) return { html, added: false };
  return { html: h.slice(0, ulEnd) + `\n            <li><a href="${target}">${display(target)}</a></li>` + h.slice(ulEnd), added: true };
}

function addInlineLink(html: string, target: string, anchor: string, section?: string): { html: string; added: boolean } {
  const link = `<a href="${target}">${anchor}</a>`;
  const regex = new RegExp(`(?<!<a[^>]*>)\\b(${anchor})\\b(?![^<]*<\\/a>)`, "i");
  if (section) {
    const secRegex = new RegExp(`(<h2 id="${section}"[^>]*>[\\s\\S]*?)(<h2 |<\\/div>\\s*<\\/body>)`, "i");
    const m = html.match(secRegex);
    if (m && regex.test(m[1])) return { html: html.replace(m[1], m[1].replace(regex, link)), added: true };
    return { html, added: false };
  }
  if (regex.test(html)) return { html: html.replace(regex, link), added: true };
  return { html, added: false };
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_add_link",
    description: "Add cross-reference links between Not-Wikipedia articles. Supports see_also, inline, or both link types, with optional bidirectional linking.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Source article filename" },
        target: { type: "string", description: "Target article to link to" },
        link_type: { type: "string", enum: ["see_also", "inline", "both"], description: "Link type (default: see_also)" },
        bidirectional: { type: "boolean", description: "Also add reverse link" },
        anchor_text: { type: "string", description: "Text to convert to inline link" },
        in_section: { type: "string", description: "Limit inline search to section" }
      },
      required: ["source", "target"]
    }
  },

  handler: async (args) => {
    try {
      const srcFile = norm(args.source as string);
      const tgtFile = norm(args.target as string);
      const linkType = (args.link_type as string) || "see_also";
      const bidir = args.bidirectional as boolean || false;
      const anchor = args.anchor_text as string;
      const section = args.in_section as string;

      const srcPath = path.join(WIKI_DIR, srcFile);
      const tgtPath = path.join(WIKI_DIR, tgtFile);

      let srcHtml: string;
      try { srcHtml = await fs.readFile(srcPath, "utf-8"); } catch { return { content: [{ type: "text", text: `Error: '${srcFile}' not found` }], isError: true }; }

      let tgtHtml: string | null = null;
      try { tgtHtml = await fs.readFile(tgtPath, "utf-8"); } catch { /* target may not exist */ }

      const results: string[] = [];

      if (linkType === "see_also" || linkType === "both") {
        const r = addToSeeAlso(srcHtml, tgtFile);
        srcHtml = r.html;
        results.push(r.added ? `Added '${tgtFile}' to See Also in '${srcFile}'` : `Link already exists in See Also`);
      }

      if ((linkType === "inline" || linkType === "both") && anchor) {
        const r = addInlineLink(srcHtml, tgtFile, anchor, section);
        srcHtml = r.html;
        results.push(r.added ? `Added inline link for '${anchor}'` : `Could not find '${anchor}' to link`);
      }

      await fs.writeFile(srcPath, srcHtml, "utf-8");

      if (bidir && tgtHtml) {
        if (linkType === "see_also" || linkType === "both") {
          const r = addToSeeAlso(tgtHtml, srcFile);
          if (r.added) { tgtHtml = r.html; results.push(`Added bidirectional link to '${srcFile}'`); }
        }
        await fs.writeFile(tgtPath, tgtHtml, "utf-8");
      } else if (bidir && !tgtHtml) {
        results.push(`Cannot add bidirectional: '${tgtFile}' doesn't exist`);
      }

      return { content: [{ type: "text", text: JSON.stringify({ success: true, source: srcFile, target: tgtFile, actions: results }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : e}` }], isError: true };
    }
  }
};
