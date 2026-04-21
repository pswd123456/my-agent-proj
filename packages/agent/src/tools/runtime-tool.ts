import type { RoutineRepository } from "@ai-app-template/db";
import type {
  ToolResult,
  ToolValidationIssue
} from "@ai-app-template/domain";

import type { SessionManager } from "../session/contracts.js";
import type { JsonValue, ToolState } from "../types.js";

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

export interface RuntimeTool {
  name: string;
  description: string;
  isReadOnly: boolean;
  inputSchema: Record<string, unknown>;
  validate(input: Record<string, JsonValue>): ToolValidationResult;
  execute(
    input: Record<string, JsonValue>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>;
}
