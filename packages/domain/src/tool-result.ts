import type { DomainJsonValue } from "./json.js";

export interface ToolValidationIssue {
  field: string;
  issue: string;
}

export interface ToolResult<T extends DomainJsonValue = DomainJsonValue> {
  ok: boolean;
  code: string;
  message: string;
  data?: T;
  validationErrors?: ToolValidationIssue[];
}
