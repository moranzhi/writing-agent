import type { IncomingMessage, ServerResponse } from "node:http";
import { listSkills } from "../skills/loader.js";
import { createBook, deleteBook, getBook, listBooks, updateBook } from "../book/store.js";
import { sessionManager } from "./session-manager.js";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

export async function handleBooksApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname === "/api/skills" && req.method === "GET") {
    const skills = await listSkills();
    json(res, 200, {
      skills: skills.map((s) => ({
        id: s.name,
        name: s.name,
        description: s.description,
        category: s.category,
        bookKind: s.bookKind,
      })),
    });
    return true;
  }

  if (pathname === "/api/books" && req.method === "GET") {
    json(res, 200, { books: listBooks() });
    return true;
  }

  if (pathname === "/api/books" && req.method === "POST") {
    const body = JSON.parse(await readBody(req)) as { title?: string };
    const book = createBook({ title: body.title });
    const session = await sessionManager.createForBook(book.id);
    json(res, 201, { book, session });
    return true;
  }

  const savesListMatch = pathname.match(/^\/api\/books\/([^/]+)\/saves$/);
  if (savesListMatch) {
    const bookId = decodeURIComponent(savesListMatch[1]);
    const book = getBook(bookId);
    if (!book) {
      json(res, 404, { error: "Book 不存在" });
      return true;
    }

    if (req.method === "GET") {
      try {
        const saves = sessionManager.listGameSnapshots(bookId);
        json(res, 200, { saves });
      } catch (err) {
        json(res, 400, {
          error: err instanceof Error ? err.message : "读取存档失败",
        });
      }
      return true;
    }

    if (req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as {
        label?: string;
        note?: string;
        sessionId?: string;
        kind?: "instance" | "run";
      };
      const sessionId =
        body.sessionId?.trim() ||
        sessionManager.getActiveSessionForBook(bookId)?.id;
      if (!sessionId) {
        json(res, 400, { error: "当前作品没有活跃会话，无法存档" });
        return true;
      }
      const kind = body.kind === "instance" ? "instance" : "run";
      try {
        const save = sessionManager.saveGameSnapshot(
          sessionId,
          body.label ?? "",
          kind,
          body.note,
        );
        json(res, 201, { save });
      } catch (err) {
        json(res, 400, {
          error: err instanceof Error ? err.message : "存档失败",
        });
      }
      return true;
    }
  }

  const saveItemMatch = pathname.match(
    /^\/api\/books\/([^/]+)\/saves\/([^/]+)(\/load)?$/,
  );
  if (saveItemMatch) {
    const bookId = decodeURIComponent(saveItemMatch[1]);
    const saveId = decodeURIComponent(saveItemMatch[2]);
    const isLoad = saveItemMatch[3] === "/load";

    if (isLoad && req.method === "POST") {
      try {
        const session = await sessionManager.loadGameSnapshot(bookId, saveId);
        json(res, 200, { session });
      } catch (err) {
        json(res, 400, {
          error: err instanceof Error ? err.message : "读档失败",
        });
      }
      return true;
    }

    if (req.method === "DELETE") {
      try {
        sessionManager.deleteGameSnapshot(bookId, saveId);
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 404, {
          error: err instanceof Error ? err.message : "删除失败",
        });
      }
      return true;
    }
  }

  const bookMatch = pathname.match(/^\/api\/books\/([^/]+)(\/open)?$/);
  if (bookMatch) {
    const bookId = decodeURIComponent(bookMatch[1]);
    const isOpen = bookMatch[2] === "/open";

    if (isOpen && req.method === "POST") {
      const book = getBook(bookId);
      if (!book) {
        json(res, 404, { error: "Book 不存在" });
        return true;
      }
      const session = await sessionManager.openBook(book.id);
      json(res, 200, { book, session });
      return true;
    }

    if (req.method === "GET") {
      const book = getBook(bookId);
      if (!book) {
        json(res, 404, { error: "Book 不存在" });
        return true;
      }
      json(res, 200, { book });
      return true;
    }

    if (req.method === "PUT") {
      const body = JSON.parse(await readBody(req)) as { title?: string };
      try {
        const book = updateBook(bookId, { title: body.title?.trim() });
        json(res, 200, { book });
      } catch (err) {
        json(res, 404, {
          error: err instanceof Error ? err.message : "更新失败",
        });
      }
      return true;
    }

    if (req.method === "DELETE") {
      const book = getBook(bookId);
      if (!book) {
        json(res, 404, { error: "Book 不存在" });
        return true;
      }
      sessionManager.dropBookSessions(bookId);
      deleteBook(bookId);
      json(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}
