import { z } from "zod";

import { THINKING_EFFORT_OPTIONS } from "./session-context.js";
import {
  USER_CONTEXT_HOOK_BEHAVIOR_OPTIONS,
  USER_CONTEXT_HOOK_EVENT_OPTIONS,
  USER_CONTEXT_HOOK_WAIT_MODE_OPTIONS
} from "./user-context-hooks.js";

const permissionRulePayloadShape = {
  shellAllowPatterns: z.array(z.string()).optional(),
  shellDenyPatterns: z.array(z.string()).optional(),
  toolAllowList: z.array(z.string()).optional(),
  toolAskList: z.array(z.string()).optional(),
  toolDenyList: z.array(z.string()).optional()
} as const;

const workspaceSkillSettingPayloadSchema = z.object({
  skillName: z.string().min(1),
  enabled: z.boolean()
});

const userContextHookPayloadSchema = z.object({
  id: z.string().min(1),
  event: z.enum(USER_CONTEXT_HOOK_EVENT_OPTIONS),
  behavior: z.enum(USER_CONTEXT_HOOK_BEHAVIOR_OPTIONS).optional(),
  waitMode: z.enum(USER_CONTEXT_HOOK_WAIT_MODE_OPTIONS).optional(),
  maxTurns: z.number().int().min(1).optional(),
  title: z.string(),
  content: z.string().min(1),
  enabled: z.boolean()
});

export const settingsFieldContracts = [
  {
    name: "workingDirectory",
    tomlKey: "working_directory",
    schema: z.string().optional(),
    targets: ["create", "session", "user", "sessionFromUser"] as const
  },
  {
    name: "model",
    tomlKey: "model",
    schema: z.string().optional(),
    targets: ["create", "session", "user"] as const
  },
  {
    name: "thinkingEffort",
    tomlKey: "thinking_effort",
    schema: z.enum(THINKING_EFFORT_OPTIONS).optional(),
    targets: ["create", "session", "user", "sessionFromUser"] as const
  },
  {
    name: "yoloMode",
    tomlKey: "yolo_mode",
    schema: z.boolean().optional(),
    targets: ["create", "session", "user", "sessionFromUser"] as const
  },
  {
    name: "planModeEnabled",
    tomlKey: null,
    schema: z.boolean().optional(),
    targets: ["create", "session"] as const
  },
  {
    name: "contextWindow",
    tomlKey: "context_window",
    schema: z.number().int().min(1000).optional(),
    targets: ["create", "user"] as const
  },
  {
    name: "maxTurns",
    tomlKey: "max_turns",
    schema: z.number().int().min(1).optional(),
    targets: ["create", "user"] as const
  },
  {
    name: "shellAllowPatterns",
    tomlKey: "shell_allow_patterns",
    schema: permissionRulePayloadShape.shellAllowPatterns,
    targets: ["session", "user", "sessionFromUser"] as const
  },
  {
    name: "shellDenyPatterns",
    tomlKey: "shell_deny_patterns",
    schema: permissionRulePayloadShape.shellDenyPatterns,
    targets: ["session", "user", "sessionFromUser"] as const
  },
  {
    name: "toolAllowList",
    tomlKey: "tool_allow_list",
    schema: permissionRulePayloadShape.toolAllowList,
    targets: ["session", "user", "sessionFromUser"] as const
  },
  {
    name: "toolAskList",
    tomlKey: "tool_ask_list",
    schema: permissionRulePayloadShape.toolAskList,
    targets: ["session", "user", "sessionFromUser"] as const
  },
  {
    name: "toolDenyList",
    tomlKey: "tool_deny_list",
    schema: permissionRulePayloadShape.toolDenyList,
    targets: ["session", "user", "sessionFromUser"] as const
  },
  {
    name: "enabledCapabilityPacks",
    tomlKey: "enabled_capability_packs",
    schema: z.array(z.string()).optional(),
    targets: ["create", "session", "user", "sessionFromUser"] as const
  },
  {
    name: "workspaceSkillSettings",
    tomlKey: "workspace_skill_settings",
    schema: z.array(workspaceSkillSettingPayloadSchema).optional(),
    targets: ["user"] as const
  },
  {
    name: "userContextHooks",
    tomlKey: "user_context_hooks",
    schema: z.array(userContextHookPayloadSchema).optional(),
    targets: ["user"] as const
  },
  {
    name: "debugConversationView",
    tomlKey: "debug_conversation_view",
    schema: z.boolean().optional(),
    targets: ["user"] as const
  },
  {
    name: "userCustomPrompt",
    tomlKey: "user_custom_prompt",
    schema: z.string().optional(),
    targets: ["user"] as const
  }
] as const;

