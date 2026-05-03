import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  discoverWorkspaceSkills,
  filterWorkspaceSkills
} from "../src/skills/index.js";

async function createWorkspaceRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-skills-"));
}

describe("discoverWorkspaceSkills", () => {
  test("returns an empty result when .agents/skills is missing", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      const result = await discoverWorkspaceSkills(workspaceRoot);
      expect(result.skills).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("loads valid skills and keeps only name/description metadata", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const skillDirectory = path.join(
      workspaceRoot,
      ".agents/skills/repo-reader"
    );

    try {
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(
        path.join(skillDirectory, "SKILL.md"),
        [
          "---",
          "name: repo_reader",
          "description: Read repository structure before implementation.",
          "---",
          "",
          "# Repo Reader",
          "",
          "Long body that should not matter."
        ].join("\n"),
        "utf8"
      );

      const result = await discoverWorkspaceSkills(workspaceRoot);
      expect(result.skills).toEqual([
        {
          name: "repo_reader",
          description: "Read repository structure before implementation.",
          relativePath: ".agents/skills/repo-reader/SKILL.md"
        }
      ]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("ignores invalid skills and records diagnostics", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const validSkillDirectory = path.join(
      workspaceRoot,
      ".agents/skills/test-helper"
    );
    const invalidSkillDirectory = path.join(
      workspaceRoot,
      ".agents/skills/bad-skill"
    );

    try {
      await mkdir(validSkillDirectory, { recursive: true });
      await mkdir(invalidSkillDirectory, { recursive: true });

      await writeFile(
        path.join(validSkillDirectory, "skill.md"),
        [
          "---",
          "name: test_helper",
          "description: Suggest minimal validation steps.",
          "---"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        path.join(invalidSkillDirectory, "SKILL.md"),
        "# Missing frontmatter",
        "utf8"
      );

      const result = await discoverWorkspaceSkills(workspaceRoot);
      expect(result.skills).toEqual([
        {
          name: "test_helper",
          description: "Suggest minimal validation steps.",
          relativePath: ".agents/skills/test-helper/skill.md"
        }
      ]);
      expect(result.diagnostics).toEqual([
        {
          relativePath: ".agents/skills/bad-skill/SKILL.md",
          reason: "missing_frontmatter",
          message: "Skill file is missing valid frontmatter."
        }
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("deduplicates skills by name after sorting and records duplicates", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const skillDirectoryA = path.join(workspaceRoot, ".agents/skills/a-skill");
    const skillDirectoryB = path.join(workspaceRoot, ".agents/skills/b-skill");

    try {
      await mkdir(skillDirectoryA, { recursive: true });
      await mkdir(skillDirectoryB, { recursive: true });

      const sharedContent = [
        "---",
        "name: repo_reader",
        "description: Read repository structure before implementation.",
        "---"
      ].join("\n");

      await writeFile(
        path.join(skillDirectoryA, "SKILL.md"),
        sharedContent,
        "utf8"
      );
      await writeFile(
        path.join(skillDirectoryB, "SKILL.md"),
        sharedContent,
        "utf8"
      );

      const result = await discoverWorkspaceSkills(workspaceRoot);
      expect(result.skills).toEqual([
        {
          name: "repo_reader",
          description: "Read repository structure before implementation.",
          relativePath: ".agents/skills/a-skill/SKILL.md"
        }
      ]);
      expect(result.diagnostics).toEqual([
        {
          relativePath: ".agents/skills/b-skill/SKILL.md",
          reason: "duplicate_name",
          message: "Duplicate skill name ignored: repo_reader"
        }
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("filters discovered skills through workspace skill settings", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const repoReaderDir = path.join(workspaceRoot, ".agents/skills/repo-reader");
    const plannerDir = path.join(workspaceRoot, ".agents/skills/planner");

    try {
      await mkdir(repoReaderDir, { recursive: true });
      await mkdir(plannerDir, { recursive: true });
      await writeFile(
        path.join(repoReaderDir, "SKILL.md"),
        [
          "---",
          "name: repo_reader",
          "description: Read repository structure before implementation.",
          "---"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        path.join(plannerDir, "SKILL.md"),
        [
          "---",
          "name: schedule_planner",
          "description: Plan schedules and summarize conflicts.",
          "---"
        ].join("\n"),
        "utf8"
      );

      const result = await discoverWorkspaceSkills(workspaceRoot);
      expect(
        filterWorkspaceSkills(result.skills, [
          {
            skillName: "repo_reader",
            enabled: false
          }
        ])
      ).toEqual([
        {
          name: "schedule_planner",
          description: "Plan schedules and summarize conflicts.",
          relativePath: ".agents/skills/planner/SKILL.md"
        }
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
