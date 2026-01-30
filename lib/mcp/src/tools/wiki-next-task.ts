/**
 * Wiki Next Task Selector
 *
 * The main entry point for autonomous agent operation.
 * Provides minimal deterministic structure - the agent should infer
 * article content, type, category, and researchers from context:
 * - For broken links: infer from referencing articles
 * - For new content: derive entirely from human seed inspiration
 *
 * Returns a lightweight task specification allowing agent interpretation.
 *
 * Now powered by SQLite database for faster queries.
 */

import { ToolModule } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { WIKI_DIR, META_DIR, INFOBOX_COLORS } from "../config.js";
import {
  getArticleCount,
  getBrokenLinks,
  getOrphanArticles,
  getAvailableBrokenLinks,
  getAvailableOrphanArticles,
  claimTask,
  cleanupStaleTasks,
  getClaimedTaskFilenames,
} from "../db/database.js";

interface HumanSeed {
  text: string;
  source: string;
  type: "quote" | "fallback";
}

interface TaskSpec {
  taskType: "repair_broken_link" | "create_from_live_404" | "resolve_placeholder" | "fix_orphan" | "create_new" | "ecosystem_healthy";
  priority: "critical" | "high" | "medium" | "low";
  topic: {
    name: string;
    filename: string;
    context: string;
  };
  humanSeed?: HumanSeed;
  infoboxColor: string;
  randomSeed: string;
  ecosystemStats: {
    totalArticles: number;
    brokenLinks: number;
    orphans: number;
    placeholders: number;
    live404s?: number;
  };
}

function secureRandomInt(max: number): number {
  if (max <= 0) return 0;
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  return randomValue % max;
}

function secureRandomElement<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  return arr[secureRandomInt(arr.length)];
}

// INFOBOX_COLORS imported from config.js

const BASE_URL = "https://not-wikipedia.org";

interface Live404Result {
  target: string;
  filename: string;
  suggestedTitle: string;
  sources: string[];
}

/**
 * Crawl the live site and find 404 pages (lightweight version for task selection)
 */
async function findLive404s(maxPages: number = 20): Promise<Live404Result[]> {
  const visited = new Set<string>();
  const toVisit = [`${BASE_URL}/`];
  const broken: Map<string, Live404Result> = new Map();

  while (toVisit.length > 0 && visited.size < maxPages) {
    const url = toVisit.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const response = await fetch(url, { headers: { "User-Agent": "Not-Wikipedia-TaskSelector/1.0" } });

      if (response.ok) {
        const html = await response.text();
        const hrefRegex = /href=["']([^"']+\.html)["']/gi;
        let match;

        while ((match = hrefRegex.exec(html)) !== null) {
          let href = match[1];
          if (href.startsWith("/wiki/")) continue;

          let fullUrl: string;
          if (href.startsWith("pages/")) {
            fullUrl = `${BASE_URL}/${href}`;
          } else if (href.startsWith("./wiki/")) {
            fullUrl = `${BASE_URL}/${href.slice(2)}`;
          } else if (!href.includes("/") && href.endsWith(".html")) {
            fullUrl = url.includes("/wiki/") ? `${BASE_URL}/wiki/${href}` : `${BASE_URL}/wiki/${href}`;
          } else {
            continue;
          }

          if (!visited.has(fullUrl) && !toVisit.includes(fullUrl)) {
            try {
              const headResp = await fetch(fullUrl, { method: "HEAD" });
              if (headResp.status === 404) {
                const filename = fullUrl.split("/").pop() || "";
                const suggestedTitle = filename.replace(".html", "").split("-")
                  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

                if (!broken.has(fullUrl)) {
                  broken.set(fullUrl, { target: fullUrl, filename, suggestedTitle, sources: [url] });
                } else {
                  broken.get(fullUrl)!.sources.push(url);
                }
              } else if (headResp.ok) {
                toVisit.push(fullUrl);
              }
            } catch { /* skip */ }
          }
        }
      }
      await new Promise(r => setTimeout(r, 50)); // Small delay
    } catch { /* skip */ }
  }

  const results = Array.from(broken.values());
  results.sort((a, b) => b.sources.length - a.sources.length);
  return results;
}

