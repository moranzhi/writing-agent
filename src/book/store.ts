import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BookProject, BookSummary } from "../types/book.js";
import { ensureUserDataDirs, getUserDataDir } from "../config/user-data-dir.js";
import { deleteBookSession } from "./session-store.js";
import { deleteAllRunSnapshots } from "./run-snapshot-store.js";

function booksDir(): string {
  return path.join(getUserDataDir(), "books");
}

function bookPath(id: string): string {
  return path.join(booksDir(), `${id}.json`);
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
    preview: "新建作品，选择 skill 包开始…",
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
