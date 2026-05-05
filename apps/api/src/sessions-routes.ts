import {
  applyUnifiedPatch,
  createRewriteRewindSnapshot,
  discoverWorkspaceSkills,
  invertUnifiedPatch,
  isForkCheckpointForFinalResponse,
  parseUnifiedPatch,
  searchWorkspaceFiles,
  searchWorkspaceSkills,
  sessionFileChangeActionRequestSchema,
  sessionFileChangeActionResultSchema,
  sessionWorkspaceGitStatusSchema,
  workspaceFileSearchResultSchema,
  workspaceSkillSearchResultSchema
} from "@ai-app-template/agent";
import {
  createSessionPayloadSchema,
  executeSessionPayloadSchema,
  updateSessionSettingsPayloadSchema,
  normalizeCapabilityPacks,
  normalizeSettingsPermissionRules,
  normalizeThinkingEffort
} from "@ai-app-template/domain";
import type {
  RunEventSink,
  RunSessionResult,
  SessionSnapshot
} from "@ai-app-template/agent";

import type { ApiApp, ApiAppDependencies } from "./app-context.js";
import {
  collectSessionTreeSessionIds,
  enrichSessionSnapshotsWithParentRelation
} from "./session-relations.js";
import {
  emitPreRunTraceEvent,
  enqueueRunErrorEvent,
  encodeSseEvent,
  getRequestId,
  logApiEvent,
  resolveDefaultModel,
  resolveRequestedModel,
  searchWorkspaceQuerySchema,
  toCreateSessionInput
} from "./app-shared.js";
import {
  buildMessageHookContentSet,
  countTraceContextTokensBeforeTurn,
  createForkSessionFromCheckpoint,
  createSessionForkBodySchema,
  listForkableCheckpoints,
  matchesSessionSearch,
  normalizeSessionSearchQuery,
  recoverRewriteTargetBodySchema,
  resolveLatestRewriteTarget,
  toSessionForkTarget
} from "./session-route-helpers.js";
import { getSessionWorkspaceGitStatus } from "./session-git-status.js";

interface SessionChannelSummary {
  channel: "telegram";
  externalChatId: string;
}

async function enrichSessionSnapshotsWithInboxChannels(input: {
  sessions: SessionSnapshot[];
  dependencies: ApiAppDependencies;
}): Promise<Array<SessionSnapshot & { channels?: SessionChannelSummary[] }>> {
  const repository = input.dependencies.inboxBindingRepository;
  if (!repository || input.sessions.length === 0) {
    return input.sessions;
  }

  const channelsBySessionId = new Map<string, SessionChannelSummary[]>();
  const telegramBindings = await repository.listByChannel("telegram");
  for (const binding of telegramBindings) {
    if (!binding.activeSessionId) {
      continue;
    }
    const channels = channelsBySessionId.get(binding.activeSessionId) ?? [];
    channels.push({
      channel: "telegram",
      externalChatId: binding.externalChatId
    });
    channelsBySessionId.set(binding.activeSessionId, channels);
  }

  return input.sessions.map((session) => {
    const channels = channelsBySessionId.get(session.sessionId);
    return channels && channels.length > 0 ? { ...session, channels } : session;
  });
}

