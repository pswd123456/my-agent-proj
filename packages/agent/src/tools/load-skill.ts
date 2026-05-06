import { promises as fs } from "node:fs";

import { z } from "zod";

import type { WorkspaceSkillSettingRecord } from "@ai-app-template/domain";

import type { SkillDescriptor } from "../skills/index.js";
import {
  discoverVisibleWorkspaceSkills,
  toSkillDiagnosticJson,
  toSkillJson,
  toSkillSummaryJson
} from "./skill-tool-shared.js";
import { normalizeWorkspacePath } from "./workspace.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";
import { normalizeLineWindowRequest, readLineWindow } from "./line-window.js";
import type { RuntimeTool } from "./runtime-tool.js";

const MAX_SKILL_CHARACTERS = 25_000;

const schema = z
  .object({
    skillName: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().positive().optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional()
  })
  .superRefine((value, context) => {
    if (!value.skillName && !value.path) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["skillName"],
        message: "Provide skillName or path."
      });
    }

    if (
      typeof value.startLine === "number" &&
      typeof value.endLine === "number" &&
      value.endLine < value.startLine
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endLine"],
        message: "endLine must be greater than or equal to startLine."
      });
    }
  });

function resolveRequestedSkill(
  skills: SkillDescriptor[],
  input: z.infer<typeof schema>
): SkillDescriptor | null {
  const normalizedName = input.skillName?.toLowerCase() ?? null;
  const normalizedPath = input.path?.toLowerCase() ?? null;

  if (input.skillName) {
    const exact = skills.find((skill) => skill.name === input.skillName);
    if (exact) {
      return exact;
    }

    const caseInsensitive = skills.filter(
      (skill) => skill.name.toLowerCase() === normalizedName
    );
    if (caseInsensitive.length === 1) {
      return caseInsensitive[0] ?? null;
    }
  }

  if (input.path) {
    const exact = skills.find((skill) => skill.relativePath === input.path);
    if (exact) {
      return exact;
    }

    const caseInsensitive = skills.filter(
      (skill) => skill.relativePath.toLowerCase() === normalizedPath
    );
    if (caseInsensitive.length === 1) {
      return caseInsensitive[0] ?? null;
    }
  }

  return null;
}

function formatSuccessDisplayText(input: {
  name: string;
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}): string {
  return [
    "[load_skill] success",
    `- name: ${input.name}`,
    `- path: ${input.path}`,
    `- lines: ${input.startLine}-${input.endLine}`,
    `- total lines: ${input.totalLines}`,
    `- truncated: ${input.truncated ? "yes" : "no"}`
  ].join("\n");
}

function formatFailureDisplayText(input: {
  skillName: string | undefined;
  path: string | undefined;
  reason: string;
}): string {
  return [
    "[load_skill] failed",
    `- skillName: ${input.skillName ?? "none"}`,
    `- path: ${input.path ?? "none"}`,
    `- reason: ${input.reason}`
  ].join("\n");
}

export function createLoadSkillTool(
  workingDirectory: string,
  workspaceSkillSettings: readonly WorkspaceSkillSettingRecord[] = []
): RuntimeTool {
  return {
    name: "load_skill",
    description: buildToolDescription({
      usageScenarios: [
        "Load the exact contents of a workspace skill after discovering it.",
        "Read only the relevant line window from a large SKILL.md file."
      ],
      usageInstructions: [
        "Provide either skillName or path.",
        describeObjectProperty({
          name: "skillName",
          type: "string",
          description:
            "Exact skill name from the runtime skill list or search_skill results."
        }),
        describeObjectProperty({
          name: "path",
          type: "string",
          description:
            "Exact relativePath from search_skill results, for example .agents/skills/repo-reader/SKILL.md."
        }),
        "Optionally page the result with either {startLine,endLine} or {offset,limit}."
      ],
      constraints: [
        "Use search_skill first when you do not already know the exact skill to load.",
        "Provide either skillName or path that resolves to a visible workspace skill.",
        "Like other paged readers, choose one window syntax rather than mixing both."
      ],
      examples: [
        '{"skillName":"firecrawl"}',
        '{"path":".agents/skills/repo-reader/SKILL.md","startLine":1,"endLine":80}'
      ]
    }),
    family: "workspace-file",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        skillName: {
          type: "string",
          description:
            "Optional exact skill name from the runtime skill list or search_skill results."
        },
        path: {
          type: "string",
          description:
            "Optional exact relativePath from search_skill results, for example '.agents/skills/repo-reader/SKILL.md'."
        },
        offset: { type: "number" },
        limit: { type: "number" },
        startLine: { type: "number" },
        endLine: { type: "number" }
      },
      additionalProperties: false
    },
    getSandboxTargets(input) {
      return [
        typeof input.path === "string" && input.path.trim().length > 0
          ? input.path.trim()
          : ".agents/skills"
      ];
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = schema.parse(input);
      const { discovery, visibleSkills } = await discoverVisibleWorkspaceSkills(
        workingDirectory,
        workspaceSkillSettings
      );
      const skill = resolveRequestedSkill(visibleSkills, parsed);

      if (!skill) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "SKILL_NOT_FOUND",
            message:
              "No loaded workspace skill matched the requested name or path.",
            data: {
              requestedSkillName: parsed.skillName ?? null,
              requestedPath: parsed.path ?? null,
              availableSkills: visibleSkills.map(toSkillSummaryJson),
              diagnostics: discovery.diagnostics.map(toSkillDiagnosticJson)
            }
          }),
          formatFailureDisplayText({
            skillName: parsed.skillName,
            path: parsed.path,
            reason: "skill not found"
          })
        );
      }

      try {
        const absolutePath = normalizeWorkspacePath(
          workingDirectory,
          skill.relativePath,
          context.allowWorkspaceEscape
        );
        const content = await fs.readFile(absolutePath, "utf8");
        const window = normalizeLineWindowRequest(parsed);
        const range = readLineWindow({
          content,
          startLine: window.startLine,
          endLine: window.endLine,
          maxCharacters: MAX_SKILL_CHARACTERS
        });

        return successResult(
          createToolResult({
            ok: true,
            code: "LOAD_SKILL_OK",
            message: "Loaded the requested workspace skill.",
            data: {
              skill: toSkillJson(skill),
              content: range.content,
              startLine: range.startLine,
              endLine: range.endLine,
              totalLines: range.totalLines,
              truncated: range.truncated
            }
          }),
          formatSuccessDisplayText({
            name: skill.name,
            path: skill.relativePath,
            startLine: range.startLine,
            endLine: range.endLine,
            totalLines: range.totalLines,
            truncated: range.truncated
          })
        );
      } catch (error) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "SKILL_READ_FAILED",
            message:
              error instanceof Error
                ? error.message
                : "Failed to read the requested workspace skill.",
            data: {
              skill: toSkillJson(skill)
            }
          }),
          formatFailureDisplayText({
            skillName: skill.name,
            path: skill.relativePath,
            reason: "read failed"
          })
        );
      }
    }
  };
}
