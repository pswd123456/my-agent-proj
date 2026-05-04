import { promises as fs } from "node:fs";

import {
  inferUserContextHookBehavior,
  isUserContextHookEventSupportedForBehavior,
  normalizeUserContextHookBehavior,
  normalizeUserContextHookEvent,
  normalizeUserContextHooks,
  normalizeUserContextHookWaitMode,
  type UserContextHookBehavior,
  type UserContextHookRecord,
  type UserContextHookWaitMode
} from "@ai-app-template/domain";
import { parse, TomlError } from "smol-toml";

import { getWorkspaceAgentConfigPath } from "../workspace-config/index.js";

export type WorkspaceHookConfigDiagnosticCode =
  | "invalid_toml"
  | "invalid_root"
  | "invalid_hook"
  | "invalid_field"
  | "duplicate_hook";

export interface WorkspaceHookConfigDiagnostic {
  scope: "file" | "hook";
  code: WorkspaceHookConfigDiagnosticCode;
  message: string;
  hookId?: string;
}

export interface WorkspaceHookConfigLoadResult {
  configPath: string;
  foundConfig: boolean;
  hooks: UserContextHookRecord[];
  diagnostics: WorkspaceHookConfigDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildDiagnostic(
  diagnostic: WorkspaceHookConfigDiagnostic
): WorkspaceHookConfigDiagnostic {
  return diagnostic;
}

function validateUnknownFields(
  hookId: string,
  value: Record<string, unknown>,
  allowedKeys: readonly string[]
): WorkspaceHookConfigDiagnostic | null {
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length === 0) {
    return null;
  }

  return buildDiagnostic({
    scope: "hook",
    code: "invalid_field",
    hookId,
    message: `Unsupported fields in hook config: ${unknownKeys.join(", ")}`
  });
}

function getDefinedFieldNames(
  value: Record<string, unknown>,
  fieldNames: readonly string[]
): string[] {
  return fieldNames.filter(
    (fieldName) => typeof value[fieldName] !== "undefined"
  );
}

function getSingleAliasedField(
  hookId: string,
  value: Record<string, unknown>,
  fieldNames: readonly string[],
  displayName: string
):
  | { value: unknown; diagnostic: null }
  | { value: undefined; diagnostic: WorkspaceHookConfigDiagnostic | null } {
  const definedFieldNames = getDefinedFieldNames(value, fieldNames);
  if (definedFieldNames.length === 0) {
    return { value: undefined, diagnostic: null };
  }

  if (definedFieldNames.length > 1) {
    return {
      value: undefined,
      diagnostic: buildDiagnostic({
        scope: "hook",
        code: "invalid_field",
        hookId,
        message: `Hook config must set only one ${displayName} field.`
      })
    };
  }

  const fieldName = definedFieldNames[0];
  return {
    value: typeof fieldName === "string" ? value[fieldName] : undefined,
    diagnostic: null
  };
}

