---
name: minimax_file_edit_smoke
description: Use this skill when validating or debugging the MiniMax file-edit smoke path, especially apply_patch loops, localized text removal, permission approvals, and the smoke-specific trace file.
---

# MiniMax File Edit Smoke

Use this skill when the user asks to run, stabilize, or debug `scripts/minimax-file-edit-smoke.ts`.

## Run

From the repo root:

```bash
bun scripts/minimax-file-edit-smoke.ts
```

The script creates an isolated workspace under `tmp/minimax-file-edit-smoke-*`, runs a real MiniMax-backed agent session, auto-approves file-edit permissions up to `maxAutoApprovals`, prints JSON, and asserts the expected path.

The smoke inherits permission settings from the user's saved settings. By default it uses `cli-user`; set `MINIMAX_FILE_EDIT_SMOKE_USER_ID=<userId>` only when you intentionally want to test another user's saved permission profile.

## Healthy Path

Treat the run as healthy when the JSON shows:

- `ok: true`
- `status: "completed"`
- `approvalCount` follows the inherited permission settings: usually `1` when `apply_patch` is ask-only, or `0` when the user settings allow it directly
- `textRemoved`, `classNamePreserved`, `controlFlowPreserved`, `exactContentMatch`, and `singleLineRemovalOnly` are all `true`
- tool path uses one or more successful `search_text` calls, exactly one successful `read_file`, then exactly one successful `apply_patch`
- no `apply_patch` errors, no `write_file`, and no `run_shell_command`
- `finalContent` still preserves the surrounding product structure and only removes the visible text line
- `inheritedPermissionSettings` matches the saved user settings; do not patch the smoke to hard-code tool allow/ask/deny lists

If the successful path is not stable, inspect the trace before changing prompt or tool contracts.

## Trace Debugging

Do not inspect the repo-root `tmp/agent-sessions` for this smoke. The script prints a smoke-specific `stateDirectory` and `tracePath`; use those exact paths.

Overview:

```bash
bun run trace:inspect -- inspect --session <sessionId> --state-dir <stateDirectory>
```

Expand tool inputs and outputs:

```bash
bun run trace:inspect -- inspect --session <sessionId> --state-dir <stateDirectory> --include tool-input,tool-output --max-chars 5000
```

Focus on these signals:

- total `Runs`, `Turns`, `permission_request`, and `permission_approved`
- whether `apply_patch` succeeds with only one removed line
- whether any successful patch removed surrounding structural lines, delimiters, wrappers, or control-flow boundaries
- whether the session drifts into `write_file`, `run_shell_command`, or repeated `read_file`
- whether prompt/tool descriptions caused a retry loop or the tool accepted a bad patch as success

## Fix Bias

Prefer runtime/tool-contract fixes that prevent bad successful edits over adding more prose. Generalize fixes around product-level editing behavior: local content removal should preserve surrounding structure and behavior, regardless of the specific language or framework used by the fixture.