export function registerSessionRoutes(input: {
  app: ApiApp;
  dependencies: ApiAppDependencies;
  settingsPermissionToolNames: string[];
}) {
  const { app, dependencies, settingsPermissionToolNames } = input;

  app.get("/sessions", async (c) => {
    const sessions = await dependencies.sessionManager.listSessions();
    const enrichedSessions = await enrichSessionSnapshotsWithParentRelation({
      sessions,
      backgroundTaskRepository: dependencies.backgroundTaskRepository
    });
    return c.json({
      sessions: await enrichSessionSnapshotsWithInboxChannels({
        sessions: enrichedSessions,
        dependencies
      })
    });
  });

  app.get("/sessions/search", async (c) => {
    const query = searchWorkspaceQuerySchema.parse(c.req.query());
    const normalizedQuery = normalizeSessionSearchQuery(query.q);
    const sessions = await dependencies.sessionManager.listSessions();
    const matchedSessions = sessions.filter((session) =>
      matchesSessionSearch(session, normalizedQuery)
    );
    const enrichedSessions = await enrichSessionSnapshotsWithParentRelation({
      sessions: matchedSessions,
      backgroundTaskRepository: dependencies.backgroundTaskRepository
    });
    return c.json({
      sessions: await enrichSessionSnapshotsWithInboxChannels({
        sessions: enrichedSessions,
        dependencies
      })
    });
  });

  app.post("/sessions", async (c) => {
    const requestId = getRequestId(c);
    const body = createSessionPayloadSchema.parse(await c.req.json());
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    const requestedModel = resolveRequestedModel(dependencies, body.model);
    const createInput = toCreateSessionInput({
      settings,
      defaultModel: resolveDefaultModel(dependencies),
      modelOverride: requestedModel.model,
      thinkingEffortOverride: body.thinkingEffort,
      workingDirectoryOverride: body.workingDirectory,
      yoloModeOverride: body.yoloMode,
      planModeEnabledOverride: body.planModeEnabled,
      contextWindowOverride: body.contextWindow,
      maxTurnsOverride: body.maxTurns,
      enabledCapabilityPacksOverride: body.enabledCapabilityPacks,
      buildWorkingDirectory: dependencies.buildWorkingDirectory
    });

    const session =
      await dependencies.sessionManager.createSession(createInput);
    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_created",
      sessionId: session.sessionId,
      details: { workingDirectory: session.workingDirectory }
    });
    return c.json({ session }, 201);
  });

  app.get("/sessions/:sessionId", async (c) => {
    const requestId = getRequestId(c);
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_read",
      sessionId,
      details: { found: Boolean(session) }
    });
    const enrichedSession = (
      await enrichSessionSnapshotsWithParentRelation({
        sessions: [session],
        backgroundTaskRepository: dependencies.backgroundTaskRepository
      })
    )[0];
    const channelSession = (
      await enrichSessionSnapshotsWithInboxChannels({
        sessions: [enrichedSession ?? session],
        dependencies
      })
    )[0];
    return c.json({ session: channelSession ?? enrichedSession ?? session });
  });

  app.get("/sessions/:sessionId/fork-targets", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const checkpoints =
      await dependencies.sessionManager.listForkCheckpoints(sessionId);
    const forkableCheckpoints = listForkableCheckpoints(checkpoints);
    const settings =
      await dependencies.settingsConfigStore.getEffectiveSettings(
        session.workingDirectory
      );
    const rewriteTarget = resolveLatestRewriteTarget({
      session,
      checkpoints,
      messageHookContents: buildMessageHookContentSet(settings)
    });
    return c.json({
      sessionId,
      forkTargets: forkableCheckpoints.map(toSessionForkTarget),
      rewriteTarget
    });
  });

  app.post("/sessions/:sessionId/forks", async (c) => {
    const requestId = getRequestId(c);
    const sessionId = c.req.param("sessionId");
    const sourceSession =
      await dependencies.sessionManager.getSession(sessionId);
    if (!sourceSession) {
      return c.json({ error: "Session not found." }, 404);
    }

    const body = createSessionForkBodySchema.parse(await c.req.json());
    const checkpoint =
      (typeof body.checkpointId === "string" &&
      body.checkpointId.trim().length > 0
        ? await dependencies.sessionManager.getForkCheckpoint(
            body.checkpointId.trim()
          )
        : null) ??
      (typeof body.assistantMessageId === "string" &&
      body.assistantMessageId.trim().length > 0
        ? await dependencies.sessionManager.findForkCheckpointByAssistantMessage(
            sessionId,
            body.assistantMessageId.trim()
          )
        : null);

    if (!checkpoint || checkpoint.sessionId !== sessionId) {
      return c.json(
        {
          error:
            "Fork checkpoint not found for this message. Historical reconstruction is not available for this target yet."
        },
        404
      );
    }

    if (!isForkCheckpointForFinalResponse(checkpoint)) {
      return c.json(
        {
          error:
            "Only final assistant responses can be forked. Intermediate progress messages are not valid fork targets."
        },
        409
      );
    }

    const forkSession = await createForkSessionFromCheckpoint({
      dependencies,
      sourceSession,
      checkpoint
    });
    const enrichedSession = (
      await enrichSessionSnapshotsWithParentRelation({
        sessions: [forkSession],
        backgroundTaskRepository: dependencies.backgroundTaskRepository
      })
    )[0];

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_fork_created",
      sessionId: forkSession.sessionId,
      details: {
        parentSessionId: sessionId,
        checkpointId: checkpoint.id,
        assistantMessageId: checkpoint.assistantMessageId
      }
    });

    return c.json({ session: enrichedSession ?? forkSession }, 201);
  });

  app.post("/sessions/:sessionId/rewrite-target/recover", async (c) => {
    const requestId = getRequestId(c);
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    if (await dependencies.sessionManager.isExecutionActive(sessionId)) {
      return c.json({ error: "Session is still running." }, 409);
    }

    if (
      session.context.pendingPermissionRequest ||
      session.context.pendingConfirmationPayload ||
      session.context.pendingUserQuestionPayload ||
      session.sessionState.pendingToolCallIds.length > 0 ||
      session.sessionState.interruptRequested
    ) {
      return c.json(
        {
          error:
            "Rewrite is available only after a completed user turn with no pending approval or question."
        },
        409
      );
    }

    const body = recoverRewriteTargetBodySchema.parse(await c.req.json());
    const checkpoints =
      await dependencies.sessionManager.listForkCheckpoints(sessionId);
    const settings =
      await dependencies.settingsConfigStore.getEffectiveSettings(
        session.workingDirectory
      );
    const rewriteTarget = resolveLatestRewriteTarget({
      session,
      checkpoints,
      messageHookContents: buildMessageHookContentSet(settings)
    });
    if (
      !rewriteTarget ||
      rewriteTarget.checkpointId !== body.checkpointId ||
      rewriteTarget.userMessageId !== body.userMessageId
    ) {
      return c.json(
        { error: "Only the latest rewriteable user message can be rewritten." },
        409
      );
    }

    const checkpoint = checkpoints.find(
      (candidate) => candidate.id === rewriteTarget.checkpointId
    );
    if (!checkpoint) {
      return c.json({ error: "Rewrite checkpoint not found." }, 404);
    }

    const rewindSnapshot = createRewriteRewindSnapshot({
      session,
      checkpoint
    });
    const traceRecords = await dependencies.traceManager.readEvents(sessionId);
    const nextTraceRecords = traceRecords.filter(
      (record) => record.event.turnCount < rewriteTarget.turnCount
    );
    const nextInputTokensCount = countTraceContextTokensBeforeTurn(
      traceRecords,
      rewriteTarget.turnCount
    );
    let recoveredSession =
      await dependencies.sessionManager.recover(rewindSnapshot);
    await dependencies.sessionManager.pruneForkCheckpointsFromTurn(
      sessionId,
      rewriteTarget.turnCount
    );
    await dependencies.traceManager.truncateEventsAfterTurn(
      sessionId,
      rewriteTarget.turnCount
    );
    recoveredSession = await dependencies.sessionManager.saveSession({
      ...recoveredSession,
      inputTokensCount: nextInputTokensCount
    });

    const nextCheckpoints =
      await dependencies.sessionManager.listForkCheckpoints(sessionId);
    const nextForkableCheckpoints = listForkableCheckpoints(nextCheckpoints);
    const nextRewriteTarget = resolveLatestRewriteTarget({
      session: recoveredSession,
      checkpoints: nextCheckpoints,
      messageHookContents: buildMessageHookContentSet(settings)
    });

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_rewrite_recovered",
      sessionId,
      details: {
        checkpointId: rewriteTarget.checkpointId,
        userMessageId: rewriteTarget.userMessageId,
        turnCount: rewriteTarget.turnCount
      }
    });

    return c.json({
      session: recoveredSession,
      traceRecords: nextTraceRecords,
      forkTargets: nextForkableCheckpoints.map(toSessionForkTarget),
      rewriteTarget: nextRewriteTarget
    });
  });

  app.patch("/sessions/:sessionId/settings", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const body = updateSessionSettingsPayloadSchema.parse(await c.req.json());
    const requestedWorkingDirectory =
      typeof body.workingDirectory === "string"
        ? dependencies.buildWorkingDirectory(body.workingDirectory)
        : undefined;
    const requestedModel = resolveRequestedModel(dependencies, body.model);
    const permissionRules = normalizeSettingsPermissionRules(
      {
        shellAllowPatterns:
          body.shellAllowPatterns ?? session.context.shellAllowPatterns,
        shellDenyPatterns:
          body.shellDenyPatterns ?? session.context.shellDenyPatterns,
        toolAllowList: body.toolAllowList ?? session.context.toolAllowList,
        toolAskList: body.toolAskList ?? session.context.toolAskList,
        toolDenyList: body.toolDenyList ?? session.context.toolDenyList
      },
      settingsPermissionToolNames
    );
    let updated = await dependencies.sessionManager.updateContext(sessionId, {
      ...(typeof body.yoloMode === "boolean"
        ? { yoloMode: body.yoloMode }
        : {}),
      ...(typeof body.thinkingEffort === "string"
        ? { thinkingEffort: normalizeThinkingEffort(body.thinkingEffort) }
        : {}),
      ...(typeof body.planModeEnabled === "boolean"
        ? { planModeEnabled: body.planModeEnabled }
        : {}),
      shellAllowPatterns: permissionRules.shellAllowPatterns,
      shellDenyPatterns: permissionRules.shellDenyPatterns,
      toolAllowList: permissionRules.toolAllowList,
      toolAskList: permissionRules.toolAskList,
      toolDenyList: permissionRules.toolDenyList,
      ...(Array.isArray(body.enabledCapabilityPacks)
        ? {
            enabledCapabilityPacks: normalizeCapabilityPacks(
              body.enabledCapabilityPacks
            )
          }
        : {})
    });
    if (requestedWorkingDirectory) {
      updated = await dependencies.sessionManager.setWorkingDirectory(
        sessionId,
        requestedWorkingDirectory
      );
    }
    if (requestedModel.model) {
      updated = await dependencies.sessionManager.setModel(
        sessionId,
        requestedModel.model
      );
    }
    return c.json({ session: updated });
  });

  app.get("/sessions/:sessionId/workspace-files/search", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const query = searchWorkspaceQuerySchema.parse(c.req.query());
    const result = await searchWorkspaceFiles({
      workingDirectory: session.workingDirectory,
      query: query.q,
      maxResults: query.limit
    });

    return c.json(
      workspaceFileSearchResultSchema.parse({
        items: result.matches.map((match) => ({
          path: match.path,
          name: match.name
        })),
        truncated: result.truncated
      })
    );
  });

  app.get("/sessions/:sessionId/skills/search", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const query = searchWorkspaceQuerySchema.parse(c.req.query());
    const discovery = await discoverWorkspaceSkills(session.workingDirectory);
    const result = searchWorkspaceSkills({
      skills: discovery.skills,
      query: query.q,
      maxResults: query.limit,
      allowEmptyQuery: true
    });

    return c.json(
      workspaceSkillSearchResultSchema.parse({
        items: result.matches.map((match) => ({
          name: match.name,
          description: match.description,
          relativePath: match.relativePath
        })),
        truncated: result.truncated
      })
    );
  });

  app.get("/sessions/:sessionId/git-status", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    return c.json(
      sessionWorkspaceGitStatusSchema.parse(
        await getSessionWorkspaceGitStatus(session.workingDirectory)
      )
    );
  });

  app.delete("/sessions/history", async (c) => {
    const sessions = await enrichSessionSnapshotsWithParentRelation({
      sessions: await dependencies.sessionManager.listSessions(),
      backgroundTaskRepository: dependencies.backgroundTaskRepository
    });
    if (sessions.length === 0) {
      return c.body(null, 204);
    }

    const sessionIdsToDelete = new Set<string>();
    const rootSessions = sessions.filter((session) => {
      const parentSessionId = session.parentSessionId?.trim() ?? null;
      return (
        !parentSessionId ||
        parentSessionId === session.sessionId ||
        !sessions.some((candidate) => candidate.sessionId === parentSessionId)
      );
    });

    for (const rootSession of rootSessions) {
      for (const sessionId of collectSessionTreeSessionIds({
        sessions,
        rootSessionId: rootSession.sessionId
      }).reverse()) {
        sessionIdsToDelete.add(sessionId);
      }
    }

    const isAnyExecutionActive = await Promise.all(
      [...sessionIdsToDelete].map((sessionId) =>
        dependencies.sessionManager.isExecutionActive(sessionId)
      )
    );
    if (isAnyExecutionActive.some(Boolean)) {
      return c.json(
        {
          error:
            "One or more sessions are currently running. Wait for active runs to finish before clearing history."
        },
        409
      );
    }

    for (const sessionId of sessionIdsToDelete) {
      await dependencies.sessionManager.deleteSession(sessionId);
      await dependencies.traceManager.deleteEvents(sessionId);
    }

    return c.body(null, 204);
  });

  app.delete("/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const sessions = await enrichSessionSnapshotsWithParentRelation({
      sessions: await dependencies.sessionManager.listSessions(),
      backgroundTaskRepository: dependencies.backgroundTaskRepository
    });
    const sessionIdsToDelete = collectSessionTreeSessionIds({
      sessions,
      rootSessionId: sessionId
    });
    if (sessionIdsToDelete.length === 0) {
      return c.json({ error: "Session not found." }, 404);
    }

    const isAnyExecutionActive = await Promise.all(
      sessionIdsToDelete.map((id) =>
        dependencies.sessionManager.isExecutionActive(id)
      )
    );
    if (isAnyExecutionActive.some(Boolean)) {
      return c.json(
        {
          error:
            "Session or one of its child sessions is currently running. Wait for active runs to finish before deleting it."
        },
        409
      );
    }

    for (const currentSessionId of [...sessionIdsToDelete].reverse()) {
      await dependencies.sessionManager.deleteSession(currentSessionId);
      await dependencies.traceManager.deleteEvents(currentSessionId);
    }
    return c.body(null, 204);
  });

  app.post("/sessions/:sessionId/interrupt", async (c) => {
    const requestId = getRequestId(c);
    const sessionId = c.req.param("sessionId");
    const stoppedSession =
      await dependencies.sessionManager.forceStop(sessionId);
    if (!stoppedSession) {
      return c.json({ error: "Session not found." }, 404);
    }

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_interrupted",
      sessionId
    });

    return c.json({
      sessionId,
      accepted: true,
      mode: "interrupted",
      session: stoppedSession
    });
  });

  app.post("/sessions/:sessionId/force-stop", async (c) => {
    const requestId = getRequestId(c);
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.forceStop(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_force_stopped",
      sessionId
    });

    return c.json({
      sessionId,
      accepted: true,
      mode: "interrupted",
      session
    });
  });

  app.post("/sessions/:sessionId/file-changes", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const body = sessionFileChangeActionRequestSchema.parse(await c.req.json());
    const patchFiles = body.files.flatMap((file) => {
      const parsed = parseUnifiedPatch(file.diff);
      if (!parsed.ok) {
        throw new Error(`Invalid diff for ${file.path}: ${parsed.error}`);
      }

      return parsed.value.files;
    });
    const patch =
      body.action === "undo"
        ? invertUnifiedPatch({ files: patchFiles })
        : { files: patchFiles };
    try {
      await applyUnifiedPatch({
        workingDirectory: session.workingDirectory,
        patch,
        allowWorkspaceEscape: false
      });

      return c.json(
        sessionFileChangeActionResultSchema.parse({
          sessionId,
          action: body.action,
          files: body.files
        })
      );
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error)
        },
        409
      );
    }
  });

  app.post("/sessions/:sessionId/execute", async (c) => {
    if (!dependencies.runtimeFactory) {
      return c.json(
        {
          error:
            dependencies.runtimeUnavailableMessage ??
            "Runtime is not configured."
        },
        503
      );
    }

    const body = executeSessionPayloadSchema.parse(await c.req.json());
    const sessionId = c.req.param("sessionId");
    const currentSession =
      await dependencies.sessionManager.getSession(sessionId);

    if (!currentSession) {
      return c.json({ error: "Session not found." }, 404);
    }

    const runtimeHandle = await dependencies.runtimeFactory(currentSession);
    try {
      await emitPreRunTraceEvent({
        traceManager: dependencies.traceManager,
        sessionId,
        event: runtimeHandle.preRunTraceEvent
      });
      const result = await runtimeHandle.runtime.run({
        sessionId,
        message: body.message,
        ...(typeof body.maxTurns === "number"
          ? { maxTurns: body.maxTurns }
          : {}),
        ...(typeof body.permissionReply === "boolean"
          ? { permissionReply: body.permissionReply }
          : {})
      });

      return c.json(result);
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "SessionExecutionInProgressError"
      ) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    } finally {
      await runtimeHandle.dispose();
    }
  });

  app.post("/sessions/:sessionId/execute/stream", async (c) => {
    if (!dependencies.runtimeFactory) {
      return c.json(
        {
          error:
            dependencies.runtimeUnavailableMessage ??
            "Runtime is not configured."
        },
        503
      );
    }

    const body = executeSessionPayloadSchema.parse(await c.req.json());
    const sessionId = c.req.param("sessionId");
    const currentSession =
      await dependencies.sessionManager.getSession(sessionId);

    if (!currentSession) {
      return c.json({ error: "Session not found." }, 404);
    }

    const runtimeHandle = await dependencies.runtimeFactory(currentSession);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": stream-start\n\n"));

        void (async () => {
          let runtimeTerminalEventSeen = false;
          let runtimeResult: RunSessionResult | null = null;
          const runtimeEventSink: RunEventSink = (event) => {
            if (event.kind === "run_complete" || event.kind === "run_error") {
              runtimeTerminalEventSeen = true;
            }

            controller.enqueue(encodeSseEvent(event));
          };
          try {
            await emitPreRunTraceEvent({
              traceManager: dependencies.traceManager,
              sessionId,
              event: runtimeHandle.preRunTraceEvent,
              eventSink(event) {
                controller.enqueue(encodeSseEvent(event));
              }
            });
            runtimeResult = await runtimeHandle.runtime.run({
              sessionId,
              message: body.message,
              ...(typeof body.maxTurns === "number"
                ? { maxTurns: body.maxTurns }
                : {}),
              ...(typeof body.permissionReply === "boolean"
                ? { permissionReply: body.permissionReply }
                : {}),
              eventSink: runtimeEventSink
            });
          } catch (error) {
            if (
              error instanceof Error &&
              error.name === "SessionExecutionInProgressError"
            ) {
              enqueueRunErrorEvent(controller, {
                sessionId,
                session: null,
                error: error.message,
                toolCallCount: 0,
                toolResultCount: 0,
                toolOutputs: []
              });
            } else if (!runtimeTerminalEventSeen) {
              enqueueRunErrorEvent(controller, {
                sessionId,
                session: currentSession,
                error: error instanceof Error ? error.message : String(error),
                toolCallCount: 0,
                toolResultCount: 0,
                toolOutputs: []
              });
            }
          } finally {
            try {
              await runtimeHandle.dispose();
            } catch (error) {
              if (runtimeResult) {
                enqueueRunErrorEvent(controller, {
                  sessionId,
                  session: runtimeResult.session,
                  error: error instanceof Error ? error.message : String(error),
                  toolCallCount: runtimeResult.toolCallCount,
                  toolResultCount: runtimeResult.toolResultCount,
                  toolOutputs: runtimeResult.toolOutputs
                });
              }
            } finally {
              controller.close();
            }
          }
        })();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  });

  app.post("/sessions/:sessionId/snapshot", async (c) => {
    const session = await dependencies.sessionManager.getSession(
      c.req.param("sessionId")
    );
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    return c.json({ snapshot: session });
  });
}
