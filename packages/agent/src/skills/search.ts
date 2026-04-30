import type { SkillDescriptor } from "./types.js";

const DEFAULT_MAX_RESULTS = 8;
const MAX_RESULTS_LIMIT = 50;

export type SkillMatchField = "name" | "description" | "relativePath";

export interface SkillSearchMatch extends SkillDescriptor {
  score: number;
  matchedFields: SkillMatchField[];
}

export interface SearchWorkspaceSkillsInput {
  skills: SkillDescriptor[];
  query?: string | null | undefined;
  maxResults?: number | null | undefined;
  allowEmptyQuery?: boolean;
}

export interface SearchWorkspaceSkillsResult {
  matches: SkillSearchMatch[];
  matchCount: number;
  truncated: boolean;
}

export function normalizeSkillSearchLimit(
  value: number | null | undefined
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_RESULTS;
  }

  return Math.min(Math.floor(value), MAX_RESULTS_LIMIT);
}

function scoreSkillMatch(
  skill: SkillDescriptor,
  query: string
): SkillSearchMatch | null {
  const normalizedQuery = query.toLowerCase();
  const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);
  const name = skill.name.toLowerCase();
  const description = skill.description.toLowerCase();
  const relativePath = skill.relativePath.toLowerCase();

  let score = 0;
  const matchedFields = new Set<SkillMatchField>();

  if (name === normalizedQuery) {
    score += 120;
    matchedFields.add("name");
  } else if (name.startsWith(normalizedQuery)) {
    score += 90;
    matchedFields.add("name");
  } else if (name.includes(normalizedQuery)) {
    score += 70;
    matchedFields.add("name");
  }

  if (description.includes(normalizedQuery)) {
    score += 45;
    matchedFields.add("description");
  }

  if (relativePath.includes(normalizedQuery)) {
    score += 30;
    matchedFields.add("relativePath");
  }

  const nameTermMatches = queryTerms.filter((term) =>
    name.includes(term)
  ).length;
  if (nameTermMatches > 0) {
    score += nameTermMatches * 12;
    matchedFields.add("name");
  }

  const descriptionTermMatches = queryTerms.filter((term) =>
    description.includes(term)
  ).length;
  if (descriptionTermMatches > 0) {
    score += descriptionTermMatches * 6;
    matchedFields.add("description");
  }

  const pathTermMatches = queryTerms.filter((term) =>
    relativePath.includes(term)
  ).length;
  if (pathTermMatches > 0) {
    score += pathTermMatches * 4;
    matchedFields.add("relativePath");
  }

  if (score <= 0) {
    return null;
  }

  return {
    ...skill,
    score,
    matchedFields: [...matchedFields]
  };
}

export function searchWorkspaceSkills(
  input: SearchWorkspaceSkillsInput
): SearchWorkspaceSkillsResult {
  const query = input.query?.trim() ?? "";
  const maxResults = normalizeSkillSearchLimit(input.maxResults);

  let matches: SkillSearchMatch[];
  if (query.length === 0) {
    if (!input.allowEmptyQuery) {
      return {
        matches: [],
        matchCount: 0,
        truncated: false
      };
    }

    matches = [...input.skills]
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.relativePath.localeCompare(right.relativePath)
      )
      .map((skill) => ({
        ...skill,
        score: 0,
        matchedFields: [] as SkillMatchField[]
      }));
  } else {
    matches = input.skills
      .map((skill) => scoreSkillMatch(skill, query))
      .filter((skill): skill is SkillSearchMatch => Boolean(skill))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.name.localeCompare(right.name) ||
          left.relativePath.localeCompare(right.relativePath)
      );
  }

  return {
    matches: matches.slice(0, maxResults),
    matchCount: matches.length,
    truncated: matches.length > maxResults
  };
}
