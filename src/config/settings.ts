import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listApiProfiles } from "./api-profiles.js";
import { loadLlmConfigOptional } from "./env.js";
import { ensureUserDataDirs, getUserDataDir } from "./user-data-dir.js";

export type AppSettings = {
  version: 1;
  activeProfileId: string | null;
  activePresetId: string | null;
};

const FILE_NAME = "settings.json";

function settingsPath(): string {
  return path.join(getUserDataDir(), FILE_NAME);
}

function defaultSettings(): AppSettings {
  return {
    version: 1,
    activeProfileId: null,
    activePresetId: null,
  };
}

export function loadAppSettings(): AppSettings {
  ensureUserDataDirs();
  try {
    const raw = readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as AppSettings;
    if (parsed.version !== 1) return defaultSettings();
    return {
      version: 1,
      activeProfileId: parsed.activeProfileId ?? null,
      activePresetId: parsed.activePresetId ?? null,
    };
  } catch {
    return defaultSettings();
  }
}

export function saveAppSettings(settings: AppSettings): void {
  ensureUserDataDirs();
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

export function setActiveProfileId(id: string | null): AppSettings {
  const settings = loadAppSettings();
  settings.activeProfileId = id;
  saveAppSettings(settings);
  return settings;
}

export function setActivePresetId(id: string | null): AppSettings {
  const settings = loadAppSettings();
  settings.activePresetId = id;
  saveAppSettings(settings);
  return settings;
}

/** 解析当前应使用的 API profile：settings > 首个 profile > .env */
export function resolveActiveProfile() {
  const settings = loadAppSettings();
  const profiles = listApiProfiles();

  if (settings.activeProfileId) {
    const found = profiles.find((p) => p.id === settings.activeProfileId);
    if (found?.apiKey?.trim()) return found;
  }

  if (profiles.length > 0) {
    const withKey = profiles.find((p) => p.apiKey?.trim());
    if (withKey) return withKey;
  }

  const env = loadLlmConfigOptional();
  if (env) {
    return {
      id: "__env__",
      name: "环境变量 (.env)",
      baseUrl: env.baseUrl,
      apiKey: env.apiKey,
      model: env.model,
      createdAt: "",
      updatedAt: "",
    };
  }

  return null;
}

export function ensureActiveProfileDefault(): AppSettings {
  const settings = loadAppSettings();
  const profiles = listApiProfiles();
  if (!settings.activeProfileId && profiles.length > 0) {
    settings.activeProfileId = profiles[0].id;
    saveAppSettings(settings);
  }
  return settings;
}
