import type { ReactNode } from "react";

interface WorkbenchPanelProps {
  eyebrow: string;
  title: string;
  meta?: string;
  headerActions?: ReactNode;
  children: ReactNode;
}

interface ConversationWorkbenchProps {
  header: ReactNode;
  rail: ReactNode;
  main: ReactNode;
  inspector: ReactNode;
}

export function WorkbenchPanel({
  eyebrow,
  title,
  meta,
  headerActions,
  children
}: WorkbenchPanelProps) {
  return (
    <section className="rounded-[var(--app-radius-xl)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] shadow-[var(--app-shadow-sm)]">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--app-border-subtle)] px-4 py-4">
        <div className="min-w-0">
          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-base font-semibold text-[var(--app-text-primary)]">
            {title}
          </h2>
        </div>
        {meta || headerActions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
            {meta ? (
              <span className="text-xs text-[var(--app-text-muted)]">
                {meta}
              </span>
            ) : null}
            {headerActions}
          </div>
        ) : null}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

export function ConversationWorkbench({
  header,
  rail,
  main,
  inspector
}: ConversationWorkbenchProps) {
  return (
    <main className="min-h-screen bg-[var(--app-bg-canvas)] text-[var(--app-text-primary)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-4 px-4 py-4 lg:px-6">
        <section className="rounded-[var(--app-radius-xl)] border border-[var(--app-border-strong)] bg-[var(--app-bg-elevated)] px-5 py-5 shadow-[var(--app-shadow-md)]">
          {header}
        </section>
        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)_380px]">
          <div className="min-h-0">{rail}</div>
          <div className="min-h-0">{main}</div>
          <div className="min-h-0">{inspector}</div>
        </div>
      </div>
    </main>
  );
}
