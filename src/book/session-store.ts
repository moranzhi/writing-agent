import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureUserDataDirs, getUserDataDir } from "../config/user-data-dir.js";
import type { PersistedBookSession } from "../types/book-session.js";

const SESSION_FILENAME = "session.json";

function bookDir(bookId: string): string {
  return path.join(getUserDataDir(), "books", bookId);
}

function sessionPath(bookId: string): string {
  return path.join(bookDir(bookId), SESSION_FILENAME);
}

export function saveBookSession(snapshot: PersistedBookSession): void {
  ensureUserDataDirs();
  const dir = bookDir(snapshot.bookId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(sessionPath(snapshot.bookId), JSON.stringify(snapshot, null, 2), "utf8");
}

export function loadBookSession(bookId: string): PersistedBookSession | null {
  try {
    const raw = readFileSync(sessionPath(bookId), "utf8");
    const parsed = JSON.parse(raw) as PersistedBookSession;
    if (parsed.version !== 1 || !parsed.sessionId || !parsed.runtimeSession) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function deleteBookSession(bookId: string): void {
  try {
    rmSync(bookDir(bookId), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function hasBookSession(bookId: string): boolean {
  return loadBookSession(bookId) !== null;
}
