/**
 * Unit Tests for wiki-git-publish.ts
 *
 * Tests git command construction, commit message generation,
 * push error handling, and execAsync mocking for isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import * as fs from "fs/promises";

// Use vi.hoisted to create mock function available during hoisting
const { mockExecAsync } = vi.hoisted(() => {
  return { mockExecAsync: vi.fn() };
});

// Mock modules before importing the tool
vi.mock("../../config.js", () => ({
  CONTENT_REPO_DIR: "/mock/wiki-content",
}));

vi.mock("fs/promises", () => ({
  access: vi.fn(),
}));

// Mock util.promisify to return our mock exec function
vi.mock("util", async (importOriginal) => {
  const original = await importOriginal<typeof import("util")>();
  return {
    ...original,
    promisify: vi.fn(() => mockExecAsync),
  };
});

// Import after mocks
import { tool } from "../../tools/wiki-git-publish.js";

describe("wiki-git-publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default: content repo exists
    (fs.access as Mock).mockResolvedValue(undefined);

    // Default: git commands succeed
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("content repo validation", () => {
    it("returns error when content repo does not exist", async () => {
      (fs.access as Mock).mockRejectedValue(new Error("ENOENT"));

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed");
      expect(result.content[0].text).toContain("Content repo not found");
    });

    it("checks for .git directory in content repo", async () => {
      (fs.access as Mock).mockRejectedValue(new Error("ENOENT"));

      await tool.handler({});

      expect(fs.access).toHaveBeenCalledWith("/mock/wiki-content/.git");
    });
  });

  describe("commit operations", () => {
    it("stages all changes in wiki directory", async () => {
      // Return staged changes
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      await tool.handler({});

      // First call should be staging
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git -C "/mock/wiki-content" add -A')
      );
    });

    it("generates descriptive commit message with file count", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/a.html\nM wiki/b.html\nA wiki/c.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      await tool.handler({});

      // Commit should include auto-generated message with file count
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('commit -m "Update: 3 file(s) changed"')
      );
    });

    it("uses custom commit message when provided", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "def5678\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      await tool.handler({ commit_message: "Custom commit message" });

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('commit -m "Custom commit message"')
      );
    });

    it("handles empty commits gracefully", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git status (empty = no changes)

      const result = await tool.handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("No Changes");
      expect(result.content[0].text).toContain("No changes to commit");
    });

    it("escapes double quotes in commit message", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      await tool.handler({ commit_message: 'Message with "quotes"' });

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('commit -m "Message with \\"quotes\\""')
      );
    });

    it("reports commit hash on success", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      const result = await tool.handler({});

      expect(result.content[0].text).toContain("abc1234");
    });
  });

  describe("push operations", () => {
    it("pushes to origin on success", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      await tool.handler({});

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git -C "/mock/wiki-content" push origin main')
      );
    });

    it("handles push failures gracefully after retries", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockRejectedValueOnce(new Error("Permission denied (publickey)")) // git push fails attempt 1
        .mockRejectedValueOnce(new Error("Permission denied (publickey)")) // git push fails attempt 2
        .mockRejectedValueOnce(new Error("Permission denied (publickey)")); // git push fails attempt 3

      const resultPromise = tool.handler({});

      // Advance timers to allow retries
      await vi.advanceTimersByTimeAsync(2000); // First retry delay (2s)
      await vi.advanceTimersByTimeAsync(4000); // Second retry delay (4s)

      const result = await resultPromise;

      // Should still report success (commit worked)
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Success");
      expect(result.content[0].text).toContain("Pushed:** No (failed after 3 attempts)");
    });

    it("reports partial success (commit ok, push failed after retries)", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "def5678\n", stderr: "" }) // git rev-parse
        .mockRejectedValueOnce(new Error("remote rejected")) // git push fails attempt 1
        .mockRejectedValueOnce(new Error("remote rejected")) // git push fails attempt 2
        .mockRejectedValueOnce(new Error("remote rejected")); // git push fails attempt 3

      const resultPromise = tool.handler({});

      // Advance timers to allow retries
      await vi.advanceTimersByTimeAsync(2000); // First retry delay (2s)
      await vi.advanceTimersByTimeAsync(4000); // Second retry delay (4s)

      const result = await resultPromise;

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("def5678");
      expect(result.content[0].text).toContain("Pushed:** No");
    });

    it("handles non-Error push failure after retries", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockRejectedValueOnce("string push error") // git push fails attempt 1
        .mockRejectedValueOnce("string push error") // git push fails attempt 2
        .mockRejectedValueOnce("string push error"); // git push fails attempt 3

      const resultPromise = tool.handler({});

      // Advance timers to allow retries
      await vi.advanceTimersByTimeAsync(2000); // First retry delay (2s)
      await vi.advanceTimersByTimeAsync(4000); // Second retry delay (4s)

      const result = await resultPromise;

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Success");
      expect(result.content[0].text).toContain("Pushed:** No");
    });

    it("retries push on failure and succeeds on second attempt", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockRejectedValueOnce(new Error("Temporary network error")) // git push fails attempt 1
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push succeeds attempt 2

      const resultPromise = tool.handler({});

      // Advance timers to allow first retry
      await vi.advanceTimersByTimeAsync(2000); // First retry delay (2s)

      const result = await resultPromise;

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Pushed:** Yes");
      expect(result.content[0].text).toContain("after 2 attempts");
    });

    it("retries push on failure and succeeds on third attempt", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockRejectedValueOnce(new Error("Temporary network error")) // git push fails attempt 1
        .mockRejectedValueOnce(new Error("Temporary network error")) // git push fails attempt 2
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push succeeds attempt 3

      const resultPromise = tool.handler({});

      // Advance timers to allow retries
      await vi.advanceTimersByTimeAsync(2000); // First retry delay (2s)
      await vi.advanceTimersByTimeAsync(4000); // Second retry delay (4s)

      const result = await resultPromise;

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Pushed:** Yes");
      expect(result.content[0].text).toContain("after 3 attempts");
    });

    it("does not show retry count when push succeeds on first attempt", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push succeeds

      const result = await tool.handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Pushed:** Yes");
      expect(result.content[0].text).not.toContain("after");
    });

    it("skips push when push=false", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }); // git rev-parse

      const result = await tool.handler({ push: false });

      // Should not attempt push
      expect(mockExecAsync).toHaveBeenCalledTimes(4);
      expect(mockExecAsync).not.toHaveBeenCalledWith(
        expect.stringContaining("push")
      );

      expect(result.content[0].text).toContain("Pushed:** No");
    });

    it("reports pushed status when successful", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Pushed:** Yes");
      expect(result.content[0].text).toContain("Vercel deploy triggered");
    });
  });

  describe("error handling", () => {
    it("handles git add failure", async () => {
      mockExecAsync.mockRejectedValueOnce(new Error("fatal: not a git repository"));

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed");
      expect(result.content[0].text).toContain("not a git repository");
    });

    it("handles git status failure", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockRejectedValueOnce(new Error("status command failed")); // git status fails

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("status command failed");
    });

    it("handles git commit failure", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockRejectedValueOnce(new Error("commit failed: author identity unknown")); // git commit fails

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("author identity unknown");
    });

    it("handles non-Error exceptions", async () => {
      mockExecAsync.mockRejectedValueOnce("string error");

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("string error");
    });
  });

  describe("tool interface", () => {
    it("returns valid tool definition", () => {
      expect(tool.definition.name).toBe("wiki_git_publish");
      expect(tool.definition.inputSchema.type).toBe("object");
    });

    it("defines expected input properties", () => {
      const props = tool.definition.inputSchema.properties;

      expect(props).toHaveProperty("commit_message");
      expect(props).toHaveProperty("push");
    });

    it("has no required parameters", () => {
      expect(tool.definition.inputSchema.required).toEqual([]);
    });

    it("handler returns properly formatted MCP response", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      const result = await tool.handler({});

      expect(result).toHaveProperty("content");
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toHaveProperty("type", "text");
      expect(result.content[0]).toHaveProperty("text");
    });

    it("returns isError=true on failure", async () => {
      (fs.access as Mock).mockRejectedValue(new Error("ENOENT"));

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
    });

    it("returns isError=false on success", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      const result = await tool.handler({});

      expect(result.isError).toBeFalsy();
    });
  });

  describe("git command construction", () => {
    it("uses correct content repo path for all commands", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      await tool.handler({});

      // All git commands should use -C flag with content repo path
      const calls = mockExecAsync.mock.calls;
      expect(calls[0][0]).toContain('git -C "/mock/wiki-content"');
      expect(calls[1][0]).toContain('git -C "/mock/wiki-content"');
      expect(calls[2][0]).toContain('git -C "/mock/wiki-content"');
      expect(calls[3][0]).toContain('git -C "/mock/wiki-content"');
      expect(calls[4][0]).toContain('git -C "/mock/wiki-content"');
    });

    it("runs git status --porcelain to check for changes", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git status (empty)

      await tool.handler({});

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining("status --porcelain")
      );
    });

    it("runs git rev-parse --short HEAD to get commit hash", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      await tool.handler({});

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining("rev-parse --short HEAD")
      );
    });
  });

  describe("files changed counting", () => {
    it("counts single file correctly", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/article.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Files Changed:** 1");
    });

    it("counts multiple files correctly", async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M wiki/a.html\nA wiki/b.html\nD wiki/c.html\n", stderr: "" }) // git status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git commit
        .mockResolvedValueOnce({ stdout: "abc1234\n", stderr: "" }) // git rev-parse
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push

      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Files Changed:** 3");
    });
  });
});
