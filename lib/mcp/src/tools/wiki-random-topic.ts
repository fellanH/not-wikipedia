/**
 * Wiki Random Topic Selector (DEPRECATED)
 *
 * NOTE: Use wiki_next_task instead - it provides human seed inspiration
 * for new content rather than pre-defined topic suggestions.
 *
 * This tool is kept for backwards compatibility but the agent should
 * derive topics from context (broken links, human seed) rather than
 * hard-coded suggestions.
 */

import { ToolModule } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { WIKI_DIR, META_DIR } from "../config.js";

const ECOSYSTEM_FILE = path.join(META_DIR, "ecosystem.json");

interface TopicSelection {
  source: "broken_link" | "expansion_priority" | "random_suggestion";
  topic: string;
  context: string;
  randomSeed: string;
  brokenLinksIndex: number | null;
  totalBrokenLinks: number;
}

// Cryptographically secure random number between 0 and max-1
function secureRandomInt(max: number): number {
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  return randomValue % max;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Get all broken links
async function getBrokenLinks(): Promise<string[]> {
  const brokenLinks: string[] = [];

  try {
    const allFiles = await fs.readdir(WIKI_DIR);
    const files = allFiles.filter(f => f.endsWith(".html"));

    // Read all files in parallel
    const fileContents = await Promise.all(
      files.map(async file => ({
        file,
        content: await fs.readFile(path.join(WIKI_DIR, file), "utf-8"),
      }))
    );

    for (const { file, content } of fileContents) {
      const linkMatches = content.matchAll(/href="([^"]*\.html)"/g);

      for (const match of linkMatches) {
        const link = match[1];
        if (!(await fileExists(path.join(WIKI_DIR, link)))) {
          // Store as "target-article.html" (the missing page)
          if (!brokenLinks.includes(link)) {
            brokenLinks.push(link);
          }
        }
      }
    }
  } catch (error) {
    // Return empty array on error
  }

  return brokenLinks;
}

// Get expansion priorities from ecosystem.json
async function getExpansionPriorities(): Promise<string[]> {
  try {
    if (await fileExists(ECOSYSTEM_FILE)) {
      const ecosystem = JSON.parse(await fs.readFile(ECOSYSTEM_FILE, "utf-8"));
      return ecosystem.expansion_priorities?.suggested_topics || [];
    }
  } catch (error) {
    // Return empty array on error
  }
  return [];
}

// Generate random topic suggestions
function getRandomSuggestions(): string[] {
  return [
    "The Great Semantic Collapse of 2019",
    "Meaning Erosion Prevention Protocols",
    "Collective Amnesia Events",
    "Semantic Quarantine Zones",
    "Language Extinction Patterns",
    "Memory Palace Architecture",
    "Chronological Distortion Syndrome",
    "Definitional Archaeology",
    "Concept Migration Patterns",
    "Linguistic Fossil Records",
    "Semantic Immune Deficiency",
    "Meaning Bankruptcy Proceedings",
    "Vocabulary Inheritance Laws",
    "Conceptual Plate Tectonics",
    "Etymology Decay Curves",
  ];
}

async function selectTopic(): Promise<TopicSelection> {
  // Generate random seed for transparency
  const randomSeed = crypto.randomBytes(8).toString("hex");

  // Priority 1: Broken links
  const brokenLinks = await getBrokenLinks();
  if (brokenLinks.length > 0) {
    const index = secureRandomInt(brokenLinks.length);
    const topic = brokenLinks[index].replace(".html", "").replace(/-/g, " ");
    return {
      source: "broken_link",
      topic: topic,
      context: `Fixing broken link: ${brokenLinks[index]}. This page is referenced but doesn't exist.`,
      randomSeed,
      brokenLinksIndex: index,
      totalBrokenLinks: brokenLinks.length,
    };
  }

  // Priority 2: Expansion priorities
  const priorities = await getExpansionPriorities();
  if (priorities.length > 0) {
    const index = secureRandomInt(priorities.length);
    return {
      source: "expansion_priority",
      topic: priorities[index],
      context: `From ecosystem.json expansion_priorities. Addresses underrepresented content.`,
      randomSeed,
      brokenLinksIndex: null,
      totalBrokenLinks: 0,
    };
  }

  // Priority 3: Random suggestion
  const suggestions = getRandomSuggestions();
  const index = secureRandomInt(suggestions.length);
  return {
    source: "random_suggestion",
    topic: suggestions[index],
    context: `Randomly generated topic suggestion. No broken links or expansion priorities found.`,
    randomSeed,
    brokenLinksIndex: null,
    totalBrokenLinks: 0,
  };
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_random_topic",
    description: "DEPRECATED: Use wiki_next_task instead, which provides human seed inspiration. This tool is kept for backwards compatibility only.",
    inputSchema: {
      type: "object",
      properties: {
        force_random: {
          type: "boolean",
          description: "If true, skip broken links and priorities, return pure random suggestion",
        },
      },
      required: [],
    },
  },

  handler: async (args) => {
    const forceRandom = args.force_random as boolean;

    if (forceRandom) {
      const randomSeed = crypto.randomBytes(8).toString("hex");
      const suggestions = getRandomSuggestions();
      const index = secureRandomInt(suggestions.length);
      const brokenLinks = await getBrokenLinks();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            source: "random_suggestion",
            topic: suggestions[index],
            context: "Forced random selection (skipped broken links and priorities)",
            randomSeed,
            brokenLinksIndex: null,
            totalBrokenLinks: brokenLinks.length,
          }, null, 2),
        }],
      };
    }

    const selection = await selectTopic();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(selection, null, 2),
      }],
    };
  },
};
