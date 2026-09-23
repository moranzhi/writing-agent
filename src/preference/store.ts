/**
 * 全局用户偏好库：跨局约束条目（禁区 / 节奏 / 写法纠偏等）。
 * 手写与游玩采集入库后同形；采集入库须经审核卡。
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureUserDataDirs, getUserDataDir } from "../config/user-data-dir.js";

export type PreferenceStatus = "active" | "archived";

export type PreferenceEntry = {
  id: string;
  /** 可执行约束正文（含替代做法） */
  content: string;
  status: PreferenceStatus;
  createdAt: string;
  updatedAt: string;
};

export type PreferenceStoreFile = {
  version: 1;
  entries: PreferenceEntry[];
};

const FILE_NAME = "preferences.json";

/**
 * 内置起步条目（稳定 id）。库空或缺少对应 id 时写入；用户可改/归档/删。
 * 写法：短、具体、可执行；不写「何时静音 / 本局例外」——交给选用/筛选层。
 */
export const STARTER_PREFERENCES: ReadonlyArray<{
  id: string;
  content: string;
}> = [
  {
    id: "starter-no-user-ntr-victim",
    content:
      "用户代入角色不做被 NTR 的一方（恋人/伴侣与第三者发生性或背叛性感情，用户角色受害或被欺瞒）。用户角色 NTR 别人不受此限。",
  },
  {
    id: "starter-default-male-hetero-yuri-ok",
    content:
      "禁止对男同性恋内容的直接描写，减少或忽略间接描写。默认用户角色为男性，情爱与性吸引朝向女性；女同性恋内容可写。",
  },
];

function storePath(): string {
  return path.join(getUserDataDir(), FILE_NAME);
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildStarterEntries(at = nowIso()): PreferenceEntry[] {
  return STARTER_PREFERENCES.map((s) => ({
    id: s.id,
    content: s.content,
    status: "active" as const,
    createdAt: at,
    updatedAt: at,
  }));
}

function defaultStore(): PreferenceStoreFile {
  return { version: 1, entries: buildStarterEntries() };
}

/** 缺哪些起步 id 就补哪些；不覆盖用户已改过的同 id 正文 */
export function ensureStarterPreferences(): PreferenceEntry[] {
  const store = loadPreferenceStore();
  const have = new Set(store.entries.map((e) => e.id));
  const at = nowIso();
  let added = 0;
  for (const s of STARTER_PREFERENCES) {
    if (have.has(s.id)) continue;
    store.entries.push({
      id: s.id,
      content: s.content,
      status: "active",
      createdAt: at,
      updatedAt: at,
    });
    added += 1;
  }
  if (added) savePreferenceStore(store);
  return store.entries;
}

function normalizeStatus(raw: unknown): PreferenceStatus {
  return raw === "archived" ? "archived" : "active";
}

function normalizeStore(raw: unknown): PreferenceStoreFile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultStore();
  }
  const row = raw as Record<string, unknown>;
  if (row.version !== 1 || !Array.isArray(row.entries)) {
    return defaultStore();
  }
  const entries: PreferenceEntry[] = [];
  for (const item of row.entries) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const p = item as Record<string, unknown>;
    const id = typeof p.id === "string" ? p.id.trim() : "";
    const content = typeof p.content === "string" ? p.content.trim() : "";
    if (!id || !content) continue;
    entries.push({
      id,
      content,
      status: normalizeStatus(p.status),
      createdAt: typeof p.createdAt === "string" ? p.createdAt : nowIso(),
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : nowIso(),
    });
  }
  return { version: 1, entries };
}

export function loadPreferenceStore(): PreferenceStoreFile {
  ensureUserDataDirs();
  const file = storePath();
  if (!existsSync(file)) {
    const created = defaultStore();
    writeFileSync(file, JSON.stringify(created, null, 2), "utf8");
    return created;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const normalized = normalizeStore(parsed);
    // 旧空库：补起步条目
    if (normalized.entries.length === 0) {
      const seeded = defaultStore();
      writeFileSync(file, JSON.stringify(seeded, null, 2), "utf8");
      return seeded;
    }
    return normalized;
  } catch {
    return defaultStore();
  }
}

export function savePreferenceStore(store: PreferenceStoreFile): void {
  ensureUserDataDirs();
  writeFileSync(storePath(), JSON.stringify(store, null, 2), "utf8");
}

export function listPreferences(opts?: {
  status?: PreferenceStatus | "all";
}): PreferenceEntry[] {
  const status = opts?.status ?? "all";
  const entries = loadPreferenceStore().entries;
  if (status === "all") return entries;
  return entries.filter((e) => e.status === status);
}

export function listActivePreferences(): PreferenceEntry[] {
  return listPreferences({ status: "active" });
}

export function getPreference(id: string): PreferenceEntry | null {
  return loadPreferenceStore().entries.find((e) => e.id === id) ?? null;
}

export function createPreference(input: {
  content: string;
  status?: PreferenceStatus;
}): PreferenceEntry {
  const content = input.content.trim();
  if (!content) throw new Error("偏好内容不能为空");
  const store = loadPreferenceStore();
  const t = nowIso();
  const entry: PreferenceEntry = {
    id: randomUUID(),
    content,
    status: input.status === "archived" ? "archived" : "active",
    createdAt: t,
    updatedAt: t,
  };
  store.entries.push(entry);
  savePreferenceStore(store);
  return entry;
}

export function updatePreference(
  id: string,
  patch: { content?: string; status?: PreferenceStatus },
): PreferenceEntry {
  const store = loadPreferenceStore();
  const idx = store.entries.findIndex((e) => e.id === id);
  if (idx < 0) throw new Error("偏好条目不存在");
  const cur = store.entries[idx]!;
  const content =
    patch.content !== undefined ? patch.content.trim() : cur.content;
  if (!content) throw new Error("偏好内容不能为空");
  const next: PreferenceEntry = {
    ...cur,
    content,
    status: patch.status !== undefined ? normalizeStatus(patch.status) : cur.status,
    updatedAt: nowIso(),
  };
  store.entries[idx] = next;
  savePreferenceStore(store);
  return next;
}

export function deletePreference(id: string): void {
  const store = loadPreferenceStore();
  const next = store.entries.filter((e) => e.id !== id);
  if (next.length === store.entries.length) {
    throw new Error("偏好条目不存在");
  }
  store.entries = next;
  savePreferenceStore(store);
}

/** 审核通过后写入；content 以用户编辑后的正文为准 */
export function acceptPreferenceCandidate(content: string): PreferenceEntry {
  return createPreference({ content, status: "active" });
}
