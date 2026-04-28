export interface WorkspaceInstructionsDescriptor {
  relativePath: string;
  content: string;
}

export interface WorkspaceInstructionsDiagnostic {
  relativePath: string;
  reason: "read_failed";
  message: string;
}

export interface WorkspaceInstructionsLoadResult {
  instructions: WorkspaceInstructionsDescriptor | null;
  diagnostics: WorkspaceInstructionsDiagnostic[];
}
