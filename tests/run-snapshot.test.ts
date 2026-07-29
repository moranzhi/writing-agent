import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createSession } from "../src/runtime/phase-machine.js";
import type { RunSnapshot } from "../src/types/run-snapshot.js";

describe("run snapshot store", () => {
  beforeAll(() => {
    process.env.WRITING_AGENT_DATA_DIR = mkdtempSync(
      path.join(tmpdir(), "wa-run-snapshot-"),
    );
  });

  function makeSnapshot(bookId: string, label: string, kind: "instance" | "run" = "run"): RunSnapshot {
    const runtimeSession = createSession("default");
    runtimeSession.phase = "running";
    runtimeSession.slots.startupCompleted = true;
    return {
      version: 1,
      id: randomUUID(),
      bookId,
      label,
      kind,
      orchestratorId: "world-simulator",
      runtimeSession,
      blackboardItems: [
        {
          id: randomUUID(),
          tag: "运行.事件流",
          content: "## 第 1 轮\n- 测试",
          source: "worker",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      messages: [
        {
          id: randomUUID(),
          role: "user",
          text: "存档时的对话",
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      note: "测试快照",
    };
  }

  it("saveRunSnapshot / loadRunSnapshot roundtrip", async () => {
    const { saveRunSnapshot, loadRunSnapshot } = await import(
      "../src/book/run-snapshot-store.js"
    );
    const bookId = randomUUID();
    const snapshot = makeSnapshot(bookId, "第 1 轮后");

    saveRunSnapshot(snapshot);
    const loaded = loadRunSnapshot(bookId, snapshot.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.label).toBe("第 1 轮后");
    expect(loaded!.blackboardItems).toHaveLength(1);
    expect(loaded!.note).toBe("测试快照");
  });

  it("listRunSnapshots returns saved items newest first", async () => {
    const { saveRunSnapshot, listRunSnapshots } = await import(
      "../src/book/run-snapshot-store.js"
    );
    const bookId = randomUUID();
    const older = makeSnapshot(bookId, "较早");
    older.createdAt = "2020-01-01T00:00:00.000Z";
    const newer = makeSnapshot(bookId, "较新");
    newer.createdAt = "2025-01-01T00:00:00.000Z";

    saveRunSnapshot(older);
    saveRunSnapshot(newer);

    const list = listRunSnapshots(bookId);
    expect(list).toHaveLength(2);
    expect(list[0].label).toBe("较新");
    expect(list[1].label).toBe("较早");
  });

  it("deleteRunSnapshot removes one snapshot", async () => {
    const { saveRunSnapshot, loadRunSnapshot, deleteRunSnapshot } = await import(
      "../src/book/run-snapshot-store.js"
    );
    const bookId = randomUUID();
    const snapshot = makeSnapshot(bookId, "待删");

    saveRunSnapshot(snapshot);
    expect(loadRunSnapshot(bookId, snapshot.id)).not.toBeNull();

    expect(deleteRunSnapshot(bookId, snapshot.id)).toBe(true);
    expect(loadRunSnapshot(bookId, snapshot.id)).toBeNull();
    expect(deleteRunSnapshot(bookId, snapshot.id)).toBe(false);
  });

  it("deleteAllRunSnapshots clears book snapshots", async () => {
    const { saveRunSnapshot, listRunSnapshots, deleteAllRunSnapshots } =
      await import("../src/book/run-snapshot-store.js");
    const bookId = randomUUID();
    saveRunSnapshot(makeSnapshot(bookId, "a"));
    saveRunSnapshot(makeSnapshot(bookId, "b"));

    deleteAllRunSnapshots(bookId);
    expect(listRunSnapshots(bookId)).toHaveLength(0);
  });

  it("deleteBook removes run snapshots", async () => {
    const { createBook, deleteBook } = await import("../src/book/store.js");
    const { saveRunSnapshot, listRunSnapshots } = await import(
      "../src/book/run-snapshot-store.js"
    );

    const book = createBook({ title: "快照清理测试" });
    saveRunSnapshot(makeSnapshot(book.id, "保留前"));

    deleteBook(book.id);
    expect(listRunSnapshots(book.id)).toHaveLength(0);
  });

  it("saveGameSnapshot / loadGameSnapshot restores playable state", async () => {
    const { createBook } = await import("../src/book/store.js");
    const { SessionManager } = await import("../src/server/session-manager.js");

    const book = createBook({ title: "读档测试" });

    const mgr = new SessionManager();
    const view1 = await mgr.createForBook(book.id, "world-simulator");
    await mgr.sendMessage(view1.id, "读档前消息");

    const save = mgr.saveGameSnapshot(view1.id, "第一章末");
    expect(save.label).toBe("第一章末");

    await mgr.sendMessage(view1.id, "读档后不应保留的消息");

    const view2 = await mgr.loadGameSnapshot(book.id, save.id);
    expect(view2.messages.some((m) => m.text === "读档前消息")).toBe(true);
    expect(view2.messages.some((m) => m.text === "读档后不应保留的消息")).toBe(false);
    expect(view2.hints.some((h) => h.includes("第一章末"))).toBe(true);
  }, 20_000);

  it("instance snapshot strips run progress on save and load", async () => {
    const { createBook } = await import("../src/book/store.js");
    const { SessionManager } = await import("../src/server/session-manager.js");
    const { loadRunSnapshot } = await import("../src/book/run-snapshot-store.js");

    const book = createBook({ title: "实例快照" });

    const mgr = new SessionManager();
    const view = await mgr.createForBook(book.id, "world-simulator");
    const managed = mgr["require"](view.id) as {
      runtime: { getSession: () => { slots: Record<string, unknown> }; getBlackboard: () => { write: (i: object) => void } };
    };
    managed.runtime.getSession().slots.startupCompleted = true;
    const bb = managed.runtime.getBlackboard();
    bb.write({ tag: "情境.实验.设定", content: "囚徒困境", source: "worker" });
    bb.write({ tag: "运行.事件流", content: "第1轮", source: "worker" });

    const save = mgr.saveGameSnapshot(view.id, "标准局", "instance");
    expect(save.kind).toBe("instance");

    const stored = loadRunSnapshot(book.id, save.id)!;
    expect(stored.blackboardItems.some((i) => i.tag === "情境.实验.设定")).toBe(true);
    expect(stored.blackboardItems.some((i) => i.tag === "运行.事件流")).toBe(false);

    const loaded = await mgr.loadGameSnapshot(book.id, save.id);
    expect(loaded.hints.some((h) => h.includes("实例"))).toBe(true);
  });
});
