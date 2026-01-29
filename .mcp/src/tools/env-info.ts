import { ToolModule } from "../types.js";

export const tool: ToolModule = {
  definition: {
    name: "env_info",
    description: "Get information about the current environment",
    inputSchema: {
      type: "object",
      properties: {
        info_type: {
          type: "string",
          enum: ["all", "node", "platform", "cwd", "env_vars"],
          description: "Type of environment info to retrieve",
        },
      },
      required: [],
    },
  },

  handler: async (args) => {
    const infoType = (args.info_type as string) || "all";
    const info: Record<string, unknown> = {};

    if (infoType === "all" || infoType === "node") {
      info.node_version = process.version;
    }
    if (infoType === "all" || infoType === "platform") {
      info.platform = process.platform;
      info.arch = process.arch;
    }
    if (infoType === "all" || infoType === "cwd") {
      info.cwd = process.cwd();
    }
    if (infoType === "env_vars") {
      const safeVars = ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG"];
      info.env_vars = Object.fromEntries(
        safeVars.filter((k) => process.env[k]).map((k) => [k, process.env[k]])
      );
    }

    return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
  },
};