export type SettingsContract = (typeof settingsFieldContracts)[number];
export type SettingsFieldName = SettingsContract["name"];
export type SettingsTomlKey = NonNullable<SettingsContract["tomlKey"]>;
export type SettingsContractTarget = SettingsContract["targets"][number];

type SettingShapeForTarget<TTarget extends SettingsContractTarget> = {
  [TContract in SettingsContract as TTarget extends TContract["targets"][number]
    ? TContract["name"]
    : never]: TContract["schema"];
};

function settingShapeForTarget<TTarget extends SettingsContractTarget>(
  target: TTarget
): SettingShapeForTarget<TTarget> {
  return Object.fromEntries(
    settingsFieldContracts
      .filter((field) =>
        (field.targets as readonly SettingsContractTarget[]).includes(target)
      )
      .map((field) => [field.name, field.schema])
  ) as SettingShapeForTarget<TTarget>;
}

function settingNamesForTarget<TTarget extends SettingsContractTarget>(
  target: TTarget
): readonly (keyof SettingShapeForTarget<TTarget> & SettingsFieldName)[] {
  return settingsFieldContracts
    .filter((field) =>
      (field.targets as readonly SettingsContractTarget[]).includes(target)
    )
    .map(
      (field) => field.name
    ) as unknown as readonly (keyof SettingShapeForTarget<TTarget> &
    SettingsFieldName)[];
}

export const createSessionSettingsPayloadShape =
  settingShapeForTarget("create");
export const updateSessionSettingsPayloadShape =
  settingShapeForTarget("session");
export const updateUserSettingsPayloadShape = settingShapeForTarget("user");

export const createSessionSettingsFieldNames = settingNamesForTarget("create");
export const updateSessionSettingsFieldNames = settingNamesForTarget("session");
export const updateUserSettingsFieldNames = settingNamesForTarget("user");
export const sessionSettingsFromUserSettingsFieldNames =
  settingNamesForTarget("sessionFromUser");

export const settingsTomlKeyByField = Object.fromEntries(
  settingsFieldContracts.flatMap((field) =>
    field.tomlKey ? [[field.name, field.tomlKey]] : []
  )
) as Partial<Record<SettingsFieldName, SettingsTomlKey>>;

export const settingsFieldByTomlKey = Object.fromEntries(
  settingsFieldContracts.flatMap((field) =>
    field.tomlKey ? [[field.tomlKey, field.name]] : []
  )
) as Record<SettingsTomlKey, SettingsFieldName>;

export function pickTomlSettingsFields(
  input: Record<string, unknown>
): Partial<Record<SettingsFieldName, unknown>> {
  const picked: Partial<Record<SettingsFieldName, unknown>> = {};

  for (const [tomlKey, fieldName] of Object.entries(settingsFieldByTomlKey) as [
    SettingsTomlKey,
    SettingsFieldName
  ][]) {
    if (typeof input[tomlKey] !== "undefined") {
      picked[fieldName] = input[tomlKey];
    }
  }

  return picked;
}

export function toTomlSettingsFields(
  input: Partial<Record<SettingsFieldName, unknown>>
): Record<SettingsTomlKey, unknown> {
  const tomlFields: Partial<Record<SettingsTomlKey, unknown>> = {};

  for (const [fieldName, tomlKey] of Object.entries(settingsTomlKeyByField) as [
    SettingsFieldName,
    SettingsTomlKey
  ][]) {
    if (typeof input[fieldName] !== "undefined") {
      tomlFields[tomlKey] = input[fieldName];
    }
  }

  return tomlFields as Record<SettingsTomlKey, unknown>;
}

function hasAnyDefinedField(
  value: Record<string, unknown>,
  fieldNames: readonly string[]
): boolean {
  return fieldNames.some(
    (fieldName) => typeof value[fieldName] !== "undefined"
  );
}

export function requireAnyDefinedSettingField<T extends z.ZodRawShape>(
  shape: T,
  message: string
) {
  const fieldNames = Object.keys(shape);
  const objectSchema = z.object(shape);
  return objectSchema.refine(
    (value) => hasAnyDefinedField(value as Record<string, unknown>, fieldNames),
    { message }
  );
}

export function pickDefinedSettingsFields<
  TInput extends Partial<Record<SettingsFieldName, unknown>>,
  const TFieldNames extends readonly (keyof TInput & SettingsFieldName)[]
>(
  input: TInput,
  fieldNames: TFieldNames
): Partial<Pick<TInput, TFieldNames[number]>> {
  const picked: Partial<Pick<TInput, TFieldNames[number]>> = {};
  for (const fieldName of fieldNames) {
    if (typeof input[fieldName] !== "undefined") {
      picked[fieldName] = input[fieldName] as Pick<
        TInput,
        TFieldNames[number]
      >[typeof fieldName];
    }
  }
  return picked;
}
