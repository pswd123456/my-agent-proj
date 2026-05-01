import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

import {
  isWorkspaceSkillEnabled,
  type WorkspaceSkillSettingRecord
} from "@ai-app-template/domain";

import type {
  SkillDescriptor,
  SkillDiscoveryDiagnostic,
  SkillDiscoveryResult
} from "./types.js";

const SKILLS_DIRECTORY = path.join(".agent", "skills");
const SKILL_FILE_NAMES = ["SKILL.md", "skill.md"] as const;

function toRelativePath(workingDirectory: string, targetPath: string): string {
  return path
    .relative(path.resolve(workingDirectory), path.resolve(targetPath))
    .replaceAll(path.sep, "/");
}

function parseFrontmatterValue(rawValue: string): string {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function parseFrontmatter(rawContent: string): Record<string, string> | null {
  const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return null;
  }

  const frontmatterBody = match[1];
  if (typeof frontmatterBody !== "string") {
    return null;
  }

  const metadata: Record<string, string> = {};
  for (const line of frontmatterBody.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = parseFrontmatterValue(line.slice(separatorIndex + 1));
    if (key.length === 0) {
      continue;
    }
    metadata[key] = value;
  }

  return metadata;
}

function toDescriptor(
  workingDirectory: string,
  skillFilePath: string,
  rawContent: string
): SkillDescriptor | SkillDiscoveryDiagnostic {
  const relativePath = toRelativePath(workingDirectory, skillFilePath);
  const metadata = parseFrontmatter(rawContent);

  if (!metadata) {
    return {
      relativePath,
      reason: "missing_frontmatter",
      message: "Skill file is missing valid frontmatter."
    };
  }

  const name = metadata.name?.trim();
  const description = metadata.description?.trim();

  if (!name || !description) {
    return {
      relativePath,
      reason: "invalid_metadata",
      message: "Skill frontmatter must include non-empty name and description."
    };
  }

  return {
    name,
    description,
    relativePath
  };
}

async function resolveSkillFilePath(
  skillDirectoryPath: string
): Promise<string | null> {
  const entries = await fs.readdir(skillDirectoryPath, { withFileTypes: true });
  const fileEntries = new Map(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => [entry.name, path.join(skillDirectoryPath, entry.name)])
  );

  for (const fileName of SKILL_FILE_NAMES) {
    const filePath = fileEntries.get(fileName);
    if (filePath) {
      return filePath;
    }
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      return path.join(skillDirectoryPath, entry.name);
    }
  }

  return null;
}

export async function discoverWorkspaceSkills(
  workingDirectory: string
): Promise<SkillDiscoveryResult> {
  const skillsDirectory = path.join(
    path.resolve(workingDirectory),
    SKILLS_DIRECTORY
  );

  let entries: Dirent[];
  try {
    entries = await fs.readdir(skillsDirectory, { withFileTypes: true });
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode === "ENOENT") {
      return {
        skills: [],
        diagnostics: []
      };
    }

    return {
      skills: [],
      diagnostics: [
        {
          relativePath: SKILLS_DIRECTORY.replaceAll(path.sep, "/"),
          reason: "read_failed",
          message:
            error instanceof Error
              ? error.message
              : "Unknown skills directory read failure."
        }
      ]
    };
  }

  const diagnostics: SkillDiscoveryDiagnostic[] = [];
  const discoveredSkills: SkillDescriptor[] = [];
  const skillDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const directoryName of skillDirectories) {
    const skillDirectoryPath = path.join(skillsDirectory, directoryName);
    let skillFilePath: string | null = null;
    try {
      skillFilePath = await resolveSkillFilePath(skillDirectoryPath);
    } catch (error) {
      diagnostics.push({
        relativePath: toRelativePath(workingDirectory, skillDirectoryPath),
        reason: "read_failed",
        message:
          error instanceof Error
            ? error.message
            : "Unknown skill directory read failure."
      });
    }
    if (!skillFilePath) {
      continue;
    }

    try {
      const rawContent = await fs.readFile(skillFilePath, "utf8");
      const parsed = toDescriptor(workingDirectory, skillFilePath, rawContent);
      if ("name" in parsed) {
        discoveredSkills.push(parsed);
      } else {
        diagnostics.push(parsed);
      }
    } catch (error) {
      diagnostics.push({
        relativePath: toRelativePath(workingDirectory, skillFilePath),
        reason: "read_failed",
        message:
          error instanceof Error ? error.message : "Unknown skill read failure."
      });
    }
  }

  const sortedSkills = [...discoveredSkills].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.relativePath.localeCompare(right.relativePath)
  );

  const uniqueSkills: SkillDescriptor[] = [];
  const seenNames = new Set<string>();
  for (const skill of sortedSkills) {
    if (seenNames.has(skill.name)) {
      diagnostics.push({
        relativePath: skill.relativePath,
        reason: "duplicate_name",
        message: `Duplicate skill name ignored: ${skill.name}`
      });
      continue;
    }

    seenNames.add(skill.name);
    uniqueSkills.push(skill);
  }

  return {
    skills: uniqueSkills,
    diagnostics: diagnostics.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath)
    )
  };
}

export async function loadWorkspaceSkills(
  workingDirectory: string
): Promise<SkillDescriptor[]> {
  const result = await discoverWorkspaceSkills(workingDirectory);
  return result.skills;
}

export function filterWorkspaceSkills(
  skills: readonly SkillDescriptor[],
  settings: readonly WorkspaceSkillSettingRecord[]
): SkillDescriptor[] {
  return skills.filter((skill) => isWorkspaceSkillEnabled(settings, skill.name));
}
