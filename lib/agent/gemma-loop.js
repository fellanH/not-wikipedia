#!/usr/bin/env node

/**
 * Gemma Article Generator for Not-Wikipedia
 *
 * Generates fictional encyclopedia articles using a local Ollama model (Gemma 3 4B).
 * Gemma writes structured plain text; existing MCP tools handle HTML generation,
 * DB insertion, fragment cards, and git publishing.
 *
 * Usage:
 *   cd ~/omni/workspaces/personal/not-wikipedia-project
 *   node local-agent/lib/agent/gemma-loop.js
 *
 * Env:
 *   LOOP_DELAY=30000   Delay between loops in ms (default: 30s)
 *   MAX_LOOPS=0        Max iterations, 0 = unlimited (default: 0)
 *   MODEL=gemma3:4b    Ollama model name (default: gemma3:4b)
 *   OLLAMA_URL=http://localhost:11434  Ollama base URL
 */

const { execSync } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const LOOP_DELAY = parseInt(process.env.LOOP_DELAY || "30000", 10);
const MAX_LOOPS = parseInt(process.env.MAX_LOOPS || "0", 10);
const MODEL = process.env.MODEL || "gemma3:4b";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const REBUILD_INDEX_EVERY = 5;

// Resolve paths (script lives in local-agent/lib/agent/)
const AGENT_DIR = __dirname; // local-agent/lib/agent/
const PROJECT_ROOT = path.resolve(AGENT_DIR, "../../..");
// MCP config.js resolves from lib/agent cwd: PROJECT_ROOT = local-agent/,
// WIKI_DIR = PROJECT_ROOT/../wiki-content/wiki = not-wikipedia-project/wiki-content/wiki
const WIKI_DIR = path.resolve(PROJECT_ROOT, "wiki-content/wiki");
const MCP_TOOLS = path.resolve(AGENT_DIR, "../mcp/dist/tools");

// Stats file paths
const STATUS_FILE = path.resolve(AGENT_DIR, "../meta/agent-status.json");
const STATS_FILE = path.resolve(AGENT_DIR, "../meta/gemma-stats.json");

// ---------------------------------------------------------------------------
// Stats tracker
// ---------------------------------------------------------------------------
const stats = {
  startedAt: new Date().toISOString(),
  model: MODEL,
  loops: 0,
  articles: 0,
  parseFails: 0,
  ollamaFails: 0,
  skipped: 0,
  totalGenSec: 0,
  totalChars: 0,
  recentArticles: [],  // last 20
  history: [],         // per-loop timing, last 50
};

function recordLoop(entry) {
  stats.loops++;
  if (entry.success) {
    stats.articles++;
    stats.totalGenSec += entry.genSec || 0;
    stats.totalChars += entry.chars || 0;
    stats.recentArticles.unshift({
      title: entry.title,
      filename: entry.filename,
      genSec: entry.genSec,
      chars: entry.chars,
      sections: entry.sections,
      taskType: entry.taskType,
      createdAt: new Date().toISOString(),
    });
    if (stats.recentArticles.length > 20) stats.recentArticles.length = 20;
  }
  if (entry.parseFail) stats.parseFails++;
  if (entry.ollamaFail) stats.ollamaFails++;
  if (entry.skipped) stats.skipped++;

  stats.history.unshift({
    loop: stats.loops,
    success: !!entry.success,
    genSec: entry.genSec || 0,
    totalSec: entry.totalSec || 0,
    ts: new Date().toISOString(),
  });
  if (stats.history.length > 50) stats.history.length = 50;

  writeStats();
}

function getSystemLoad() {
  const cpus = os.cpus();
  // Average load over last 1 minute
  const load1m = os.loadavg()[0];
  const loadPct = ((load1m / cpus.length) * 100).toFixed(0);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedPct = (((totalMem - freeMem) / totalMem) * 100).toFixed(0);

  return {
    cpuCount: cpus.length,
    loadAvg1m: load1m.toFixed(2),
    loadPct: `${loadPct}%`,
    memUsedPct: `${usedPct}%`,
    memFreeGb: (freeMem / 1073741824).toFixed(1),
    memTotalGb: (totalMem / 1073741824).toFixed(1),
  };
}

