import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { BookProject, BookSummary } from "../types/book.js";
import type { PersistedBookSession } from "../types/book-session.js";
import type { RunSnapshot } from "../types/run-snapshot.js";
import { ensureUserDataDirs, getUserDataDir } from "../config/user-data-dir.js";
import { deleteBookSession } from "./session-store.js";
import { deleteAllRunSnapshots } from "./run-snapshot-store.js";

const SESSION_FILENAME = "session.json";

function booksDir(): string {
  return path.join(getUserDataDir(), "books");
}

function bookPath(id: string): string {
  return path.join(booksDir(), `${id}.json`);
}

function bookDataDir(id: string): string {
  return path.join(getUserDataDir(), "books", id);
}

export function listBooks(): BookSummary[] {
  ensureUserDataDirs();
  mkdirSync(booksDir(), { recursive: true });
  let files: string[];
  try {
    files = readdirSync(booksDir()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const books: BookProject[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(path.join(booksDir(), file), "utf8");
      books.push(JSON.parse(raw) as BookProject);
    } catch {
      /* skip */
    }
  }

  return books
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((b) => ({
      id: b.id,
      title: b.title,
      activeSkillId: b.activeSkillId ?? b.orchestratorId,
      activeSkillName: b.activeSkillName ?? b.orchestratorName,
      preview: b.preview,
      updatedAt: b.updatedAt,
      orchestratorId: b.orchestratorId,
      orchestratorName: b.orchestratorName,
    }));
}

export function getBook(id: string): BookProject | null {
  try {
    const raw = readFileSync(bookPath(id), "utf8");
    return JSON.parse(raw) as BookProject;
  } catch {
    return null;
  }
}

export function createBook(input: { title?: string }): BookProject {
  ensureUserDataDirs();
  mkdirSync(booksDir(), { recursive: true });
  const now = new Date().toISOString();
  const book: BookProject = {
    id: randomUUID(),
    title: input.title?.trim() || "未命名作品",
    preview: "新建作品，描述你想创作什么…",
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  };
  writeFileSync(bookPath(book.id), JSON.stringify(book, null, 2), "utf8");
  return book;
}

export function updateBook(
  id: string,
  patch: Partial<
    Pick<
      BookProject,
      | "title"
      | "preview"
      | "sessionIds"
      | "activeSessionId"
      | "activeSkillId"
      | "activeSkillName"
      | "orchestratorId"
      | "orchestratorName"
    >
  >,
): BookProject {
  const book = getBook(id);
  if (!book) throw new Error("Book 不存在");
  const updated: BookProject = {
    ...book,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(bookPath(id), JSON.stringify(updated, null, 2), "utf8");
  return updated;
}

export function appendBookSession(id: string, sessionId: string): void {
  const book = getBook(id);
  if (!book) return;
  if (!book.sessionIds.includes(sessionId)) {
    updateBook(id, { sessionIds: [...book.sessionIds, sessionId] });
  }
}

export function deleteBook(id: string): void {
  deleteBookSession(id);
  deleteAllRunSnapshots(id);
  try {
    unlinkSync(bookPath(id));
  } catch {
    /* ignore */
  }
}

/** 复制作品及其会话、游玩存档为新作品 */
export function duplicateBook(sourceId: string, title?: string): BookProject {
  const source = getBook(sourceId);
  if (!source) throw new Error("Book 不存在");

  const newId = randomUUID();
  const newSessionId = randomUUID();
  const now = new Date().toISOString();
  const dupTitle = title?.trim() || `${source.title} 副本`;

  ensureUserDataDirs();
  const sourceDir = bookDataDir(sourceId);
  const destDir = bookDataDir(newId);

  if (existsSync(sourceDir)) {
    cpSync(sourceDir, destDir, { recursive: true });
  } else {
    mkdirSync(destDir, { recursive: true });
  }

  const sessionFile = path.join(destDir, SESSION_FILENAME);
  let sessionIds: string[] = [];
  let activeSessionId: string | undefined;

  if (existsSync(sessionFile)) {
    try {
      const snap = JSON.parse(readFileSync(sessionFile, "utf8")) as PersistedBookSession;
      snap.bookId = newId;
      snap.sessionId = newSessionId;
      snap.runtimeSession.id = newSessionId;
      snap.savedAt = now;
      writeFileSync(sessionFile, JSON.stringify(snap, null, 2), "utf8");
      sessionIds = [newSessionId];
      activeSessionId = newSessionId;
    } catch {
      /* ignore broken session */
    }
  }

  const snapDir = path.join(destDir, "run-snapshots");
  if (existsSync(snapDir)) {
    for (const file of readdirSync(snapDir).filter((f) => f.endsWith(".json"))) {
      try {
        const full = path.join(snapDir, file);
        const raw = JSON.parse(readFileSync(full, "utf8")) as RunSnapshot;
        raw.bookId = newId;
        writeFileSync(full, JSON.stringify(raw, null, 2), "utf8");
      } catch {
        /* skip */
      }
    }
  }

  const newBook: BookProject = {
    ...structuredClone(source),
    id: newId,
    title: dupTitle,
    sessionIds,
    activeSessionId,
    createdAt: now,
    updatedAt: now,
  };
  writeFileSync(bookPath(newId), JSON.stringify(newBook, null, 2), "utf8");
  return newBook;
}
