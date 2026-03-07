/**
 * Wiki Git Publish Tool
 *
 * Commits and pushes changes in the wiki-content repository for automatic
 * Vercel deployment. Since wiki-content is now the source of truth,
 * this tool just handles git operations (no file copying needed).
 *
 * Architecture:
 *   wiki-content (source of truth) → GitHub → Vercel auto-deploy
 */

import { ToolModule } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { CONTENT_REPO_DIR } from "../config.js";

const execAsync = promisify(exec);

interface PublishInput {
  commit_message?: string;
  push?: boolean; // Default: true (for auto-deploy via GitHub)
}

interface PublishResult {
  success: boolean;
  action: "committed" | "no_changes";
  commit_hash?: string;
  pushed: boolean;
  files_changed?: number;
  push_attempts?: number;
  error?: string;
}

/**
 * Execute a git command in the content repo.
 */
async function gitCommand(
  command: string,
): Promise<{ stdout: string; stderr: string }> {
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
 * Push with retry and exponential backoff.
 * Returns { success, attempts } where attempts is the number of tries made.
 */
async function pushWithRetry(
  maxAttempts = 3,
): Promise<{ success: boolean; attempts: number; error?: string }> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await gitCommand("push origin main");
      return { success: true, attempts: attempt };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);

      if (attempt === maxAttempts) {
        console.error(
          `Push failed after ${maxAttempts} attempts: ${lastError}`,
        );
        return { success: false, attempts: attempt, error: lastError };
      }

      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      console.log(
        `Push attempt ${attempt} failed, retrying in ${delay / 1000}s...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { success: false, attempts: maxAttempts, error: lastError };
}

/**
 * Main publish function.
 */
async function publishChanges(input: PublishInput): Promise<PublishResult> {
  const { commit_message, push = true } = input;

  // Validate content repo exists
  if (!(await validateContentRepo())) {
    return {
      success: false,
      action: "no_changes",
      pushed: false,
      error: `Content repo not found at ${CONTENT_REPO_DIR}. Ensure wiki-content is cloned as a sibling directory.`,
    };
  }

  try {
    // Stage all changes
    await gitCommand("add -A");

    // Check if there are changes to commit
    const { stdout: statusOut } = await gitCommand("status --porcelain");
    if (!statusOut.trim()) {
      return {
        success: true,
        action: "no_changes",
        pushed: false,
        error: "No changes to commit",
      };
    }

    // Count changed files
    const filesChanged = statusOut.trim().split("\n").length;

    // Commit
    const message = commit_message || `Update: ${filesChanged} file(s) changed`;
    await gitCommand(`commit -m "${message.replace(/"/g, '\\"')}"`);

    // Get commit hash
    const { stdout: hashOut } = await gitCommand("rev-parse --short HEAD");
    const commitHash = hashOut.trim();

    // Push if requested (with retry logic)
    let pushed = false;
    let pushAttempts: number | undefined;
    if (push) {
      const pushResult = await pushWithRetry(3);
      pushed = pushResult.success;
      pushAttempts = pushResult.attempts;

      if (!pushResult.success) {
        // Push failed after all retries, but commit succeeded
        return {
          success: true,
          action: "committed",
          commit_hash: commitHash,
          files_changed: filesChanged,
          pushed: false,
          push_attempts: pushAttempts,
          error: `Committed but push failed after ${pushAttempts} attempts: ${pushResult.error}`,
        };
      }
    }

    return {
      success: true,
      action: "committed",
      commit_hash: commitHash,
      files_changed: filesChanged,
      pushed,
      push_attempts: pushAttempts,
    };
  } catch (error) {
    return {
      success: false,
      action: "no_changes",
      pushed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const tool: ToolModule = {
  definition: {
    name: "wiki_git_publish",
    description: `Commit and push changes in the wiki-content repository for automatic Vercel deployment. Since wiki-content is the source of truth, articles are written directly there - this tool just handles git commit/push.`,
    inputSchema: {
      type: "object",
      properties: {
        commit_message: {
          type: "string",
          description:
            "Custom commit message. If not provided, auto-generates based on changed files.",
        },
        push: {
          type: "boolean",
          description:
            "Push to remote after commit (default: true). Triggers Vercel auto-deploy via GitHub.",
        },
      },
      required: [],
    },
  },

  handler: async (args) => {
    const input: PublishInput = {
      commit_message: args.commit_message as string | undefined,
      push: args.push as boolean | undefined,
    };

    const result = await publishChanges(input);

    // Format output
    const lines: string[] = [];
    if (result.success) {
      if (result.action === "committed") {
        lines.push(`## Publish Result: Success`);
        lines.push("");
        lines.push(`- **Files Changed:** ${result.files_changed}`);
        lines.push(`- **Commit:** ${result.commit_hash}`);
        let pushStatus: string;
        if (result.pushed) {
          pushStatus = `Yes (Vercel deploy triggered)${result.push_attempts && result.push_attempts > 1 ? ` after ${result.push_attempts} attempts` : ""}`;
        } else if (result.push_attempts && result.push_attempts > 0) {
          pushStatus = `No (failed after ${result.push_attempts} attempts)`;
        } else {
          pushStatus = "No";
        }
        lines.push(`- **Pushed:** ${pushStatus}`);
      } else {
        lines.push(`## Publish Result: No Changes`);
        lines.push("");
        lines.push(`- **Note:** ${result.error}`);
      }
    } else {
      lines.push(`## Publish Result: Failed`);
      lines.push("");
      lines.push(`- **Error:** ${result.error}`);
    }

    return {
      content: [
        {
          type: "text",
          text: lines.join("\n"),
        },
      ],
      isError: !result.success,
    };
  },
};
