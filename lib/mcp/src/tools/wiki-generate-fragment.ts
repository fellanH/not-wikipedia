/**
 * Wiki Generate Fragment Tool
 *
 * Generates a single preview fragment for an article.
 * Called after article creation for incremental updates.
 */

import { ToolModule } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { WIKI_DIR } from "../config.js";
import { getArticleByFilename } from "../db/database.js";

// Output directories (relative to dist/)
const DIST_DIR = path.resolve(WIKI_DIR, "..");
const FRAGMENTS_DIR = path.join(DIST_DIR, "fragments");
const API_DIR = path.join(DIST_DIR, "api");

/**
 * Extract first paragraph from HTML as summary (truncated to ~200 chars)
 */
function extractSummary(html: string): string {
  // Find first <p> with actual content (skip warning boxes)
  const match = html.match(/<p>(?!<b>This article)<b>([^<]+)<\/b>([^<]*(?:<[^>]+>[^<]*)*?)<\/p>/);
  if (match) {
    const text = (match[1] + match[2])
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 200 ? text.slice(0, 197) + "..." : text;
  }

  // Fallback: any paragraph
  const fallback = html.match(/<p>([^<]+(?:<[^>]+>[^<]*)*?)<\/p>/);
  if (fallback) {
    const text = fallback[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return text.length > 200 ? text.slice(0, 197) + "..." : text;
  }

  return "";
}

/**
 * Extract keywords from article HTML
 */
function extractKeywords(html: string, title: string): string[] {
  const keywords = new Set<string>();

  title.toLowerCase().split(/\s+/).forEach(w => {
    if (w.length > 3) keywords.add(w);
  });

  const boldMatches = html.matchAll(/<b>([^<]+)<\/b>/g);
  for (const match of boldMatches) {
    const term = match[1].toLowerCase().trim();
    if (term.length > 3 && term.length < 30) keywords.add(term);
  }

  const linkMatches = html.matchAll(/<a href="[^"]*\.html">([^<]+)<\/a>/g);
  for (const match of linkMatches) {
    const term = match[1].toLowerCase().trim();
    if (term.length > 3 && term.length < 30) keywords.add(term);
  }

  return Array.from(keywords).slice(0, 15);
}

/**
 * Extract infobox fields from HTML
 */
function extractInfoboxFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const rows = html.matchAll(/<tr>\s*<th[^>]*>([^<]+)<\/th>\s*<td>([^<]*(?:<[^>]+>[^<]*)*?)<\/td>\s*<\/tr>/g);

  let count = 0;
  for (const match of rows) {
    if (count >= 4) break;
    const key = match[1].trim();
    const value = match[2].replace(/<[^>]+>/g, "").trim();
    if (key && value) {
      fields[key] = value;
      count++;
    }
  }

  return fields;
}

/**
 * Generate preview fragment HTML
 */
function generateFragment(
  filename: string,
  title: string,
  type: string,
  summary: string,
  infoboxFields: Record<string, string>
): string {
  const fieldsHtml = Object.entries(infoboxFields)
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join("\n        ");

  return `<article class="preview-card" data-type="${type}">
  <h4><a href="pages/${filename}">${title}</a></h4>
  <span class="type-badge type-${type}">${type}</span>
  <p>${summary}</p>
  ${fieldsHtml ? `<dl class="preview-meta">\n        ${fieldsHtml}\n      </dl>` : ""}
</article>`;
}

/**
 * Append entry to search index (incremental update)
 */
async function appendToSearchIndex(entry: {
  filename: string;
  title: string;
  summary: string;
  type: string;
  category: string;
  keywords: string[];
  inlinks: number;
  outlinks: number;
}): Promise<void> {
  const indexPath = path.join(API_DIR, "search-index.json");

  let index: typeof entry[] = [];
  try {
    const existing = await fs.readFile(indexPath, "utf-8");
    index = JSON.parse(existing);
  } catch {
    // File doesn't exist, start fresh
  }

  // Remove existing entry if present (update case)
  index = index.filter(e => e.filename !== entry.filename);
  index.push(entry);

  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_generate_fragment",
    description: "Generate a preview fragment for a single article. Use after creating/editing an article for incremental index updates.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Article filename (e.g., 'semantic-drift.html')"
        },
        update_index: {
          type: "boolean",
          description: "Also update search-index.json with this article (default: true)"
        }
      },
      required: ["filename"]
    }
  },

  handler: async (args) => {
    try {
      const filename = args.filename as string;
      const updateIndex = args.update_index !== false;

      if (!filename.endsWith(".html")) {
        return {
          content: [{ type: "text", text: "Error: filename must end with .html" }],
          isError: true
        };
      }

      // Get article from database
      const dbArticle = getArticleByFilename(filename);
      if (!dbArticle) {
        return {
          content: [{ type: "text", text: `Error: Article '${filename}' not found in database` }],
          isError: true
        };
      }

      // Read article HTML
      const htmlPath = path.join(WIKI_DIR, filename);
      let html: string;
      try {
        html = await fs.readFile(htmlPath, "utf-8");
      } catch {
        return {
          content: [{ type: "text", text: `Error: Article file '${filename}' not found` }],
          isError: true
        };
      }

      // Extract metadata
      const summary = extractSummary(html);
      const keywords = extractKeywords(html, dbArticle.title);
      const infoboxFields = extractInfoboxFields(html);
      const type = dbArticle.type || "article";

      // Ensure fragments directory exists
      await fs.mkdir(FRAGMENTS_DIR, { recursive: true });

      // Generate and write fragment
      const fragment = generateFragment(
        filename,
        dbArticle.title,
        type,
        summary,
        infoboxFields
      );
      const fragmentPath = path.join(FRAGMENTS_DIR, filename);
      await fs.writeFile(fragmentPath, fragment, "utf-8");

      // Update search index if requested
      if (updateIndex) {
        await fs.mkdir(API_DIR, { recursive: true });
        await appendToSearchIndex({
          filename,
          title: dbArticle.title,
          summary,
          type,
          category: dbArticle.category || "uncategorized",
          keywords,
          inlinks: dbArticle.inlinks,
          outlinks: dbArticle.outlinks
        });
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            filename,
            fragment: `fragments/${filename}`,
            indexUpdated: updateIndex,
            summary: summary.slice(0, 50) + "...",
            keywords: keywords.slice(0, 5)
          }, null, 2)
        }]
      };
    } catch (e) {
      return {
        content: [{
          type: "text",
          text: `Error generating fragment: ${e instanceof Error ? e.message : e}`
        }],
        isError: true
      };
    }
  }
};
