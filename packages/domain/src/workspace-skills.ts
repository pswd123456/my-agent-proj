export interface WorkspaceSkillSettingRecord {
  skillName: string;
  enabled: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeWorkspaceSkillSettings(
  input: unknown
): WorkspaceSkillSettingRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seenNames = new Set<string>();
  const normalized: WorkspaceSkillSettingRecord[] = [];

  for (const item of input) {
    if (!isPlainRecord(item)) {
      continue;
    }

    const skillName =
      typeof item.skillName === "string" ? item.skillName.trim() : "";
    if (!skillName || seenNames.has(skillName)) {
      continue;
    }

    seenNames.add(skillName);
    normalized.push({
      skillName,
      enabled: typeof item.enabled === "boolean" ? item.enabled : true
    });
  }

  return normalized;
}

export function getWorkspaceSkillSetting(
  settings: readonly WorkspaceSkillSettingRecord[],
  skillName: string
): WorkspaceSkillSettingRecord | null {
  const normalizedSkillName = skillName.trim();
  if (!normalizedSkillName) {
    return null;
  }

  return (
    settings.find((setting) => setting.skillName === normalizedSkillName) ??
    null
  );
}

export function isWorkspaceSkillEnabled(
  settings: readonly WorkspaceSkillSettingRecord[],
  skillName: string
): boolean {
  const setting = getWorkspaceSkillSetting(settings, skillName);
  return setting ? setting.enabled : true;
}
