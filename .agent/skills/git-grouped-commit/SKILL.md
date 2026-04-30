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

## Example

Given this `git status`:

```
 M apps/api/src/app.ts
 M apps/api/tests/app-settings.test.ts
 M apps/web/app/_components/session-workbench.tsx
 M apps/web/app/_components/session-workbench-state.ts
?? apps/web/app/_components/session-composer-commands.ts
?? apps/web/app/_components/session-composer-commands.test.ts
 M packages/agent/src/prompt.ts
 M packages/agent/src/runtime.ts
 M packages/agent/tests/prompt-skills.test.ts
?? packages/agent/src/context-hooks.ts
?? packages/agent/tests/context-hooks.test.ts
 M packages/db/src/schema.ts
?? packages/db/migrations/0019_fearless_quasar.sql
?? packages/db/migrations/meta/0019_snapshot.json
 M docs/architecture/overview.md
 M docs/architecture/workspace-agent-config.md
```

### Grouping result

| Group | Files |
|---|---|
| `apps/api` | `apps/api/src/app.ts`, `apps/api/tests/app-settings.test.ts` |
| `apps/web` | `apps/web/app/_components/session-workbench.tsx`, `apps/web/app/_components/session-workbench-state.ts`, `apps/web/app/_components/session-composer-commands.ts`, `apps/web/app/_components/session-composer-commands.test.ts` |
| `packages/agent` | `packages/agent/src/prompt.ts`, `packages/agent/src/runtime.ts`, `packages/agent/tests/prompt-skills.test.ts`, `packages/agent/src/context-hooks.ts`, `packages/agent/tests/context-hooks.test.ts` |
| `packages/db` | `packages/db/src/schema.ts`, `packages/db/migrations/0019_fearless_quasar.sql`, `packages/db/migrations/meta/0019_snapshot.json` |
| `docs` | `docs/architecture/overview.md`, `docs/architecture/workspace-agent-config.md` |

### Commands executed

**Group 1 — `apps/api`:**

```
git add apps/api/src/app.ts apps/api/tests/app-settings.test.ts
git commit -m "feat(api): add app settings endpoint and tests"
```

**Group 2 — `apps/web`:**

```
git add apps/web/app/_components/session-workbench.tsx \
        apps/web/app/_components/session-workbench-state.ts \
        apps/web/app/_components/session-composer-commands.ts \
        apps/web/app/_components/session-composer-commands.test.ts
git commit -m "feat(web): add composer commands panel with workbench state wiring"
```

**Group 3 — `packages/agent`:**

```
git add packages/agent/src/prompt.ts \
        packages/agent/src/runtime.ts \
        packages/agent/tests/prompt-skills.test.ts \
        packages/agent/src/context-hooks.ts \
        packages/agent/tests/context-hooks.test.ts
git commit -m "feat(agent): add context hook infrastructure and update prompt assembly"
```

**Group 4 — `packages/db`:**

```
git add packages/db/src/schema.ts \
        packages/db/migrations/0019_fearless_quasar.sql \
        packages/db/migrations/meta/0019_snapshot.json
git commit -m "feat(db): add migration 0019 for schema changes"
```

**Group 5 — `docs`:**

```
git add docs/architecture/overview.md docs/architecture/workspace-agent-config.md
git commit -m "docs: update architecture overview and agent config documentation"
```

### Summary report

```
Committed 5 groups:
  a1b2c3d feat(api): add app settings endpoint and tests
  e4f5g6h feat(web): add composer commands panel with workbench state wiring
  i7j8k9l feat(agent): add context hook infrastructure and update prompt assembly
  m0n1o2p feat(db): add migration 0019 for schema changes
  q3r4s5t docs: update architecture overview and agent config documentation

All changes committed, working tree clean.
```