function writeStats() {
  const sys = getSystemLoad();
  const avgGenSec = stats.articles > 0 ? (stats.totalGenSec / stats.articles).toFixed(1) : "0";
  const avgChars = stats.articles > 0 ? Math.round(stats.totalChars / stats.articles) : 0;
  const successRate = stats.loops > 0 ? ((stats.articles / stats.loops) * 100).toFixed(0) : "0";
  const uptimeSec = ((Date.now() - new Date(stats.startedAt).getTime()) / 1000).toFixed(0);

  const output = {
    ...stats,
    computed: {
      avgGenSec,
      avgChars,
      successRate: `${successRate}%`,
      uptimeSec: parseInt(uptimeSec, 10),
      uptimeHuman: formatDuration(parseInt(uptimeSec, 10)),
      articlesPerHour: uptimeSec > 0 ? ((stats.articles / uptimeSec) * 3600).toFixed(1) : "0",
    },
    system: sys,
    updatedAt: new Date().toISOString(),
  };

  try {
    const tmp = STATS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(output, null, 2));
    fs.renameSync(tmp, STATS_FILE);
  } catch { /* non-fatal */ }

  // Also update the shared agent-status.json for the dashboard
  try {
    let status = {};
    try { status = JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8")); } catch {}
    status.gemma = {
      active: true,
      model: MODEL,
      loops: stats.loops,
      articles: stats.articles,
      successRate: `${successRate}%`,
      avgGenSec,
      system: sys,
      lastArticle: stats.recentArticles[0] || null,
      updatedAt: new Date().toISOString(),
    };
    status.timestamp = new Date().toISOString();
    const tmp = STATUS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(status, null, 2));
    fs.renameSync(tmp, STATUS_FILE);
  } catch { /* non-fatal */ }
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function printStats() {
  const sys = getSystemLoad();
  const avgGen = stats.articles > 0 ? (stats.totalGenSec / stats.articles).toFixed(1) : "-";
  const rate = stats.loops > 0 ? ((stats.articles / stats.loops) * 100).toFixed(0) : "-";
  const uptimeSec = (Date.now() - new Date(stats.startedAt).getTime()) / 1000;
  const aph = uptimeSec > 60 ? ((stats.articles / uptimeSec) * 3600).toFixed(1) : "-";

  log("");
  log(`${CYAN}--- STATS ---${NC}`);
  log(`  Articles: ${stats.articles}/${stats.loops} loops (${rate}% success)`);
  log(`  Avg generation: ${avgGen}s | Articles/hour: ${aph}`);
  log(`  Parse fails: ${stats.parseFails} | Ollama fails: ${stats.ollamaFails} | Skipped: ${stats.skipped}`);
  log(`  CPU: ${sys.loadPct} (${sys.loadAvg1m} avg, ${sys.cpuCount} cores) | RAM: ${sys.memUsedPct} (${sys.memFreeGb}/${sys.memTotalGb} GB free)`);
  log(`  Uptime: ${formatDuration(Math.round(uptimeSec))}`);
  log(`${CYAN}-------------${NC}`);
  log("");
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const NC = "\x1b[0m";

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`${CYAN}[gemma ${ts}]${NC} ${msg}`);
}
function logOk(msg) { log(`${GREEN}+${NC} ${msg}`); }
function logWarn(msg) { log(`${YELLOW}!${NC} ${msg}`); }
function logErr(msg) { log(`${RED}x${NC} ${msg}`); }

// ---------------------------------------------------------------------------
// getLocalSeed - fallback seed when wiki-next-task doesn't provide one
// ---------------------------------------------------------------------------
const LOCAL_SEEDS = [
  { text: "The fog comes on little cat feet.", source: "Carl Sandburg" },
  { text: "Salt is born of the purest parents: the sun and the sea.", source: "Pythagoras" },
  { text: "When the moon is not full, the stars shine more brightly.", source: "Buganda proverb" },
  { text: "The bamboo that bends is stronger than the oak that resists.", source: "Japanese proverb" },
  { text: "Clay remembers the hands that shaped it.", source: "Japanese pottery tradition" },
  { text: "Maps are the first and last thing a refugee packs.", source: "Amitav Ghosh" },
  { text: "The history of a people is found in its songs.", source: "George Jellinek" },
  { text: "The law is reason, free from passion.", source: "Aristotle" },
  { text: "Fermentation is the process by which a substance breaks itself down into simpler substances.", source: "Sandor Katz" },
  { text: "Plate tectonics is not all havoc and destruction. It is also renewal.", source: "Robert Ballard" },
  { text: "The ball is round, and the game lasts ninety minutes.", source: "Sepp Herberger" },
  { text: "A book is like a garden carried in the pocket.", source: "Chinese proverb" },
  { text: "The sea, once it casts its spell, holds one in its net of wonder forever.", source: "Jacques Cousteau" },
  { text: "Nothing in biology makes sense except in the light of evolution.", source: "Theodosius Dobzhansky" },
  { text: "An old error is always more popular than a new truth.", source: "German proverb" },
  { text: "Cooking done with care is an act of love.", source: "Craig Claiborne" },
  { text: "Mountains are cathedrals where I practice my religion.", source: "Anatoli Boukreev" },
  { text: "One cannot step twice in the same river.", source: "Heraclitus" },
  { text: "The loom is the mother of all machines.", source: "Textile history" },
  { text: "If you want to go far, go together.", source: "African proverb" },
];

