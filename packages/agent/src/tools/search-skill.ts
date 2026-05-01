import type { WorkspaceSkillSettingRecord } from "@ai-app-template/domain";

import type { SkillDescriptor } from "../skills/index.js";
import {
  discoverWorkspaceSkills,
  filterWorkspaceSkills,
  type SkillDiscoveryDiagnostic
} from "../skills/index.js";
import { searchWorkspaceSkills } from "../skills/search.js";
import { createToolResult, successResult } from "./tool-result.js";
import type { RuntimeTool } from "./runtime-tool.js";

const DEFAULT_MAX_RESULTS = 8;
const MAX_RESULTS_LIMIT = 50;

function toSkillJson(skill: SkillDescriptor): Record<string, string> {
  return {
    name: skill.name,
    description: skill.description,
    relativePath: skill.relativePath
  };
}

function toDiagnosticJson(
  diagnostic: SkillDiscoveryDiagnostic
): Record<string, string> {
  return {
    relativePath: diagnostic.relativePath,
    reason: diagnostic.reason,
    message: diagnostic.message
  };
}

function normalizeQuery(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMaxResults(value: unknown): number | null {
  if (value === undefined) {
    return DEFAULT_MAX_RESULTS;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.min(Math.floor(value), MAX_RESULTS_LIMIT);
}

function formatDisplayText(input: {
  query: string;
  returnedCount: number;
  totalMatches: number;
  diagnostics: SkillDiscoveryDiagnostic[];
}): string {
  return [
    "[search_skill] success",
    `- query: ${input.query}`,
    `- matches returned: ${input.returnedCount}`,
    `- total matches: ${input.totalMatches}`,
    `- diagnostics: ${input.diagnostics.length}`
  ].join("\n");
}

export function createSearchSkillTool(
  workingDirectory: string,
  workspaceSkillSettings: readonly WorkspaceSkillSettingRecord[] = []
): RuntimeTool {
  return {
    name: "search_skill",
    description:
      "Search workspace skills discovered from .agent/skills by name, description, or relative path. Use this before load_skill when you need the most relevant skill.",
    family: "workspace-file",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query matched against skill name, description, and relative path."
        },
        maxResults: {
          type: "number",
          description: "Optional maximum number of matches to return."
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    getSandboxTargets() {
      return [".agent/skills"];
    },
    validate(input) {
      const issues: Array<{ field: string; issue: string }> = [];
      if (normalizeQuery(input.query) === null) {
        issues.push({
          field: "query",
          issue: "query must be a non-empty string."
        });
      }
      if (normalizeMaxResults(input.maxResults) === null) {
        issues.push({
          field: "maxResults",
          issue: "maxResults must be a positive number."
        });
      }

      if (issues.length > 0) {
        return {
          ok: false,
          issues
        };
      }

      return {
        ok: true,
        value: input
      };
    },
    async execute(input) {
      const query = normalizeQuery(input.query) ?? "";
      const maxResults =
        normalizeMaxResults(input.maxResults) ?? DEFAULT_MAX_RESULTS;
      const discovery = await discoverWorkspaceSkills(workingDirectory);
      const visibleSkills = filterWorkspaceSkills(
        discovery.skills,
        workspaceSkillSettings
      );
      const searchResult = searchWorkspaceSkills({
        skills: visibleSkills,
        query,
        maxResults
      });
      const matches = searchResult.matches;

      return successResult(
        createToolResult({
          ok: true,
          code: "SEARCH_SKILL_OK",
          message:
            matches.length > 0
              ? "Found workspace skills matching the query."
              : "No workspace skills matched the query.",
          data: {
            query,
            matchCount: searchResult.matchCount,
            returnedCount: matches.length,
            truncated: searchResult.truncated,
            matches: matches.map((skill) => ({
              ...toSkillJson(skill),
              score: skill.score,
              matchedFields: [...skill.matchedFields]
            })),
            diagnostics: discovery.diagnostics.map(toDiagnosticJson)
          }
        }),
        formatDisplayText({
          query,
          returnedCount: matches.length,
          totalMatches: searchResult.matchCount,
          diagnostics: discovery.diagnostics
        })
      );
    }
  };
}