// Embedded fallback corpus for human seed inspiration
const FALLBACK_CORPUS: Array<{ text: string; source: string }> = [
  { text: "Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.", source: "Herman Melville, Moby-Dick" },
  { text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.", source: "Jane Austen, Pride and Prejudice" },
  { text: "The fog comes on little cat feet. It sits looking over harbor and city on silent haunches and then moves on.", source: "Carl Sandburg, Fog" },
  { text: "I have measured out my life with coffee spoons.", source: "T.S. Eliot, The Love Song of J. Alfred Prufrock" },
  { text: "Whereof one cannot speak, thereof one must be silent.", source: "Ludwig Wittgenstein, Tractatus Logico-Philosophicus" },
  { text: "He who has a why to live can bear almost any how.", source: "Friedrich Nietzsche, Twilight of the Idols" },
  { text: "There is grandeur in this view of life, with its several powers, having been originally breathed into a few forms or into one.", source: "Charles Darwin, On the Origin of Species" },
  { text: "The cosmos is within us. We are made of star-stuff. We are a way for the universe to know itself.", source: "Carl Sagan, Cosmos" },
  { text: "I write entirely to find out what I'm thinking, what I'm looking at, what I see and what it means.", source: "Joan Didion, Why I Write" },
  { text: "Time is the substance I am made of. Time is a river which sweeps me along, but I am the river.", source: "Jorge Luis Borges, A New Refutation of Time" },
  { text: "The past is never dead. It's not even past.", source: "William Faulkner, Requiem for a Nun" },
  { text: "Perhaps one did not want to be loved so much as to be understood.", source: "George Orwell, 1984" },
  { text: "We are what we pretend to be, so we must be careful about what we pretend to be.", source: "Kurt Vonnegut, Mother Night" },
  { text: "The mind is its own place, and in itself can make a heaven of hell, a hell of heaven.", source: "John Milton, Paradise Lost" },
  { text: "Memory is the diary we all carry about with us.", source: "Oscar Wilde" },
  { text: "Two roads diverged in a yellow wood, and sorry I could not travel both.", source: "Robert Frost, The Road Not Taken" },
  { text: "One cannot step twice in the same river.", source: "Heraclitus" },
  { text: "The world is too much with us; late and soon, getting and spending, we lay waste our powers.", source: "William Wordsworth, The World Is Too Much With Us" },
  { text: "So we beat on, boats against the current, borne back ceaselessly into the past.", source: "F. Scott Fitzgerald, The Great Gatsby" },
  { text: "I took a deep breath and listened to the old brag of my heart: I am, I am, I am.", source: "Sylvia Plath, The Bell Jar" },
];

async function fetchHumanSeed(): Promise<HumanSeed> {
  // Try Quotable API first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch("https://api.quotable.io/random?minLength=50&maxLength=200", {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json();
      return { text: data.content, source: data.author, type: "quote" };
    }
  } catch {
    // Fall through to fallback
  }

  // Use fallback corpus
  const index = secureRandomInt(FALLBACK_CORPUS.length);
  const passage = FALLBACK_CORPUS[index];
  return { text: passage.text, source: passage.source, type: "fallback" };
}

/**
 * Get placeholders and used colors by scanning HTML files.
 * These are not stored in the database.
 */
async function getFileBasedState(): Promise<{ placeholders: string[]; usedColors: string[] }> {
  const state = {
    placeholders: [] as string[],
    usedColors: [] as string[],
  };

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
      // Check placeholders
      if (content.includes("NEXT_PAGE_PLACEHOLDER")) {
        state.placeholders.push(file);
      }

      // Extract used colors
      const colorMatch = content.match(/background-color:\s*(#[a-fA-F0-9]{6})/);
      if (colorMatch) {
        state.usedColors.push(colorMatch[1].toLowerCase());
      }
    }
  } catch {
    // Continue with partial state
  }

  return state;
}

