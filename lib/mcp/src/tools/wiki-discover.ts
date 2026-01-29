/**
 * Wiki Discover Tool - Recursive Discovery Engine
 *
 * Scans a newly created article for concepts (broken links) and auto-queues
 * them for generation, creating a "Content Fractal" that expands the
 * knowledge graph recursively.
 *
 * This transforms the system from "reactive" (fixing broken links one at a time)
 * to "explosive" growth (each article spawns multiple new concepts).
 *
 * Safety mechanisms:
 * - Depth limit prevents infinite recursion (default: 3 layers)
 * - Priority scoring ensures high-value concepts are generated first
 * - Already-existing articles are skipped
 */

import { ToolModule } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { WIKI_DIR } from "../config.js";
import {
  getArticleDepth,
  queueDiscoveredConcept,
  getDiscoveryQueueStats,
  DiscoveryQueueItem,
} from "../db/database.js";

// Default configuration
const DEFAULT_MAX_DEPTH = 3;

interface DiscoverInput {
  source_article: string;
  max_depth?: number;
  // Relevance filtering options
  relevance_filter?: {
    // Keywords that must appear in the link filename (OR logic)
    required_keywords?: string[];
    // Keywords that exclude a link from queuing (OR logic)
    excluded_keywords?: string[];
    // Minimum filename length to queue (filters out very short/generic names)
    min_filename_length?: number;
  };
}

interface DiscoveredConcept {
  filename: string;
  suggestedTitle: string;
  depth: number;
  queued: boolean;
  reason?: string;
}

interface DiscoverResult {
  sourceArticle: string;
  sourceDepth: number;
  conceptsFound: number;
  conceptsQueued: number;
  conceptsSkipped: number;
  concepts: DiscoveredConcept[];
  queueStats: {
    pending: number;
    inProgress: number;
    completed: number;
    byDepth: Record<number, number>;
  };
}

/**
 * Convert filename to suggested title.
 * e.g., "semantic-drift.html" -> "Semantic Drift"
 */
function filenameToTitle(filename: string): string {
  return filename
    .replace(/\.html$/, "")
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Extract all internal links from an HTML article.
 */
async function extractLinks(articlePath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(articlePath, "utf-8");
    const linkMatches = content.match(/href="([^"]*\.html)"/g) || [];
    const links = linkMatches.map(match => {
      const href = match.match(/href="([^"]*)"/)?.[1] || "";
      return href;
    });
    // Remove duplicates
    return [...new Set(links)];
  } catch {
    return [];
  }
}

/**
 * Check if an article exists.
 */
async function articleExists(filename: string): Promise<boolean> {
  try {
    await fs.access(path.join(WIKI_DIR, filename));
    return true;
  } catch {
    return false;
  }
}

/**
 * Calculate priority score for a concept.
 * Higher = more important to generate.
 *
 * Factors:
 * - Lower depth = higher priority (closer to root)
 * - More references = higher priority (more demanded)
 */
function calculatePriority(depth: number, referenceCount: number = 1): number {
  // Base priority decreases with depth (0->100, 1->75, 2->50, 3->25)
  const depthPriority = Math.max(0, 100 - depth * 25);

  // Bonus for multiple references
  const referencePriority = Math.min(50, referenceCount * 10);

  return depthPriority + referencePriority;
}

/**
 * Check if a filename passes the relevance filter.
 */
function passesRelevanceFilter(
  filename: string,
  filter?: DiscoverInput["relevance_filter"]
): { passes: boolean; reason?: string } {
  if (!filter) return { passes: true };

  const baseFilename = filename.replace(/\.html$/, "").toLowerCase();

  // Check minimum length
  if (filter.min_filename_length && baseFilename.length < filter.min_filename_length) {
    return { passes: false, reason: `filename too short (< ${filter.min_filename_length} chars)` };
  }

  // Check excluded keywords
  if (filter.excluded_keywords && filter.excluded_keywords.length > 0) {
    for (const keyword of filter.excluded_keywords) {
      if (baseFilename.includes(keyword.toLowerCase())) {
        return { passes: false, reason: `contains excluded keyword: ${keyword}` };
      }
    }
  }

  // Check required keywords (at least one must match)
  if (filter.required_keywords && filter.required_keywords.length > 0) {
    const hasRequiredKeyword = filter.required_keywords.some(keyword =>
      baseFilename.includes(keyword.toLowerCase())
    );
    if (!hasRequiredKeyword) {
      return { passes: false, reason: `missing required keywords` };
    }
  }

  return { passes: true };
}

/**
 * Main discovery function.
 * Scans an article and queues new concepts for recursive generation.
 */
