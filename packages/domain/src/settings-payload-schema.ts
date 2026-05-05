import { z } from "zod";

import {
  createSessionSettingsPayloadShape,
  requireAnyDefinedSettingField,
  updateSessionSettingsPayloadShape,
  updateUserSettingsPayloadShape
} from "./settings-contract.js";
import { SESSION_MAX_TURNS_LIMIT } from "./session-settings.js";

export const createSessionPayloadSchema = z.object(
  createSessionSettingsPayloadShape
);

export const updateSessionSettingsPayloadSchema = requireAnyDefinedSettingField(
  updateSessionSettingsPayloadShape,
  "At least one session settings field is required."
);

export const updateUserSettingsPayloadSchema = requireAnyDefinedSettingField(
  updateUserSettingsPayloadShape,
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
