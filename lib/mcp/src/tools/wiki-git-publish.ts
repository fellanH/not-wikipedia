/**
 * Wiki Git Publish Tool
 *
 * Publishes new or updated articles to the content repository for automatic
 * deployment. Copies the file from dist/wiki to the content repo, commits,
 * and optionally pushes to remote.
 *
 * Architecture:
 *   Source repo (not-wikipedia) → Content repo (wiki-content) → Vercel auto-deploy
 */

import { ToolModule } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { WIKI_DIR, CONTENT_REPO_DIR } from "../config.js";

const execAsync = promisify(exec);

interface PublishInput {
  filename: string;
  commit_message?: string;
  push?: boolean;  // Default: true (for auto-deploy via GitHub)
  sync_all?: boolean;
}

interface PublishResult {
  success: boolean;
  filename: string;
  action: "created" | "updated" | "synced";
  commit_hash?: string;
  pushed: boolean;
  error?: string;
}

/**
 * Execute a git command in the content repo.
 */
async function gitCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`git -C "${CONTENT_REPO_DIR}" ${command}`);
}

/**
 * Check if the content repo exists and is a git repository.
 */
async function validateContentRepo(): Promise<boolean> {
  try {
    await fs.access(path.join(CONTENT_REPO_DIR, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy a single article from source to content repo.
 */
async function copyArticle(filename: string): Promise<"created" | "updated"> {
  const sourcePath = path.join(WIKI_DIR, filename);
  const destPath = path.join(CONTENT_REPO_DIR, "wiki", filename);

  // Ensure pages directory exists
  await fs.mkdir(path.join(CONTENT_REPO_DIR, "wiki"), { recursive: true });

  // Check if file exists in destination
  let action: "created" | "updated";
  try {
    await fs.access(destPath);
    action = "updated";
  } catch {
    action = "created";
  }

  // Copy the file
  await fs.copyFile(sourcePath, destPath);

  return action;
}

/**
 * Recursively copy a directory.
 */
async function copyDirectory(src: string, dest: string): Promise<number> {
  let count = 0;
  try {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        count += await copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
        count++;
      }
    }
  } catch {
    // Directory may not exist, that's ok
  }
  return count;
}

/**
 * Sync all articles from source to content repo.
 */
async function syncAllArticles(): Promise<number> {
  const sourceFiles = await fs.readdir(WIKI_DIR);
  const htmlFiles = sourceFiles.filter(f => f.endsWith(".html"));

  await fs.mkdir(path.join(CONTENT_REPO_DIR, "wiki"), { recursive: true });

  let count = 0;
  for (const file of htmlFiles) {
    const sourcePath = path.join(WIKI_DIR, file);
    const destPath = path.join(CONTENT_REPO_DIR, "wiki", file);
    await fs.copyFile(sourcePath, destPath);
    count++;
  }

  // Sync root files (index.html, styles.css, htmx.min.js, wiki.js)
  const rootFiles = ["index.html", "styles.css", "htmx.min.js", "wiki.js"];
  for (const file of rootFiles) {
    const sourcePath = path.join(WIKI_DIR, "..", file);
    const destPath = path.join(CONTENT_REPO_DIR, file);
    try {
      await fs.copyFile(sourcePath, destPath);
    } catch {
      // File may not exist, that's ok
    }
  }

  // Sync HTMX directories (api/, fragments/, categories/)
  const htmxDirs = ["api", "fragments", "categories"];
  for (const dir of htmxDirs) {
    const srcDir = path.join(WIKI_DIR, "..", dir);
    const destDir = path.join(CONTENT_REPO_DIR, dir);
    count += await copyDirectory(srcDir, destDir);
  }

  return count;
}

/**
 * Main publish function.
 */
async function publishArticle(input: PublishInput): Promise<PublishResult> {
  const { filename, commit_message, push = true, sync_all = false } = input;

  // Validate content repo exists
  if (!(await validateContentRepo())) {
    return {
      success: false,
      filename,
      action: "created",
      pushed: false,
      error: `Content repo not found at ${CONTENT_REPO_DIR}. Run setup first.`,
    };
  }

  try {
    let action: "created" | "updated" | "synced";
    let filesChanged: number;

    if (sync_all) {
      // Sync all articles
      filesChanged = await syncAllArticles();
      action = "synced";
    } else {
      // Copy single article
      const sourcePath = path.join(WIKI_DIR, filename);
      try {
        await fs.access(sourcePath);
      } catch {
        return {
          success: false,
          filename,
          action: "created",
          pushed: false,
          error: `Source file not found: ${sourcePath}`,
        };
      }
      action = await copyArticle(filename);
      filesChanged = 1;
    }

    // Stage changes
    await gitCommand("add -A");

    // Check if there are changes to commit
    const { stdout: statusOut } = await gitCommand("status --porcelain");
    if (!statusOut.trim()) {
      return {
        success: true,
        filename,
        action,
        pushed: false,
        error: "No changes to commit (files already in sync)",
      };
    }

    // Commit
    const message = commit_message ||
      (sync_all
        ? `Sync: ${filesChanged} articles from source`
        : `${action === "created" ? "Add" : "Update"}: ${filename}`);

    await gitCommand(`commit -m "${message.replace(/"/g, '\\"')}"`);

    // Get commit hash
    const { stdout: hashOut } = await gitCommand("rev-parse --short HEAD");
    const commitHash = hashOut.trim();

    // Push if requested
    let pushed = false;
    if (push) {
      try {
        await gitCommand("push origin main");
        pushed = true;
      } catch (pushError) {
        // Push failed, but commit succeeded
        return {
          success: true,
          filename,
          action,
          commit_hash: commitHash,
          pushed: false,
          error: `Committed but push failed: ${pushError instanceof Error ? pushError.message : String(pushError)}`,
        };
      }
    }

    return {
      success: true,
      filename,
      action,
      commit_hash: commitHash,
      pushed,
    };
  } catch (error) {
    return {
      success: false,
      filename,
      action: "created",
      pushed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_git_publish",
    description: `Publish articles to the content repository for automatic Vercel deployment. Copies files from the source wiki directory to the content repo, commits changes, and optionally pushes to remote. Use sync_all=true to sync all articles at once.`,
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Article filename to publish (e.g., 'semantic-drift.html'). Ignored if sync_all is true.",
        },
        commit_message: {
          type: "string",
          description: "Custom commit message. If not provided, auto-generates based on action.",
        },
        push: {
          type: "boolean",
          description: "Push to remote after commit (default: true). Triggers Vercel auto-deploy via GitHub.",
        },
        sync_all: {
          type: "boolean",
          description: "Sync all articles instead of just one (default: false).",
        },
      },
      required: [],
    },
  },

  handler: async (args) => {
    const input: PublishInput = {
      filename: (args.filename as string) || "",
      commit_message: args.commit_message as string | undefined,
      push: args.push as boolean | undefined,
      sync_all: args.sync_all as boolean | undefined,
    };

    // Validate input
    if (!input.sync_all && !input.filename) {
      return {
        content: [{
          type: "text",
          text: "Error: Either filename or sync_all=true is required.",
        }],
        isError: true,
      };
    }

    const result = await publishArticle(input);

    // Format output
    const lines: string[] = [];
    if (result.success) {
      lines.push(`## Publish ${result.action === "synced" ? "Sync" : "Result"}: Success`);
      lines.push("");
      if (result.action === "synced") {
        lines.push(`- **Action:** Synced all articles`);
      } else {
        lines.push(`- **File:** ${result.filename}`);
        lines.push(`- **Action:** ${result.action}`);
      }
      if (result.commit_hash) {
        lines.push(`- **Commit:** ${result.commit_hash}`);
      }
      lines.push(`- **Pushed:** ${result.pushed ? "Yes" : "No"}`);
      if (result.error) {
        lines.push(`- **Note:** ${result.error}`);
      }
    } else {
      lines.push(`## Publish Result: Failed`);
      lines.push("");
      lines.push(`- **Error:** ${result.error}`);
    }

    return {
      content: [{
        type: "text",
        text: lines.join("\n"),
      }],
      isError: !result.success,
    };
  },
};
