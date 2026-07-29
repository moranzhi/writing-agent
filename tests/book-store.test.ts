import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("book store", () => {
  beforeAll(() => {
    process.env.WRITING_AGENT_DATA_DIR = mkdtempSync(
      path.join(tmpdir(), "wa-book-test-"),
    );
  });

  it("creates and lists books", async () => {
    const { createBook, getBook, listBooks } = await import("../src/book/store.js");
    const book = createBook({ title: "测试之书" });
    expect(book.id).toBeTruthy();
    expect(getBook(book.id)?.title).toBe("测试之书");
    expect(listBooks().some((b) => b.id === book.id)).toBe(true);
  });

  it("duplicates book with session data", async () => {
    const { createBook, duplicateBook, getBook, listBooks } = await import("../src/book/store.js");
    const { saveBookSession } = await import("../src/book/session-store.js");
    const source = createBook({ title: "源作品" });
    saveBookSession({
      version: 1,
      sessionId: "sess-1",
      bookId: source.id,
      runtimeSession: {
        id: "sess-1",
        phase: "idle",
        presetId: "default",
        slots: {},
        artifacts: [],
        history: [],
      },
      blackboardItems: [],
      messages: [],
      savedAt: new Date().toISOString(),
    });
    const copy = duplicateBook(source.id, "备份作品");
    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe("备份作品");
    expect(listBooks().some((b) => b.id === copy.id)).toBe(true);
    expect(getBook(copy.id)?.title).toBe("备份作品");
  });
});
