import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createLoadSkillTool,
  createSearchSkillTool
} from "../src/tools/index.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";

async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "skill-tools-"));
}

function createContext(workingDirectory: string): ToolExecutionContext {
  return {
    sessionId: "session-1",
    userId: "user-1",
    workingDirectory,
    routineRepository: undefined as never,
    sessionManager: undefined as never,
    sessionContext: {
      status: "running",
      currentDateContext: "2026-04-28",
      yoloMode: false,
      planModeEnabled: false,
      taskBriefPath: null,
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    },
    permissionRules: {
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    },
    sessionMessages: []
  };
}

describe("skill tools", () => {
  test("search_skill ranks matching workspace skills and reports diagnostics", async () => {
    const workspace = await createWorkspace();

    try {
      const repoReaderDir = path.join(
        workspace,
        ".agent",
        "skills",
        "repo-reader"
      );
      const plannerDir = path.join(workspace, ".agent", "skills", "planner");
      const invalidDir = path.join(workspace, ".agent", "skills", "broken");
      await mkdir(repoReaderDir, { recursive: true });
      await mkdir(plannerDir, { recursive: true });
      await mkdir(invalidDir, { recursive: true });
      await writeFile(
        path.join(repoReaderDir, "SKILL.md"),
        [
          "---",
          "name: repo_reader",
          "description: Read repository structure before implementation.",
          "---",
          "",
          "# Repo Reader"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        path.join(plannerDir, "SKILL.md"),
        [
          "---",
          "name: schedule_planner",
          "description: Plan schedules and summarize conflicts.",
          "---",
          "",
          "# Planner"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        path.join(invalidDir, "SKILL.md"),
        "# Missing frontmatter",
        "utf8"
      );

      const result = await createSearchSkillTool(workspace).execute(
        {
          query: "repo"
        },
        createContext(workspace)
      );

      expect(result.state).toBe("success");
      expect(result.result.data).toMatchObject({
        query: "repo",
        matchCount: 1,
        returnedCount: 1,
        truncated: false,
        matches: [
          {
            name: "repo_reader",
            relativePath: ".agent/skills/repo-reader/SKILL.md"
          }
        ],
        diagnostics: [
          {
            relativePath: ".agent/skills/broken/SKILL.md",
            reason: "missing_frontmatter"
          }
        ]
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("load_skill reads a workspace skill by name with line windows", async () => {
    const workspace = await createWorkspace();

    try {
      const skillDir = path.join(workspace, ".agent", "skills", "repo-reader");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: repo_reader",
          "description: Read repository structure before implementation.",
          "---",
          "",
          "# Repo Reader",
          "",
          "1. Search the repository first.",
          "2. Read only the narrow files you need."
        ].join("\n"),
        "utf8"
      );

      const result = await createLoadSkillTool(workspace).execute(
        {
          skillName: "repo_reader",
          offset: 5,
          limit: 2
        },
        createContext(workspace)
      );

      expect(result.state).toBe("success");
      expect(result.result.data).toMatchObject({
        skill: {
          name: "repo_reader",
          relativePath: ".agent/skills/repo-reader/SKILL.md"
        },
        content: "# Repo Reader\n",
        startLine: 6,
        endLine: 7,
        totalLines: 9,
        truncated: false
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("load_skill reports missing skills with visible alternatives", async () => {
    const workspace = await createWorkspace();

    try {
      const skillDir = path.join(workspace, ".agent", "skills", "repo-reader");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: repo_reader",
          "description: Read repository structure before implementation.",
          "---"
        ].join("\n"),
        "utf8"
      );

      const result = await createLoadSkillTool(workspace).execute(
        {
          skillName: "missing_skill"
        },
        createContext(workspace)
      );

      expect(result.state).toBe("failed");
      expect(result.result).toMatchObject({
        ok: false,
        code: "SKILL_NOT_FOUND",
        data: {
          requestedSkillName: "missing_skill",
          availableSkills: [
            {
              name: "repo_reader",
              relativePath: ".agent/skills/repo-reader/SKILL.md"
            }
          ]
        }
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("hidden workspace skills stay unavailable to search_skill and load_skill", async () => {
    const workspace = await createWorkspace();

    try {
      const visibleDir = path.join(workspace, ".agent", "skills", "planner");
      const hiddenDir = path.join(workspace, ".agent", "skills", "repo-reader");
      await mkdir(visibleDir, { recursive: true });
      await mkdir(hiddenDir, { recursive: true });
      await writeFile(
        path.join(visibleDir, "SKILL.md"),
        [
          "---",
          "name: schedule_planner",
          "description: Plan schedules and summarize conflicts.",
          "---"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        path.join(hiddenDir, "SKILL.md"),
        [
          "---",
          "name: repo_reader",
          "description: Read repository structure before implementation.",
          "---"
        ].join("\n"),
        "utf8"
      );

      const workspaceSkillSettings = [
        {
          skillName: "repo_reader",
          enabled: false
        }
      ] as const;
      const searchResult = await createSearchSkillTool(
        workspace,
        workspaceSkillSettings
      ).execute(
        {
          query: "repo"
        },
        createContext(workspace)
      );
      expect(searchResult.state).toBe("success");
      expect(searchResult.result.data).toMatchObject({
        matchCount: 0,
        returnedCount: 0,
        matches: []
      });

      const loadResult = await createLoadSkillTool(
        workspace,
        workspaceSkillSettings
      ).execute(
        {
          skillName: "repo_reader"
        },
        createContext(workspace)
      );
      expect(loadResult.state).toBe("failed");
      expect(loadResult.result).toMatchObject({
        code: "SKILL_NOT_FOUND",
        data: {
          requestedSkillName: "repo_reader",
          availableSkills: [
            {
              name: "schedule_planner",
              relativePath: ".agent/skills/planner/SKILL.md"
            }
          ]
        }
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
