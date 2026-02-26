/**
 * Unit Tests for wiki-next-task.ts
 *
 * Tests task priority ordering, human seed fallback behavior, and task claiming logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import * as fs from "fs/promises";
import * as crypto from "crypto";

// Mock modules before importing the tool
vi.mock("../../db/database.js", () => ({
  getArticleCount: vi.fn(),
  getBrokenLinks: vi.fn(),
  getAvailableBrokenLinks: vi.fn(),
  getOrphanArticles: vi.fn(),
  getAvailableOrphanArticles: vi.fn(),
  claimTask: vi.fn(),
  cleanupStaleTasks: vi.fn(),
  getClaimedTaskFilenames: vi.fn(),
}));

vi.mock("../../config.js", () => ({
  WIKI_DIR: "/mock/wiki",
  META_DIR: "/mock/meta",
  INFOBOX_COLORS: ["#7b9e89", "#c9a86c", "#8b7355"],
}));

vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

// Import after mocks
import { tool } from "../../tools/wiki-next-task.js";
import * as db from "../../db/database.js";

describe("wiki-next-task", () => {
  // Store original fetch
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    (db.getArticleCount as Mock).mockReturnValue(10);
    (db.getBrokenLinks as Mock).mockReturnValue([]);
    (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
    (db.getOrphanArticles as Mock).mockReturnValue([]);
    (db.getAvailableOrphanArticles as Mock).mockReturnValue([]);
    (db.claimTask as Mock).mockReturnValue(true);
    (db.cleanupStaleTasks as Mock).mockReturnValue(0);
    (db.getClaimedTaskFilenames as Mock).mockReturnValue([]);

    // Mock fs operations
    (fs.readdir as Mock).mockResolvedValue([]);
    (fs.readFile as Mock).mockResolvedValue("");

    // Mock crypto.randomBytes to be deterministic
    vi.spyOn(crypto, "randomBytes").mockImplementation((size: number) => {
      return Buffer.alloc(size, 0x42);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("task priority", () => {
    it("prioritizes live 404s over broken links", async () => {
      // Setup: both live 404s (via crawl) and broken links exist
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([
        { target: "broken-link.html", sources: ["article1.html"] },
      ]);

      // Mock fetch for live 404 crawl - simulate finding a 404
      let fetchCallCount = 0;
      global.fetch = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
        fetchCallCount++;
        if (url === "https://not-wikipedia.org/") {
          return {
            ok: true,
            text: async () => '<a href="./wiki/missing-page.html">Link</a>',
          };
        }
        if (options?.method === "HEAD") {
          // Simulate 404 for missing-page.html
          return { status: 404, ok: false };
        }
        return { ok: false };
      }) as Mock;

      const result = await tool.handler({ use_live_crawl: true, max_crawl_pages: 5 });
      const task = JSON.parse(result.content[0].text);

      expect(task.taskType).toBe("create_from_live_404");
      expect(task.priority).toBe("critical");
    });

    it("prioritizes broken links over placeholders", async () => {
      // Setup: broken links and placeholders exist
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([
        { target: "missing-article.html", sources: ["source1.html", "source2.html"] },
      ]);

      // Mock files with placeholders
      (fs.readdir as Mock).mockResolvedValue(["placeholder-article.html"]);
      (fs.readFile as Mock).mockResolvedValue("content with NEXT_PAGE_PLACEHOLDER marker");

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      expect(task.taskType).toBe("repair_broken_link");
      expect(task.priority).toBe("critical");
      expect(task.topic.filename).toBe("missing-article.html");
    });

    it("prioritizes placeholders over orphans", async () => {
      // Setup: no broken links, but placeholders and orphans exist
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (db.getAvailableOrphanArticles as Mock).mockReturnValue(["orphan-article.html"]);

      // Mock files with placeholders
      (fs.readdir as Mock).mockResolvedValue(["has-placeholder.html"]);
      (fs.readFile as Mock).mockResolvedValue("content with NEXT_PAGE_PLACEHOLDER here");

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      expect(task.taskType).toBe("resolve_placeholder");
      expect(task.priority).toBe("high");
      expect(task.topic.filename).toBe("has-placeholder.html");
    });

    it("prioritizes orphans over new content", async () => {
      // Setup: only orphans exist
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (db.getAvailableOrphanArticles as Mock).mockReturnValue(["lonely-article.html"]);

      // Mock no placeholders
      (fs.readdir as Mock).mockResolvedValue(["lonely-article.html"]);
      (fs.readFile as Mock).mockResolvedValue("content without placeholder");

      // Mock fetch for human seed to ensure fallback
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      expect(task.taskType).toBe("fix_orphan");
      expect(task.priority).toBe("medium");
      expect(task.topic.filename).toBe("lonely-article.html");
    });

    it("falls back to create_new when ecosystem is healthy", async () => {
      // Setup: no issues to fix
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (db.getAvailableOrphanArticles as Mock).mockReturnValue([]);
      (fs.readdir as Mock).mockResolvedValue(["existing.html"]);
      (fs.readFile as Mock).mockResolvedValue("normal content");

      // Mock fetch for human seed
      global.fetch = vi.fn().mockRejectedValue(new Error("API unavailable"));

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      expect(task.taskType).toBe("create_new");
      expect(task.priority).toBe("low");
      expect(task.humanSeed).toBeDefined();
    });

    it("returns correct ecosystemStats in every response", async () => {
      (db.getArticleCount as Mock).mockReturnValue(42);
      (db.getBrokenLinks as Mock).mockReturnValue([
        { target: "a.html", sources: ["b.html"] },
        { target: "c.html", sources: ["d.html"] },
      ]);
      (db.getOrphanArticles as Mock).mockReturnValue(["x.html", "y.html", "z.html"]);

      (fs.readdir as Mock).mockResolvedValue(["p1.html", "p2.html"]);
      (fs.readFile as Mock).mockImplementation(async (path: string) => {
        if (path.includes("p1")) return "NEXT_PAGE_PLACEHOLDER";
        return "normal";
      });

      // Mock fetch
      global.fetch = vi.fn().mockRejectedValue(new Error("API unavailable"));

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      expect(task.ecosystemStats.totalArticles).toBe(42);
      expect(task.ecosystemStats.brokenLinks).toBe(2);
      expect(task.ecosystemStats.orphans).toBe(3);
      expect(task.ecosystemStats.placeholders).toBe(1);
    });
  });

  describe("human seed", () => {
    it("fetches from Quotable API when available", async () => {
      // Setup for create_new task
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (db.getAvailableOrphanArticles as Mock).mockReturnValue([]);
      (fs.readdir as Mock).mockResolvedValue([]);

      // Mock successful API response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: "The only way to do great work is to love what you do.",
          author: "Steve Jobs",
        }),
      });

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      expect(task.humanSeed.type).toBe("quote");
      expect(task.humanSeed.text).toBe("The only way to do great work is to love what you do.");
      expect(task.humanSeed.source).toBe("Steve Jobs");
    });

    it("falls back to local corpus on API timeout", async () => {
      // Setup for create_new task
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (db.getAvailableOrphanArticles as Mock).mockReturnValue([]);
      (fs.readdir as Mock).mockResolvedValue([]);

      // Mock API timeout via abort
      global.fetch = vi.fn().mockImplementation(() => {
        const error = new Error("Aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      });

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      expect(task.humanSeed.type).toBe("fallback");
      expect(task.humanSeed.text).toBeTruthy();
      expect(task.humanSeed.source).toBeTruthy();
    });

    it("falls back to local corpus on API error", async () => {
      // Setup for create_new task
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (db.getAvailableOrphanArticles as Mock).mockReturnValue([]);
      (fs.readdir as Mock).mockResolvedValue([]);

      // Mock API returning non-ok response
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      expect(task.humanSeed.type).toBe("fallback");
    });

    it("uses secure random selection for fallback", async () => {
      // Setup for create_new task
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (db.getAvailableOrphanArticles as Mock).mockReturnValue([]);
      (fs.readdir as Mock).mockResolvedValue([]);

      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      // Call multiple times and verify randomBytes was used
      await tool.handler({});

      // crypto.randomBytes should have been called for random selection
      expect(crypto.randomBytes).toHaveBeenCalled();
    });

    it("only includes humanSeed for create_new tasks", async () => {
      // Setup: broken link exists
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([
        { target: "missing.html", sources: ["source.html"] },
      ]);

      global.fetch = vi.fn().mockRejectedValue(new Error("Should not be called"));

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      expect(task.taskType).toBe("repair_broken_link");
      expect(task.humanSeed).toBeUndefined();
    });
  });

  describe("task claiming", () => {
    it("marks task as claimed in database", async () => {
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([
        { target: "to-claim.html", sources: ["ref.html"] },
      ]);

      await tool.handler({});

      expect(db.claimTask).toHaveBeenCalledWith(
        "repair_broken_link",
        "to-claim.html",
        expect.stringMatching(/^worker-/)
      );
    });

    it("prevents duplicate claims by returning false from claimTask", async () => {
      // Setup multiple broken links
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([
        { target: "first.html", sources: ["a.html"] },
        { target: "second.html", sources: ["b.html"] },
      ]);

      // First claim fails, second succeeds
      (db.claimTask as Mock)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      // Should have tried to claim at least 2 tasks
      expect(db.claimTask).toHaveBeenCalledTimes(2);
      expect(task.taskType).toBe("repair_broken_link");
    });

    it("handles concurrent claim attempts by trying multiple items", async () => {
      // Setup multiple broken links
      const brokenLinks = [
        { target: "contested1.html", sources: ["a.html"] },
        { target: "contested2.html", sources: ["b.html"] },
        { target: "available.html", sources: ["c.html"] },
      ];
      (db.getAvailableBrokenLinks as Mock).mockReturnValue(brokenLinks);

      // First two claims fail (contested by other workers), third succeeds
      (db.claimTask as Mock)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      expect(task.taskType).toBe("repair_broken_link");
      // Should have attempted claims on multiple items
      expect((db.claimTask as Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("falls through to next priority when all items are claimed", async () => {
      // Setup broken links that all fail to claim
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([
        { target: "claimed1.html", sources: ["a.html"] },
      ]);
      (db.getAvailableOrphanArticles as Mock).mockReturnValue(["orphan.html"]);

      // First claim for broken link fails
      (db.claimTask as Mock)
        .mockReturnValueOnce(false) // broken link claim fails
        .mockReturnValueOnce(true); // orphan claim succeeds

      (fs.readdir as Mock).mockResolvedValue([]);

      global.fetch = vi.fn().mockRejectedValue(new Error("API unavailable"));

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      // Should have fallen through to orphans
      expect(task.taskType).toBe("fix_orphan");
    });

    it("cleans up stale task assignments on startup", async () => {
      (db.cleanupStaleTasks as Mock).mockReturnValue(3);
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (fs.readdir as Mock).mockResolvedValue([]);

      global.fetch = vi.fn().mockRejectedValue(new Error("API unavailable"));

      await tool.handler({});

      expect(db.cleanupStaleTasks).toHaveBeenCalledWith(30);
    });

    it("excludes claimed filenames from placeholder selection", async () => {
      // Setup: one placeholder file, but it's already claimed
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (db.getClaimedTaskFilenames as Mock).mockReturnValue(["placeholder.html"]);
      (db.getAvailableOrphanArticles as Mock).mockReturnValue([]);

      (fs.readdir as Mock).mockResolvedValue(["placeholder.html"]);
      (fs.readFile as Mock).mockResolvedValue("NEXT_PAGE_PLACEHOLDER content");

      global.fetch = vi.fn().mockRejectedValue(new Error("API unavailable"));

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      // Should skip to create_new since the only placeholder is claimed
      expect(task.taskType).toBe("create_new");
    });

    it("claims create_new tasks with unique filename", async () => {
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (db.getAvailableOrphanArticles as Mock).mockReturnValue([]);
      (fs.readdir as Mock).mockResolvedValue([]);

      global.fetch = vi.fn().mockRejectedValue(new Error("API unavailable"));

      await tool.handler({});

      // Should claim with a unique generated filename
      expect(db.claimTask).toHaveBeenCalledWith(
        "create_new",
        expect.stringMatching(/^new-content-[a-f0-9]+\.html$/),
        expect.stringMatching(/^worker-/)
      );
    });
  });

  describe("infobox color selection", () => {
    it("selects from available colors not yet used", async () => {
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (fs.readdir as Mock).mockResolvedValue(["article1.html", "article2.html"]);
      (fs.readFile as Mock).mockImplementation(async (path: string) => {
        if (path.includes("article1")) {
          return 'background-color: #7b9e89;';
        }
        if (path.includes("article2")) {
          return 'background-color: #c9a86c;';
        }
        return "";
      });

      global.fetch = vi.fn().mockRejectedValue(new Error("API unavailable"));

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      // Should pick the third color since first two are used
      expect(task.infoboxColor).toBe("#8b7355");
    });
  });

  describe("tool interface", () => {
    it("returns valid tool definition", () => {
      expect(tool.definition.name).toBe("wiki_next_task");
      expect(tool.definition.inputSchema.type).toBe("object");
      expect(tool.definition.inputSchema.properties).toHaveProperty("use_live_crawl");
      expect(tool.definition.inputSchema.properties).toHaveProperty("max_crawl_pages");
    });

    it("handler returns properly formatted MCP response", async () => {
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (fs.readdir as Mock).mockResolvedValue([]);
      global.fetch = vi.fn().mockRejectedValue(new Error("API unavailable"));

      const result = await tool.handler({});

      expect(result).toHaveProperty("content");
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toHaveProperty("type", "text");
      expect(result.content[0]).toHaveProperty("text");

      // Verify the text is valid JSON
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("taskType");
      expect(parsed).toHaveProperty("priority");
      expect(parsed).toHaveProperty("topic");
      expect(parsed).toHaveProperty("randomSeed");
      expect(parsed).toHaveProperty("ecosystemStats");
    });

    it("accepts use_live_crawl and max_crawl_pages arguments", async () => {
      // Mock minimal crawl that returns no 404s
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === "https://not-wikipedia.org/") {
          return { ok: true, text: async () => "<html></html>" };
        }
        return { ok: false };
      });

      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (fs.readdir as Mock).mockResolvedValue([]);

      const result = await tool.handler({
        use_live_crawl: true,
        max_crawl_pages: 10,
      });

      // Should work without errors
      expect(result.content[0].text).toBeTruthy();
    });
  });

  describe("error handling", () => {
    it("continues with partial state when file operations fail", async () => {
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([]);
      (fs.readdir as Mock).mockRejectedValue(new Error("Permission denied"));

      global.fetch = vi.fn().mockRejectedValue(new Error("API unavailable"));

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      // Should still return a valid task
      expect(task.taskType).toBe("create_new");
      expect(task.ecosystemStats.placeholders).toBe(0);
    });

    it("handles empty broken links sources gracefully", async () => {
      // Edge case: broken link with empty sources (shouldn't happen, but defensive)
      (db.getAvailableBrokenLinks as Mock).mockReturnValue([
        { target: "orphaned-link.html", sources: [] },
      ]);

      const result = await tool.handler({});
      const task = JSON.parse(result.content[0].text);

      expect(task.taskType).toBe("repair_broken_link");
      expect(task.topic.context).toContain("0 article(s)");
    });
  });
});
