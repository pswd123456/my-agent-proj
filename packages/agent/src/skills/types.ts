export interface SkillDescriptor {
  name: string;
  description: string;
  relativePath: string;
}

export interface SkillDiscoveryDiagnostic {
  relativePath: string;
  reason:
    | "missing_frontmatter"
    | "invalid_metadata"
    | "duplicate_name"
    | "read_failed";
  message: string;
}

export interface SkillDiscoveryResult {
  skills: SkillDescriptor[];
  diagnostics: SkillDiscoveryDiagnostic[];
}
