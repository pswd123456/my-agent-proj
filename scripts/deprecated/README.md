# Deprecated Scripts

This folder keeps scripts that are no longer part of the active maintenance
surface.

- `repair-session-timestamps.ts` was a one-off database repair utility for
  historical session timestamp drift.
- `text-tool-call-fallback-smoke.ts` is superseded by the regular
  `packages/agent/tests/text-tool-call-fallback.test.ts` coverage.

Do not add new package scripts or docs that depend on these files. If either
workflow becomes necessary again, restore it as an active script with current
tests and documentation.
