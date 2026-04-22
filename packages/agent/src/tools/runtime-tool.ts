import type { RoutineRepository } from "@ai-app-template/db";
import type {
  ToolResult,
  ToolValidationIssue
} from "@ai-app-template/domain";

import type { SessionManager } from "../session/contracts.js";
import type { JsonValue, ToolState } from "../types.js";

export type RuntimeToolFamily =
  | "workspace-file"
  | "workspace-shell"
  | "workspace-network"
  | "schedule";

export type RuntimeToolPermissionProfile =
  | "allow"
  | "destructive-only"
  | "always-ask-user";

export type RuntimeToolSandboxProfile =
  | "none"
  | "workspace-rooted"
  | "workspace-working-directory";

export interface ToolExecutionContext {
  sessionId: string;
  userId: string;
  workingDirectory: string;
  routineRepository: RoutineRepository;
  sessionManager: SessionManager;
  sessionContext: {
    status: string;
    currentDateContext: string;
  };
}

export interface ToolExecutionResult {
  state: ToolState;
  content: string;
  displayText: string;
  result: ToolResult;
  error?: string;
}

export interface ToolValidationResult {
  ok: boolean;
  value?: Record<string, JsonValue>;
  issues?: ToolValidationIssue[];
}

export interface ToolPermissionRequest {
  summaryText: string;
  contextNote?: string;
}

export interface RuntimeTool {
  name: string;
  description: string;
  family: RuntimeToolFamily;
  isReadOnly: boolean;
  hasExternalSideEffect: boolean;
  permissionProfile: RuntimeToolPermissionProfile;
  sandboxProfile: RuntimeToolSandboxProfile;
  inputSchema: Record<string, unknown>;
  getSandboxTargets?(input: Record<string, JsonValue>): string[];
  getPermissionRequest?(
    input: Record<string, JsonValue>,
    context: ToolExecutionContext
  ): Promise<ToolPermissionRequest | null>;
  validate(input: Record<string, JsonValue>): ToolValidationResult;
  execute(
    input: Record<string, JsonValue>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>;
}
