import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ai-app-template",
  description: "AI-first full-stack app template with Next.js, Hono, LangGraph, and PostgreSQL."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
