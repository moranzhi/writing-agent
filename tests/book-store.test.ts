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
});
