import { ToolModule } from "../types.js";

export const tool: ToolModule = {
  definition: {
    name: "random_string",
    description: "Generate a random string",
    inputSchema: {
      type: "object",
      properties: {
        length: {
          type: "number",
          description: "Length of the string (default: 16, max: 256)",
        },
        charset: {
          type: "string",
          enum: ["alphanumeric", "alpha", "numeric", "hex", "base64"],
          description: "Character set to use",
        },
      },
      required: [],
    },
  },

  handler: async (args) => {
    const length = Math.min(Math.max((args.length as number) || 16, 1), 256);
    const charset = (args.charset as string) || "alphanumeric";

    const charsets: Record<string, string> = {
      alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
      numeric: "0123456789",
      hex: "0123456789abcdef",
      base64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    };

    const chars = charsets[charset] || charsets.alphanumeric;
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return { content: [{ type: "text", text: result }] };
  },
};
