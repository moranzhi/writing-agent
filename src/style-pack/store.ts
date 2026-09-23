/**
 * 全局文风库：跨卡复用的「怎么写」包（遣词 / 示范 / 禁忌 / 写法档等）。
 * 与偏好库分离：偏好=硬约束全量挂载；文风=创作节点选用。
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureUserDataDirs, getUserDataDir } from "../config/user-data-dir.js";

export type StylePackStatus = "active" | "archived";

export type StylePackEntry = {
  id: string;
  /** 短名，便于列表与选用 */
  name: string;
  /** 只规定「怎么写」：遣词、示范、笔墨、禁忌、写法档、示例对话等 */
  content: string;
  /** 抽取时留下的样本原文（可选） */
  samples?: string;
  status: StylePackStatus;
  createdAt: string;
  updatedAt: string;
};

export type StylePackStoreFile = {
  version: 1;
  entries: StylePackEntry[];
};

const FILE_NAME = "style-packs.json";

function storePath(): string {
  return path.join(getUserDataDir(), FILE_NAME);
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultStore(): StylePackStoreFile {
  return { version: 1, entries: [] };
}

function normalizeStatus(raw: unknown): StylePackStatus {
  return raw === "archived" ? "archived" : "active";
}

function normalizeStore(raw: unknown): StylePackStoreFile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultStore();
  }
  const row = raw as Record<string, unknown>;
  if (row.version !== 1 || !Array.isArray(row.entries)) {
    return defaultStore();
  }
  const entries: StylePackEntry[] = [];
  for (const item of row.entries) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const p = item as Record<string, unknown>;
    const id = typeof p.id === "string" ? p.id.trim() : "";
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const content = typeof p.content === "string" ? p.content.trim() : "";
    if (!id || !name || !content) continue;
    const samples =
      typeof p.samples === "string" && p.samples.trim()
        ? p.samples.trim()
        : undefined;
    entries.push({
      id,
      name,
      content,
      ...(samples ? { samples } : {}),
      status: normalizeStatus(p.status),
      createdAt: typeof p.createdAt === "string" ? p.createdAt : nowIso(),
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : nowIso(),
    });
  }
  return { version: 1, entries };
}

export function loadStylePackStore(): StylePackStoreFile {
  ensureUserDataDirs();
  const file = storePath();
  if (!existsSync(file)) {
    const created = defaultStore();
    writeFileSync(file, JSON.stringify(created, null, 2), "utf8");
    return created;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return normalizeStore(parsed);
  } catch {
    return defaultStore();
  }
}

export function saveStylePackStore(store: StylePackStoreFile): void {
  ensureUserDataDirs();
  writeFileSync(storePath(), JSON.stringify(store, null, 2), "utf8");
}

export function listStylePacks(opts?: {
  status?: StylePackStatus | "all";
}): StylePackEntry[] {
  const status = opts?.status ?? "all";
  const entries = loadStylePackStore().entries;
  if (status === "all") return entries;
  return entries.filter((e) => e.status === status);
}

export function listActiveStylePacks(): StylePackEntry[] {
  return listStylePacks({ status: "active" });
}

export function getStylePack(id: string): StylePackEntry | null {
  return loadStylePackStore().entries.find((e) => e.id === id) ?? null;
}

export function createStylePack(input: {
  name: string;
  content: string;
  samples?: string;
  status?: StylePackStatus;
}): StylePackEntry {
  const name = input.name.trim();
  const content = input.content.trim();
  if (!name) throw new Error("文风名称不能为空");
  if (!content) throw new Error("文风内容不能为空");
  const store = loadStylePackStore();
  const t = nowIso();
  const samples = input.samples?.trim() || undefined;
  const entry: StylePackEntry = {
    id: randomUUID(),
    name,
    content,
    ...(samples ? { samples } : {}),
    status: input.status === "archived" ? "archived" : "active",
    createdAt: t,
    updatedAt: t,
  };
  store.entries.push(entry);
  saveStylePackStore(store);
  return entry;
}

export function updateStylePack(
  id: string,
  patch: {
    name?: string;
    content?: string;
    samples?: string | null;
    status?: StylePackStatus;
  },
): StylePackEntry {
  const store = loadStylePackStore();
  const idx = store.entries.findIndex((e) => e.id === id);
  if (idx < 0) throw new Error("文风包不存在");
  const cur = store.entries[idx]!;
  const name = patch.name !== undefined ? patch.name.trim() : cur.name;
  const content =
    patch.content !== undefined ? patch.content.trim() : cur.content;
  if (!name) throw new Error("文风名称不能为空");
  if (!content) throw new Error("文风内容不能为空");
  let samples = cur.samples;
  if (patch.samples !== undefined) {
    samples = patch.samples?.trim() || undefined;
  }
  const next: StylePackEntry = {
    ...cur,
    name,
    content,
    ...(samples ? { samples } : {}),
    status: patch.status !== undefined ? normalizeStatus(patch.status) : cur.status,
    updatedAt: nowIso(),
  };
  if (!samples) delete (next as { samples?: string }).samples;
  store.entries[idx] = next;
  saveStylePackStore(store);
  return next;
}

export function deleteStylePack(id: string): void {
  const store = loadStylePackStore();
  const next = store.entries.filter((e) => e.id !== id);
  if (next.length === store.entries.length) {
    throw new Error("文风包不存在");
  }
  store.entries = next;
  saveStylePackStore(store);
}
