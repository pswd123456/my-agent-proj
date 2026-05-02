"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

import {
  APP_THEME_STORAGE_KEY,
  applyAppThemeVariables,
  isAppThemeMode,
  type AppThemeMode
} from "./app-theme";

interface AppThemeContextValue {
  mode: AppThemeMode;
  setMode: (mode: AppThemeMode) => void;
  toggleMode: () => void;
}

const AppThemeContext = createContext<AppThemeContextValue>({
  mode: "night",
  setMode: () => undefined,
  toggleMode: () => undefined
});

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppThemeMode>("night");

  useEffect(() => {
    const savedMode = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (isAppThemeMode(savedMode)) {
      setModeState(savedMode);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.appTheme = mode;
    document.documentElement.style.colorScheme =
      mode === "day" ? "light" : "dark";
    applyAppThemeVariables(document.body, mode);
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, mode);
  }, [mode]);

  const value = useMemo<AppThemeContextValue>(() => {
    const setMode = (nextMode: AppThemeMode) => setModeState(nextMode);
    const toggleMode = () =>
      setModeState((current) => (current === "day" ? "night" : "day"));

    return {
      mode,
      setMode,
      toggleMode
    };
  }, [mode]);

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(AppThemeContext);
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.75v1.1" />
      <path d="M8 13.15v1.1" />
      <path d="m3.58 3.58.78.78" />
      <path d="m11.64 11.64.78.78" />
      <path d="M1.75 8h1.1" />
      <path d="M13.15 8h1.1" />
      <path d="m3.58 12.42.78-.78" />
      <path d="m11.64 4.36.78-.78" />
      <circle cx="8" cy="8" r="2.75" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.62 10.58A5.2 5.2 0 0 1 5.42 3.38 5.22 5.22 0 1 0 12.62 10.58Z" />
    </svg>
  );
}

export function AppThemeToggle() {
  const { mode, toggleMode } = useAppTheme();
  const isDayMode = mode === "day";
  const label = isDayMode ? "切换夜间模式" : "切换日间模式";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={toggleMode}
      className="inline-flex h-8 items-center gap-2 rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 text-[0.72rem] font-medium uppercase tracking-[0.14em] text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
    >
      {isDayMode ? <SunIcon /> : <MoonIcon />}
      <span>{isDayMode ? "日间" : "夜间"}</span>
    </button>
  );
}
