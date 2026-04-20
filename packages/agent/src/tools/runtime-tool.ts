import type { JsonValue, ToolState } from "../types.js";

export interface ToolExecutionContext {
  sessionId: string;
  workingDirectory: string;
}

export interface ToolExecutionResult {
  state: ToolState;
  content: string;
  error?: string;
}

export interface RuntimeTool {
  name: string;
  description: string;
  isReadOnly: boolean;
  inputSchema: Record<string, unknown>;
  execute(
    input: Record<string, JsonValue>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>;
}
