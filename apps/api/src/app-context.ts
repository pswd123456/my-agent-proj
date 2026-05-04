import type { Hono } from "hono";

import type {
  AgentRuntime,
  Logger,
  SessionManager,
  SessionSnapshot,
  SystemLogManager,
  TraceEvent,
  TraceManager
} from "@ai-app-template/agent";
import type { ModelService, TelegramClient } from "@ai-app-template/agent";
import type { SettingsConfigStore } from "@ai-app-template/agent";
import type {
  BackgroundTaskRepository,
  InboxBindingRepository,
  RoutineRepository
} from "@ai-app-template/db";

import type { CronJobRepository } from "./cron-jobs.js";

export interface ApiAppContext {
  Variables: {
    requestId: string;
  };
}

export type ApiApp = Hono<ApiAppContext>;

export interface ApiAppDependencies {
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  cronJobRepository?: CronJobRepository;
  settingsConfigStore: SettingsConfigStore;
  inboxBindingRepository?: InboxBindingRepository;
  backgroundTaskRepository?: BackgroundTaskRepository;
  traceManager: TraceManager;
  systemLogManager: SystemLogManager;
  apiLogger?: Logger;
  buildWorkingDirectory(input?: string): string;
  pickDirectory?(input?: { startDirectory?: string }): Promise<string | null>;
  runtimeFactory?: (session: SessionSnapshot) => Promise<{
    runtime: AgentRuntime;
    dispose(): Promise<void>;
    preRunTraceEvent?: TraceEvent;
  }>;
  modelService?: ModelService;
  defaultModel?: string;
  telegramBotToken?: string;
  telegramWebhookSecret?: string;
  telegramClient?: TelegramClient;
  runtimeUnavailableMessage?: string;
}
