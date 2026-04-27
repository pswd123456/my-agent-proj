---
name: skill_creator
description: Create or update workspace skills under .agent/skills with concise, discoverable metadata and stable repo-aware instructions.
---

# Skill Creator

Use this skill when the task is to add, revise, or validate a workspace skill for this project agent.

## Workflow

1. Read the root `AGENTS.md` and the nearest `AGENTS.md` for any target files.
2. Check `docs/architecture/workspace-agent-config.md` and `docs/plan/stage3.md` when skill loading or prompt impact matters.
3. Keep each skill small: one `SKILL.md`, with optional `references/` or `scripts/` only when they add real value.
4. Write stable frontmatter with only `name` and `description`.
5. Prefer repo-grounded instructions over generic advice; point to the exact files or commands the agent should inspect.
6. Do not invent skills or capabilities that are not present in `.agent/skills/`.
7. Verify discoverability with the skill loader or a focused test when the new skill should be loaded by runtime.

## Writing rules

- Keep the body concise and action-oriented.
- Use short, direct steps instead of long explanations.
- Avoid extra docs unless they materially improve the workflow.
