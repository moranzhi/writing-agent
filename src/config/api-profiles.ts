import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LlmConfig } from "./env.js";
import { loadLlmConfigOptional } from "./env.js";
import { ensureUserDataDirs, getUserDataDir } from "./user-data-dir.js";

export type ApiProfile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  createdAt: string;
  updatedAt: string;
};

type ApiProfilesFile = {
  version: 1;
  profiles: ApiProfile[];
};

const FILE_NAME = "profiles.json";

function profilesPath(): string {
  return path.join(getUserDataDir(), FILE_NAME);
}

function readFile(): ApiProfilesFile {
  ensureUserDataDirs();
  try {
    const raw = readFileSync(profilesPath(), "utf8");
    const parsed = JSON.parse(raw) as ApiProfilesFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.profiles)) {
      return { version: 1, profiles: [] };
    }
    return parsed;
  } catch {
    return { version: 1, profiles: [] };
  }
}

function writeFile(data: ApiProfilesFile): void {
  ensureUserDataDirs();
  writeFileSync(profilesPath(), JSON.stringify(data, null, 2), "utf8");
}

function seedFromEnvIfEmpty(data: ApiProfilesFile): ApiProfilesFile {
  if (data.profiles.length > 0) return data;
  const env = loadLlmConfigOptional();
  if (!env) return data;
  const now = new Date().toISOString();
  const profile: ApiProfile = {
    id: randomUUID(),
    name: "环境变量 (.env)",
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    model: env.model,
    createdAt: now,
    updatedAt: now,
  };
  return { version: 1, profiles: [profile] };
}

export function listApiProfiles(): ApiProfile[] {
  const data = seedFromEnvIfEmpty(readFile());
  if (data.profiles.length !== readFile().profiles.length) {
    writeFile(data);
  }
  return data.profiles;
}

export function getApiProfile(id: string): ApiProfile | null {
  return listApiProfiles().find((p) => p.id === id) ?? null;
}

export function createApiProfile(input: {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}): ApiProfile {
  const data = readFile();
  const now = new Date().toISOString();
  const profile: ApiProfile = {
    id: randomUUID(),
    name: input.name.trim() || "未命名",
    baseUrl: input.baseUrl.trim() || "https://api.deepseek.com",
    apiKey: input.apiKey.trim(),
    model: input.model.trim() || "deepseek-v4-pro",
    createdAt: now,
    updatedAt: now,
  };
  data.profiles.push(profile);
  writeFile(data);
  return profile;
}

export function updateApiProfile(
  id: string,
  input: Partial<Pick<ApiProfile, "name" | "baseUrl" | "apiKey" | "model">>,
): ApiProfile {
  const data = readFile();
  const index = data.profiles.findIndex((p) => p.id === id);
  if (index < 0) throw new Error("API 配置不存在");
  const current = data.profiles[index];
  const updated: ApiProfile = {
    ...current,
    name: input.name?.trim() || current.name,
    baseUrl: input.baseUrl?.trim() || current.baseUrl,
    apiKey: input.apiKey !== undefined && input.apiKey.trim() !== ""
      ? input.apiKey.trim()
      : current.apiKey,
    model: input.model?.trim() || current.model,
    updatedAt: new Date().toISOString(),
  };
  data.profiles[index] = updated;
  writeFile(data);
  return updated;
}

export function deleteApiProfile(id: string): void {
  const data = readFile();
  data.profiles = data.profiles.filter((p) => p.id !== id);
  writeFile(data);
}

export function profileToLlmConfig(profile: ApiProfile): LlmConfig {
  return {
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
  };
}

export async function testApiProfile(profile: ApiProfile): Promise<{
  ok: boolean;
  message: string;
}> {
  const url = `${profile.baseUrl.replace(/\/$/, "")}/models`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${profile.apiKey}` },
    });
    if (response.ok) {
      return { ok: true, message: "连接成功" };
    }
    const body = await response.text();
    return {
      ok: false,
      message: `HTTP ${response.status}: ${body.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "连接失败",
    };
  }
}
