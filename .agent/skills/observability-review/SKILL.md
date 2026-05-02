---
name: observability_review
description: Diagnose concrete my-agent-proj runtime issues by deciding whether to inspect trace or query system logs; query logs first for API or worker health, repeated noisy events, requestId or runId correlated failures, and raw errors, then inspect trace for turn-by-turn agent runtime reconstruction.
---

# Observability Review

Use this skill when the task is to diagnose a concrete `my-agent-proj` runtime issue, or to review whether trace and system-log coverage is good enough for fast debugging.

## First checks

1. Read `docs/architecture/trace-debugging.md` and `docs/architecture/workspace-agent-config.md`.
2. If the task is about a real failure or suspicious runtime behavior, start from live evidence before reading broad code:
   - `bun run trace:inspect -- list --limit 10`
   - `bun run trace:inspect -- inspect --latest`
3. Inspect these seams before proposing observability changes:
   - `packages/agent/src/trace.ts`
   - `packages/agent/src/system-log.ts`
   - `packages/agent/src/runtime/run-loop.ts`
   - `packages/agent/src/runtime/tool-execution.ts`
   - `packages/agent/src/runtime/permission.ts`
   - `packages/agent/src/runtime.ts`
   - `packages/agent/src/background-tasks/runner.ts`
   - `apps/api/src/app.ts`
   - `apps/worker/src/index.ts`
   - `scripts/trace-log-inspector.ts`

## When To Query Logs First

Query logs before expanding trace when you need fast operational diagnosis:

- the user asks why the API, worker, or runtime looks unhealthy
- you suspect repeated noisy or misleading events
- you already have `sessionId`, `runId`, or `requestId` and want the shortest path to related failures
- you need raw stack, SQL, stderr, or request-scoped errors
- you want to confirm whether a failure is component-local before reconstructing the full agent turn

## When To Inspect Trace First

Inspect trace before broad log spelunking when you need agent-runtime reconstruction:

- why a run stopped
- which tool call is pending or failed
- whether a pause is expected permission or user input versus a runtime bug
- prompt or cache composition questions
- turn-by-turn tool, thinking, response, compaction, background notification, or fallback flow

## How To Query Logs

1. Fastest session-scoped view through the inspector:
   - latest session: `bun run trace:inspect -- inspect --latest --include logs --log-limit 20`
   - specific session: `bun run trace:inspect -- inspect --session <sessionId> --include logs --log-limit 20`
2. Error-focused slice:
   - `bun run trace:inspect -- inspect --session <sessionId> --errors-only --include raw-errors,logs`
3. If the API server is up and you need structured filters that trace inspector does not expose directly, query `/system-logs`:
   - `curl 'http://localhost:3001/system-logs?sessionId=<sessionId>&component=worker&runId=<runId>&requestId=<requestId>&limit=20'`
4. If you only need a raw file sample or event frequency, query the JSONL directly:
   - by session: `rg '"sessionId":"<sessionId>"' tmp/agent-sessions/logs/system.log.jsonl*`
   - by run: `rg '"runId":"<runId>"' tmp/agent-sessions/logs/system.log.jsonl*`
   - noisy events overview: `rg -o '"component":"[^"]+","event":"[^"]+"' tmp/agent-sessions/logs/system.log.jsonl* | sort | uniq -c | sort -nr | head -20`

## Default Diagnosis Flow

1. List recent sessions: `bun run trace:inspect -- list --limit 10`
2. Inspect one session summary: `bun run trace:inspect -- inspect --session <sessionId>`
3. If the question is operational, query logs first with `--include logs` or `/system-logs`.
4. If the question is runtime reconstruction, expand the trace sections you need.
5. Only then propose observability gaps or code changes.

## Trace Review

1. Check whether each meaningful runtime phase emits a structured trace event, not just free-form text.
2. Look for missing correlation fields that prevent per-run slicing or joining to logs, especially `runId`, `requestId`, task ids, and parent or child session links.
3. Verify the event model can explain:
   - why a run stopped
   - which tool call is pending or failed
   - whether a wait is expected permission or user input versus a runtime bug
   - whether retries, rewrite recovery, resume, and detached background work can be separated cleanly
4. Start with the inspector before raw JSONL:
   - `bun run trace:inspect -- list --limit 10`
   - `bun run trace:inspect -- inspect --latest`
5. Expand only the needed sections:
   - prompt or cache issues: `--include prompt,response`
   - tool failures: `--include tool-input,tool-output,logs`
   - permission or HITL pauses: `--include permissions,logs`
   - crashes: `--errors-only --include raw-errors,logs`

## Log Review

1. Check whether logs can answer the first operational questions without reading full trace:
   - which request, run, or session failed
   - which component failed
   - whether the worker, API, or runtime is noisy or unhealthy
   - whether the last error still contains the actionable stack, query, or stderr
2. Verify correlation and filterability for:
   - `sessionId`
   - `runId`
   - `requestId`
   - `turnCount`
   - worker or background-task identity when relevant
3. Review event naming and noise. Read a small live sample and count repeated events before proposing new ones.
4. Prefer high-signal lifecycle logs around:
   - run start and completion
   - tool dispatch and result
   - permission request, approve, and reject
   - background task claim, run, timeout, cancel, and completion
   - API request failure and force-stop paths
5. Treat aggressive truncation as a review point when it hides the real failure.

## Live evidence

- Use `bun run trace:inspect` plus a small shell summary over `tmp/agent-sessions/logs/system.log.jsonl*` to see what events dominate.
- Distinguish `schema exists` from `field is actually written and queryable`.
- Distinguish `trace can theoretically hold it` from `default inspector or API makes it easy to find`.

## Output format

Report findings first, ordered by severity.

For each finding include:

- what is missing, misleading, or noisy
- exact file and line reference
- why it slows debugging or weakens runtime-quality evaluation
- the smallest next fix

Keep trace gaps and log gaps separate unless the same correlation problem affects both.

## Non-goals

- Do not treat session snapshot as a trace replacement.
- Do not recommend external observability platforms before fixing repo-local signal quality.
- Do not collapse trace and log into one channel; trace is for runtime reconstruction, log is for operational diagnosis.
