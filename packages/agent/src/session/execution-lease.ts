import { DEFAULT_EXECUTION_LEASE_TIMEOUT_MS } from "./contracts.js";

export interface ExecutionLeaseRow {
  activeRunId: string | null;
  activeRunStartedAt: string | Date | null;
}

export function toIsoString(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const tzMatch = normalized.match(/([+-]\d{2})(\d{2})?$/);
  const hasExplicitTimeZone =
    normalized.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(normalized) || tzMatch;
  const parsedValue = tzMatch
    ? normalized.replace(
        /([+-]\d{2})(\d{2})?$/,
        (_, hours: string, minutes?: string) => `${hours}:${minutes ?? "00"}`
      )
    : normalized;

  return new Date(
    hasExplicitTimeZone ? parsedValue : `${normalized}Z`
  ).toISOString();
}

export function hasActiveExecutionLease(input: {
  activeRunId: string | null;
  activeRunStartedAt: string | Date | null;
  now?: number;
  staleAfterMs?: number;
}): boolean {
  if (!input.activeRunId) {
    return false;
  }

  const staleAfterMs =
    typeof input.staleAfterMs === "number"
      ? input.staleAfterMs
      : DEFAULT_EXECUTION_LEASE_TIMEOUT_MS;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
    return true;
  }

  if (!input.activeRunStartedAt) {
    return false;
  }

  const startedAtMs = new Date(input.activeRunStartedAt).getTime();
  if (!Number.isFinite(startedAtMs)) {
    return false;
  }

  const now = input.now ?? Date.now();
  return now - startedAtMs < staleAfterMs;
}

export function resolveExecutionLeaseStaleBefore(
  staleAfterMs?: number,
  now = Date.now()
): string | null {
  if (typeof staleAfterMs !== "number" || staleAfterMs < 0) {
    return null;
  }

  return new Date(now - staleAfterMs).toISOString();
}

export function shouldTreatRunAsInterrupted(input: {
  runId: string;
  lease: Pick<ExecutionLeaseRow, "activeRunId">;
  loopState: string;
  interruptRequested: boolean;
}): boolean {
  if (input.lease.activeRunId !== input.runId) {
    return (
      input.loopState === "interrupted" || input.lease.activeRunId !== null
    );
  }

  return input.interruptRequested;
}
