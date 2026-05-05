import type { WorkspaceSkillSettingRecord } from "@ai-app-template/domain";

import {
  discoverWorkspaceSkills,
  filterWorkspaceSkills,
  type SkillDescriptor,
  type SkillDiscoveryDiagnostic,
  type SkillDiscoveryResult
} from "../skills/index.js";

const DEFAULT_MAX_SKILL_RESULTS = 8;
const MAX_SKILL_RESULTS_LIMIT = 50;

export interface WorkspaceSkillToolDiscovery {
  discovery: SkillDiscoveryResult;
  visibleSkills: SkillDescriptor[];
}

export function toSkillJson(skill: SkillDescriptor): Record<string, string> {
  return {
    name: skill.name,
    description: skill.description,
    relativePath: skill.relativePath
  };
}

export function toSkillSummaryJson(
  skill: SkillDescriptor
): Record<string, string> {
  return {
    name: skill.name,
    relativePath: skill.relativePath
  };
}

export function toSkillDiagnosticJson(
  diagnostic: SkillDiscoveryDiagnostic
): Record<string, string> {
  return {
    relativePath: diagnostic.relativePath,
    reason: diagnostic.reason,
    message: diagnostic.message
  };
}

export function normalizeSkillMaxResults(value: unknown): number | null {
  if (value === undefined) {
    return DEFAULT_MAX_SKILL_RESULTS;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.min(Math.floor(value), MAX_SKILL_RESULTS_LIMIT);
}

export function defaultSkillMaxResults(): number {
  return DEFAULT_MAX_SKILL_RESULTS;
}

export async function discoverVisibleWorkspaceSkills(
  workingDirectory: string,
  workspaceSkillSettings: readonly WorkspaceSkillSettingRecord[] = []
): Promise<WorkspaceSkillToolDiscovery> {
  const discovery = await discoverWorkspaceSkills(workingDirectory);
  return {
    discovery,
    visibleSkills: filterWorkspaceSkills(
      discovery.skills,
      workspaceSkillSettings
    )
  };
}
