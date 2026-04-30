---
name: git_grouped_commit
description: Group uncommitted git changes by logical area and commit them in batches with sensible messages.
---

# Git Grouped Commit

Use this skill when the user asks to commit uncommitted changes by groups, categories, or logical areas — or when the workspace has many uncommitted files spanning multiple modules and a single commit would be too coarse.

## Workflow

### 1. Gather uncommitted changes

Run `git status` at the repo root. Separate results into:

- **Modified** (worktree `M` or staged `M`): already-tracked files with changes.
- **Untracked** (`??`): new files not yet tracked.
- Ignore deleted files unless the user explicitly wants them.

### 2. Group by logical area

Classify every changed file into one of these buckets, using the file path prefix:

| Group | Path prefix | Typical commit prefix |
|---|---|---|
| `apps/api` | `apps/api/` | `feat(api):` |
| `apps/web` | `apps/web/` | `feat(web):` |
| `apps/worker` | `apps/worker/` | `feat(worker):` |
| `packages/agent` | `packages/agent/` | `feat(agent):` |
| `packages/db` | `packages/db/` | `feat(db):` |
| `packages/domain` | `packages/domain/` | `feat(domain):` |
| `packages/sdk` | `packages/sdk/` | `feat(sdk):` |
| `docs` | `docs/` | `docs:` |
| `skills` | `.agent/skills/` | `chore(skills):` |
| `root` | root-level files (no prefix, or `scripts/`, `data/`, etc.) | `chore:` |

A file that matches none of the above goes into a catch-all `other` group.

If a group has zero files, skip it.

### 3. Commit each group automatically

Process every non-empty group one at a time, without asking for confirmation. For each group:

1. **Stage** the group's files: `git add <file1> <file2> ...` (include both modified and untracked files).
2. **Inspect** what changed in the staged diff for that group only: `git diff --cached -- <group-prefix>`. Read enough to understand the intent — skim file names and key changes, don't read every line.
3. **Generate a commit message** following the [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `<type>(<scope>): <short summary>`
   - Type: `feat` for new features/tests, `fix` for corrections, `docs` for docs, `chore` for infra/skills/root, `refactor` for pure restructures.
   - Scope: the group name without prefix (e.g. `api`, `agent`, `db`).
   - Summary: one concise line describing the main change in the group. Derive it from the file paths and diff content. Use imperative mood (e.g. "add context hook infrastructure" not "added context hook infrastructure").
   - If the group touches multiple concerns, add a blank line then bullet points for each sub-change.
4. **Commit**: `git commit -m "<message>"`.
5. Move to the next group.

### 4. Report summary

After all groups are processed, report:

- How many groups were committed
- Each commit's hash and one-line subject
- Remaining uncommitted changes, if any

## Rules

- Do not ask for confirmation at any step. Group, generate messages, and commit directly.
- Never mix files from different groups in one commit.
- If a group has only test files, still treat it as a valid group (use `test:` type prefix).
- When generating commit messages, prefer specificity over vagueness — mention the actual module, feature, or fix, not just "update files".
- Respect `.gitignore`; never force-add ignored files.
