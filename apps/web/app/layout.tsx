import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { semantic, foundation } from "@ai-app-template/tokens";
import "./globals.css";

export const metadata: Metadata = {
  title: "ai-app-template",
  description:
    "AI-first full-stack app template with Next.js, Hono, LangGraph, and PostgreSQL."
};

const themeVariables = {
  "--app-bg-canvas": semantic.color.bg.canvas,
  "--app-bg-surface": semantic.color.bg.surface,
  "--app-bg-elevated": semantic.color.bg.elevated,
  "--app-bg-muted": semantic.color.bg.muted,
  "--app-text-primary": semantic.color.text.primary,
  "--app-text-secondary": semantic.color.text.secondary,
  "--app-text-muted": semantic.color.text.muted,
  "--app-border-subtle": semantic.color.border.subtle,
  "--app-border-strong": semantic.color.border.strong,
  "--app-border-accent": semantic.color.border.accent,
  "--app-accent": semantic.color.text.accent,
  "--app-status-success": semantic.color.status.success,
  "--app-status-warning": semantic.color.status.warning,
  "--app-status-danger": semantic.color.status.danger,
  "--app-control-field-bg": semantic.control.field.background,
  "--app-control-field-border": semantic.control.field.border,
  "--app-control-field-border-hover": semantic.control.field.borderHover,
  "--app-control-field-border-focus": semantic.control.field.borderFocus,
  "--app-control-menu-bg": semantic.control.menu.background,
  "--app-control-menu-border": semantic.control.menu.border,
  "--app-control-menu-item-hover": semantic.control.menu.itemHover,
  "--app-control-menu-item-selected": semantic.control.menu.itemSelected,
  "--app-control-menu-icon": semantic.control.menu.icon,
  "--app-font-sans": foundation.typography.fontFamily.sans,
  "--app-font-mono": foundation.typography.fontFamily.mono,
  "--app-shadow-sm": foundation.shadow.sm,
  "--app-shadow-md": foundation.shadow.md,
  "--app-radius-md": foundation.radius.md,
  "--app-radius-lg": foundation.radius.lg,
  "--app-radius-xl": foundation.radius.xl,
  "--app-switch-width": "2.75rem",
  "--app-switch-height": "1.625rem",
  "--app-switch-padding": "0.1875rem",
  "--app-switch-track-off": "rgba(246, 239, 223, 0.14)",
  "--app-switch-track-on": foundation.color.jade[700],
  "--app-switch-thumb": foundation.color.sand[50],
  "--app-motion-standard": foundation.motion.duration.moderate,
  "--app-ease-standard": foundation.motion.easing.standard
} as CSSProperties;

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning style={themeVariables}>
        {children}
      </body>
    </html>
  );
}
