import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createSession } from "../src/runtime/phase-machine.js";
import type { PersistedBookSession } from "../src/types/book-session.js";

describe("session persistence", () => {
  beforeAll(() => {
    process.env.WRITING_AGENT_DATA_DIR = mkdtempSync(
      path.join(tmpdir(), "wa-session-persist-"),
    );
  });

  it("saveBookSession / loadBookSession roundtrip", async () => {
    const { createBook } = await import("../src/book/store.js");
    const { saveBookSession, loadBookSession } = await import(
      "../src/book/session-store.js"
    );

    const book = createBook({ title: "持久化测试" });
    const sessionId = randomUUID();
    const runtimeSession = createSession("default");
    runtimeSession.id = sessionId;
    runtimeSession.phase = "running";
    runtimeSession.slots = { startupCompleted: true, userGoal: "测试目标" };

    const snapshot: PersistedBookSession = {
      version: 1,
      sessionId,
      bookId: book.id,
      orchestratorId: "world-simulator",
      runtimeSession,
      blackboardItems: [
        {
          id: randomUUID(),
          tag: "测试.条目",
          content: "hello",
          source: "worker",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      messages: [
        {
          id: randomUUID(),
          role: "user",
          text: "用户消息",
          createdAt: new Date().toISOString(),
        },
      ],
      savedAt: new Date().toISOString(),
    };

    saveBookSession(snapshot);
    const loaded = loadBookSession(book.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe(sessionId);
    expect(loaded!.runtimeSession.phase).toBe("running");
    expect(loaded!.runtimeSession.slots.userGoal).toBe("测试目标");
    expect(loaded!.blackboardItems).toHaveLength(1);
    expect(loaded!.messages[0].text).toBe("用户消息");
  });

  it("openBook restores persisted session after restart", async () => {
    const { createBook, getBook } = await import("../src/book/store.js");
    const { SessionManager } = await import("../src/server/session-manager.js");

    const book = createBook({ title: "续作测试" });

    const mgr1 = new SessionManager();
    const view1 = await mgr1.createForBook(book.id, "world-simulator");
    await mgr1.sendMessage(view1.id, "测试输入");

    const mgr2 = new SessionManager();
    const view2 = await mgr2.openBook(book.id);

    expect(view2.id).toBe(view1.id);
    expect(view2.resumed).toBe(true);
    expect(view2.hints.some((h) => h.includes("恢复"))).toBe(true);
    expect(view2.messages.some((m) => m.text === "测试输入")).toBe(true);
    expect(getBook(book.id)?.activeSessionId).toBe(view1.id);
  }, 20_000);

  it("deleteBook removes session snapshot", async () => {
    const { createBook, deleteBook } = await import("../src/book/store.js");
    const { hasBookSession } = await import("../src/book/session-store.js");
    const { SessionManager } = await import("../src/server/session-manager.js");

    const book = createBook({ title: "删除测试" });

    const mgr = new SessionManager();
    await mgr.createForBook(book.id, "world-simulator");
    expect(hasBookSession(book.id)).toBe(true);

    deleteBook(book.id);
    expect(hasBookSession(book.id)).toBe(false);
  });

  it("createForBook auto-starts world-simulator agent-first", async () => {
    const { createBook, deleteBook } = await import("../src/book/store.js");
    const { SessionManager } = await import("../src/server/session-manager.js");

    const book = createBook({ title: "启动询问" });

    const mgr = new SessionManager();
    const view = await mgr.createForBook(book.id);
    expect(view.waitingReason?.kind).toBe("input");
    expect(view.activeSkill).toBe("world-simulator");
    expect(view.uiPrompt).toContain("描述想做什么");
    expect(view.messages.some((m) => m.text?.includes("描述想做什么"))).toBe(false);

    deleteBook(book.id);
  });

  it("createForBook with explicit world-simulator override", async () => {
    const { createBook, deleteBook } = await import("../src/book/store.js");
    const { SessionManager } = await import("../src/server/session-manager.js");

    const book = createBook({ title: "显式包" });

    const mgr = new SessionManager();
    const view = await mgr.createForBook(book.id, "world-simulator");
    expect(view.waitingReason?.kind).toBe("input");
    expect(view.activeSkill).toBe("world-simulator");

    deleteBook(book.id);
  });

  it("createForBook with recipe lands on that recipe's seeded pick graph", async () => {
    const { createBook, deleteBook } = await import("../src/book/store.js");
    const { SessionManager } = await import("../src/server/session-manager.js");

    const book = createBook({ title: "配方开局" });
    const mgr = new SessionManager();
    const view = await mgr.createForBook(
      book.id,
      "world-simulator",
      "world-simulator",
    );
    expect(view.waitingReason?.kind).toBe("pick_creation_step");
    expect(view.startupCompleted).toBe(true);
    expect(view.uiPrompt).toBeUndefined();
    expect(view.openingGuide).toBeNull();
    const { loadAllRecipeDetails } = await import(
      "../src/skills/creation-flow.js"
    );
    const details = await loadAllRecipeDetails("dialogue/world-simulator");
    const seedNames = details
      .find((d) => d.id === "world-simulator")
      ?.seed?.steps.map((s) => s.name);
    expect(seedNames?.length).toBeGreaterThan(0);
    expect(view.creationFlowView?.steps.map((s) => s.name)).toEqual(seedNames);

    deleteBook(book.id);
  });
});
