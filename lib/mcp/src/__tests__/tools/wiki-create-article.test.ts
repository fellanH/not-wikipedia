/**
 * Unit Tests for wiki-create-article.ts
 *
 * Tests HTML generation from markdown, infobox rendering, database registration,
 * and error handling paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import * as fs from "fs/promises";

// Mock modules before importing the tool
vi.mock("../../db/database.js", () => ({
  insertArticle: vi.fn(),
  completeTask: vi.fn(),
}));

vi.mock("../../config.js", () => ({
  WIKI_DIR: "/mock/wiki",
  META_DIR: "/mock/meta",
  INFOBOX_COLORS: ["#7b9e89", "#c9a86c", "#8b7355"],
}));

vi.mock("fs/promises", () => ({
  access: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

// Import after mocks
import { tool } from "../../tools/wiki-create-article.js";
import * as db from "../../db/database.js";

describe("wiki-create-article", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: file doesn't exist (access throws)
    (fs.access as Mock).mockRejectedValue(new Error("ENOENT"));
    (fs.writeFile as Mock).mockResolvedValue(undefined);
    (fs.unlink as Mock).mockResolvedValue(undefined);

    // Default: DB operations succeed
    (db.insertArticle as Mock).mockReturnValue(1);
    (db.completeTask as Mock).mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("HTML generation", () => {
    it("generates valid HTML structure", async () => {
      const result = await tool.handler({
        title: "Test Article",
        content: "This is the article content.",
      });

      expect(result.isError).toBeFalsy();

      // Get the written HTML
      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      // Check basic HTML structure
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('<html lang="en">');
      expect(html).toContain("<head>");
      expect(html).toContain("<body>");
      expect(html).toContain("<title>Test Article - Wikipedia</title>");
      expect(html).toContain('<h1 id="firstHeading">Test Article</h1>');
      expect(html).toContain("<p>This is the article content.</p>");
      expect(html).toContain("</body>");
      expect(html).toContain("</html>");
    });

    it("escapes special characters in content", async () => {
      await tool.handler({
        title: "Article with Specials",
        content: "This has **bold** and *italic* text.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      // Markdown should be converted
      expect(html).toContain("<b>bold</b>");
      expect(html).toContain("<i>italic</i>");
    });

    it("renders infobox with correct color", async () => {
      await tool.handler({
        title: "Test Article",
        content: "Content here.",
        infobox_color: "#ff5733",
        infobox_fields: {
          Type: "Example",
          Status: "Active",
        },
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      // Check infobox structure and color
      expect(html).toContain("background-color: #ff5733");
      expect(html).toContain('<table class="infobox">');
      expect(html).toContain(
        '<td colspan="2" class="infobox-title">Test Article</td>',
      );
      expect(html).toContain('<th scope="row">Type</th><td>Example</td>');
      expect(html).toContain('<th scope="row">Status</th><td>Active</td>');
    });

    it("uses random color when infobox_color not provided", async () => {
      await tool.handler({
        title: "Test Article",
        content: "Content here.",
        infobox_fields: { Type: "Example" },
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      // Should use one of the configured colors
      expect(html).toMatch(/background-color: #[0-9a-f]{6}/);
    });

    it("generates proper internal links", async () => {
      await tool.handler({
        title: "Test Article",
        content: "See [related article](related-article.html) for more info.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      expect(html).toContain(
        '<a href="related-article.html">related article</a>',
      );
    });

    it("renders section headings with correct IDs", async () => {
      await tool.handler({
        title: "Test Article",
        content:
          "## History\n\nHistory content.\n\n### Early Period\n\nEarly period content.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      expect(html).toContain(
        '<h2 id="History">History<span class="mw-editsection">',
      );
      expect(html).toContain('<h3 id="Early_Period">Early Period</h3>');
    });

    it("generates table of contents with all sections", async () => {
      await tool.handler({
        title: "Test Article",
        content: "## Introduction\n\nIntro.\n\n## History\n\nHistory.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      expect(html).toContain('<div id="toc">');
      expect(html).toContain('<a href="#Introduction">Introduction</a>');
      expect(html).toContain('<a href="#History">History</a>');
      expect(html).toContain('<a href="#See_also">See also</a>');
      expect(html).toContain('<a href="#References">References</a>');
    });

    it("renders unordered lists correctly", async () => {
      await tool.handler({
        title: "Test Article",
        content: "Some list:\n\n- Item one\n- Item two\n- Item three",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      expect(html).toContain("<ul>");
      expect(html).toContain("<li>Item one</li>");
      expect(html).toContain("<li>Item two</li>");
      expect(html).toContain("<li>Item three</li>");
      expect(html).toContain("</ul>");
    });

    it("renders see_also section with article links", async () => {
      await tool.handler({
        title: "Test Article",
        content: "Content.",
        see_also: ["related-topic", "another-article.html"],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      expect(html).toContain('<a href="related-topic.html">related topic</a>');
      expect(html).toContain(
        '<a href="another-article.html">another article</a>',
      );
    });

    it("renders categories correctly", async () => {
      await tool.handler({
        title: "Test Article",
        content: "Content.",
        categories: ["Science", "Technology", "History"],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      expect(html).toContain('<div id="catlinks">');
      expect(html).toContain("<b>Categories:</b>");
      expect(html).toContain(">Science</a>");
      expect(html).toContain(">Technology</a>");
      expect(html).toContain(">History</a>");
    });

    it("renders warning message when provided", async () => {
      await tool.handler({
        title: "Test Article",
        content: "Content.",
        warning_message: "This article needs verification.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      expect(html).toContain('<div class="ambox ambox-warning">');
      expect(html).toContain(
        "<strong>Warning:</strong> This article needs verification.",
      );
    });

    it("handles empty see_also with placeholder", async () => {
      await tool.handler({
        title: "Test Article",
        content: "Content.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      expect(html).toContain("<li><i>No related articles yet</i></li>");
    });

    it("handles empty categories with uncategorized label", async () => {
      await tool.handler({
        title: "Test Article",
        content: "Content.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      expect(html).toContain("<i>Uncategorized</i>");
    });

    it("creates correct filename from title", async () => {
      await tool.handler({
        title: "Test Article with Spaces",
        content: "Content.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const filepath = writeCall[0] as string;

      expect(filepath).toBe("/mock/wiki/test-article-with-spaces.html");
    });

    it("handles special characters in title for filename", async () => {
      await tool.handler({
        title: "Test: Article (With) Special! Characters?",
        content: "Content.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const filepath = writeCall[0] as string;

      expect(filepath).toBe(
        "/mock/wiki/test-article-with-special-characters.html",
      );
    });
  });

  describe("database registration", () => {
    it("inserts article record on success", async () => {
      await tool.handler({
        title: "New Article",
        content: "Content here.",
        categories: ["Science"],
      });

      expect(db.insertArticle).toHaveBeenCalledWith({
        filename: "new-article.html",
        title: "New Article",
        type: "article",
        category: "science",
        outlinks: 0,
        inlinks: 0,
        created: expect.any(String),
      });
    });

    it("counts outlinks from content links", async () => {
      await tool.handler({
        title: "Article with Links",
        content: "See [link1](page1.html) and [link2](page2.html).",
      });

      expect(db.insertArticle).toHaveBeenCalledWith(
        expect.objectContaining({
          outlinks: 2,
        }),
      );
    });

    it("counts outlinks including see_also", async () => {
      await tool.handler({
        title: "Article with Links",
        content: "See [link1](page1.html).",
        see_also: ["related1", "related2"],
      });

      expect(db.insertArticle).toHaveBeenCalledWith(
        expect.objectContaining({
          outlinks: 3, // 1 from content + 2 from see_also
        }),
      );
    });

    it("uses first category as article category", async () => {
      await tool.handler({
        title: "Test",
        content: "Content.",
        categories: ["History", "Science"],
      });

      expect(db.insertArticle).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "history",
        }),
      );
    });

    it("defaults to technology category when no categories provided", async () => {
      await tool.handler({
        title: "Test",
        content: "Content.",
      });

      expect(db.insertArticle).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "technology",
        }),
      );
    });

    it("propagates DB registration errors and rolls back file", async () => {
      // Simulate DB constraint error
      (db.insertArticle as Mock).mockImplementation(() => {
        throw new Error("UNIQUE constraint failed");
      });

      const result = await tool.handler({
        title: "Existing Article",
        content: "Content.",
      });

      // Should error with descriptive message
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Article creation failed during DB registration",
      );
      expect(result.content[0].text).toContain("UNIQUE constraint failed");

      // Should have attempted to rollback by deleting the file
      expect(fs.unlink).toHaveBeenCalledWith(
        "/mock/wiki/existing-article.html",
      );
    });

    it("completes task assignments for created article", async () => {
      await tool.handler({
        title: "Test Article",
        content: "Content.",
      });

      expect(db.completeTask).toHaveBeenCalledWith(
        "repair_broken_link",
        "test-article.html",
      );
      expect(db.completeTask).toHaveBeenCalledWith(
        "create_from_live_404",
        "test-article.html",
      );
      expect(db.completeTask).toHaveBeenCalledWith(
        "fix_orphan",
        "test-article.html",
      );
      expect(db.completeTask).toHaveBeenCalledWith(
        "resolve_placeholder",
        "test-article.html",
      );
    });

    it("handles task completion errors gracefully", async () => {
      (db.completeTask as Mock).mockImplementation(() => {
        throw new Error("Task not found");
      });

      const result = await tool.handler({
        title: "Test Article",
        content: "Content.",
      });

      // Should not error - just log warning
      expect(result.isError).toBeFalsy();
    });
  });

  describe("error handling", () => {
    it("throws on missing title", async () => {
      const result = await tool.handler({
        content: "Content without title.",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("title and content required");
    });

    it("throws on missing content", async () => {
      const result = await tool.handler({
        title: "Title without content",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("title and content required");
    });

    it("throws on empty title", async () => {
      const result = await tool.handler({
        title: "",
        content: "Content here.",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("title and content required");
    });

    it("throws on empty content", async () => {
      const result = await tool.handler({
        title: "Test",
        content: "",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("title and content required");
    });

    it("throws when article already exists", async () => {
      // File exists
      (fs.access as Mock).mockResolvedValue(undefined);

      const result = await tool.handler({
        title: "Existing Article",
        content: "Content.",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("already exists");
    });

    it("propagates file system write errors", async () => {
      (fs.writeFile as Mock).mockRejectedValue(new Error("Permission denied"));

      const result = await tool.handler({
        title: "Test Article",
        content: "Content.",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Permission denied");
    });
  });

  describe("tool interface", () => {
    it("returns valid tool definition", () => {
      expect(tool.definition.name).toBe("wiki_create_article");
      expect(tool.definition.inputSchema.type).toBe("object");
      expect(tool.definition.inputSchema.required).toContain("title");
      expect(tool.definition.inputSchema.required).toContain("content");
    });

    it("defines all expected input properties", () => {
      const props = tool.definition.inputSchema.properties;

      expect(props).toHaveProperty("title");
      expect(props).toHaveProperty("content");
      expect(props).toHaveProperty("topic");
      expect(props).toHaveProperty("infobox_color");
      expect(props).toHaveProperty("infobox_fields");
      expect(props).toHaveProperty("categories");
      expect(props).toHaveProperty("see_also");
      expect(props).toHaveProperty("warning_message");
    });

    it("handler returns properly formatted MCP response on success", async () => {
      const result = await tool.handler({
        title: "Test Article",
        content: "Content.",
      });

      expect(result).toHaveProperty("content");
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toHaveProperty("type", "text");
      expect(result.content[0]).toHaveProperty("text");

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("success", true);
      expect(parsed).toHaveProperty("filename", "test-article.html");
      expect(parsed).toHaveProperty("title", "Test Article");
      expect(parsed).toHaveProperty("message");
    });

    it("handler returns error response with isError flag", async () => {
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("Error");
    });
  });

  describe("edge cases", () => {
    it("handles content with multiple consecutive lists", async () => {
      await tool.handler({
        title: "Test",
        content: "First list:\n- A\n- B\n\nText between.\n\n- C\n- D",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      // Should have two separate lists
      expect((html.match(/<ul>/g) || []).length).toBe(2);
      expect((html.match(/<\/ul>/g) || []).length).toBe(2);
    });

    it("handles content without any sections", async () => {
      await tool.handler({
        title: "Simple Article",
        content: "Just a paragraph without any headings.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      // TOC should still have See also and References
      expect(html).toContain('<a href="#See_also">See also</a>');
      expect(html).toContain('<a href="#References">References</a>');
    });

    it("handles title with leading/trailing whitespace", async () => {
      await tool.handler({
        title: "  Test Article  ",
        content: "Content.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      // Title should be preserved in HTML
      expect(html).toContain("<title>  Test Article  ");
    });

    it("handles mixed markdown formatting", async () => {
      await tool.handler({
        title: "Test",
        content: "This is **bold with *nested italic* inside**.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      expect(html).toContain("<b>bold with <i>nested italic</i> inside</b>");
    });

    it("handles empty infobox_fields object", async () => {
      await tool.handler({
        title: "Test",
        content: "Content.",
        infobox_fields: {},
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      // Should not render infobox table when empty
      expect(html).not.toContain('<table class="infobox">');
    });

    it("handles section headings with underscores", async () => {
      await tool.handler({
        title: "Test",
        content: "## Section_With_Underscores\n\nContent.",
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const html = writeCall[1] as string;

      expect(html).toContain('id="Section_With_Underscores"');
    });
  });
});
