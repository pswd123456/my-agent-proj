import { useEffect } from "react";

export function useSyncedRef<T>(ref: { current: T }, value: T) {
  useEffect(() => {
    ref.current = value;
  }, [ref, value]);
}

export function useDebouncedTrimmedValue(input: {
  value: string;
  delayMs: number;
  onChange: (value: string) => void;
}) {
  const { value, delayMs, onChange } = input;

  useEffect(() => {
    if (typeof window === "undefined") {
      onChange(value.trim());
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onChange(value.trim());
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [delayMs, onChange, value]);
}

export function useResponsiveStoredCollapseState(input: {
  mediaQueryText: string;
  storageKey: string;
  resolveCollapsedState: (
    storedValue: string | null,
    narrow: boolean
  ) => boolean;
  onNarrowChange: (value: boolean) => void;
  onCollapsedChange: (value: boolean) => void;
}) {
  const {
    mediaQueryText,
    storageKey,
    resolveCollapsedState,
    onNarrowChange,
    onCollapsedChange
  } = input;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(mediaQueryText);
    const syncState = () => {
      onNarrowChange(mediaQuery.matches);
      const storedValue = window.localStorage.getItem(storageKey);
      onCollapsedChange(resolveCollapsedState(storedValue, mediaQuery.matches));
    };

    syncState();
    mediaQuery.addEventListener("change", syncState);

    return () => {
      mediaQuery.removeEventListener("change", syncState);
    };
  }, [
    mediaQueryText,
    onCollapsedChange,
    onNarrowChange,
    resolveCollapsedState,
    storageKey
  ]);
}
