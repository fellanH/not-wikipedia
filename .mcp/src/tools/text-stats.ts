import { ToolModule } from "../types.js";

export const tool: ToolModule = {
  definition: {
    name: "text_stats",
    description: "Get statistics about a piece of text",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to analyze",
        },
      },
      required: ["text"],
    },
  },

  handler: async (args) => {
    const text = args.text as string;
    const stats = {
      characters: text.length,
      characters_no_spaces: text.replace(/\s/g, "").length,
      words: text.split(/\s+/).filter(Boolean).length,
      lines: text.split("\n").length,
      sentences: text.split(/[.!?]+/).filter(Boolean).length,
      paragraphs: text.split(/\n\s*\n/).filter(Boolean).length,
    };
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  },
};
