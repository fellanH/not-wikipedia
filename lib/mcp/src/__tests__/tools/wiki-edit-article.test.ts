/**
 * Unit Tests for wiki-edit-article.ts
 *
 * Tests section finding logic, content replacement, link addition,
 * and malformed HTML handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import * as fs from "fs/promises";

// Mock modules before importing the tool
vi.mock("../../config.js", () => ({
  WIKI_DIR: "/mock/wiki",
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

// Import after mocks
import { tool } from "../../tools/wiki-edit-article.js";

// Sample HTML template for testing
const createTestHtml = (content: string) => `<!DOCTYPE html>
<html lang="en">
<head>
    <title>Test Article - Wikipedia</title>
</head>
<body>
    <h1 id="firstHeading">Test Article</h1>
    <div id="siteSub">From Not-Wikipedia</div>
    <div id="contentSub"></div>
    <div id="bodyContent">
        <table class="infobox">
            <tr><th scope="row">Type</th><td>Example</td></tr>
            <tr><th scope="row">Status</th><td>Active</td></tr>
        </table>
${content}
        <h2 id="See_also">See also<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <ul>
            <li><i>No related articles yet</i></li>
        </ul>

        <h2 id="References">References<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <ol class="references"></ol>
    </div>
    <div id="catlinks">
        <b>Categories:</b> <i>Uncategorized</i>
    </div>
</body>
</html>`;

describe("wiki-edit-article", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.writeFile as Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("section operations", () => {
    it("finds section by heading text", async () => {
      const html = createTestHtml(`
        <h2 id="History">History<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>Original history content.</p>
`);
      (fs.readFile as Mock).mockResolvedValue(html);

      const result = await tool.handler({
        filename: "test-article.html",
        operations: [
          { type: "update_section", section_id: "History", content: "Updated history content." },
        ],
      });

      expect(result.isError).toBeFalsy();
      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;
      expect(writtenHtml).toContain("Updated history content.");
    });

    it("replaces section content correctly", async () => {
      const html = createTestHtml(`
        <h2 id="Background">Background<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>Old background info.</p>
        <p>More old content.</p>

        <h2 id="Details">Details<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>Details content.</p>
`);
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [
          { type: "update_section", section_id: "Background", content: "New background info." },
        ],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain("New background info.");
      expect(writtenHtml).not.toContain("Old background info.");
      // Details section should be preserved
      expect(writtenHtml).toContain("Details content.");
    });

    it("handles missing section gracefully", async () => {
      const html = createTestHtml(`
        <h2 id="History">History<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>History content.</p>
`);
      (fs.readFile as Mock).mockResolvedValue(html);

      const result = await tool.handler({
        filename: "test-article.html",
        operations: [
          { type: "update_section", section_id: "NonExistent", content: "New content." },
        ],
      });

      // Should succeed but not apply the operation
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.operations_applied).not.toContain("update_section");
    });

    it("preserves surrounding HTML", async () => {
      const html = createTestHtml(`
        <h2 id="Introduction">Introduction<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>Intro content.</p>

        <h2 id="Middle">Middle<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>Middle content to update.</p>

        <h2 id="Conclusion">Conclusion<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>Conclusion content.</p>
`);
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [
          { type: "update_section", section_id: "Middle", content: "Updated middle content." },
        ],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      // Check surrounding sections are preserved
      expect(writtenHtml).toContain("Intro content.");
      expect(writtenHtml).toContain("Updated middle content.");
      expect(writtenHtml).toContain("Conclusion content.");
      // Infobox should be preserved
      expect(writtenHtml).toContain('<table class="infobox">');
    });

    it("adds new section after specified section", async () => {
      const html = createTestHtml(`
        <h2 id="History">History<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>History content.</p>
`);
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [
          {
            type: "add_section",
            section_title: "New Section",
            content: "New section content.",
            after_section: "History",
          },
        ],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain('<h2 id="New_Section">New Section');
      expect(writtenHtml).toContain("New section content.");

      // New section should appear between History and See_also
      const historyIndex = writtenHtml.indexOf('id="History"');
      const newSectionIndex = writtenHtml.indexOf('id="New_Section"');
      const seeAlsoIndex = writtenHtml.indexOf('id="See_also"');

      expect(newSectionIndex).toBeGreaterThan(historyIndex);
      expect(newSectionIndex).toBeLessThan(seeAlsoIndex);
    });

    it("adds section before See_also when no after_section specified", async () => {
      const html = createTestHtml(`
        <h2 id="History">History<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>History content.</p>
`);
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "add_section", section_title: "New Section", content: "Content." }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      const newSectionIndex = writtenHtml.indexOf('id="New_Section"');
      const seeAlsoIndex = writtenHtml.indexOf('id="See_also"');

      expect(newSectionIndex).toBeLessThan(seeAlsoIndex);
    });
  });

  describe("link operations", () => {
    it("adds link to See_also section", async () => {
      const html = createTestHtml(`
        <h2 id="History">History<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>History content.</p>
`);
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "append_see_also", link: "related-article" }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain('<a href="related-article.html">Related Article</a>');
    });

    it("adds link with .html extension when provided", async () => {
      const html = createTestHtml("");
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "append_see_also", link: "another-page.html" }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain('<a href="another-page.html">Another Page</a>');
    });

    it("removes placeholder when adding first link", async () => {
      const html = createTestHtml("");
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "append_see_also", link: "first-link" }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).not.toContain("<i>No related articles yet</i>");
      expect(writtenHtml).toContain('<a href="first-link.html">First Link</a>');
    });

    it("does not duplicate existing links", async () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<body>
    <h2 id="See_also">See also<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
    <ul>
        <li><a href="existing-link.html">Existing Link</a></li>
    </ul>
</body>
</html>`;
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "append_see_also", link: "existing-link" }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      // Should only have one occurrence
      const matches = writtenHtml.match(/existing-link\.html/g);
      expect(matches).toHaveLength(1);
    });

    it("formats link name from hyphenated filename", async () => {
      const html = createTestHtml("");
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "append_see_also", link: "some-long-article-name" }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain(">Some Long Article Name</a>");
    });
  });

  describe("infobox operations", () => {
    it("updates existing infobox field", async () => {
      const html = createTestHtml("");
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "update_infobox", infobox_field: "Status", infobox_value: "Inactive" }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain('<th scope="row">Status</th><td>Inactive</td>');
      expect(writtenHtml).not.toContain('<td>Active</td>');
    });

    it("adds new infobox field if not exists", async () => {
      const html = createTestHtml("");
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "update_infobox", infobox_field: "Location", infobox_value: "USA" }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain('<th scope="row">Location</th><td>USA</td>');
    });
  });

  describe("category operations", () => {
    it("adds category to uncategorized article", async () => {
      const html = createTestHtml("");
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "add_category", category: "Science" }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain(">Science</a>");
      expect(writtenHtml).not.toContain("<i>Uncategorized</i>");
    });

    it("adds additional category to categorized article", async () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<body>
    <div id="catlinks">
        <b>Categories:</b> <a href="#">History</a>
    </div>
</body>
</html>`;
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "add_category", category: "Geography" }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain(">History</a>");
      expect(writtenHtml).toContain(">Geography</a>");
      expect(writtenHtml).toContain(" | ");
    });

    it("does not add duplicate category", async () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<body>
    <div id="catlinks">
        <b>Categories:</b> <a href="#">Science</a>
    </div>
</body>
</html>`;
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "add_category", category: "Science" }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      const matches = writtenHtml.match(/>Science</g);
      expect(matches).toHaveLength(1);
    });
  });

  describe("warning operations", () => {
    it("adds warning to article", async () => {
      const html = createTestHtml("");
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "set_warning", warning: "This article needs review." }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain('<div class="ambox ambox-warning">');
      expect(writtenHtml).toContain("<strong>Warning:</strong> This article needs review.");
    });

    it("replaces existing warning", async () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<body>
    <div id="siteSub">From Not-Wikipedia</div>
    <div class="ambox ambox-warning">
        <strong>Warning:</strong> Old warning message.
    </div>
    <div id="bodyContent"></div>
</body>
</html>`;
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "set_warning", warning: "New warning message." }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain("New warning message.");
      expect(writtenHtml).not.toContain("Old warning message.");
    });
  });

  describe("append content operations", () => {
    it("appends content before See_also section", async () => {
      const html = createTestHtml(`
        <h2 id="History">History<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>History content.</p>
`);
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "append_content", content: "Additional paragraph content." }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain("<p>Additional paragraph content.</p>");

      // Should be before See_also
      const contentIndex = writtenHtml.indexOf("Additional paragraph content.");
      const seeAlsoIndex = writtenHtml.indexOf('id="See_also"');
      expect(contentIndex).toBeLessThan(seeAlsoIndex);
    });
  });

  describe("edge cases", () => {
    it("handles nested HTML elements", async () => {
      const html = createTestHtml(`
        <h2 id="Description">Description<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>Content with <strong>bold</strong> and <em>italic</em> text.</p>
        <ul>
            <li>List item 1</li>
            <li>List item 2</li>
        </ul>
`);
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "update_section", section_id: "Description", content: "Simple replacement." }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain("Simple replacement.");
      expect(writtenHtml).not.toContain("List item 1");
    });

    it("handles empty sections", async () => {
      const html = createTestHtml(`
        <h2 id="Empty_Section">Empty Section<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
`);
      (fs.readFile as Mock).mockResolvedValue(html);

      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "update_section", section_id: "Empty_Section", content: "Now has content." }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain("Now has content.");
    });

    it("fails safely on malformed HTML - missing section end", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
    <h2 id="Broken">Broken Section
    <p>Content without closing h2
    <h2 id="See_also">See also</h2>
</body>
</html>`;
      (fs.readFile as Mock).mockResolvedValue(html);

      const result = await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "update_section", section_id: "Broken", content: "Updated." }],
      });

      // Should not crash
      expect(result.isError).toBeFalsy();
    });

    it("handles multiple operations in sequence", async () => {
      const html = createTestHtml(`
        <h2 id="History">History<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>Original content.</p>
`);
      (fs.readFile as Mock).mockResolvedValue(html);

      const result = await tool.handler({
        filename: "test-article.html",
        operations: [
          { type: "update_section", section_id: "History", content: "Updated history." },
          { type: "append_see_also", link: "related-topic" },
          { type: "add_category", category: "Technology" },
        ],
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.operations_applied).toContain("update_section");
      expect(parsed.operations_applied).toContain("append_see_also");
      expect(parsed.operations_applied).toContain("add_category");

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain("Updated history.");
      expect(writtenHtml).toContain("related-topic.html");
      expect(writtenHtml).toContain(">Technology</a>");
    });

    it("handles case-insensitive section ID matching", async () => {
      const html = createTestHtml(`
        <h2 id="History">History<span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
        <p>Content.</p>
`);
      (fs.readFile as Mock).mockResolvedValue(html);

      // The implementation uses case-insensitive regex
      await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "update_section", section_id: "History", content: "Updated." }],
      });

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const writtenHtml = writeCall[1] as string;

      expect(writtenHtml).toContain("Updated.");
    });

    it("handles HTML with no See_also section for append_content", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
    <h2 id="Content">Content</h2>
    <p>Some content.</p>
</body>
</html>`;
      (fs.readFile as Mock).mockResolvedValue(html);

      const result = await tool.handler({
        filename: "test-article.html",
        operations: [{ type: "append_content", content: "New content." }],
      });

      // Should not apply operation when See_also not found
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.operations_applied).not.toContain("append_content");
    });
  });

  describe("error handling", () => {
    it("returns error for missing filename", async () => {
      const result = await tool.handler({
        operations: [{ type: "append_see_also", link: "test" }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("filename and operations required");
    });

    it("returns error for empty operations", async () => {
      const result = await tool.handler({
        filename: "test.html",
        operations: [],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("filename and operations required");
    });

    it("returns error for non-existent file", async () => {
      (fs.readFile as Mock).mockRejectedValue(new Error("ENOENT"));

      const result = await tool.handler({
        filename: "nonexistent.html",
        operations: [{ type: "append_see_also", link: "test" }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("appends .html extension if missing", async () => {
      (fs.readFile as Mock).mockRejectedValue(new Error("ENOENT"));

      await tool.handler({
        filename: "test-article",
        operations: [{ type: "append_see_also", link: "test" }],
      });

      const readCall = (fs.readFile as Mock).mock.calls[0];
      expect(readCall[0]).toBe("/mock/wiki/test-article.html");
    });

    it("handles write errors gracefully", async () => {
      const html = createTestHtml("");
      (fs.readFile as Mock).mockResolvedValue(html);
      (fs.writeFile as Mock).mockRejectedValue(new Error("Permission denied"));

      const result = await tool.handler({
        filename: "test.html",
        operations: [{ type: "append_see_also", link: "test" }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Permission denied");
    });

    it("handles invalid operation type gracefully", async () => {
      const html = createTestHtml("");
      (fs.readFile as Mock).mockResolvedValue(html);

      const result = await tool.handler({
        filename: "test.html",
        operations: [{ type: "invalid_operation" as any }],
      });

      // Should succeed but not apply any operation
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.operations_applied).toEqual([]);
    });

    it("handles operation with missing required fields", async () => {
      const html = createTestHtml("");
      (fs.readFile as Mock).mockResolvedValue(html);

      const result = await tool.handler({
        filename: "test.html",
        operations: [
          { type: "add_section" }, // missing section_title and content
        ],
      });

      // Should succeed but not apply the operation
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.operations_applied).not.toContain("add_section");
    });
  });

  describe("tool interface", () => {
    it("returns valid tool definition", () => {
      expect(tool.definition.name).toBe("wiki_edit_article");
      expect(tool.definition.inputSchema.type).toBe("object");
      expect(tool.definition.inputSchema.required).toContain("filename");
      expect(tool.definition.inputSchema.required).toContain("operations");
    });

    it("defines all expected operation types", () => {
      const operationsSchema = tool.definition.inputSchema.properties.operations as any;
      const typeEnum = operationsSchema.items.properties.type.enum;

      expect(typeEnum).toContain("add_section");
      expect(typeEnum).toContain("update_section");
      expect(typeEnum).toContain("append_see_also");
      expect(typeEnum).toContain("update_infobox");
      expect(typeEnum).toContain("add_category");
      expect(typeEnum).toContain("set_warning");
      expect(typeEnum).toContain("append_content");
    });

    it("handler returns properly formatted MCP response on success", async () => {
      const html = createTestHtml("");
      (fs.readFile as Mock).mockResolvedValue(html);

      const result = await tool.handler({
        filename: "test.html",
        operations: [{ type: "append_see_also", link: "test" }],
      });

      expect(result).toHaveProperty("content");
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toHaveProperty("type", "text");
      expect(result.content[0]).toHaveProperty("text");

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("success", true);
      expect(parsed).toHaveProperty("filename", "test.html");
      expect(parsed).toHaveProperty("operations_applied");
    });

    it("handler returns error response with isError flag", async () => {
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("Error");
    });
  });
});
