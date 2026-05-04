import { z } from "zod";

import { THINKING_EFFORT_OPTIONS } from "./session-context.js";
import { SESSION_MAX_TURNS_LIMIT } from "./session-settings.js";
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

function hasAnyDefinedField(
  value: Record<string, unknown>,
  fieldNames: readonly string[]
): boolean {
  return fieldNames.some(
    (fieldName) => typeof value[fieldName] !== "undefined"
  );
}

function requireAnyDefinedField<T extends z.ZodRawShape>(
  shape: T,
  message: string
){
  const fieldNames = Object.keys(shape);
  const objectSchema = z.object(shape);
  return objectSchema.refine(
    (value) => hasAnyDefinedField(value as Record<string, unknown>, fieldNames),
    { message }
  );
}

export const createSessionPayloadSchema = z.object({
  workingDirectory: z.string().optional(),
  model: z.string().optional(),
  thinkingEffort: z.enum(THINKING_EFFORT_OPTIONS).optional(),
  yoloMode: z.boolean().optional(),
  planModeEnabled: z.boolean().optional(),
  contextWindow: z.number().int().min(1000).optional(),
  maxTurns: z.number().int().min(1).optional(),
  enabledCapabilityPacks: z.array(z.string()).optional()
});

export const updateSessionSettingsPayloadSchema = requireAnyDefinedField(
  {
    model: z.string().optional(),
    thinkingEffort: z.enum(THINKING_EFFORT_OPTIONS).optional(),
    yoloMode: z.boolean().optional(),
    planModeEnabled: z.boolean().optional(),
    ...permissionRulePayloadShape,
    enabledCapabilityPacks: z.array(z.string()).optional()
  },
  "At least one session settings field is required."
);

export const updateUserSettingsPayloadSchema = requireAnyDefinedField(
  {
    workingDirectory: z.string().optional(),
    model: z.string().optional(),
    thinkingEffort: z.enum(THINKING_EFFORT_OPTIONS).optional(),
    yoloMode: z.boolean().optional(),
    contextWindow: z.number().int().min(1000).optional(),
    maxTurns: z.number().int().min(1).optional(),
    ...permissionRulePayloadShape,
    enabledCapabilityPacks: z.array(z.string()).optional(),
    workspaceSkillSettings: z
      .array(workspaceSkillSettingPayloadSchema)
      .optional(),
    userContextHooks: z.array(userContextHookPayloadSchema).optional(),
    debugConversationView: z.boolean().optional(),
    userCustomPrompt: z.string().optional()
  },
  "At least one settings field is required."
);

export const executeSessionPayloadSchema = z.object({
  message: z.string().min(1),
  maxTurns: z.number().int().min(1).max(SESSION_MAX_TURNS_LIMIT).optional(),
  permissionReply: z.boolean().optional()
});

export type CreateSessionPayload = z.infer<typeof createSessionPayloadSchema>;
export type UpdateSessionSettingsPayload = z.infer<
  typeof updateSessionSettingsPayloadSchema
>;
export type UpdateUserSettingsPayload = z.infer<
  typeof updateUserSettingsPayloadSchema
>;
