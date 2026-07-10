import { mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureUserDataDirs, getUserDataDir } from "../config/user-data-dir.js";
import type { RunSnapshot, RunSnapshotMeta } from "../types/run-snapshot.js";
import { toRunSnapshotMeta } from "../types/run-snapshot.js";

function snapshotsDir(bookId: string): string {
  return path.join(getUserDataDir(), "books", bookId, "run-snapshots");
}

function snapshotPath(bookId: string, snapshotId: string): string {
  return path.join(snapshotsDir(bookId), `${snapshotId}.json`);
}

function isValidRunSnapshot(value: unknown): value is RunSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as RunSnapshot;
  const kind = s.kind ?? "run";
  return (
    s.version === 1 &&
    typeof s.id === "string" &&
    typeof s.bookId === "string" &&
    typeof s.label === "string" &&
    (kind === "instance" || kind === "run") &&
    typeof s.orchestratorId === "string" &&
    s.runtimeSession != null &&
    Array.isArray(s.blackboardItems) &&
    Array.isArray(s.messages) &&
    typeof s.createdAt === "string"
  );
}

function normalizeSnapshot(raw: RunSnapshot): RunSnapshot {
  return { ...raw, kind: raw.kind ?? "run" };
}

/** 保存运行快照（同 bookId + snapshotId 则覆盖） */
export function saveRunSnapshot(snapshot: RunSnapshot): void {
  ensureUserDataDirs();
  const dir = snapshotsDir(snapshot.bookId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(snapshotPath(snapshot.bookId, snapshot.id), JSON.stringify(snapshot, null, 2), "utf8");
}

/** 读取单个运行快照；不存在或格式无效时返回 null */
export function loadRunSnapshot(bookId: string, snapshotId: string): RunSnapshot | null {
  try {
    const raw = readFileSync(snapshotPath(bookId, snapshotId), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidRunSnapshot(parsed) || parsed.bookId !== bookId || parsed.id !== snapshotId) {
      return null;
    }
    return normalizeSnapshot(parsed);
  } catch {
    return null;
  }
}

/** 删除单个运行快照；成功删除返回 true */
export function deleteRunSnapshot(bookId: string, snapshotId: string): boolean {
  try {
    unlinkSync(snapshotPath(bookId, snapshotId));
    return true;
  } catch {
    return false;
  }
}

/** 列出某 Book 下全部运行快照（按 createdAt 降序） */
export function listRunSnapshots(bookId: string): RunSnapshotMeta[] {
  ensureUserDataDirs();
  let files: string[];
  try {
    files = readdirSync(snapshotsDir(bookId)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const metas: RunSnapshotMeta[] = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const snapshot = loadRunSnapshot(bookId, id);
    if (snapshot) metas.push(toRunSnapshotMeta(snapshot));
  }

  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 删除某 Book 下全部运行快照（删 Book 时调用） */
export function deleteAllRunSnapshots(bookId: string): void {
  try {
    rmSync(snapshotsDir(bookId), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
