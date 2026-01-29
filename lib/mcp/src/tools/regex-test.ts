import { ToolModule } from "../types.js";

export const tool: ToolModule = {
  definition: {
    name: "regex_test",
    description: "Test a regex pattern against text",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The regex pattern",
        },
        flags: {
          type: "string",
          description: "Regex flags (e.g., 'gi' for global, case-insensitive)",
        },
        text: {
          type: "string",
          description: "The text to test against",
        },
      },
      required: ["pattern", "text"],
    },
  },

  handler: async (args) => {
    const pattern = args.pattern as string;
    const flags = (args.flags as string) || "";
    const text = args.text as string;

    try {
      const regex = new RegExp(pattern, flags);
      const matches = text.match(regex);
      const result = {
        pattern,
        flags,
        matches: matches || [],
        matched: !!matches,
        match_count: matches?.length || 0,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Invalid regex: ${(e as Error).message}` }], isError: true };
    }
  },
};
