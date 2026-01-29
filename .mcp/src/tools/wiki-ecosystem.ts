/**
 * Wiki Ecosystem Status Tool
 *
 * Returns current health status of the Not-Wikipedia ecosystem:
 * - Article count
 * - Broken links
 * - Orphan articles
 * - Category balance
 *
 * Now powered by SQLite database for faster queries.
 */

import { ToolModule } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import {
  getArticleCount,
  getBrokenLinks,
  getOrphanArticles,
  getCategoryDistribution,
} from "../db/database.js";

const WIKI_DIR = path.join(process.cwd(), "not-wikipedia");

interface EcosystemStatus {
  healthy: boolean;
  articles: number;
  brokenLinks: string[];
  orphanArticles: string[];
  placeholders: string[];
  categoryBalance: Record<string, number>;
  issues: string[];
}

/**
 * Scan HTML files for placeholders (not stored in DB).
 */
async function getPlaceholders(): Promise<string[]> {
  const placeholders: string[] = [];
  try {
    const files = await fs.readdir(WIKI_DIR);
    const htmlFiles = files.filter(f => f.endsWith(".html"));

    for (const file of htmlFiles) {
      const content = await fs.readFile(path.join(WIKI_DIR, file), "utf-8");
      if (content.includes("NEXT_PAGE_PLACEHOLDER")) {
        placeholders.push(file);
      }
    }
  } catch {
    // Return empty on error
  }
  return placeholders;
}

async function getEcosystemStatus(): Promise<EcosystemStatus> {
  const status: EcosystemStatus = {
    healthy: true,
    articles: 0,
    brokenLinks: [],
    orphanArticles: [],
    placeholders: [],
    categoryBalance: {},
    issues: [],
  };

  try {
    // Get counts from database
    status.articles = getArticleCount();

    // Get broken links from database
    const brokenLinksData = getBrokenLinks();
    status.brokenLinks = brokenLinksData.map(bl =>
      `${bl.sources.join(", ")} -> ${bl.target}`
    );

    // Get orphan articles from database
    status.orphanArticles = getOrphanArticles();

    // Scan for placeholders (still file-based)
    status.placeholders = await getPlaceholders();

    // Get category distribution from database
    status.categoryBalance = getCategoryDistribution();

    // Compile issues
    if (status.brokenLinks.length > 0) {
      status.issues.push(`${status.brokenLinks.length} broken links`);
      status.healthy = false;
    }
    if (status.placeholders.length > 0) {
      status.issues.push(`${status.placeholders.length} unresolved placeholders`);
      status.healthy = false;
    }
    if (status.orphanArticles.length > 0) {
      status.issues.push(`${status.orphanArticles.length} orphan articles`);
    }

  } catch (error) {
    status.issues.push(`Error: ${error}`);
    status.healthy = false;
  }

  return status;
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_ecosystem_status",
    description: "Get the current health status of the Not-Wikipedia ecosystem. Returns article count, broken links, orphan articles, placeholders, and category balance.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  handler: async () => {
    const status = await getEcosystemStatus();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(status, null, 2),
      }],
    };
  },
};
