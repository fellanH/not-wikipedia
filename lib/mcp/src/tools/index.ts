/**
 * Tool Registry
 *
 * This file collects all tools and exports them in formats the server needs:
 * - definitions: Array of tool schemas for ListToolsRequest
 * - handlers: Map of tool name → handler function for CallToolRequest
 *
 * To add a new tool:
 * 1. Create your tool file (e.g., src/tools/my-tool.ts)
 * 2. Import it below
 * 3. Add it to the toolModules array
 * 4. Rebuild with `npm run build`
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolModule, ToolHandler } from "../types.js";

// Import all tools
// Each tool exports a `tool` object with definition and handler
import { tool as helloWorld } from "./hello-world.js";
import { tool as timestamp } from "./timestamp.js";
import { tool as uuid } from "./uuid.js";
import { tool as base64 } from "./base64.js";
import { tool as hash } from "./hash.js";
import { tool as jsonFormat } from "./json-format.js";
import { tool as envInfo } from "./env-info.js";
import { tool as textStats } from "./text-stats.js";
import { tool as regexTest } from "./regex-test.js";
import { tool as randomString } from "./random-string.js";
import { tool as shellCommand } from "./shell-command.js";

// Wiki ecosystem tools
import { tool as wikiEcosystem } from "./wiki-ecosystem.js";
import { tool as wikiRandomTopic } from "./wiki-random-topic.js";
import { tool as wikiResearcher } from "./wiki-researcher.js";
import { tool as wikiBrokenLinks } from "./wiki-broken-links.js";
import { tool as wikiNextTask } from "./wiki-next-task.js";
import { tool as wikiHumanSeed } from "./wiki-human-seed.js";
import { tool as wikiCreateArticle } from "./wiki-create-article.js";
import { tool as wikiEditArticle } from "./wiki-edit-article.js";
import { tool as wikiAddLink } from "./wiki-add-link.js";
import { tool as wikiGetArticle } from "./wiki-get-article.js";
import { tool as wikiDiscover } from "./wiki-discover.js";
import { tool as wikiGitPublish } from "./wiki-git-publish.js";

// Register all tools here
// Add your custom tools to this array
const toolModules: ToolModule[] = [
  helloWorld,
  timestamp,
  uuid,
  base64,
  hash,
  jsonFormat,
  envInfo,
  textStats,
  regexTest,
  randomString,
  shellCommand,
  // Wiki ecosystem tools
  wikiEcosystem,
  wikiRandomTopic,
  wikiResearcher,
  wikiBrokenLinks,
  wikiNextTask,
  wikiHumanSeed,
  wikiCreateArticle,
  wikiEditArticle,
  wikiAddLink,
  wikiGetArticle,
  wikiDiscover,
  wikiGitPublish,
];

// Build the definitions list for ListToolsRequest
// This is what clients see when they ask "what tools are available?"
export const definitions: Tool[] = toolModules.map((t) => t.definition);

// Build a handler map for CallToolRequest
// Provides O(1) lookup when a tool is called by name
export const handlers: Map<string, ToolHandler> = new Map(
  toolModules.map((t) => [t.definition.name, t.handler])
);
