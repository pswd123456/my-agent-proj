import type { Metadata } from "next";

import { getAppThemeStyle } from "./_components/app-theme";
import { AppThemeProvider } from "./_components/app-theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ai-app-template",
  description:
    "AI-first full-stack app template with Next.js, Hono, LangGraph, and PostgreSQL."
};

const themeVariables = getAppThemeStyle("night");

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning style={themeVariables}>
        <AppThemeProvider>{children}</AppThemeProvider>
      </body>
    </html>
  );
}
