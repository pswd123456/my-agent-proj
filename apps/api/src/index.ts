import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";

const app = new Hono();

app.get("/", (c) => {
  return c.json({
    name: "ai-app-template-api",
    status: "ok"
  });
});

app.get("/health", (c) => {
  const health = z.object({
    status: z.literal("ok"),
    service: z.literal("api")
  });

  return c.json(
    health.parse({
      status: "ok",
      service: "api"
    })
  );
});

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);

serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    console.log(`API listening on http://localhost:${info.port}`);
  }
);
