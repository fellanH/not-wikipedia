import { exec } from "child_process";
import { promisify } from "util";
import { ToolModule } from "../types.js";

const execAsync = promisify(exec);

export const tool: ToolModule = {
  definition: {
    name: "shell_command",
    description: "Execute a shell command and return the output. Use with caution.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        cwd: {
          type: "string",
          description: "Working directory for the command",
        },
      },
      required: ["command"],
    },
  },

  handler: async (args) => {
    const command = args.command as string;
    const cwd = args.cwd as string;

    try {
      const { stdout } = await execAsync(command, {
        cwd: cwd || process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      return { content: [{ type: "text", text: stdout || "(no output)" }] };
    } catch (e: unknown) {
      const error = e as { stderr?: string; message: string };
      return { content: [{ type: "text", text: `Error: ${error.stderr || error.message}` }], isError: true };
    }
  },
};
