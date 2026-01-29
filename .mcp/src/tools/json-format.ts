import { ToolModule } from "../types.js";

export const tool: ToolModule = {
  definition: {
    name: "json_format",
    description: "Format, minify, or validate JSON",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["format", "minify", "validate"],
          description: "Action to perform on the JSON",
        },
        json: {
          type: "string",
          description: "The JSON string to process",
        },
      },
      required: ["action", "json"],
    },
  },

  handler: async (args) => {
    const action = args.action as string;
    const json = args.json as string;

    try {
      const parsed = JSON.parse(json);

      switch (action) {
        case "format":
          return { content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }] };
        case "minify":
          return { content: [{ type: "text", text: JSON.stringify(parsed) }] };
        case "validate":
          return { content: [{ type: "text", text: "Valid JSON" }] };
        default:
          return { content: [{ type: "text", text: "Unknown action" }], isError: true };
      }
    } catch (e) {
      if (action === "validate") {
        return { content: [{ type: "text", text: `Invalid JSON: ${(e as Error).message}` }] };
      }
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  },
};
