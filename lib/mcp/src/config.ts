/**
 * Shared Configuration
 *
 * Centralized path configuration for the MCP tools.
 * All paths are relative to the project root (process.cwd()).
 */

import * as path from "path";

/**
 * Get the project root directory.
 * When running from lib/mcp, we need to go up two levels.
 * When running from project root, paths work directly.
 */
function getProjectRoot(): string {
  const cwd = process.cwd();

  // If we're in lib/mcp or lib/agent/mcp, go up to project root
  if (cwd.endsWith("/lib/mcp") || cwd.endsWith("/lib/agent/mcp")) {
    return path.resolve(cwd, "../..");
  }
  if (cwd.endsWith("/lib/agent")) {
    return path.resolve(cwd, "../..");
  }

  // Otherwise assume we're at project root
  return cwd;
}

const PROJECT_ROOT = getProjectRoot();

/**
 * Content repository directory - the source of truth for all wiki content.
 * This is a separate git repo that Vercel deploys from.
 */
export const CONTENT_REPO_DIR = path.join(PROJECT_ROOT, "..", "wiki-content");

/**
 * Wiki articles directory (static HTML files).
 */
export const WIKI_DIR = path.join(CONTENT_REPO_DIR, "wiki");

/**
 * Database file path.
 */
export const DB_PATH = path.join(PROJECT_ROOT, "lib", "meta", "ralph.db");

/**
 * Meta directory (ecosystem.json, researchers.json).
 */
export const META_DIR = path.join(PROJECT_ROOT, "lib", "meta");

/**
 * CSS file for wiki articles.
 */
export const WIKI_CSS_PATH = path.join(CONTENT_REPO_DIR, "styles.css");

/**
 * Index file for the wiki.
 */
export const WIKI_INDEX_PATH = path.join(CONTENT_REPO_DIR, "index.html");

/**
 * Fragments directory for article previews.
 */
export const FRAGMENTS_DIR = path.join(CONTENT_REPO_DIR, "fragments");

/**
 * API directory for search index and other data.
 */
export const API_DIR = path.join(CONTENT_REPO_DIR, "api");

/**
 * Categories directory.
 */
export const CATEGORIES_DIR = path.join(CONTENT_REPO_DIR, "categories");

/**
 * Infobox color palette.
 */
export const INFOBOX_COLORS = [
  "#7b9e89", "#c9a86c", "#8b7355", "#d4a87a", "#a6c4d4",
  "#b8a8d4", "#98d1a8", "#e6c88a", "#9fc5e8", "#f9cb9c"
];
