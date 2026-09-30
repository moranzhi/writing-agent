import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  normalizeCapabilities,
  probeProfileCapabilities,
  type ProfileCapabilities,
} from "../llm/capabilities.js";
import { sanitizeReasoningEffort } from "../llm/generation-compat.js";
import { normalizeBaseUrl } from "../llm/list-models.js";
import type { LlmConfig } from "./env.js";
import { loadLlmConfigOptional } from "./env.js";
import { ensureUserDataDirs, getUserDataDir } from "./user-data-dir.js";

export type ApiProfile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  /** 这一条配置对应的模型 */
  model: string;
  /**
   * 旧数据里曾把同端点的多个模型塞进一条配置。
   * 读入时会拆回独立配置，不再写回。
   */
  models?: string[];
  /** 同 baseUrl + 同 Key 哈希的收纳组 */
  groupId?: string;
  /**
   * 该配置的思考强度（按型号写入 reasoning_effort / thinking）。预设不带这项。
   * 省略 / auto = 不发送；none = 关闭或映射为最轻档。
   * 带 tools 时：多数型号强制 none；GLM-5.3 与 Gemini 3 保留合法档（Gemini 3.8 为 low/medium/high）。
   * 探测永远用 low，不受此项影响。
   */
  reasoningEffort?: string;
  createdAt: string;
  updatedAt: string;
  /** 能力探测结果；改 baseUrl/model 后应重测 */
  capabilities?: ProfileCapabilities;
};

/** 前厅里折叠显示。分类用 Key 哈希，不比较、不展示原文。 */
export type ApiProfileGroup = {
  id: string;
  name: string;
  baseUrl: string;
  keyHash: string;
};

export type ApiProfileGroupView = {
  id: string;
  name: string;
  baseUrl: string;
};

type ApiProfilesFile = {
  version: 1;
  profiles: ApiProfile[];
  groups?: ApiProfileGroup[];
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

/** 读旧的 models 字段时用：当前模型放最前，去重。 */
export function normalizeModelList(
  model: string,
  models: unknown,
): { model: string; models: string[] } {
  const current = model.trim();
  const extra = Array.isArray(models)
    ? models
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const seen = new Set<string>();
  const list: string[] = [];
  const push = (id: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    list.push(id);
  };
  push(current);
  for (const id of extra) push(id);
  const active = current || list[0] || "deepseek-v4-pro";
  if (!seen.has(active)) list.unshift(active);
  return { model: list[0] ?? active, models: list };
}

export function apiKeyHash(apiKey: string): string {
  return createHash("sha256").update(apiKey.trim()).digest("hex");
}

function groupSlot(baseUrl: string, apiKey: string): string {
  return `${normalizeBaseUrl(baseUrl)}\n${apiKeyHash(apiKey)}`;
}

function hostLabel(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  try {
    return new URL(trimmed).host || trimmed || "未命名组";
  } catch {
    return trimmed.replace(/\/+$/, "") || "未命名组";
  }
}

function uniqueGroupName(host: string, keyHash: string, used: Set<string>): string {
  if (!used.has(host)) return host;
  const alt = `${host} · ${keyHash.slice(0, 4)}`;
  if (!used.has(alt)) return alt;
  let n = 2;
  while (used.has(`${host} · ${n}`)) n += 1;
  return `${host} · ${n}`;
}

function withoutLegacyModels(profile: ApiProfile): ApiProfile {
  if (profile.models === undefined) return profile;
  const next = { ...profile };
  delete next.models;
  return next;
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
    model: env.model.trim() || "deepseek-v4-pro",
    createdAt: now,
    updatedAt: now,
  };
  return { version: 1, profiles: [profile] };
}

function splitLegacyModelLists(profiles: ApiProfile[]): {
  profiles: ApiProfile[];
  changed: boolean;
} {
  const out: ApiProfile[] = [];
  let changed = false;
  const now = new Date().toISOString();
  for (const profile of profiles) {
    const current = profile.model.trim();
    const extras = normalizeModelList(current, profile.models).models.filter(
      (model) => model !== current,
    );
    if (profile.models !== undefined) changed = true;
    out.push(withoutLegacyModels({ ...profile, model: current || profile.model }));
    for (const model of extras) {
      changed = true;
      const sibling: ApiProfile = {
        id: randomUUID(),
        name: model,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        model,
        createdAt: now,
        updatedAt: now,
      };
      if (profile.reasoningEffort) sibling.reasoningEffort = profile.reasoningEffort;
      out.push(sibling);
    }
  }
  return { profiles: out, changed };
}

