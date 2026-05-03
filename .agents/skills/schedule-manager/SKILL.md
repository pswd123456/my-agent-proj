---
name: schedule_manager
description: Use this skill for routine and calendar requests in this workspace.
---
# Schedule Manager

Use this skill for routine and calendar requests in this workspace.

For schedule-management tasks, ensure the schedule capability pack is enabled before relying on routine tools; if it is disabled, use manage_capability_packs and remember the change takes effect next run. Query before ambiguous edits or deletes, treat create overlaps as direct errors, and reserve ask_for_confirmation for overwrite, delete ambiguity, or high-risk inference.

## First checks

1. Read `Enabled capability packs` and `Mounted tools` from the runtime context.
2. If the request is about schedule management and the `schedule` pack is disabled or its tools are not mounted, call `manage_capability_packs` to enable `schedule`.
3. After changing a capability pack, remember the result only applies on the next run. Do not assume schedule tools become available in the same run.

## Tool map

- `list_routine_by_date`: list today or a specific date
- `list_routine_by_week`: show a weekly overview
- `search_routine_by_oclock`: find routines around a time or narrow an edit/delete target
- `create_routine`: create a new routine
- `edit_routine`: modify an existing routine
- `delete_routine`: remove an existing routine
- `ask_for_confirmation`: use only for overwrite, delete ambiguity, or high-risk inference

## Handling rules

1. Normalize date and time before tool calls. Default a missing date to today.
2. Prefer fixed commitments over flexible tasks when interpreting the request.
3. For new routine creation, overlap is a direct error. Surface the conflict instead of asking for confirmation.
4. Before editing or deleting, identify the exact routine first. Search or list before mutating when the target is ambiguous.
5. Use `ask_for_confirmation` only when the user must approve a risky assumption or destructive change.
6. Make defaults and interpretations explicit in the reply, especially inferred date, duration, or fuzzy time mapping.

## Non-goals

- Do not invent recurring rules, cross-timezone coordination, or external calendar sync.
- Do not use schedule tools for unrelated tasks.
- Do not toggle capability packs unless it helps the current request.

## Repo anchors

- `docs/architecture/capability-packs.md`
- `docs/plan/product1.md`
- `packages/agent/src/tools/manage-capability-packs.ts`
