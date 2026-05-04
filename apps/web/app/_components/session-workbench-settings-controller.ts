import type {
  ApiClient,
  SessionSettingsRecord,
  SessionSnapshot,
  SettingsPermissionToolOption,
  UserSettingsChannelsPayload,
  UserSettingsMcpPayload,
  UserSettingsPayload,
  UserSettingsSkillsPayload
} from "@ai-app-template/sdk";

import {
  buildSessionSettingsPatchFromUserSettings,
  buildUserSettingsPayloadFromForm,
  normalizeSettingsFormState,
  toSettingsChannelsState,
  toSettingsFormState,
  toSettingsMcpFormState,
  toSettingsSkillsState
} from "./session-workbench-state";
import type {
  SettingsChannelsState,
  SettingsFormState,
  SettingsMcpFormState,
  SettingsSkillsState
} from "./session-workbench-types";

export interface SettingsControllerStateSync {
  setUserSettings: (settings: SessionSettingsRecord) => void;
  setPermissionTools: (tools: SettingsPermissionToolOption[]) => void;
  setSettingsForm: (form: SettingsFormState) => void;
  setSettingsChannelsState: (state: SettingsChannelsState) => void;
  setSettingsMcpForm: (form: SettingsMcpFormState) => void;
  setSettingsSkillsState: (state: SettingsSkillsState) => void;
  setMcpSettingsErrorText: (message: string | null) => void;
  setChannelsSettingsErrorText: (message: string | null) => void;
}

export interface SaveUserSettingsControllerInput {
  apiClient: ApiClient;
  form: SettingsFormState;
  currentSession: SessionSnapshot | null;
  sync: SettingsControllerStateSync;
  hydrateCurrentSession: (session: SessionSnapshot) => void;
}

export interface SaveUserSettingsControllerResult {
  settingsPayload: UserSettingsPayload;
  normalizedForm: SettingsFormState;
}

export async function refreshExtendedSettingsPayloads(
  apiClient: ApiClient
): Promise<{
  channelsPayload: UserSettingsChannelsPayload;
  mcpPayload: UserSettingsMcpPayload;
  skillsPayload: UserSettingsSkillsPayload;
}> {
  const [channelsPayload, mcpPayload, skillsPayload] = await Promise.all([
    apiClient.getUserSettingsChannels(),
    apiClient.getUserSettingsMcp(),
    apiClient.getUserSettingsSkills()
  ]);

  return {
    channelsPayload,
    mcpPayload,
    skillsPayload
  };
}

export function applyUserSettingsPayload(
  payload: UserSettingsPayload,
  sync: Pick<
    SettingsControllerStateSync,
    "setUserSettings" | "setPermissionTools" | "setSettingsForm"
  >
) {
  sync.setUserSettings(payload.settings);
  sync.setPermissionTools(payload.permissionTools);
  sync.setSettingsForm(toSettingsFormState(payload.settings));
}

export function applyExtendedSettingsPayloads(
  payloads: {
    channelsPayload: UserSettingsChannelsPayload;
    mcpPayload: UserSettingsMcpPayload;
    skillsPayload: UserSettingsSkillsPayload;
  },
  sync: Pick<
    SettingsControllerStateSync,
    | "setSettingsChannelsState"
    | "setSettingsMcpForm"
    | "setSettingsSkillsState"
    | "setMcpSettingsErrorText"
    | "setChannelsSettingsErrorText"
  >
) {
  sync.setSettingsChannelsState(toSettingsChannelsState(payloads.channelsPayload));
  sync.setSettingsMcpForm(toSettingsMcpFormState(payloads.mcpPayload));
  sync.setSettingsSkillsState(toSettingsSkillsState(payloads.skillsPayload));
  sync.setMcpSettingsErrorText(null);
  sync.setChannelsSettingsErrorText(null);
}

export async function saveUserSettingsWithRefresh(
  input: SaveUserSettingsControllerInput
): Promise<SaveUserSettingsControllerResult> {
  const normalizedForm = normalizeSettingsFormState(input.form);
  const settingsPayload = await input.apiClient.updateUserSettingsPayload(
    buildUserSettingsPayloadFromForm(normalizedForm)
  );

  applyUserSettingsPayload(settingsPayload, input.sync);

  try {
    const payloads = await refreshExtendedSettingsPayloads(input.apiClient);
    applyExtendedSettingsPayloads(payloads, input.sync);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.sync.setMcpSettingsErrorText(message);
    input.sync.setChannelsSettingsErrorText(message);
  }

  if (input.currentSession) {
    const syncedSession = await input.apiClient.updateSessionSettings(
      input.currentSession.sessionId,
      buildSessionSettingsPatchFromUserSettings(settingsPayload.settings)
    );
    input.hydrateCurrentSession(syncedSession);
  }

  return {
    settingsPayload,
    normalizedForm
  };
}
