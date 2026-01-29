/**
 * Wiki Get Article Tool
 *
 * Parses a Not-Wikipedia article and returns structured metadata.
 */

import { ToolModule } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { WIKI_DIR } from "../config.js";

interface ArticleMetadata {
  filename: string;
  title: string;
  warning?: string;
  infobox?: { title: string; fields: Array<{ label: string; value: string }>; color?: string };
  sections: Array<{ id: string; title: string; level: number; content_preview?: string }>;
  see_also: string[];
  categories: string[];
  internal_links: Array<{ href: string; text: string; is_broken?: boolean }>;
  external_links: Array<{ href: string; text: string }>;
  reference_count: number;
  word_count: number;
}

function strip(html: string): string { return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }

async function parseArticle(html: string, filename: string): Promise<ArticleMetadata> {
  const meta: ArticleMetadata = {
    filename, title: "", sections: [], see_also: [], categories: [],
    internal_links: [], external_links: [], reference_count: 0, word_count: 0
  };

  const titleM = html.match(/<h1 id="firstHeading">([^<]+)<\/h1>/i);
  if (titleM) meta.title = titleM[1].trim();

  const warnM = html.match(/<div class="ambox[^"]*">[^<]*(?:<strong>Warning:<\/strong>)?\s*([^<]+)/i);
  if (warnM) meta.warning = warnM[1].trim();

  const infoM = html.match(/<table class="infobox">([\s\S]*?)<\/table>/i);
  if (infoM) {
    const titleM2 = infoM[1].match(/<td[^>]*class="infobox-title"[^>]*>([^<]+)<\/td>/i);
    const colorM = html.match(/\.infobox-title\s*\{\s*background-color:\s*([^;]+)/i);
    const fields: Array<{ label: string; value: string }> = [];
    const fieldRe = /<tr>\s*<th scope="row">([^<]+)<\/th>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;
    let fm;
    while ((fm = fieldRe.exec(infoM[1]))) fields.push({ label: fm[1].trim(), value: strip(fm[2]).trim() });
    meta.infobox = { title: titleM2?.[1]?.trim() || meta.title, fields, color: colorM?.[1]?.trim() };
  }

  const secRe = /<h([23]) id="([^"]+)"[^>]*>([^<]+)/gi;
  let sm;
  while ((sm = secRe.exec(html))) {
    const level = parseInt(sm[1]);
    const id = sm[2];
    const title = sm[3].trim();
    const after = html.slice(sm.index + sm[0].length);
    const nextH = after.search(/<h[23] /i);
    const preview = strip(nextH > 0 ? after.slice(0, nextH) : after.slice(0, 500)).slice(0, 200);
    meta.sections.push({ id, title, level, content_preview: preview || undefined });
  }

  const seeAlsoM = html.match(/<h2 id="See_also"[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
  if (seeAlsoM) {
    const linkRe = /<a href="([^"]+)">([^<]+)<\/a>/gi;
    let lm;
    while ((lm = linkRe.exec(seeAlsoM[1]))) {
      if (!lm[1].startsWith("/wiki/") && !lm[1].startsWith("http")) meta.see_also.push(lm[1].replace(".html", ""));
    }
  }

  const catM = html.match(/<div id="catlinks">([\s\S]*?)<\/div>/i);
  if (catM) {
    const catRe = /<a href="#">([^<]+)<\/a>/gi;
    let cm;
    while ((cm = catRe.exec(catM[1]))) meta.categories.push(cm[1].trim());
  }

  const allLinkRe = /<a href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  const seen = new Set<string>();
  let alm;
  while ((alm = allLinkRe.exec(html))) {
    const href = alm[1];
    const text = alm[2].trim();
    if (href.includes("action=edit") || href === "#" || seen.has(href)) continue;
    seen.add(href);
    const isExt = href.startsWith("http") || href.startsWith("/wiki/");
    const isInt = !isExt && href.endsWith(".html");
    if (isInt) {
      let broken = false;
      try { await fs.access(path.join(WIKI_DIR, href)); } catch { broken = true; }
      meta.internal_links.push({ href, text, is_broken: broken });
    } else if (isExt) {
      meta.external_links.push({ href, text });
    }
  }

  const refs = html.match(/<li id="cite\d+"/gi);
  meta.reference_count = refs?.length || 0;

  const bodyM = html.match(/<div id="content">([\s\S]*)<\/div>\s*<\/body>/i);
  if (bodyM) meta.word_count = strip(bodyM[1]).split(/\s+/).filter(w => w.length > 0).length;

  return meta;
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_get_article",
    description: "Parse a Not-Wikipedia article and return structured metadata: title, sections, links, infobox, categories, word count.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Article filename" },
        include_content_preview: { type: "boolean", description: "Include section content previews (default: true)" },
        include_links: { type: "boolean", description: "Include detailed link analysis (default: true)" }
      },
      required: ["filename"]
    }
  },

  handler: async (args) => {
    try {
      let filename = args.filename as string;
      const incPreview = args.include_content_preview !== false;
      const incLinks = args.include_links !== false;

      if (!filename) return { content: [{ type: "text", text: "Error: filename required" }], isError: true };
      if (!filename.endsWith(".html")) filename += ".html";

      let html: string;
      try { html = await fs.readFile(path.join(WIKI_DIR, filename), "utf-8"); } catch { return { content: [{ type: "text", text: `Error: '${filename}' not found` }], isError: true }; }

      const meta = await parseArticle(html, filename);
      if (!incPreview) meta.sections = meta.sections.map(s => ({ id: s.id, title: s.title, level: s.level }));
      if (!incLinks) { meta.internal_links = []; meta.external_links = []; }

      return { content: [{ type: "text", text: JSON.stringify(meta, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : e}` }], isError: true };
    }
  }
};
