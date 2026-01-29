/**
 * Wiki Broken Links Index
 *
 * Returns an indexed list of all broken links in the ecosystem.
 * Each broken link includes:
 * - Index number (for selection)
 * - Target page (the missing article)
 * - Source pages (where the link appears)
 * - Suggested title (cleaned up from filename)
 *
 * Now powered by SQLite database for faster queries.
 */

import { ToolModule } from "../types.js";
import * as crypto from "crypto";
import { getBrokenLinks } from "../db/database.js";

interface BrokenLink {
  index: number;
  target: string;
  suggestedTitle: string;
  sources: string[];
  priority: "high" | "medium" | "low";
}

interface BrokenLinksResult {
  count: number;
  links: BrokenLink[];
  randomSelection: number | null;
  randomSeed: string;
}

function secureRandomInt(max: number): number {
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  return randomValue % max;
}

function getBrokenLinksIndex(): BrokenLinksResult {
  const randomSeed = crypto.randomBytes(8).toString("hex");

  // Get broken links from database
  const brokenLinksData = getBrokenLinks();

  // Convert to indexed array
  const links: BrokenLink[] = brokenLinksData.map((bl, index) => {
    // Clean up filename to suggested title
    const suggestedTitle = bl.target
      .replace(".html", "")
      .split("-")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

    // Priority based on number of sources
    let priority: "high" | "medium" | "low" = "low";
    if (bl.sources.length >= 3) priority = "high";
    else if (bl.sources.length >= 2) priority = "medium";

    return {
      index,
      target: bl.target,
      suggestedTitle,
      sources: bl.sources,
      priority,
    };
  });

  // Sort by priority (high first) then by number of sources
  links.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.sources.length - a.sources.length;
  });

  // Re-index after sorting
  links.forEach((link, i) => link.index = i);

  return {
    count: links.length,
    links,
    randomSelection: links.length > 0 ? secureRandomInt(links.length) : null,
    randomSeed,
  };
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_broken_links",
    description: "Get an indexed list of all broken links in the Not-Wikipedia ecosystem. Each link includes index, target page, source pages, and priority. Also provides a random selection index.",
    inputSchema: {
      type: "object",
      properties: {
        select_index: {
          type: "number",
          description: "If provided, return only the broken link at this index",
        },
        select_random: {
          type: "boolean",
          description: "If true, return only the randomly selected broken link",
        },
      },
      required: [],
    },
  },

  handler: async (args) => {
    const result = getBrokenLinksIndex();
    const selectIndex = args.select_index as number | undefined;
    const selectRandom = args.select_random as boolean;

    if (selectIndex !== undefined && selectIndex >= 0 && selectIndex < result.links.length) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            selected: result.links[selectIndex],
            totalBrokenLinks: result.count,
            randomSeed: result.randomSeed,
          }, null, 2),
        }],
      };
    }

    if (selectRandom && result.randomSelection !== null) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            selected: result.links[result.randomSelection],
            selectedIndex: result.randomSelection,
            totalBrokenLinks: result.count,
            randomSeed: result.randomSeed,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  },
};