async function discoverConcepts(input: DiscoverInput): Promise<DiscoverResult> {
  const { source_article, max_depth = DEFAULT_MAX_DEPTH, relevance_filter } = input;

  // Get source article's depth (0 if root/new)
  const sourceDepth = getArticleDepth(source_article);
  const newConceptDepth = sourceDepth + 1;

  // Build the article path
  const articlePath = path.join(WIKI_DIR, source_article);

  // Extract all links from the article
  const links = await extractLinks(articlePath);

  const concepts: DiscoveredConcept[] = [];
  let conceptsQueued = 0;
  let conceptsSkipped = 0;

  for (const link of links) {
    const suggestedTitle = filenameToTitle(link);

    // Skip if article already exists
    if (await articleExists(link)) {
      conceptsSkipped++;
      concepts.push({
        filename: link,
        suggestedTitle,
        depth: newConceptDepth,
        queued: false,
        reason: "already exists",
      });
      continue;
    }

    // Skip if depth exceeds max
    if (newConceptDepth > max_depth) {
      conceptsSkipped++;
      concepts.push({
        filename: link,
        suggestedTitle,
        depth: newConceptDepth,
        queued: false,
        reason: `exceeds max depth (${max_depth})`,
      });
      continue;
    }

    // Check relevance filter
    const filterResult = passesRelevanceFilter(link, relevance_filter);
    if (!filterResult.passes) {
      conceptsSkipped++;
      concepts.push({
        filename: link,
        suggestedTitle,
        depth: newConceptDepth,
        queued: false,
        reason: `filtered: ${filterResult.reason}`,
      });
      continue;
    }

    // Calculate priority and queue
    const priority = calculatePriority(newConceptDepth);
    const queued = queueDiscoveredConcept(
      link,
      suggestedTitle,
      newConceptDepth,
      source_article,
      priority
    );

    if (queued) {
      conceptsQueued++;
      concepts.push({
        filename: link,
        suggestedTitle,
        depth: newConceptDepth,
        queued: true,
      });
    } else {
      conceptsSkipped++;
      concepts.push({
        filename: link,
        suggestedTitle,
        depth: newConceptDepth,
        queued: false,
        reason: "already in queue",
      });
    }
  }

  // Get queue stats
  const queueStats = getDiscoveryQueueStats();

  return {
    sourceArticle: source_article,
    sourceDepth,
    conceptsFound: links.length,
    conceptsQueued,
    conceptsSkipped,
    concepts,
    queueStats,
  };
}

// =============================================================================
// EXPORT
// =============================================================================

export const tool: ToolModule = {
  definition: {
    name: "wiki_discover",
    description: `Scan a newly created article for concepts (broken links) and auto-queue them for recursive generation. Creates a "Content Fractal" where each article spawns new articles up to a configurable depth limit. Returns discovery statistics and queue state.`,
    inputSchema: {
      type: "object",
      properties: {
        source_article: {
          type: "string",
          description: "Filename of the article to scan (e.g., 'semantic-drift.html')",
        },
        max_depth: {
          type: "number",
          description: `Maximum recursion depth (default: ${DEFAULT_MAX_DEPTH}). Articles at depth N will queue concepts at depth N+1.`,
        },
        relevance_filter: {
          type: "object",
          description: "Optional relevance filter to prevent topic drift",
          properties: {
            required_keywords: {
              type: "array",
              items: { type: "string" },
              description: "Keywords that must appear in the link filename (OR logic). Use to stay on topic.",
            },
            excluded_keywords: {
              type: "array",
              items: { type: "string" },
              description: "Keywords that exclude a link from queuing. Use to avoid unwanted topics.",
            },
            min_filename_length: {
              type: "number",
              description: "Minimum filename length to queue. Filters out very short/generic names.",
            },
          },
        },
      },
      required: ["source_article"],
    },
  },

  handler: async (args) => {
    const input = args as unknown as DiscoverInput;

    try {
      const result = await discoverConcepts(input);

      // Format output
      const lines: string[] = [
        `## Recursive Discovery Results`,
        ``,
        `**Source:** ${result.sourceArticle} (depth: ${result.sourceDepth})`,
        `**Concepts Found:** ${result.conceptsFound}`,
        `**Queued for Generation:** ${result.conceptsQueued}`,
        `**Skipped:** ${result.conceptsSkipped}`,
        ``,
      ];

      if (result.concepts.length > 0) {
        lines.push(`### Discovered Concepts`);
        lines.push(``);
        for (const concept of result.concepts) {
          const status = concept.queued
            ? `QUEUED (depth ${concept.depth})`
            : `SKIPPED: ${concept.reason}`;
          lines.push(`- **${concept.suggestedTitle}** (${concept.filename}) - ${status}`);
        }
        lines.push(``);
      }

      lines.push(`### Queue Statistics`);
      lines.push(`- Pending: ${result.queueStats.pending}`);
      lines.push(`- In Progress: ${result.queueStats.inProgress}`);
      lines.push(`- Completed: ${result.queueStats.completed}`);

      if (Object.keys(result.queueStats.byDepth).length > 0) {
        lines.push(`- By Depth:`);
        for (const [depth, count] of Object.entries(result.queueStats.byDepth)) {
          lines.push(`  - Depth ${depth}: ${count} pending`);
        }
      }

      return {
        content: [{
          type: "text",
          text: lines.join("\n"),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error during discovery: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
};