/** 同 baseUrl + 同 Key 哈希共用一个组。组名可改，分类键不变。 */
function assignGroups(data: ApiProfilesFile): { data: ApiProfilesFile; changed: boolean } {
  const groups = [...(data.groups ?? [])];
  let changed = !Array.isArray(data.groups);
  const bySlot = new Map<string, ApiProfileGroup>();
  for (const group of groups) {
    bySlot.set(`${normalizeBaseUrl(group.baseUrl)}\n${group.keyHash}`, group);
  }
  const usedNames = new Set(groups.map((group) => group.name));
  const profiles = data.profiles.map((profile) => {
    const baseUrl = profile.baseUrl.trim().replace(/\/+$/, "") || profile.baseUrl;
    const slot = groupSlot(baseUrl, profile.apiKey);
    let group = bySlot.get(slot);
    if (!group) {
      const keyHash = apiKeyHash(profile.apiKey);
      const name = uniqueGroupName(hostLabel(baseUrl), keyHash, usedNames);
      usedNames.add(name);
      group = {
        id: randomUUID(),
        name,
        baseUrl: normalizeBaseUrl(baseUrl) || baseUrl,
        keyHash,
      };
      groups.push(group);
      bySlot.set(slot, group);
      changed = true;
    }
    if (profile.groupId !== group.id || profile.baseUrl !== baseUrl || profile.models) {
      changed = true;
      return withoutLegacyModels({ ...profile, baseUrl, groupId: group.id });
    }
    return profile;
  });
  const used = new Set(profiles.map((profile) => profile.groupId).filter(Boolean));
  const kept = groups.filter((group) => used.has(group.id));
  if (kept.length !== groups.length) changed = true;
  return { data: { version: 1, profiles, groups: kept }, changed };
}

function loadProfiles(): ApiProfilesFile {
  const raw = readFile();
  const seeded = seedFromEnvIfEmpty(raw);
  const split = splitLegacyModelLists(seeded.profiles);
  const assigned = assignGroups({
    version: 1,
    profiles: split.profiles,
    groups: seeded.groups,
  });
  if (seeded !== raw || split.changed || assigned.changed) {
    writeFile(assigned.data);
  }
  return assigned.data;
}

export function listApiProfiles(): ApiProfile[] {
  return loadProfiles().profiles;
}

export function getApiProfile(id: string): ApiProfile | null {
  return listApiProfiles().find((profile) => profile.id === id) ?? null;
}

export function listApiGroups(): ApiProfileGroupView[] {
  return (loadProfiles().groups ?? []).map((group) => ({
    id: group.id,
    name: group.name,
    baseUrl: group.baseUrl,
  }));
}

export function renameApiProfileGroup(id: string, name: string): ApiProfileGroupView {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("组名不能为空");
  const data = loadProfiles();
  const index = (data.groups ?? []).findIndex((group) => group.id === id);
  if (index < 0) throw new Error("配置组不存在");
  const groups = [...(data.groups ?? [])];
  const current = groups[index]!;
  if (current.name === trimmed) {
    return { id: current.id, name: current.name, baseUrl: current.baseUrl };
  }
  groups[index] = { ...current, name: trimmed };
  writeFile({ ...data, groups });
  return { id, name: trimmed, baseUrl: current.baseUrl };
}

export function createApiProfile(input: {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: string;
}): ApiProfile {
  const data = loadProfiles();
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
  const assigned = assignGroups(data);
  writeFile(assigned.data);
  return assigned.data.profiles.find((item) => item.id === profile.id) ?? profile;
}

export function updateApiProfile(
  id: string,
  input: Partial<
    Pick<ApiProfile, "name" | "baseUrl" | "apiKey" | "model" | "reasoningEffort">
  >,
): ApiProfile {
  const data = loadProfiles();
  const index = data.profiles.findIndex((profile) => profile.id === id);
  if (index < 0) throw new Error("API 配置不存在");
  const current = data.profiles[index]!;
  const nextBase =
    input.baseUrl !== undefined
      ? input.baseUrl.trim() || current.baseUrl
      : current.baseUrl;
  const nextModel = input.model?.trim() || current.model;
  const nextKey =
    input.apiKey !== undefined && input.apiKey.trim() !== ""
      ? input.apiKey.trim()
      : current.apiKey;
  const endpointChanged =
    normalizeBaseUrl(nextBase) !== normalizeBaseUrl(current.baseUrl) ||
    nextModel !== current.model;
  const reasoningEffort =
    input.reasoningEffort !== undefined
      ? normalizeProfileReasoningEffort(input.reasoningEffort)
      : current.reasoningEffort;
  const draft: ApiProfile = {
    ...current,
    name: input.name !== undefined ? input.name.trim() || current.name : current.name,
    baseUrl: nextBase,
    apiKey: nextKey,
    model: nextModel,
    updatedAt: new Date().toISOString(),
  };
  delete draft.models;
  if (reasoningEffort) draft.reasoningEffort = reasoningEffort;
  else delete draft.reasoningEffort;
  if (endpointChanged) delete draft.capabilities;
  data.profiles[index] = draft;
  const assigned = assignGroups(data);
  writeFile(assigned.data);
  return assigned.data.profiles.find((profile) => profile.id === id) ?? draft;
}

export function saveProfileCapabilities(
  id: string,
  capabilities: ProfileCapabilities,
): ApiProfile {
  const data = loadProfiles();
  const index = data.profiles.findIndex((profile) => profile.id === id);
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
  const data = loadProfiles();
  data.profiles = data.profiles.filter((profile) => profile.id !== id);
  const assigned = assignGroups(data);
  writeFile(assigned.data);
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