function getLocalSeed() {
  const pick = LOCAL_SEEDS[Math.floor(Math.random() * LOCAL_SEEDS.length)];
  return { text: pick.text, source: pick.source, type: "fallback" };
}

// ---------------------------------------------------------------------------
// callTool - execute an MCP tool in a subprocess
// ---------------------------------------------------------------------------
function callTool(toolName, args) {
  // Write a temp script to avoid shell escaping issues with JSON content
  const tmpFile = path.join(AGENT_DIR, `.tmp-tool-${process.pid}.cjs`);
  const script = `
const { tool } = require('${MCP_TOOLS}/${toolName}.js');
const args = ${JSON.stringify(args)};
tool.handler(args).then(r => {
  const text = r.content?.[0]?.text ?? '';
  process.stdout.write(text);
}).catch(e => {
  process.stderr.write('Tool error: ' + e.message + '\\n');
  process.exit(1);
});
`;
  try {
    fs.writeFileSync(tmpFile, script);
    const result = execSync(`node "${tmpFile}"`, {
      cwd: AGENT_DIR, // MCP config.js resolves paths from cwd
      timeout: 60_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result;
  } catch (err) {
    const stderr = err.stderr?.toString() || err.message;
    throw new Error(`callTool(${toolName}) failed: ${stderr}`);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ---------------------------------------------------------------------------
// callOllama - generate text from local Ollama
// ---------------------------------------------------------------------------
async function callOllama(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: true,
        options: { temperature: 1.0, num_predict: 2048 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      clearTimeout(timeout);
      throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    }

    // Stream tokens to stderr as they arrive
    let full = "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Process complete JSON lines
      const lines = buf.split("\n");
      buf = lines.pop(); // keep incomplete line in buffer
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.response) {
            process.stderr.write(chunk.response);
            full += chunk.response;
          }
        } catch { /* skip malformed line */ }
      }
    }
    // Process any remaining buffer
    if (buf.trim()) {
      try {
        const chunk = JSON.parse(buf);
        if (chunk.response) {
          process.stderr.write(chunk.response);
          full += chunk.response;
        }
      } catch { /* skip */ }
    }
    process.stderr.write("\n");

    clearTimeout(timeout);
    return full;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// gatherContext - pull relevant context for the task
// ---------------------------------------------------------------------------
function gatherContext(task) {
  const context = [];

  if (task.taskType === "repair_broken_link" || task.taskType === "create_from_live_404") {
    // For broken links: find articles that reference the target
    const targetFile = task.topic?.filename || "";
    if (targetFile) {
      try {
        const files = fs.readdirSync(WIKI_DIR).filter(f => f.endsWith(".html"));
        const sample = files.sort(() => Math.random() - 0.5).slice(0, 30);
        for (const file of sample) {
          const content = fs.readFileSync(path.join(WIKI_DIR, file), "utf-8");
          if (content.includes(targetFile)) {
            // Extract a paragraph near the reference
            const idx = content.indexOf(targetFile);
            const start = Math.max(0, idx - 200);
            const end = Math.min(content.length, idx + 200);
            const snippet = content.slice(start, end).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            context.push(`From ${file}: ...${snippet}...`);
            if (context.length >= 3) break;
          }
        }
      } catch { /* continue without context */ }
    }
  } else if (task.taskType === "fix_orphan") {
    // For orphans: read the orphan article itself so Gemma can create a
    // companion article in the same thematic space that links back to it
    const orphanFile = task.topic?.filename || "";
    if (orphanFile) {
      try {
        const content = fs.readFileSync(path.join(WIKI_DIR, orphanFile), "utf-8");
        // Extract title
        const titleMatch = content.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const orphanTitle = titleMatch ? titleMatch[1].trim() : orphanFile.replace(".html", "");
        // Extract first 2 paragraphs as context (dotAll for multiline <p>)
        const paragraphs = [];
        const pRegex = /<p>([\s\S]*?)<\/p>/g;
        let m;
        while ((m = pRegex.exec(content)) !== null && paragraphs.length < 2) {
          const text = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          if (text.length > 30) paragraphs.push(text);
        }
        // Extract see_also links for thematic context
        const seeAlsoLinks = [];
        const linkRegex = /See also[\s\S]*?<ul>([\s\S]*?)<\/ul>/i;
        const seeAlsoBlock = content.match(linkRegex);
        if (seeAlsoBlock) {
          const hrefRegex = /href="([^"]+)"/g;
          let lm;
          while ((lm = hrefRegex.exec(seeAlsoBlock[1])) !== null) {
            seeAlsoLinks.push(lm[1].replace(".html", "").replace(/-/g, " "));
          }
        }

        context.push(
          `ORPHAN ARTICLE "${orphanTitle}" (${orphanFile}):\n` +
          paragraphs.join("\n\n") +
          (seeAlsoLinks.length > 0 ? `\nRelated topics: ${seeAlsoLinks.join(", ")}` : "")
        );
      } catch { /* continue without */ }
    }
  }

  // For create_new tasks, skip tone examples to reduce bias toward existing patterns.
  // For repair/orphan tasks, add 1 random excerpt for tone reference.
  if (task.taskType !== "create_new") {
    try {
      const files = fs.readdirSync(WIKI_DIR).filter(f => f.endsWith(".html"));
      const shuffled = files.sort(() => Math.random() - 0.5);
      for (const file of shuffled) {
        const content = fs.readFileSync(path.join(WIKI_DIR, file), "utf-8");
        const match = content.match(/<p>([\s\S]{50,300}?)<\/p>/);
        if (match) {
          const text = match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          if (text.length > 30) {
            context.push(`Example tone from ${file}: "${text}"`);
            break;
          }
        }
      }
    } catch { /* continue without */ }
  }

  return context.join("\n\n");
}

