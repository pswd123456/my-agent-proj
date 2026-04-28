import { promises as fs } from "node:fs";
import path from "node:path";

import type { WorkspaceInstructionsLoadResult } from "./types.js";

const AGENTS_FILE_NAME = "AGENTS.md";

export class WorkspaceInstructionsManager {
  async load(
    workingDirectory: string
  ): Promise<WorkspaceInstructionsLoadResult> {
    const workspaceRoot = path.resolve(workingDirectory);
    const agentsPath = path.join(workspaceRoot, AGENTS_FILE_NAME);

    try {
      const content = await fs.readFile(agentsPath, "utf8");
      return {
        instructions: {
          relativePath: AGENTS_FILE_NAME,
          content
        },
        diagnostics: []
      };
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT") {
        return {
          instructions: null,
          diagnostics: []
        };
      }

      return {
        instructions: null,
        diagnostics: [
          {
            relativePath: AGENTS_FILE_NAME,
            reason: "read_failed",
            message:
              error instanceof Error
                ? error.message
                : "Unknown AGENTS.md read failure."
          }
        ]
      };
    }
  }
}

export function createWorkspaceInstructionsManager(): WorkspaceInstructionsManager {
  return new WorkspaceInstructionsManager();
}
