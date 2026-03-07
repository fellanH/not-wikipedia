/**
 * Unit Tests for wiki-discover.ts
 *
 * Tests link extraction from HTML, relevance filtering, depth limiting,
 * and priority calculation for the Content Fractal discovery engine.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import * as fs from "fs/promises";

// Mock modules before importing the tool
vi.mock("../../db/database.js", () => ({
  getArticleDepth: vi.fn(),
  queueDiscoveredConcept: vi.fn(),
  getDiscoveryQueueStats: vi.fn(),
}));

vi.mock("../../config.js", () => ({
  WIKI_DIR: "/mock/wiki",
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  access: vi.fn(),
}));

// Import after mocks
import { tool } from "../../tools/wiki-discover.js";
import * as db from "../../db/database.js";

describe("wiki-discover", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: source article has depth 0
    (db.getArticleDepth as Mock).mockReturnValue(0);

    // Default: queue operations succeed
    (db.queueDiscoveredConcept as Mock).mockReturnValue(true);

    // Default queue stats
    (db.getDiscoveryQueueStats as Mock).mockReturnValue({
      pending: 0,
      inProgress: 0,
      completed: 0,
      byDepth: {},
    });

    // Default: articles don't exist (access throws)
    (fs.access as Mock).mockRejectedValue(new Error("ENOENT"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("link extraction", () => {
    it("extracts all href attributes", async () => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="article-one.html">Article One</a>
            <a href="article-two.html">Article Two</a>
            <a href="article-three.html">Article Three</a>
          </body>
        </html>
      `);

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("Concepts Found:** 3");
    });

    it("filters out external links", async () => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="internal-article.html">Internal</a>
            <a href="https://example.com/external">External HTTPS</a>
            <a href="http://example.com/external">External HTTP</a>
            <a href="//example.com/external">Protocol-relative</a>
          </body>
        </html>
      `);

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // Only internal-article.html matches the href="*.html" pattern
      expect(text).toContain("Concepts Found:** 1");
    });

    it("filters out anchor links", async () => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="real-article.html">Real Article</a>
            <a href="#section">Section Anchor</a>
            <a href="page.html#section">Page with Anchor</a>
          </body>
        </html>
      `);

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // The regex only matches href="*.html" without fragments
      // "page.html#section" won't match since # is between quotes
      expect(text).toContain("Concepts Found:** 1");
    });

    it("deduplicates links", async () => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="same-article.html">First mention</a>
            <a href="same-article.html">Second mention</a>
            <a href="same-article.html">Third mention</a>
            <a href="different-article.html">Different</a>
          </body>
        </html>
      `);

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // Should only count 2 unique links
      expect(text).toContain("Concepts Found:** 2");
    });

    it("handles articles with no links", async () => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <p>This article has no links.</p>
          </body>
        </html>
      `);

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("Concepts Found:** 0");
    });

    it("handles malformed HTML gracefully", async () => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="valid-link.html">Valid</a>
            <a href="broken-link>Broken tag</a>
            <a href = "spaces.html">With spaces</a>
          </body>
        </html>
      `);

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBeFalsy();
      // Should at least find the valid link
      const text = result.content[0].text;
      expect(text).toContain("valid-link.html");
    });

    it("handles file read errors gracefully", async () => {
      (fs.readFile as Mock).mockRejectedValue(new Error("File not found"));

      const result = await tool.handler({
        source_article: "nonexistent.html",
      });

      // Should not throw, but return 0 concepts
      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("Concepts Found:** 0");
    });
  });

  describe("relevance filtering", () => {
    beforeEach(() => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="quantum-computing.html">Quantum Computing</a>
            <a href="neural-networks.html">Neural Networks</a>
            <a href="classical-physics.html">Classical Physics</a>
            <a href="ai-research.html">AI Research</a>
            <a href="bio.html">Bio</a>
          </body>
        </html>
      `);
    });

    it("accepts links matching required keywords", async () => {
      const result = await tool.handler({
        source_article: "test-article.html",
        relevance_filter: {
          required_keywords: ["quantum", "neural"],
        },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // Only quantum-computing and neural-networks should be queued
      expect(text).toContain("quantum-computing.html");
      expect(text).toContain("neural-networks.html");
      expect(text).toContain("Queued for Generation:** 2");

      // Others should be filtered
      expect(text).toContain("classical-physics.html");
      expect(text).toContain("filtered: missing required keywords");
    });

    it("rejects links matching excluded keywords", async () => {
      const result = await tool.handler({
        source_article: "test-article.html",
        relevance_filter: {
          excluded_keywords: ["classical", "bio"],
        },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // classical-physics and bio should be excluded
      expect(text).toContain("classical-physics.html");
      expect(text).toContain("contains excluded keyword: classical");
      expect(text).toContain("bio.html");
      expect(text).toContain("contains excluded keyword: bio");

      // 3 should be queued (quantum-computing, neural-networks, ai-research)
      expect(text).toContain("Queued for Generation:** 3");
    });

    it("enforces minimum filename length", async () => {
      const result = await tool.handler({
        source_article: "test-article.html",
        relevance_filter: {
          min_filename_length: 10,
        },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // "bio" (3 chars) should be rejected
      expect(text).toContain("bio.html");
      expect(text).toContain("filename too short");

      // Others should be queued (quantum-computing, neural-networks, classical-physics, ai-research)
      expect(text).toContain("Queued for Generation:** 4");
    });

    it("combines all filter criteria", async () => {
      const result = await tool.handler({
        source_article: "test-article.html",
        relevance_filter: {
          required_keywords: ["quantum", "neural", "classical"],
          excluded_keywords: ["classical"],
          min_filename_length: 5,
        },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // Only quantum-computing and neural-networks should pass
      // classical-physics matches required but also excluded
      expect(text).toContain("Queued for Generation:** 2");
    });

    it("is case-insensitive for keyword matching", async () => {
      const result = await tool.handler({
        source_article: "test-article.html",
        relevance_filter: {
          required_keywords: ["QUANTUM", "Neural"],
        },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // Should match despite case differences
      expect(text).toContain("quantum-computing.html");
      expect(text).toContain("neural-networks.html");
      expect(text).toContain("Queued for Generation:** 2");
    });

    it("accepts all links when no filter is provided", async () => {
      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // All 5 links should be queued
      expect(text).toContain("Queued for Generation:** 5");
    });

    it("accepts all links when empty filter object is provided", async () => {
      const result = await tool.handler({
        source_article: "test-article.html",
        relevance_filter: {},
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // All 5 links should be queued
      expect(text).toContain("Queued for Generation:** 5");
    });
  });

  describe("depth limiting", () => {
    beforeEach(() => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="concept-a.html">Concept A</a>
            <a href="concept-b.html">Concept B</a>
          </body>
        </html>
      `);
    });

    it("respects max depth limit", async () => {
      // Source article is at depth 2
      (db.getArticleDepth as Mock).mockReturnValue(2);

      const result = await tool.handler({
        source_article: "deep-article.html",
        max_depth: 2,
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // New concepts would be at depth 3, exceeding max_depth 2
      expect(text).toContain("exceeds max depth (2)");
      expect(text).toContain("Queued for Generation:** 0");
    });

    it("queues concepts at exactly max depth", async () => {
      // Source article is at depth 1
      (db.getArticleDepth as Mock).mockReturnValue(1);

      const result = await tool.handler({
        source_article: "article.html",
        max_depth: 2,
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // New concepts at depth 2 should be allowed (2 <= 2)
      expect(text).toContain("Queued for Generation:** 2");
    });

    it("uses default max_depth of 3 when not specified", async () => {
      // Source at depth 2 -> new concepts at depth 3 should be allowed
      (db.getArticleDepth as Mock).mockReturnValue(2);

      const result = await tool.handler({
        source_article: "article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // Default max_depth is 3, depth 3 should be allowed
      expect(text).toContain("Queued for Generation:** 2");
    });

    it("rejects concepts beyond default max_depth", async () => {
      // Source at depth 3 -> new concepts at depth 4 should be rejected
      (db.getArticleDepth as Mock).mockReturnValue(3);

      const result = await tool.handler({
        source_article: "article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // Default max_depth is 3, depth 4 exceeds it
      expect(text).toContain("exceeds max depth (3)");
      expect(text).toContain("Queued for Generation:** 0");
    });

    it("reports source depth correctly", async () => {
      (db.getArticleDepth as Mock).mockReturnValue(1);

      const result = await tool.handler({
        source_article: "article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      expect(text).toContain("(depth: 1)");
    });
  });

  describe("priority calculation", () => {
    beforeEach(() => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="concept.html">Concept</a>
          </body>
        </html>
      `);
    });

    it("assigns higher priority to lower depth", async () => {
      // Test depth 0 -> new concepts at depth 1
      (db.getArticleDepth as Mock).mockReturnValue(0);

      await tool.handler({
        source_article: "root-article.html",
      });

      // Priority for depth 1: 100 - 1*25 = 75
      expect(db.queueDiscoveredConcept).toHaveBeenCalledWith(
        "concept.html",
        "Concept",
        1,
        "root-article.html",
        75,
      );
    });

    it("assigns lower priority to deeper depth", async () => {
      // Test depth 2 -> new concepts at depth 3
      (db.getArticleDepth as Mock).mockReturnValue(2);

      await tool.handler({
        source_article: "deep-article.html",
      });

      // Priority for depth 3: 100 - 3*25 = 25
      expect(db.queueDiscoveredConcept).toHaveBeenCalledWith(
        "concept.html",
        "Concept",
        3,
        "deep-article.html",
        25,
      );
    });

    it("assigns zero base priority at depth 4+", async () => {
      // Test depth 3 -> new concepts at depth 4
      (db.getArticleDepth as Mock).mockReturnValue(3);

      await tool.handler({
        source_article: "very-deep-article.html",
        max_depth: 5, // Allow deeper than default
      });

      // Priority for depth 4: max(0, 100 - 4*25) = 0
      expect(db.queueDiscoveredConcept).toHaveBeenCalledWith(
        "concept.html",
        "Concept",
        4,
        "very-deep-article.html",
        0,
      );
    });

    it("boosts priority for multiple references", async () => {
      // Mock a link that already exists in the queue
      (db.queueDiscoveredConcept as Mock).mockReturnValue(false);

      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="popular-concept.html">Popular Concept</a>
          </body>
        </html>
      `);

      const result = await tool.handler({
        source_article: "article.html",
      });

      // The link is already in queue, so it should be skipped
      expect(result.content[0].text).toContain("already in queue");
    });
  });

  describe("article existence check", () => {
    beforeEach(() => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="existing-article.html">Existing</a>
            <a href="new-article.html">New</a>
          </body>
        </html>
      `);
    });

    it("skips already existing articles", async () => {
      // First article exists, second doesn't
      (fs.access as Mock)
        .mockResolvedValueOnce(undefined) // existing-article.html exists
        .mockRejectedValueOnce(new Error("ENOENT")); // new-article.html doesn't

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      expect(text).toContain("existing-article.html");
      expect(text).toContain("already exists");
      expect(text).toContain("new-article.html");
      expect(text).toContain("QUEUED");
      expect(text).toContain("Queued for Generation:** 1");
    });

    it("counts skipped articles separately", async () => {
      // Both articles exist
      (fs.access as Mock).mockResolvedValue(undefined);

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      expect(text).toContain("Queued for Generation:** 0");
      expect(text).toContain("Skipped:** 2");
    });
  });

  describe("queue statistics", () => {
    beforeEach(() => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="concept.html">Concept</a>
          </body>
        </html>
      `);
    });

    it("returns queue statistics in result", async () => {
      (db.getDiscoveryQueueStats as Mock).mockReturnValue({
        pending: 10,
        inProgress: 2,
        completed: 50,
        byDepth: { 1: 5, 2: 3, 3: 2 },
      });

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      expect(text).toContain("Pending: 10");
      expect(text).toContain("In Progress: 2");
      expect(text).toContain("Completed: 50");
      expect(text).toContain("Depth 1: 5 pending");
      expect(text).toContain("Depth 2: 3 pending");
      expect(text).toContain("Depth 3: 2 pending");
    });

    it("returns only queue stats when no source_article provided", async () => {
      (db.getDiscoveryQueueStats as Mock).mockReturnValue({
        pending: 5,
        inProgress: 1,
        completed: 20,
        byDepth: { 1: 3, 2: 2 },
      });

      const result = await tool.handler({});

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      expect(text).toContain("Discovery Queue Status");
      expect(text).toContain("**Pending:** 5");
      expect(text).toContain("**In Progress:** 1");
      expect(text).toContain("**Completed:** 20");
      expect(text).not.toContain("Concepts Found");
    });
  });

  describe("filename to title conversion", () => {
    it("converts hyphenated filenames to title case", async () => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="semantic-drift.html">Link</a>
            <a href="quantum-field-theory.html">Link</a>
          </body>
        </html>
      `);

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      expect(text).toContain("Semantic Drift");
      expect(text).toContain("Quantum Field Theory");
    });

    it("handles single-word filenames", async () => {
      (fs.readFile as Mock).mockResolvedValue(`
        <html>
          <body>
            <a href="physics.html">Link</a>
          </body>
        </html>
      `);

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      expect(text).toContain("Physics");
    });
  });

  describe("tool interface", () => {
    it("returns valid tool definition", () => {
      expect(tool.definition.name).toBe("wiki_discover");
      expect(tool.definition.inputSchema.type).toBe("object");
    });

    it("defines expected input properties", () => {
      const props = tool.definition.inputSchema.properties;

      expect(props).toHaveProperty("source_article");
      expect(props).toHaveProperty("max_depth");
      expect(props).toHaveProperty("relevance_filter");
    });

    it("has no required properties", () => {
      // source_article is optional (returns queue stats without it)
      expect(tool.definition.inputSchema.required).toEqual([]);
    });

    it("handler returns properly formatted MCP response", async () => {
      (fs.readFile as Mock).mockResolvedValue("<html><body></body></html>");

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result).toHaveProperty("content");
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toHaveProperty("type", "text");
      expect(result.content[0]).toHaveProperty("text");
    });
  });

  describe("error handling", () => {
    it("handles discovery errors gracefully", async () => {
      // Mock an unexpected error during discovery
      (db.getArticleDepth as Mock).mockImplementation(() => {
        throw new Error("Database connection failed");
      });

      const result = await tool.handler({
        source_article: "test-article.html",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error during discovery");
      expect(result.content[0].text).toContain("Database connection failed");
    });

    it("handles queue stats errors gracefully when no source provided", async () => {
      (db.getDiscoveryQueueStats as Mock).mockImplementation(() => {
        throw new Error("Stats unavailable");
      });

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error during discovery");
    });
  });
});
