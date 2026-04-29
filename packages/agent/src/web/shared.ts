export const DEFAULT_NETWORK_TIMEOUT_MS = 20_000;
export const MAX_NETWORK_TIMEOUT_MS = 60_000;

export function clampInteger(input: {
  value: number | undefined;
  defaultValue: number;
  min: number;
  max: number;
}): number {
  if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
    return input.defaultValue;
  }

  return Math.min(input.max, Math.max(input.min, Math.floor(input.value)));
}

export function truncateContent(input: { content: string; maxChars: number }): {
  content: string;
  truncated: boolean;
} {
  if (input.content.length <= input.maxChars) {
    return { content: input.content, truncated: false };
  }

  return {
    content: input.content.slice(0, input.maxChars),
    truncated: true
  };
}

export function createTimeoutSignal(input: {
  timeoutMs: number;
  abortSignal?: AbortSignal | undefined;
}): {
  signal: AbortSignal;
  cleanup: () => void;
  isTimedOut: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs);

  const onAbort = () => {
    controller.abort();
  };

  if (input.abortSignal?.aborted) {
    controller.abort();
  } else if (input.abortSignal) {
    input.abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      input.abortSignal?.removeEventListener("abort", onAbort);
    },
    isTimedOut() {
      return timedOut;
    }
  };
}

export function toHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http or https protocol.");
  }

  return url;
}
