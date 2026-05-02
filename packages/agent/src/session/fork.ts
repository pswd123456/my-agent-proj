import { promises as fs } from "node:fs";
import path from "node:path";

export {
  buildForkReplayRequestMessages,
  cloneForkSessionSnapshot,
  createRewriteRewindSnapshot,
  findLastAssistantBlock,
  getCheckpointTriggerUserBlock,
  getCheckpointTriggerUserMessageIndex
} from "./checkpoint.js";

export async function copyTaskBriefForFork(input: {
  sourceTaskBriefPath: string | null | undefined;
  targetTaskBriefPath: string | null | undefined;
}): Promise<void> {
  if (
    typeof input.sourceTaskBriefPath !== "string" ||
    input.sourceTaskBriefPath.length === 0 ||
    typeof input.targetTaskBriefPath !== "string" ||
    input.targetTaskBriefPath.length === 0
  ) {
    return;
  }

  try {
    await fs.mkdir(path.dirname(input.targetTaskBriefPath), {
      recursive: true
    });
    await fs.copyFile(input.sourceTaskBriefPath, input.targetTaskBriefPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
