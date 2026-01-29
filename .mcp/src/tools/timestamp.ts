import { ToolModule } from "../types.js";

export const tool: ToolModule = {
  definition: {
    name: "timestamp",
    description: "Get the current timestamp in various formats",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          description: "Format: 'iso', 'unix', 'unix_ms', or 'readable'",
          enum: ["iso", "unix", "unix_ms", "readable"],
        },
      },
      required: [],
    },
  },

  handler: async (args) => {
    const format = (args.format as string) || "iso";
    const now = new Date();
    let result: string;

    switch (format) {
      case "unix":
        result = Math.floor(now.getTime() / 1000).toString();
        break;
      case "unix_ms":
        result = now.getTime().toString();
        break;
      case "readable":
        result = now.toLocaleString();
        break;
      case "iso":
      default:
        result = now.toISOString();
    }

    return { content: [{ type: "text", text: result }] };
  },
};
