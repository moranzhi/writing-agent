import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { importSillyTavernPreset } from "../src/preset/importer.js";
import {
  appendTurnMessages,
  assembleDirectChatMessages,
  buildChatHistory,
  buildDirectChatTaskMessages,
  buildPriorForWindow,
  createConversation,
  createShell,
  DEFAULT_DIRECT_CHAT_SYSTEM,
  EMPTY_SHELL_SLOTS,
  getConversation,
  getShell,
  listConversations,
  listShells,
  promoteTemporary,
  resolveDirectChatPreset,
  runDirectChatTurn,
} from "../src/direct-chat/index.js";

function samplePreset() {
  return importSillyTavernPreset({
    prompts: [
      { identifier: "main", name: "Main", role: "system", content: "MAIN" },
      {
        identifier: "charDescription",
        name: "Desc",
        role: "system",
        marker: true,
      },
      {
        identifier: "chatHistory",
        name: "History",
        role: "system",
        marker: true,
      },
      { identifier: "jailbreak", name: "PHI", role: "system", content: "PHI" },
    ],
    prompt_order: [
      {
        character_id: 1,
        order: [
          { identifier: "main", enabled: true },
          { identifier: "charDescription", enabled: true },
          { identifier: "chatHistory", enabled: true },
          { identifier: "jailbreak", enabled: true },
        ],
      },
    ],
  }).preset;
}

describe("direct-chat history assembly", () => {
  it("joins seed history with prior turns", () => {
    expect(
      buildChatHistory("种子", [
        { role: "user", content: "你好" },
        { role: "assistant", content: "嗨" },
      ]),
    ).toBe("种子\n\n【用户】\n你好\n\n【助手】\n嗨");
  });

  it("fills sandwich with seed + transcript + turn", () => {
    const messages = assembleDirectChatMessages(samplePreset(), {
      message: "继续",
      slots: {
        ...EMPTY_SHELL_SLOTS,
        systemPrompt: "契约",
        loreBefore: "设定A",
        seedHistory: "旧史",
      },
      priorMessages: [{ role: "user", content: "上一句" }],
    });
    const contents = messages.map((m) => m.content);
    expect(contents.some((c) => String(c).includes("设定A"))).toBe(true);
    expect(contents.some((c) => String(c).includes("旧史"))).toBe(true);
    expect(contents.some((c) => String(c).includes("上一句"))).toBe(true);
    expect(contents).toContain("继续");
    expect(contents.some((c) => String(c).includes("契约"))).toBe(true);
  });

  it("uses default system prompt when slot empty", () => {
    const task = buildDirectChatTaskMessages({
      message: "hi",
      slots: EMPTY_SHELL_SLOTS,
      priorMessages: [],
    });
    expect(task[0]?.content).toBe(DEFAULT_DIRECT_CHAT_SYSTEM);
  });
});

describe("direct-chat store", () => {
  beforeEach(() => {
    process.env.WRITING_AGENT_DATA_DIR = mkdtempSync(
      path.join(tmpdir(), "wa-direct-chat-"),
    );
  });

  it("roundtrips shell and conversation", () => {
    const shell = createShell({
      name: "测试壳",
      slots: { ...EMPTY_SHELL_SLOTS, loreBefore: "世界" },
    });
    expect(getShell(shell.id)?.loreBefore).toBe("世界");
    const conv = createConversation({
      shellId: shell.id,
      name: "会话1",
      messages: [
        {
          id: "m1",
          role: "user",
          content: "你好",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(listShells()[0]?.conversationCount).toBe(1);
    expect(listConversations(shell.id)).toHaveLength(1);
    expect(getConversation(conv.id)?.messages[0]?.content).toBe("你好");
  });

  it("promotes temporary messages into persistent shell+conversation", () => {
    const { shell, conversation } = promoteTemporary({
      shell: { name: "从临时", slots: { loreBefore: "L" } },
      conversationName: "升格会话",
      messages: [
        {
          id: "u1",
          role: "user",
          content: "问",
          createdAt: new Date().toISOString(),
        },
        {
          id: "a1",
          role: "assistant",
          content: "答",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(shell.name).toBe("从临时");
    expect(shell.loreBefore).toBe("L");
    expect(conversation.name).toBe("升格会话");
    expect(conversation.messages).toHaveLength(2);
  });
});

describe("direct-chat turn gating", () => {
  it("rejects when no preset is available", async () => {
    process.env.WRITING_AGENT_DATA_DIR = mkdtempSync(
      path.join(tmpdir(), "wa-direct-chat-preset-"),
    );
    await expect(
      runDirectChatTurn({
        message: "你好",
        slots: EMPTY_SHELL_SLOTS,
        priorMessages: [],
        presetId: null,
        complete: false,
      }),
    ).rejects.toThrow(/预设/);
  });

  it("appends user/assistant and keeps contextTrace on latest", () => {
    const messages = appendTurnMessages({
      prior: [],
      userText: "问",
      reply: "答",
      contextTrace: {
        caller: "direct-chat",
        createdAt: new Date().toISOString(),
        messages: [{ role: "user", content: "x" }],
        charCount: 1,
      },
      keepTraceLatest: 3,
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]?.contextTrace?.caller).toBe("direct-chat");
  });
});

describe("resolveDirectChatPreset", () => {
  it("throws for missing explicit preset id", () => {
    expect(() => resolveDirectChatPreset("missing-preset-xyz")).toThrow(
      /预设不存在/,
    );
  });
});

describe("buildPriorForWindow", () => {
  const turns = [
    {
      id: "t1",
      user: { content: "问1", createdAt: "1" },
      replies: [
        { windowId: "a", content: "A1" },
        { windowId: "b", content: "B1" },
      ],
      createdAt: "1",
    },
    {
      id: "t2",
      user: { content: "问2", createdAt: "2" },
      replies: [
        { windowId: "a", content: "A2" },
        { windowId: "b", content: "B2" },
      ],
      selectedWindowId: "a",
      createdAt: "2",
    },
  ];

  it("uses each window's own reply when nothing selected", () => {
    expect(buildPriorForWindow([turns[0]!], "b")).toEqual([
      { role: "user", content: "问1" },
      { role: "assistant", content: "B1" },
    ]);
  });

  it("forces selected reply into every window's prior", () => {
    expect(buildPriorForWindow(turns, "b")).toEqual([
      { role: "user", content: "问1" },
      { role: "assistant", content: "B1" },
      { role: "user", content: "问2" },
      { role: "assistant", content: "A2" },
    ]);
  });
});