// ---------------------------------------------------------------------------
// buildPrompt - assemble the Gemma prompt
// ---------------------------------------------------------------------------
function buildPrompt(task, context) {
  const topicName = task.topic?.name || "";
  const topicContext = task.topic?.context || "";
  const seedText = task.humanSeed?.text || "";
  const seedSource = task.humanSeed?.source || "";
  const subjectHint = task.subjectHint || "";
  const voiceText = task.voiceContext?.text || "";

  let prompt = "";

  if (task.taskType === "create_new") {
    // Seed-driven prompt. Minimal context, let the LLM be creative.
    const seed = seedText
      ? `"${seedText}" (${seedSource})`
      : "the concept of something that has never existed";

    prompt = `You are writing a fictional encyclopedia article inspired by ${seed}.
Write in a neutral, encyclopedic tone. Everything is fictional. Be original.

`;
  } else if (task.taskType === "repair_broken_link" || task.taskType === "create_from_live_404") {
    prompt = `Write a fictional encyclopedia article for "${topicName}".
This topic is referenced by other articles but doesn't exist yet.
${topicContext}
Write in a neutral, encyclopedic tone. Everything is fictional.

`;
  } else if (task.taskType === "fix_orphan") {
    const orphanFile = task.topic?.filename || "";
    const orphanName = orphanFile.replace(".html", "").replace(/-/g, " ");
    prompt = `Write a fictional encyclopedia article that references "${orphanName}" (${orphanFile}).
Do NOT recreate "${orphanName}". Invent a related but different topic that links to it.
Write in a neutral, encyclopedic tone. Everything is fictional.

`;
  } else {
    prompt = `Write a fictional encyclopedia article.
Task: ${task.taskType} | Topic: ${topicName}
${topicContext}
Write in a neutral, encyclopedic tone. Everything is fictional.

`;
  }

  // Context only for repair/orphan tasks
  if (context && task.taskType !== "create_new") {
    prompt += `Context from existing articles:\n${context}\n\n`;
  }

  // Minimal structure. No example values to avoid steering.
  prompt += `Format:

TITLE:
TYPE:
FIELD:
FIRST_DESCRIBED:
KEY_RESEARCHERS:

INTRO:

SECTION:

SECTION:

QUOTE:
QUOTE_BY:

REFERENCE:
REFERENCE:`;

  return prompt;
}

