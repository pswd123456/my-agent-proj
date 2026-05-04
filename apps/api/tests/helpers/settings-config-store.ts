import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createSettingsConfigStore,
  type SettingsConfigStore
} from "@ai-app-template/agent";

export async function createTestSettingsConfigStore(input?: {
  settingsPermissionToolOptions?: readonly string[];
}): Promise<{
  settingsConfigStore: SettingsConfigStore;
  homeDir: string;
}> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "api-settings-home-"));
  return {
    settingsConfigStore: createSettingsConfigStore({
      homeDir,
      ...(input?.settingsPermissionToolOptions
        ? {
            settingsPermissionToolOptions: input.settingsPermissionToolOptions
          }
        : {})
    }),
    homeDir
  };
}