function parseHookConfig(
  rawHookId: string,
  rawValue: unknown
): {
  hook: UserContextHookRecord | null;
  diagnostics: WorkspaceHookConfigDiagnostic[];
} {
  const hookId = rawHookId.trim();
  const diagnostics: WorkspaceHookConfigDiagnostic[] = [];

  if (!hookId) {
    return {
      hook: null,
      diagnostics: [
        buildDiagnostic({
          scope: "hook",
          code: "invalid_field",
          message: "Hook section name must not be empty."
        })
      ]
    };
  }

  if (!isRecord(rawValue)) {
    return {
      hook: null,
      diagnostics: [
        buildDiagnostic({
          scope: "hook",
          code: "invalid_hook",
          hookId,
          message: "Hook config must be a table."
        })
      ]
    };
  }

  const unknownFields = validateUnknownFields(hookId, rawValue, [
    "event",
    "behavior",
    "wait_mode",
    "waitMode",
    "max_turns",
    "maxTurns",
    "title",
    "content",
    "enabled"
  ]);
  if (unknownFields) {
    return { hook: null, diagnostics: [unknownFields] };
  }

  const event = normalizeUserContextHookEvent(rawValue.event);
  if (!event) {
    return {
      hook: null,
      diagnostics: [
        buildDiagnostic({
          scope: "hook",
          code: "invalid_field",
          hookId,
          message:
            "Hook event must be one of session_started, run_started, or run_end."
        })
      ]
    };
  }

  let behavior: UserContextHookBehavior | undefined;
  if (typeof rawValue.behavior !== "undefined") {
    const normalizedBehavior = normalizeUserContextHookBehavior(
      rawValue.behavior
    );
    if (!normalizedBehavior) {
      return {
        hook: null,
        diagnostics: [
          buildDiagnostic({
            scope: "hook",
            code: "invalid_field",
            hookId,
            message:
              "Hook behavior must be one of context, message, or subagent."
          })
        ]
      };
    }
    behavior = normalizedBehavior;
  }

  const inferredBehavior = inferUserContextHookBehavior({
    event,
    ...(behavior ? { behavior } : {})
  });
  if (!isUserContextHookEventSupportedForBehavior(event, inferredBehavior)) {
    return {
      hook: null,
      diagnostics: [
        buildDiagnostic({
          scope: "hook",
          code: "invalid_field",
          hookId,
          message: "Context hooks do not support the run_end event."
        })
      ]
    };
  }

  const waitModeField = getSingleAliasedField(
    hookId,
    rawValue,
    ["wait_mode", "waitMode"],
    "wait_mode"
  );
  if (waitModeField.diagnostic) {
    return { hook: null, diagnostics: [waitModeField.diagnostic] };
  }

  let waitMode: UserContextHookWaitMode | undefined;
  if (typeof waitModeField.value !== "undefined") {
    if (inferredBehavior !== "subagent") {
      return {
        hook: null,
        diagnostics: [
          buildDiagnostic({
            scope: "hook",
            code: "invalid_field",
            hookId,
            message: "wait_mode only applies to subagent hooks."
          })
        ]
      };
    }

    const normalizedWaitMode = normalizeUserContextHookWaitMode(
      waitModeField.value
    );
    if (!normalizedWaitMode) {
      return {
        hook: null,
        diagnostics: [
          buildDiagnostic({
            scope: "hook",
            code: "invalid_field",
            hookId,
            message: "Hook wait_mode must be blocking or unblocking."
          })
        ]
      };
    }
    waitMode = normalizedWaitMode;
  }

  const maxTurnsField = getSingleAliasedField(
    hookId,
    rawValue,
    ["max_turns", "maxTurns"],
    "max_turns"
  );
  if (maxTurnsField.diagnostic) {
    return { hook: null, diagnostics: [maxTurnsField.diagnostic] };
  }

  let maxTurns: number | undefined;
  if (typeof maxTurnsField.value !== "undefined") {
    if (inferredBehavior !== "subagent") {
      return {
        hook: null,
        diagnostics: [
          buildDiagnostic({
            scope: "hook",
            code: "invalid_field",
            hookId,
            message: "max_turns only applies to subagent hooks."
          })
        ]
      };
    }

    if (
      typeof maxTurnsField.value !== "number" ||
      !Number.isFinite(maxTurnsField.value)
    ) {
      return {
        hook: null,
        diagnostics: [
          buildDiagnostic({
            scope: "hook",
            code: "invalid_field",
            hookId,
            message: "Hook max_turns must be a finite number."
          })
        ]
      };
    }
    maxTurns = maxTurnsField.value;
  }

  const title = typeof rawValue.title === "undefined" ? hookId : rawValue.title;
  if (typeof title !== "string") {
    return {
      hook: null,
      diagnostics: [
        buildDiagnostic({
          scope: "hook",
          code: "invalid_field",
          hookId,
          message: "Hook title must be a string."
        })
      ]
    };
  }

  if (typeof rawValue.content !== "string" || rawValue.content.trim() === "") {
    return {
      hook: null,
      diagnostics: [
        buildDiagnostic({
          scope: "hook",
          code: "invalid_field",
          hookId,
          message: "Hook content must be a non-empty string."
        })
      ]
    };
  }

  const enabled =
    typeof rawValue.enabled === "undefined" ? true : rawValue.enabled;
  if (typeof enabled !== "boolean") {
    return {
      hook: null,
      diagnostics: [
        buildDiagnostic({
          scope: "hook",
          code: "invalid_field",
          hookId,
          message: "Hook enabled must be a boolean."
        })
      ]
    };
  }

  return {
    hook: {
      id: hookId,
      event,
      ...(behavior ? { behavior } : {}),
      ...(waitMode ? { waitMode } : {}),
      ...(typeof maxTurns === "number" ? { maxTurns } : {}),
      title,
      content: rawValue.content,
      enabled
    },
    diagnostics
  };
}

export function mergeWorkspaceAndSettingsUserContextHooks(input: {
  workspaceHooks: readonly UserContextHookRecord[];
  settingsHooks: readonly UserContextHookRecord[];
}): UserContextHookRecord[] {
  return normalizeUserContextHooks([
    ...input.workspaceHooks,
    ...input.settingsHooks
  ]);
}

export async function loadWorkspaceHookConfig(
  workingDirectory: string
): Promise<WorkspaceHookConfigLoadResult> {
  const configPath = getWorkspaceAgentConfigPath(workingDirectory);

  let rawContent: string;
  try {
    rawContent = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        configPath,
        foundConfig: false,
        hooks: [],
        diagnostics: []
      };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = parse(rawContent);
  } catch (error) {
    const message =
      error instanceof TomlError || error instanceof Error
        ? error.message
        : "Unknown TOML parse error.";
    return {
      configPath,
      foundConfig: true,
      hooks: [],
      diagnostics: [
        buildDiagnostic({
          scope: "file",
          code: "invalid_toml",
          message
        })
      ]
    };
  }

  if (!isRecord(parsed)) {
    return {
      configPath,
      foundConfig: true,
      hooks: [],
      diagnostics: [
        buildDiagnostic({
          scope: "file",
          code: "invalid_root",
          message: "Workspace config root must be a TOML table."
        })
      ]
    };
  }

  const root = parsed.hooks;
  if (typeof root === "undefined") {
    return {
      configPath,
      foundConfig: true,
      hooks: [],
      diagnostics: []
    };
  }

  if (!isRecord(root)) {
    return {
      configPath,
      foundConfig: true,
      hooks: [],
      diagnostics: [
        buildDiagnostic({
          scope: "file",
          code: "invalid_root",
          message: "hooks must be a TOML table."
        })
      ]
    };
  }

  const diagnostics: WorkspaceHookConfigDiagnostic[] = [];
  const hooks: UserContextHookRecord[] = [];
  const seenHookIds = new Set<string>();
  for (const hookName of Object.keys(root).sort()) {
    const hookId = hookName.trim();
    if (seenHookIds.has(hookId)) {
      diagnostics.push(
        buildDiagnostic({
          scope: "hook",
          code: "duplicate_hook",
          hookId,
          message: `Duplicate hook section ignored: ${hookId}`
        })
      );
      continue;
    }
    seenHookIds.add(hookId);

    const parsedHook = parseHookConfig(hookName, root[hookName]);
    diagnostics.push(...parsedHook.diagnostics);
    if (parsedHook.hook) {
      hooks.push(parsedHook.hook);
    }
  }

  return {
    configPath,
    foundConfig: true,
    hooks: normalizeUserContextHooks(hooks),
    diagnostics
  };
}