// ---------------------------------------------------------------------------
// parseGemmaOutput - state machine parser for structured text
// ---------------------------------------------------------------------------
function parseGemmaOutput(raw) {
  const lines = raw.split("\n");
  const result = {
    title: "",
    type: "",
    alsoKnownAs: "",
    field: "",
    firstDescribed: "",
    keyResearchers: "",
    ambox: "",
    intro: [],
    sections: [],
    quotes: [],
    seeAlso: [],
    references: [],
  };

  let state = "header"; // header | intro | section | done
  let currentSection = null;

  for (const line of lines) {
    // Strip markdown bold markers and horizontal rules that Gemma sometimes adds
    const trimmed = line.trim().replace(/^\*\*/, "").replace(/\*\*$/, "").replace(/^---+$/, "").trim();

    // Skip Gemma's conversational preamble/postamble
    if (trimmed.startsWith("Okay, here") || trimmed.startsWith("Would you like")) continue;
    if (trimmed === "---") continue;

    // Header fields
    if (trimmed.startsWith("TITLE:")) {
      result.title = trimmed.slice(6).replace(/^\*+\s*|\*+$/g, "").trim();
      continue;
    }
    if (trimmed.startsWith("TYPE:")) {
      result.type = trimmed.slice(5).trim();
      continue;
    }
    if (trimmed.startsWith("ALSO_KNOWN_AS:")) {
      result.alsoKnownAs = trimmed.slice(14).trim();
      continue;
    }
    if (trimmed.startsWith("FIELD:")) {
      result.field = trimmed.slice(6).trim();
      continue;
    }
    if (trimmed.startsWith("FIRST_DESCRIBED:")) {
      result.firstDescribed = trimmed.slice(16).trim();
      continue;
    }
    if (trimmed.startsWith("KEY_RESEARCHERS:")) {
      result.keyResearchers = trimmed.slice(16).trim();
      continue;
    }
    if (trimmed.startsWith("AMBOX:")) {
      result.ambox = trimmed.slice(6).trim();
      continue;
    }

    // State transitions
    if (trimmed === "INTRO:" || trimmed.startsWith("INTRO:")) {
      state = "intro";
      // Handle content on the same line as INTRO:
      const inlineContent = trimmed.slice(6).trim();
      if (inlineContent) {
        result.intro.push(inlineContent);
      }
      continue;
    }
    if (trimmed.startsWith("SECTION:")) {
      const sectionTitle = trimmed.slice(8).trim();
      if (sectionTitle) {
        currentSection = { title: sectionTitle, body: [] };
        result.sections.push(currentSection);
        state = "section";
      }
      continue;
    }
    if (trimmed.startsWith("QUOTE:")) {
      const quoteText = trimmed.slice(6).trim().replace(/^[""]|[""]$/g, "");
      if (quoteText) result.quotes.push({ text: quoteText, by: "" });
      continue;
    }
    if (trimmed.startsWith("QUOTE_BY:")) {
      const by = trimmed.slice(9).trim();
      if (result.quotes.length > 0) {
        result.quotes[result.quotes.length - 1].by = by;
      }
      continue;
    }
    if (trimmed.startsWith("SEE_ALSO:")) {
      const items = trimmed.slice(9).trim().split(/[,;]+/).map(s => s.trim()).filter(Boolean);
      result.seeAlso = items.map(s => {
        // Normalize to filename format
        return s.replace(/\.html$/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + ".html";
      });
      continue;
    }
    if (trimmed.startsWith("REFERENCE:")) {
      result.references.push(trimmed.slice(10).trim());
      continue;
    }

    // Content accumulation
    if (state === "intro" && trimmed) {
      result.intro.push(trimmed);
    } else if (state === "section" && currentSection && trimmed) {
      currentSection.body.push(trimmed);
    }
  }

  // Validation
  if (!result.title || result.intro.length === 0) {
    return null;
  }

  return result;
}

// ---------------------------------------------------------------------------
// existsInWiki - check if a file already exists in the wiki directory
// ---------------------------------------------------------------------------
function existsInWiki(filename) {
  try {
    fs.accessSync(path.join(WIKI_DIR, filename));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// buildCreateArgs - convert parsed output to wiki-create-article arguments
// ---------------------------------------------------------------------------
function buildCreateArgs(parsed, task) {
  // Build markdown content
  let content = "";

  // Intro paragraphs (first sentence bold)
  const introText = parsed.intro.join("\n\n");
  const firstPeriod = introText.indexOf(".");
  if (firstPeriod > 0 && firstPeriod < 200) {
    content += `**${introText.slice(0, firstPeriod + 1)}** ${introText.slice(firstPeriod + 1)}`;
  } else {
    content += introText;
  }
  content += "\n\n";

  // Sections
  for (const section of parsed.sections) {
    content += `## ${section.title}\n\n`;
    content += section.body.join("\n\n");
    content += "\n\n";
  }

  // Quotes as blockquote
  for (const quote of parsed.quotes) {
    if (quote.text) {
      content += `> "${quote.text}"\n`;
      if (quote.by) content += `> -- ${quote.by}\n`;
      content += "\n";
    }
  }

  // References as list
  if (parsed.references.length > 0) {
    content += "## References\n\n";
    for (const ref of parsed.references) {
      content += `- ${ref}\n`;
    }
    content += "\n";
  }

  // Build infobox fields
  const infoboxFields = {};
  if (parsed.type) infoboxFields["Type"] = parsed.type;
  if (parsed.alsoKnownAs) infoboxFields["Also known as"] = parsed.alsoKnownAs;
  if (parsed.field) infoboxFields["Field"] = parsed.field;
  if (parsed.firstDescribed) infoboxFields["First described"] = parsed.firstDescribed;
  if (parsed.keyResearchers) infoboxFields["Key researchers"] = parsed.keyResearchers;

  // Build categories from type and field
  const categories = [];
  if (parsed.type) categories.push(parsed.type.charAt(0).toUpperCase() + parsed.type.slice(1));
  if (parsed.field) {
    parsed.field.split(",").forEach(f => {
      const trimmed = f.trim();
      if (trimmed) categories.push(trimmed);
    });
  }

  // For orphan tasks, ensure we don't collide with the orphan's own filename
  const slug = parsed.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let filenameOverride;
  const orphanFile = task.topic?.filename || "";
  if (slug + ".html" === orphanFile || existsInWiki(slug + ".html")) {
    // Append "-companion" or a random suffix to avoid collision
    const suffix = slug + "-companion";
    filenameOverride = existsInWiki(suffix + ".html")
      ? slug + "-" + Date.now().toString(36) + ".html"
      : suffix + ".html";
  }

  return {
    title: parsed.title,
    content,
    infobox_color: task.infoboxColor || "#b0c4de",
    infobox_fields: infoboxFields,
    categories: categories.length > 0 ? categories : ["Uncategorized"],
    see_also: parsed.seeAlso,
    warning_message: parsed.ambox || undefined,
    model: MODEL,
    ...(filenameOverride && { filename_override: filenameOverride }),
  };
}

// ---------------------------------------------------------------------------
// Per-loop log files
// ---------------------------------------------------------------------------
const LOG_DIR = path.resolve(AGENT_DIR, "logs");
const MAX_LOGS = 200;

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function writeLoopLog(loopNum, data) {
  ensureLogDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `gemma-${ts}-loop${loopNum}.json`;
  const filepath = path.join(LOG_DIR, filename);
  try {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  } catch (err) {
    logWarn(`Failed to write log: ${err.message}`);
  }
}

function rotateLogs() {
  ensureLogDir();
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith("gemma-") && f.endsWith(".json"))
      .sort();
    if (files.length > MAX_LOGS) {
      const toDelete = files.slice(0, files.length - MAX_LOGS);
      for (const f of toDelete) {
        fs.unlinkSync(path.join(LOG_DIR, f));
      }
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// sleep helper
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// runLoop - main loop
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let shuttingDown = false;

function handleShutdown(signal) {
  if (shuttingDown) {
    logWarn(`Second ${signal} received, forcing exit.`);
    printStats();
    process.exit(1);
  }
  shuttingDown = true;
  logWarn(`${signal} received. Finishing current loop, then exiting...`);
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

async function runLoop() {
  log(`Starting Gemma article generator`);
  log(`Model: ${MODEL} | Delay: ${LOOP_DELAY}ms | Max loops: ${MAX_LOOPS || "unlimited"}`);
  log(`Ollama: ${OLLAMA_URL}`);
  log(`Project root: ${PROJECT_ROOT}`);
  log(`Wiki dir: ${WIKI_DIR}`);
  log("");

  // Verify Ollama is reachable
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    log(`Ollama models available: ${models.join(", ")}`);
    if (!models.some(m => m.startsWith(MODEL.split(":")[0]))) {
      logWarn(`Model "${MODEL}" not found. Available: ${models.join(", ")}`);
      logWarn(`Run: ollama pull ${MODEL}`);
      process.exit(1);
    }
  } catch (err) {
    logErr(`Cannot reach Ollama at ${OLLAMA_URL}: ${err.message}`);
    logErr("Is Ollama running? Start it with: ollama serve");
    process.exit(1);
  }

  let loopCount = 0;

  while (true) {
    if (shuttingDown) {
      log("Shutdown requested. Exiting loop.");
      break;
    }

    loopCount++;
    if (MAX_LOOPS > 0 && loopCount > MAX_LOOPS) {
      log(`Reached max loops (${MAX_LOOPS}). Exiting.`);
      break;
    }

    const loopStart = Date.now();
    const loopLog = {
      loop: loopCount,
      startedAt: new Date().toISOString(),
      model: MODEL,
      task: null,
      context: null,
      prompt: null,
      rawOutput: null,
      parsed: null,
      createArgs: null,
      result: null,
      outcome: "unknown",
      error: null,
      timing: {},
      system: getSystemLoad(),
    };

    log(`\n${"=".repeat(50)}`);
    log(`Loop ${loopCount}${MAX_LOOPS > 0 ? `/${MAX_LOOPS}` : ""}`);
    log(`${"=".repeat(50)}`);

    try {
      // Step 1: Get next task
      log("Fetching next task...");
      let taskJson;
      let retries = 0;
      while (retries < 3) {
        try {
          taskJson = callTool("wiki-next-task", {});
          break;
        } catch (err) {
          retries++;
          logWarn(`Task fetch failed (attempt ${retries}/3): ${err.message}`);
          if (retries < 3) await sleep(5000);
        }
      }
      if (!taskJson) {
        logErr("Failed to get task after 3 attempts. Skipping loop.");
        loopLog.outcome = "task_fetch_failed";
        recordLoop({ skipped: true });
        writeLoopLog(loopCount, loopLog);
        await sleep(LOOP_DELAY);
        continue;
      }

      const task = JSON.parse(taskJson);

      // Skip orphan tasks: all articles are discoverable via the index page
      // and homepage "Latest Article" section, so orphans aren't a real problem.
      if (task.taskType === "fix_orphan") {
        logWarn(`Skipping orphan task (${task.topic?.name}), overriding to create_new.`);
        task.taskType = "create_new";
        task.topic = {
          name: "INSPIRED_BY_SEED",
          filename: "to-be-determined.html",
          context: "",
        };
        // Fetch a seed since the orphan task didn't come with one
        if (!task.humanSeed?.text) {
          task.humanSeed = getLocalSeed();
        }
      }

      loopLog.task = task;
      logOk(`Task: ${task.taskType} | Topic: ${task.topic?.name || "new"}`);

      // Step 2: Gather context
      const context = gatherContext(task);
      loopLog.context = context;
      if (context) {
        log(`Context: ${context.length} chars`);
      } else {
        log("Context: none (fresh creation)");
      }

      // Step 3: Build prompt
      const prompt = buildPrompt(task, context);
      loopLog.prompt = prompt;
      loopLog.timing.promptBuiltAt = Date.now() - loopStart;
      const seedText = task.humanSeed?.text || "";
      // Print full prompt so operator can see exactly what the LLM receives
      log(`\n--- PROMPT (${prompt.length} chars) ---`);
      process.stderr.write(prompt + "\n");
      log(`--- END PROMPT ---\n`);
      log(`Generating with ${MODEL}...`);
      const genStart = Date.now();
      let raw;
      retries = 0;
      while (retries < 3) {
        try {
          raw = await callOllama(prompt);
          break;
        } catch (err) {
          retries++;
          logWarn(`Ollama call failed (attempt ${retries}/3): ${err.message}`);
          if (err.name === "AbortError") {
            logWarn("Timeout, likely generating too much text.");
          }
          if (retries < 3) {
            logWarn("Retrying in 60s...");
            await sleep(60_000);
          }
        }
      }
      if (!raw) {
        logErr("Ollama failed after 3 attempts. Skipping loop.");
        loopLog.outcome = "ollama_failed";
        recordLoop({ ollamaFail: true });
        writeLoopLog(loopCount, loopLog);
        await sleep(LOOP_DELAY);
        continue;
      }

      const genSec = (Date.now() - genStart) / 1000;
      loopLog.rawOutput = raw;
      loopLog.timing.genSec = genSec;
      logOk(`Generated ${raw.length} chars in ${genSec.toFixed(1)}s`);

      // Step 5: Parse output
      log("Parsing output...");
      const parsed = parseGemmaOutput(raw);
      if (!parsed) {
        logWarn("Parse failed (no TITLE or INTRO found). Raw output:");
        console.error(raw.slice(0, 500));
        loopLog.outcome = "parse_failed";
        recordLoop({ parseFail: true, genSec, chars: raw.length });
        writeLoopLog(loopCount, loopLog);
        await sleep(LOOP_DELAY);
        continue;
      }
      loopLog.parsed = parsed;
      logOk(`Parsed: "${parsed.title}" (${parsed.sections.length} sections, ${parsed.references.length} refs)`);

      // Step 6: Create article via MCP tool
      log("Creating article...");
      const createArgs = buildCreateArgs(parsed, task);
      loopLog.createArgs = createArgs;
      let createResult;
      try {
        createResult = callTool("wiki-create-article", createArgs);
      } catch (err) {
        if (err.message.includes("already exists")) {
          logWarn(`Article already exists. Skipping.`);
          loopLog.outcome = "already_exists";
          recordLoop({ skipped: true, genSec, chars: raw.length });
          writeLoopLog(loopCount, loopLog);
          await sleep(LOOP_DELAY);
          continue;
        }
        throw err;
      }

      let created;
      try {
        created = JSON.parse(createResult);
      } catch {
        created = { filename: "", success: false };
      }
      loopLog.result = created;

      if (!created.success) {
        logWarn(`Article creation returned: ${createResult.slice(0, 200)}`);
        loopLog.outcome = "create_failed";
        loopLog.error = createResult.slice(0, 500);
        recordLoop({ skipped: true, genSec, chars: raw.length });
        writeLoopLog(loopCount, loopLog);
        await sleep(LOOP_DELAY);
        continue;
      }
      logOk(`Created: ${created.filename}`);

      // Step 7: Run discovery on new article
      log("Running link discovery...");
      try {
        callTool("wiki-discover", { source_article: created.filename });
        logOk("Discovery complete");
      } catch (err) {
        logWarn(`Discovery failed: ${err.message}`);
      }

      // Step 8: Git publish
      log("Publishing...");
      try {
        const publishResult = callTool("wiki-git-publish", { filename: created.filename });
        logOk(`Published: ${publishResult.slice(0, 100)}`);
      } catch (err) {
        logWarn(`Publish failed: ${err.message}`);
        // Non-fatal, next publish will catch up
      }

      // Step 8.5: Rebuild search index periodically
      if (loopCount % REBUILD_INDEX_EVERY === 0) {
        log("Rebuilding search index...");
        try {
          callTool("wiki-build-index", {});
          logOk("Index rebuilt");
        } catch (err) {
          logWarn(`Index rebuild failed: ${err.message}`);
        }
      }

      const totalSec = (Date.now() - loopStart) / 1000;
      loopLog.outcome = "success";
      loopLog.timing.totalSec = totalSec;
      recordLoop({
        success: true,
        genSec,
        totalSec,
        chars: raw.length,
        title: parsed.title,
        filename: created.filename,
        sections: parsed.sections.length,
        taskType: task.taskType,
      });
      writeLoopLog(loopCount, loopLog);

      logOk(`Loop ${loopCount} complete: "${parsed.title}" (${totalSec.toFixed(1)}s total)`);
    } catch (err) {
      logErr(`Loop error: ${err.message}`);
      loopLog.outcome = "error";
      loopLog.error = err.message;
      recordLoop({ skipped: true });
      writeLoopLog(loopCount, loopLog);
    }

    // Print stats every 5 loops, rotate logs every 20
    if (loopCount % 5 === 0) printStats();
    if (loopCount % 20 === 0) rotateLogs();

    // Step 9: Sleep before next loop (interruptible)
    if (shuttingDown) break;
    log(`Sleeping ${LOOP_DELAY / 1000}s...`);
    await sleep(LOOP_DELAY);
  }

  printStats();
  log("Gemma loop finished.");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
runLoop().catch(err => {
  logErr(`Fatal error: ${err.message}`);
  process.exit(1);
});
