/**
 * Wiki Researcher Picker (OPTIONAL)
 *
 * This tool is optional - the agent can create researchers organically
 * based on article content. Use this tool only if you want to:
 * - Check existing researchers for consistency
 * - Reference established researchers in the Not-Wikipedia universe
 * - Avoid accidentally duplicating researcher names
 *
 * Now powered by SQLite database for faster queries.
 */

import { ToolModule } from "../types.js";
import * as crypto from "crypto";
import {
  getResearchersByStatus,
  getResearcherContributions,
  getResearcherArticles,
  Researcher as DbResearcher,
} from "../db/database.js";

interface Researcher {
  name: string;
  field: string;
  institution: string;
  nationality: string;
  active_years: string;
  key_contributions: string[];
  articles_mentioned: string[];
  usage_count: number;
  status: string;
}

interface ResearcherSelection {
  researcher: Researcher | null;
  source: "existing_available" | "existing_moderate" | "suggested_new" | "none";
  suggestion: string;
  randomSeed: string;
}

function secureRandomInt(max: number): number {
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  return randomValue % max;
}

/**
 * Convert database researcher to API format.
 */
function toApiResearcher(dbResearcher: DbResearcher): Researcher {
  const contributions = getResearcherContributions(dbResearcher.id);
  const articles = getResearcherArticles(dbResearcher.id);

  return {
    name: dbResearcher.name,
    field: dbResearcher.field || "",
    institution: dbResearcher.institution || "",
    nationality: dbResearcher.nationality || "",
    active_years: dbResearcher.active_years || "",
    key_contributions: contributions,
    articles_mentioned: articles.map(f => f.replace(".html", "")),
    usage_count: dbResearcher.usage_count,
    status: dbResearcher.status,
  };
}

function selectResearcher(preferNew: boolean = false): ResearcherSelection {
  const randomSeed = crypto.randomBytes(8).toString("hex");

  // Get researchers by status from database
  const availableDb = getResearchersByStatus("AVAILABLE");
  const moderateDb = getResearchersByStatus("MODERATE");

  // If preferNew or random chance (20%), suggest creating a new researcher
  if (preferNew || secureRandomInt(5) === 0) {
    return {
      researcher: null,
      source: "suggested_new",
      suggestion: "Consider creating a new researcher for diversity. Look at existing researchers to avoid duplication.",
      randomSeed,
    };
  }

  // Prefer available researchers
  if (availableDb.length > 0) {
    const index = secureRandomInt(availableDb.length);
    const researcher = toApiResearcher(availableDb[index]);
    return {
      researcher,
      source: "existing_available",
      suggestion: `Selected from ${availableDb.length} available researchers`,
      randomSeed,
    };
  }

  // Fall back to moderate (with warning)
  if (moderateDb.length > 0) {
    const index = secureRandomInt(moderateDb.length);
    const researcher = toApiResearcher(moderateDb[index]);
    return {
      researcher,
      source: "existing_moderate",
      suggestion: `Warning: No available researchers. Selected from ${moderateDb.length} moderate-use researchers. Consider creating new researchers.`,
      randomSeed,
    };
  }

  // No researchers available
  return {
    researcher: null,
    source: "none",
    suggestion: "All researchers overused! Please create new researchers.",
    randomSeed,
  };
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_researcher_pick",
    description: "OPTIONAL: Browse existing researchers for reference or consistency checking. The agent can create new researchers organically - use this only to avoid duplicating names or to reference established Not-Wikipedia researchers.",
    inputSchema: {
      type: "object",
      properties: {
        prefer_new: {
          type: "boolean",
          description: "If true, prefer suggesting a new researcher over existing ones",
        },
        field: {
          type: "string",
          description: "Optional: filter by field (e.g., 'linguistics', 'consciousness')",
        },
      },
      required: [],
    },
  },

  handler: async (args) => {
    const preferNew = args.prefer_new as boolean || false;
    const selection = selectResearcher(preferNew);

    return {
      content: [{
        type: "text",
        text: JSON.stringify(selection, null, 2),
      }],
    };
  },
};
