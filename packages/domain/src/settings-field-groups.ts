export const updateSessionSettingsFieldNames = [
  "model",
  "thinkingEffort",
  "yoloMode",
  "planModeEnabled",
  "shellAllowPatterns",
  "shellDenyPatterns",
  "toolAllowList",
  "toolAskList",
  "toolDenyList",
  "enabledCapabilityPacks"
] as const;

export const updateUserSettingsFieldNames = [
  "workingDirectory",
  "model",
  "thinkingEffort",
  "yoloMode",
  "contextWindow",
  "maxTurns",
  "shellAllowPatterns",
  "shellDenyPatterns",
  "toolAllowList",
  "toolAskList",
  "toolDenyList",
  "enabledCapabilityPacks",
  "workspaceSkillSettings",
  "userContextHooks",
  "debugConversationView",
  "userCustomPrompt"
] as const;

export const sessionSettingsFromUserSettingsFieldNames = [
  "thinkingEffort",
  "yoloMode",
  "shellAllowPatterns",
  "shellDenyPatterns",
  "toolAllowList",
  "toolAskList",
  "toolDenyList",
  "enabledCapabilityPacks"
] as const;
