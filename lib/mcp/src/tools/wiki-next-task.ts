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
} from "../db/database.js";

interface HumanSeed {
  text: string;
  source: string;
  type: "quote" | "fallback";
}

interface TaskSpec {
  taskType: "repair_broken_link" | "resolve_placeholder" | "fix_orphan" | "create_new" | "ecosystem_healthy";
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

async function selectNextTask(): Promise<TaskSpec> {
  const randomSeed = crypto.randomBytes(8).toString("hex");

  // Get data from database
  const articleCount = getArticleCount();
  const brokenLinksData = getBrokenLinks();
  const orphansData = getOrphanArticles();

  // Get file-based state (placeholders and colors)
  const fileState = await getFileBasedState();

  // Pick unused color for visual variety
  const availableColors = INFOBOX_COLORS.filter(c => !fileState.usedColors.includes(c.toLowerCase()));
  const infoboxColor = secureRandomElement(availableColors) || secureRandomElement(INFOBOX_COLORS) || "#b0c4de";

  const ecosystemStats = {
    totalArticles: articleCount,
    brokenLinks: brokenLinksData.length,
    orphans: orphansData.length,
    placeholders: fileState.placeholders.length,
  };

  // Priority 1: Broken links (CRITICAL)
  // Agent should infer article type/category from the link context and referencing articles
  if (brokenLinksData.length > 0) {
    // Sort by number of sources (most referenced first)
    brokenLinksData.sort((a, b) => b.sources.length - a.sources.length);
    const selected = secureRandomElement(brokenLinksData) || brokenLinksData[0];
    const topicName = selected.target.replace(".html", "").split("-")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

    return {
      taskType: "repair_broken_link",
      priority: "critical",
      topic: {
        name: topicName,
        filename: selected.target,
        context: `Referenced by ${selected.sources.length} article(s): ${selected.sources.join(", ")}. Read the referencing articles to understand the conceptual role this page should fill—but use entirely fresh vocabulary and framing. Do not echo their terminology.`,
      },
      infoboxColor,
      randomSeed,
      ecosystemStats,
    };
  }

  // Priority 2: Placeholders (HIGH)
  if (fileState.placeholders.length > 0) {
    const sourceFile = secureRandomElement(fileState.placeholders) || fileState.placeholders[0];
    return {
      taskType: "resolve_placeholder",
      priority: "high",
      topic: {
        name: "PLACEHOLDER_RESOLUTION",
        filename: sourceFile,
        context: `File ${sourceFile} contains unresolved NEXT_PAGE_PLACEHOLDER. Read the file to understand context and replace with an appropriate link.`,
      },
      infoboxColor,
      randomSeed,
      ecosystemStats,
    };
  }

  // Priority 3: Orphans (MEDIUM)
  if (orphansData.length > 0) {
    const orphan = secureRandomElement(orphansData) || orphansData[0];
    return {
      taskType: "fix_orphan",
      priority: "medium",
      topic: {
        name: orphan.replace(".html", ""),
        filename: orphan,
        context: `This article has no incoming links. Read the orphan article and find 2-3 related articles to add natural links from.`,
      },
      infoboxColor,
      randomSeed,
      ecosystemStats,
    };
  }

  // Priority 4: Create new content (LOW - ecosystem is healthy)
  // Agent should derive all content decisions from the human seed
  const humanSeed = await fetchHumanSeed();

  return {
    taskType: "create_new",
    priority: "low",
    topic: {
      name: "INSPIRED_BY_SEED",
      filename: "to-be-determined.html",
      context: "Ecosystem is healthy. Use the humanSeed as pure inspiration—derive a genuinely novel topic unrelated to existing articles. Avoid terminology patterns from the current corpus (semantic-*, temporal-*, *-consciousness). Invent fresh concepts with unique naming.",
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
      properties: {},
      required: [],
    },
  },

  handler: async () => {
    const task = await selectNextTask();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(task, null, 2),
      }],
    };
  },
};