async function selectNextTask(options: { useLiveCrawl?: boolean; maxCrawlPages?: number } = {}): Promise<TaskSpec> {
  const randomSeed = crypto.randomBytes(8).toString("hex");
  const workerId = `worker-${crypto.randomBytes(4).toString("hex")}`;

  // Clean up stale task assignments (workers that crashed)
  // 30 minute timeout - tasks older than this are considered abandoned
  const staleCleaned = cleanupStaleTasks(30);
  if (staleCleaned > 0) {
    console.error(`[wiki_next_task] Cleaned up ${staleCleaned} stale task assignment(s)`);
  }

  // Get data from database (using available* functions that exclude claimed tasks)
  const articleCount = getArticleCount();
  const allBrokenLinks = getBrokenLinks(); // For stats
  const availableBrokenLinks = getAvailableBrokenLinks(); // Excludes claimed
  const allOrphans = getOrphanArticles(); // For stats
  const availableOrphans = getAvailableOrphanArticles(); // Excludes claimed

  // Get file-based state (placeholders and colors)
  const fileState = await getFileBasedState();

  // Filter placeholders to exclude claimed tasks
  const claimedFilenames = new Set(getClaimedTaskFilenames());
  const availablePlaceholders = fileState.placeholders.filter(f => !claimedFilenames.has(f));

  // Pick unused color for visual variety
  const availableColors = INFOBOX_COLORS.filter(c => !fileState.usedColors.includes(c.toLowerCase()));
  const infoboxColor = secureRandomElement(availableColors) || secureRandomElement(INFOBOX_COLORS) || "#b0c4de";

  // Check for live 404s if requested
  let live404s: Live404Result[] = [];
  if (options.useLiveCrawl) {
    const allLive404s = await findLive404s(options.maxCrawlPages || 20);
    // Filter out already claimed live 404s
    live404s = allLive404s.filter(l => !claimedFilenames.has(l.filename));
  }

  const ecosystemStats = {
    totalArticles: articleCount,
    brokenLinks: allBrokenLinks.length, // Total for reporting
    orphans: allOrphans.length, // Total for reporting
    placeholders: fileState.placeholders.length, // Total for reporting
    live404s: live404s.length,
  };

  // Helper function to attempt claiming a task with retry on different items
  function tryClaimFromList<T>(
    items: T[],
    getFilename: (item: T) => string,
    taskType: string,
    maxAttempts: number = 5
  ): T | null {
    // Shuffle to reduce contention when multiple workers start simultaneously
    const shuffled = [...items].sort(() => Math.random() - 0.5);

    for (let i = 0; i < Math.min(maxAttempts, shuffled.length); i++) {
      const item = shuffled[i];
      const filename = getFilename(item);
      if (claimTask(taskType, filename, workerId)) {
        console.error(`[wiki_next_task] Claimed task: ${taskType} -> ${filename} (worker: ${workerId})`);
        return item;
      }
      // Task was already claimed by another worker, try next
    }
    return null;
  }

  // Priority 0: Live 404s from deployed site (CRITICAL - takes precedence)
  if (options.useLiveCrawl && live404s.length > 0) {
    const claimed = tryClaimFromList(
      live404s,
      (item) => item.filename,
      "create_from_live_404"
    );

    if (claimed) {
      return {
        taskType: "create_from_live_404",
        priority: "critical",
        topic: {
          name: claimed.suggestedTitle,
          filename: claimed.filename,
          context: `This page returns 404 on the live site (${claimed.target}). Referenced by ${claimed.sources.length} page(s): ${claimed.sources.map(s => s.split("/").pop()).join(", ")}. Create this missing page to fix the broken links.`,
        },
        infoboxColor,
        randomSeed,
        ecosystemStats,
      };
    }
    // All live 404s are claimed, fall through to next priority
  }

  // Priority 1: Broken links (CRITICAL)
  if (availableBrokenLinks.length > 0) {
    // Sort by number of sources (most referenced first) before attempting claims
    availableBrokenLinks.sort((a, b) => b.sources.length - a.sources.length);

    const claimed = tryClaimFromList(
      availableBrokenLinks,
      (item) => item.target,
      "repair_broken_link"
    );

    if (claimed) {
      const topicName = claimed.target.replace(".html", "").split("-")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

      return {
        taskType: "repair_broken_link",
        priority: "critical",
        topic: {
          name: topicName,
          filename: claimed.target,
          context: `Referenced by ${claimed.sources.length} article(s): ${claimed.sources.join(", ")}. Create this missing article to fix the broken links.`,
        },
        infoboxColor,
        randomSeed,
        ecosystemStats,
      };
    }
    // All broken links are claimed, fall through
  }

  // Priority 2: Placeholders (HIGH)
  if (availablePlaceholders.length > 0) {
    const claimed = tryClaimFromList(
      availablePlaceholders,
      (item) => item,
      "resolve_placeholder"
    );

    if (claimed) {
      return {
        taskType: "resolve_placeholder",
        priority: "high",
        topic: {
          name: "PLACEHOLDER_RESOLUTION",
          filename: claimed,
          context: `File ${claimed} contains unresolved NEXT_PAGE_PLACEHOLDER. Read the file to understand context and replace with an appropriate link.`,
        },
        infoboxColor,
        randomSeed,
        ecosystemStats,
      };
    }
    // All placeholders are claimed, fall through
  }

  // Priority 3: Orphans (MEDIUM)
  if (availableOrphans.length > 0) {
    const claimed = tryClaimFromList(
      availableOrphans,
      (item) => item,
      "fix_orphan"
    );

    if (claimed) {
      return {
        taskType: "fix_orphan",
        priority: "medium",
        topic: {
          name: claimed.replace(".html", ""),
          filename: claimed,
          context: `This article has no incoming links. Read the orphan article and find 2-3 related articles to add natural links from.`,
        },
        infoboxColor,
        randomSeed,
        ecosystemStats,
      };
    }
    // All orphans are claimed, fall through
  }

  // Priority 4: Create new content (LOW - ecosystem is healthy or all tasks claimed)
  // For new content, we use a generated filename as the claim target
  const humanSeed = await fetchHumanSeed();
  const newContentFilename = `new-content-${randomSeed}.html`;

  // Claim with a unique filename to prevent duplicate new content generation
  claimTask("create_new", newContentFilename, workerId);

  return {
    taskType: "create_new",
    priority: "low",
    topic: {
      name: "INSPIRED_BY_SEED",
      filename: "to-be-determined.html",
      context: "Ecosystem is healthy (or all repair tasks are claimed by other workers). Use the humanSeed as pure inspiration—derive a genuinely novel topic unrelated to existing articles. Avoid terminology patterns from the current corpus (semantic-*, temporal-*, *-consciousness). Invent fresh concepts with unique naming.",
    },
    humanSeed,
    infoboxColor,
    randomSeed,
    ecosystemStats,
  };
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_next_task",
    description: "Get the next task for the Not-Wikipedia autonomous agent. Returns a minimal task specification with task type, topic context, and optional human seed. The agent should infer article content, type, and thematic direction from context (referencing articles for broken links, or human seed for new content). Only provides infobox color for visual variety.",
    inputSchema: {
      type: "object",
      properties: {
        use_live_crawl: {
          type: "boolean",
          description: "If true, crawl the live site for 404 pages instead of using the database. This makes HTTP requests to not-wikipedia.org to find actual broken links.",
        },
        max_crawl_pages: {
          type: "number",
          description: "Maximum number of pages to crawl when using live crawl (default: 20)",
        },
      },
      required: [],
    },
  },

  handler: async (args) => {
    const useLiveCrawl = args.use_live_crawl as boolean;
    const maxCrawlPages = args.max_crawl_pages as number | undefined;

    const task = await selectNextTask({
      useLiveCrawl,
      maxCrawlPages,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify(task, null, 2),
      }],
    };
  },
};
