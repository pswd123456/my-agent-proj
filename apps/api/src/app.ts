import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  createCronJobBodySchema,
  cronJobResponseSchema,
  listCronJobsResponseSchema,
  updateCronJobBodySchema
} from "./cron-jobs.js";
import type { ApiAppContext, ApiAppDependencies } from "./app-context.js";
export type { ApiAppContext, ApiAppDependencies } from "./app-context.js";
import {
  buildErrorPayload,
  buildModelCatalog,
  buildSettingsPermissionMetadata,
  chooseDirectoryBodySchema,
  getRequestId,
  logApiEvent
} from "./app-shared.js";
import { registerObservabilityRoutes } from "./observability-routes.js";
import { registerSessionRoutes } from "./sessions-routes.js";
import { registerSettingsRoutes } from "./settings-routes.js";
import { registerTelegramRoutes } from "./telegram-routes.js";

export function createApiApp(dependencies: ApiAppDependencies) {
  const app = new Hono<ApiAppContext>();
  const settingsPermissionTools = buildSettingsPermissionMetadata(dependencies);
  const settingsPermissionToolNames = settingsPermissionTools.map(
    (tool) => tool.name
  );

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id")?.trim() || randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
  });

  app.onError(async (error, c) => {
    const requestId = getRequestId(c);
    const payload = buildErrorPayload(error, requestId);
    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "request_failed",
      level: "error",
      details: payload.error
    });
    const response = c.json(payload, payload.error.status);
    response.headers.set("x-request-id", requestId);
    return response;
  });

  app.get("/", (c) => {
    return c.json({
      name: "my-agent-proj-api",
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

  app.get("/models", (c) => {
    return c.json(buildModelCatalog(dependencies));
  });

  registerTelegramRoutes({ app, dependencies });
  registerSettingsRoutes({
    app,
    dependencies,
    settingsPermissionTools
  });
  registerSessionRoutes({
    app,
    dependencies,
    settingsPermissionToolNames
  });
  registerObservabilityRoutes({ app, dependencies });

  app.get("/cron-jobs", async (c) => {
    if (!dependencies.cronJobRepository) {
      return c.json({ error: "Cron jobs are not configured." }, 503);
    }

    const cronJobs = await dependencies.cronJobRepository.list();
    return c.json(listCronJobsResponseSchema.parse({ cronJobs }));
  });

  app.post("/cron-jobs", async (c) => {
    if (!dependencies.cronJobRepository) {
      return c.json({ error: "Cron jobs are not configured." }, 503);
    }

    const requestId = getRequestId(c);
    const body = createCronJobBodySchema.parse(await c.req.json());
    const requestedModel =
      typeof body.model === "string"
        ? (await import("./app-shared.js")).resolveRequestedModel(
            dependencies,
            body.model
          ).model
        : undefined;
    const cronJob = await dependencies.cronJobRepository.create({
      ...body,
      workingDirectory: dependencies.buildWorkingDirectory(
        body.workingDirectory
      ),
      ...(requestedModel ? { model: requestedModel } : {})
    });

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "cron_job_created",
      details: { cronJobId: cronJob.id }
    });

    return c.json(cronJobResponseSchema.parse({ cronJob }), 201);
  });

  app.patch("/cron-jobs/:cronJobId", async (c) => {
    if (!dependencies.cronJobRepository) {
      return c.json({ error: "Cron jobs are not configured." }, 503);
    }

    const requestId = getRequestId(c);
    const cronJobId = c.req.param("cronJobId");
    const body = updateCronJobBodySchema.parse(await c.req.json());
    const requestedModel =
      body.model === null
        ? null
        : typeof body.model === "string"
          ? (await import("./app-shared.js")).resolveRequestedModel(
              dependencies,
              body.model
            ).model
          : undefined;
    const cronJob = await dependencies.cronJobRepository.update(cronJobId, {
      ...body,
      ...(typeof body.workingDirectory === "string"
        ? {
            workingDirectory: dependencies.buildWorkingDirectory(
              body.workingDirectory
            )
          }
        : {}),
      ...(typeof requestedModel === "string" || requestedModel === null
        ? { model: requestedModel }
        : {})
    });

    if (!cronJob) {
      return c.json({ error: "Cron job not found." }, 404);
    }

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "cron_job_updated",
      details: { cronJobId }
    });

    return c.json(cronJobResponseSchema.parse({ cronJob }));
  });

  app.delete("/cron-jobs/:cronJobId", async (c) => {
    if (!dependencies.cronJobRepository) {
      return c.json({ error: "Cron jobs are not configured." }, 503);
    }

    const requestId = getRequestId(c);
    const cronJobId = c.req.param("cronJobId");
    const removed = await dependencies.cronJobRepository.remove(cronJobId);
    if (!removed) {
      return c.json({ error: "Cron job not found." }, 404);
    }

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "cron_job_deleted",
      details: { cronJobId }
    });

    return c.body(null, 204);
  });

  app.post("/directory-picker", async (c) => {
    if (!dependencies.pickDirectory) {
      return c.json({ error: "Directory picker is not configured." }, 501);
    }

    const body = chooseDirectoryBodySchema.parse(await c.req.json());
    const selectedPath = await dependencies.pickDirectory(
      body.startDirectory ? { startDirectory: body.startDirectory } : undefined
    );
    return c.json({
      path: selectedPath,
      canceled: selectedPath === null
    });
  });

  return app;
}
