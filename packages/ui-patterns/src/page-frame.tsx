import type { ReactNode } from "react";

interface PageFrameProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}

export function PageFrame({
  eyebrow,
  title,
  description,
  children
}: PageFrameProps) {
  return (
    <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-20">
      <p className="text-sm uppercase tracking-[0.24em] text-stone-400">
        {eyebrow}
      </p>
      <h1 className="mt-6 max-w-3xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
        {title}
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-300">
        {description}
      </p>
      <div className="mt-10">{children}</div>
    </section>
  );
}
