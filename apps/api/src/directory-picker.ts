import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_DIRECTORY_PICKER_PROMPT = "Select default working directory";

export interface PickDirectoryInput {
  startDirectory?: string;
}

function toAppleScriptString(value: string): string {
  return JSON.stringify(value);
}

async function resolveStartDirectory(input?: string): Promise<string | null> {
  const candidate = input?.trim();
  if (!candidate) {
    return null;
  }

  const normalized = path.resolve(candidate);
  try {
    const stat = await fs.stat(normalized);
    return stat.isDirectory() ? normalized : null;
  } catch {
    return null;
  }
}

async function pickDirectoryOnMac(
  input: PickDirectoryInput
): Promise<string | null> {
  const startDirectory = await resolveStartDirectory(input.startDirectory);
  const script = startDirectory
    ? [
        `set defaultLocation to POSIX file ${toAppleScriptString(startDirectory)}`,
        `set chosenFolder to choose folder with prompt ${toAppleScriptString(DEFAULT_DIRECTORY_PICKER_PROMPT)} default location defaultLocation`,
        'POSIX path of chosenFolder'
      ]
    : [
        `set chosenFolder to choose folder with prompt ${toAppleScriptString(DEFAULT_DIRECTORY_PICKER_PROMPT)}`,
        'POSIX path of chosenFolder'
      ];

  try {
    const { stdout } = await execFileAsync("osascript", [
      ...script.flatMap((line) => ["-e", line])
    ]);
    const selectedPath = stdout.trim();
    return selectedPath.length > 0 ? selectedPath : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("User canceled") ||
      message.includes("(-128)") ||
      message.includes("execution error: User canceled")
    ) {
      return null;
    }
    throw error;
  }
}

export async function pickDirectoryWithSystemDialog(
  input: PickDirectoryInput = {}
): Promise<string | null> {
  if (process.platform === "darwin") {
    return pickDirectoryOnMac(input);
  }

  throw new Error(
    `Directory picker is not supported on ${process.platform} yet. Enter an absolute path manually instead.`
  );
}
