/**
 * Wiki Build Index Tool
 *
 * Generates static index files for HTMX-powered search and navigation.
 * Creates:
 * - api/search-index.json: Searchable article metadata
 * - api/articles.json: Full article list with summaries
 * - categories/*.html: Pre-rendered category pages
 * - fragments/*.html: Article preview fragments
 */

import { ToolModule } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { WIKI_DIR } from "../config.js";
import {
  getAllArticles,
  getCategoryDistribution,
} from "../db/database.js";

// Output directories (relative to dist/)
const DIST_DIR = path.resolve(WIKI_DIR, "..");
const API_DIR = path.join(DIST_DIR, "api");
const CATEGORIES_DIR = path.join(DIST_DIR, "categories");
const FRAGMENTS_DIR = path.join(DIST_DIR, "fragments");

interface SearchIndexEntry {
  filename: string;
  title: string;
  summary: string;
  type: string;
  category: string;
  keywords: string[];
  inlinks: number;
  outlinks: number;
}

interface ArticleEntry extends SearchIndexEntry {
  created: string;
}

/**
 * Extract first paragraph from HTML as summary (truncated to ~200 chars)
 */
function extractSummary(html: string): string {
  // Find first <p> with actual content
  const match = html.match(/<p>(?!<b>This article)<b>([^<]+)<\/b>([^<]*(?:<[^>]+>[^<]*)*?)<\/p>/);
  if (match) {
    // Get the bold term and following text
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
 * Extract keywords from article HTML (bold terms, links, title words)
 */
function extractKeywords(html: string, title: string): string[] {
  const keywords = new Set<string>();

  // Add title words
  title.toLowerCase().split(/\s+/).forEach(w => {
    if (w.length > 3) keywords.add(w);
  });

  // Extract bold terms
  const boldMatches = html.matchAll(/<b>([^<]+)<\/b>/g);
  for (const match of boldMatches) {
    const term = match[1].toLowerCase().trim();
    if (term.length > 3 && term.length < 30) keywords.add(term);
  }

  // Extract internal link text
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
 * Generate preview fragment HTML for an article
 */
function generateFragment(filename: string, title: string, type: string, summary: string, infoboxFields: Record<string, string>): string {
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
 * Generate category page HTML
 */
function generateCategoryPage(category: string, articles: ArticleEntry[]): string {
  const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1);
  const articleList = articles
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(a => `<li><a href="../pages/${a.filename}" class="article-link" data-type="${a.type}">${a.title}</a> <span class="type-badge type-${a.type}">${a.type}</span></li>`)
    .join("\n          ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${categoryTitle} - Not-Wikipedia</title>
    <link rel="stylesheet" href="../styles.css">
</head>
<body>
    <div id="content">
        <h1 id="firstHeading">${categoryTitle}</h1>
        <div id="siteSub">Category page</div>

        <p>Articles in the <b>${category}</b> category (${articles.length} total):</p>

        <ul class="article-list">
          ${articleList}
        </ul>

        <p><a href="../index.html">&larr; Back to main page</a></p>
    </div>
    <script src="../htmx.min.js"></script>
    <script src="../wiki.js"></script>
</body>
</html>`;
}

/**
 * Generate "all articles" page HTML
 */
function generateAllArticlesPage(articles: ArticleEntry[]): string {
  const articleList = articles
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(a => `<li><a href="../pages/${a.filename}" class="article-link" data-type="${a.type}">${a.title}</a> <span class="type-badge type-${a.type}">${a.type}</span> <span class="category-tag">${a.category}</span></li>`)
    .join("\n          ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>All Articles - Not-Wikipedia</title>
    <link rel="stylesheet" href="../styles.css">
</head>
<body>
    <div id="content">
        <h1 id="firstHeading">All Articles</h1>
        <div id="siteSub">Complete article index</div>

        <p>All ${articles.length} articles in Not-Wikipedia:</p>

        <ul class="article-list">
          ${articleList}
        </ul>

        <p><a href="../index.html">&larr; Back to main page</a></p>
    </div>
    <script src="../htmx.min.js"></script>
    <script src="../wiki.js"></script>
</body>
</html>`;
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_build_index",
    description: "Generate static index files for HTMX search and navigation. Creates api/search-index.json, api/articles.json, category pages, and article fragments.",
    inputSchema: {
      type: "object",
      properties: {
        regenerate_fragments: {
          type: "boolean",
          description: "Regenerate all fragments even if they exist (default: false, only new articles)"
        },
        verbose: {
          type: "boolean",
          description: "Include detailed output (default: false)"
        }
      }
    }
  },

  handler: async (args) => {
    try {
      const regenerateFragments = args.regenerate_fragments as boolean || false;
      const verbose = args.verbose as boolean || false;

      // Ensure output directories exist
      await fs.mkdir(API_DIR, { recursive: true });
      await fs.mkdir(CATEGORIES_DIR, { recursive: true });
      await fs.mkdir(FRAGMENTS_DIR, { recursive: true });

      // Get all articles from database
      const dbArticles = getAllArticles();
      const categoryDist = getCategoryDistribution();

      const searchIndex: SearchIndexEntry[] = [];
      const articlesIndex: ArticleEntry[] = [];
      const categorizedArticles: Record<string, ArticleEntry[]> = {};

      let fragmentsCreated = 0;
      let fragmentsSkipped = 0;

      // Process each article
      for (const dbArticle of dbArticles) {
        const htmlPath = path.join(WIKI_DIR, dbArticle.filename);

        let html: string;
        try {
          html = await fs.readFile(htmlPath, "utf-8");
        } catch {
          // File doesn't exist, skip
          continue;
        }

        const summary = extractSummary(html);
        const keywords = extractKeywords(html, dbArticle.title);
        const infoboxFields = extractInfoboxFields(html);

        const entry: ArticleEntry = {
          filename: dbArticle.filename,
          title: dbArticle.title,
          summary,
          type: dbArticle.type || "article",
          category: dbArticle.category || "uncategorized",
          keywords,
          inlinks: dbArticle.inlinks,
          outlinks: dbArticle.outlinks,
          created: dbArticle.created
        };

        searchIndex.push({
          filename: entry.filename,
          title: entry.title,
          summary: entry.summary,
          type: entry.type,
          category: entry.category,
          keywords: entry.keywords,
          inlinks: entry.inlinks,
          outlinks: entry.outlinks
        });

        articlesIndex.push(entry);

        // Categorize
        if (!categorizedArticles[entry.category]) {
          categorizedArticles[entry.category] = [];
        }
        categorizedArticles[entry.category].push(entry);

        // Generate fragment
        const fragmentPath = path.join(FRAGMENTS_DIR, dbArticle.filename);
        const fragmentExists = await fs.access(fragmentPath).then(() => true).catch(() => false);

        if (regenerateFragments || !fragmentExists) {
          const fragment = generateFragment(
            dbArticle.filename,
            dbArticle.title,
            entry.type,
            summary,
            infoboxFields
          );
          await fs.writeFile(fragmentPath, fragment, "utf-8");
          fragmentsCreated++;
        } else {
          fragmentsSkipped++;
        }
      }

      // Write search index
      await fs.writeFile(
        path.join(API_DIR, "search-index.json"),
        JSON.stringify(searchIndex, null, 2),
        "utf-8"
      );

      // Write full articles index
      await fs.writeFile(
        path.join(API_DIR, "articles.json"),
        JSON.stringify({
          total: articlesIndex.length,
          generated: new Date().toISOString(),
          articles: articlesIndex
        }, null, 2),
        "utf-8"
      );

      // Write random helper (list of filenames for random selection)
      await fs.writeFile(
        path.join(API_DIR, "random.json"),
        JSON.stringify({
          articles: articlesIndex.map(a => ({ filename: a.filename, title: a.title }))
        }, null, 2),
        "utf-8"
      );

      // Generate category pages
      for (const [category, articles] of Object.entries(categorizedArticles)) {
        const categoryPage = generateCategoryPage(category, articles);
        await fs.writeFile(
          path.join(CATEGORIES_DIR, `${category}.html`),
          categoryPage,
          "utf-8"
        );
      }

      // Generate "all articles" page
      const allPage = generateAllArticlesPage(articlesIndex);
      await fs.writeFile(
        path.join(CATEGORIES_DIR, "all.html"),
        allPage,
        "utf-8"
      );

      const result = {
        success: true,
        searchIndex: {
          path: "api/search-index.json",
          entries: searchIndex.length,
          sizeBytes: JSON.stringify(searchIndex).length
        },
        articlesIndex: {
          path: "api/articles.json",
          entries: articlesIndex.length
        },
        fragments: {
          path: "fragments/",
          created: fragmentsCreated,
          skipped: fragmentsSkipped
        },
        categories: {
          path: "categories/",
          pages: Object.keys(categorizedArticles).length + 1 // +1 for all.html
        }
      };

      if (verbose) {
        (result as Record<string, unknown>).categoryBreakdown = categoryDist;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (e) {
      return {
        content: [{
          type: "text",
          text: `Error building index: ${e instanceof Error ? e.message : e}`
        }],
        isError: true
      };
    }
  }
};
