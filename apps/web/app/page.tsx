const lanes = [
  {
    title: "Web",
    description: "Next.js App Router shell for the first user-facing surface."
  },
  {
    title: "API",
    description: "Hono service boundary for web, mobile, and future clients."
  },
  {
    title: "Worker",
    description: "Background lane for jobs, agent runs, and scheduled workflows."
  }
];

const stack = [
  "TypeScript",
  "Next.js",
  "Hono",
  "LangGraph.js",
  "PostgreSQL"
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-stone-950 text-stone-50">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-20">
        <p className="text-sm uppercase tracking-[0.28em] text-stone-400">
          AI App Template
        </p>
        <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
          Start with the backend shape, then let the interface catch up.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-300">
          This starter is organized for a single developer building an AI-first
          product with Codex. Keep the domain, API contracts, and agent runtime
          clean first, then layer on the MVP UI.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {stack.map((item) => (
            <span
              key={item}
              className="rounded-full border border-stone-800 bg-stone-900/80 px-4 py-2 text-sm text-stone-300"
            >
              {item}
            </span>
          ))}
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {lanes.map((lane) => (
            <article
              key={lane.title}
              className="rounded-2xl border border-stone-800 bg-stone-900/70 p-5"
            >
              <h2 className="text-sm font-medium text-stone-200">
                {lane.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-400">
                {lane.description}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
