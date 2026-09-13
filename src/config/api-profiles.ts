import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  normalizeCapabilities,
  probeProfileCapabilities,
  type ProfileCapabilities,
} from "../llm/capabilities.js";
import { sanitizeReasoningEffort } from "../llm/generation-compat.js";
import type { LlmConfig } from "./env.js";
import { loadLlmConfigOptional } from "./env.js";
import { ensureUserDataDirs, getUserDataDir } from "./user-data-dir.js";

export type ApiProfile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
 * 该配置默认思考强度（按型号写入 reasoning_effort / thinking）。
 * 省略 / auto = 不发送；none = 关闭或映射为最轻档；带 tools 时非 GLM 强制 none，GLM-5.3 保留合法档。
 * 探测永远用 low，不受此项影响。
 */
  reasoningEffort?: string;
  createdAt: string;
  updatedAt: string;
  /** 能力探测结果；改 baseUrl/model 后应重测 */
  capabilities?: ProfileCapabilities;
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

/** 存盘值：合法档位原样保留；空 / auto / 非法 → undefined（不发送） */
export function normalizeProfileReasoningEffort(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "auto") return undefined;
  return sanitizeReasoningEffort(trimmed);
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
  reasoningEffort?: string;
}): ApiProfile {
  const data = readFile();
  const now = new Date().toISOString();
  const reasoningEffort = normalizeProfileReasoningEffort(input.reasoningEffort);
  const profile: ApiProfile = {
    id: randomUUID(),
    name: input.name.trim() || "未命名",
    baseUrl: input.baseUrl.trim() || "https://api.deepseek.com",
    apiKey: input.apiKey.trim(),
    model: input.model.trim() || "deepseek-v4-pro",
    ...(reasoningEffort ? { reasoningEffort } : {}),
    createdAt: now,
    updatedAt: now,
  };
  data.profiles.push(profile);
  writeFile(data);
  return profile;
}

export function updateApiProfile(
  id: string,
  input: Partial<
    Pick<ApiProfile, "name" | "baseUrl" | "apiKey" | "model" | "reasoningEffort">
  >,
): ApiProfile {
  const data = readFile();
  const index = data.profiles.findIndex((p) => p.id === id);
  if (index < 0) throw new Error("API 配置不存在");
  const current = data.profiles[index];
  const nextBase = input.baseUrl?.trim() || current.baseUrl;
  const nextModel = input.model?.trim() || current.model;
  const endpointChanged =
    nextBase !== current.baseUrl || nextModel !== current.model;
  const reasoningEffort =
    input.reasoningEffort !== undefined
      ? normalizeProfileReasoningEffort(input.reasoningEffort)
      : current.reasoningEffort;
  const updated: ApiProfile = {
    ...current,
    name: input.name?.trim() || current.name,
    baseUrl: nextBase,
    apiKey: input.apiKey !== undefined && input.apiKey.trim() !== ""
      ? input.apiKey.trim()
      : current.apiKey,
    model: nextModel,
    updatedAt: new Date().toISOString(),
    // 端点或模型变了，旧探测作废
    ...(endpointChanged ? { capabilities: undefined } : {}),
  };
  if (reasoningEffort) updated.reasoningEffort = reasoningEffort;
  else delete updated.reasoningEffort;
  data.profiles[index] = updated;
  writeFile(data);
  return updated;
}

export function saveProfileCapabilities(
  id: string,
  capabilities: ProfileCapabilities,
): ApiProfile {
  const data = readFile();
  const index = data.profiles.findIndex((p) => p.id === id);
  if (index < 0) throw new Error("API 配置不存在");
  const current = data.profiles[index]!;
  const updated: ApiProfile = {
    ...current,
    capabilities: normalizeCapabilities(capabilities) ?? capabilities,
    updatedAt: new Date().toISOString(),
  };
  data.profiles[index] = updated;
  writeFile(data);
  return updated;
}

/** 探测并持久化；返回更新后的 profile */
export async function probeAndSaveProfileCapabilities(
  id: string,
): Promise<ApiProfile> {
  const profile = getApiProfile(id);
  if (!profile) throw new Error("API 配置不存在");
  const capabilities = await probeProfileCapabilities({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
  });
  return saveProfileCapabilities(id, capabilities);
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
    ...(profile.reasoningEffort
      ? { reasoningEffort: profile.reasoningEffort }
      : {}),
    capabilities: normalizeCapabilities(profile.capabilities),
  };
}
