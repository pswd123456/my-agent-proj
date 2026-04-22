import path from "node:path";

function isWithinRoot(rootDirectory: string, targetDirectory: string): boolean {
  const relativePath = path.relative(rootDirectory, targetDirectory);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

export function resolveApiWorkingDirectory(
  workspaceRoot: string,
  input?: string
): string {
  const rootDirectory = path.resolve(workspaceRoot);
  if (!input) {
    return rootDirectory;
  }

  const candidateDirectory = path.resolve(rootDirectory, input);
  return isWithinRoot(rootDirectory, candidateDirectory)
    ? candidateDirectory
    : rootDirectory;
}
