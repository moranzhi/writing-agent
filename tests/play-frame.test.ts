import { describe, expect, it } from "vitest";
import { importSillyTavernPreset } from "../src/preset/importer.js";
import { assemblePlayWorkerMessages } from "../src/preset/play-frame.js";
import { assemblePresetMessages } from "../src/preset/assembler.js";
import type { WorldInfoPack } from "../src/preset/world-info-pack.js";

const pack: WorldInfoPack = {
  worldBookBefore: [{ id: "lore", name: "舞台", content: "古镇夜雨" }],
  history: "用户：昨天来过",
  worldBookAfter: [{ id: "vars", name: "变量", content: "HP 3" }],
  turn: "我推门",
  postTurn: [{ id: "tail", name: "尾注", content: "勿剧透" }],
};

describe("assemblePlayWorkerMessages", () => {
  it("walks extended prompt_order: ST pre, our before, history, our after, turn, ST post, postTurn", () => {
    const report = importSillyTavernPreset({
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
    });

    const messages = assemblePlayWorkerMessages({
      systemPrompt: "SKILL",
      preset: report.preset,
      pack,
    });

    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["system", "MAIN"],
      [
        "system",
        "### 任务契约\n\nSKILL\n\n### 舞台\n\n古镇夜雨",
      ],
      ["system", "用户：昨天来过"],
      ["system", "### 变量\n\nHP 3"],
      ["user", "我推门"],
      ["system", "PHI"],
      ["system", "### 尾注\n\n勿剧透"],
    ]);
  });

  it("does not emit any message before the first preset order entry", () => {
    const report = importSillyTavernPreset({
      prompts: [
        {
          identifier: "wb-head",
          name: "世界书首",
          role: "system",
          content: "<世界书>",
        },
        {
          identifier: "chatHistory",
          name: "History",
          role: "system",
          marker: true,
        },
        {
          identifier: "wb-tail",
          name: "世界书尾",
          role: "system",
          content: "</世界书>",
        },
      ],
      prompt_order: [
        {
          character_id: 1,
          order: [
            { identifier: "wb-head", enabled: true },
            { identifier: "chatHistory", enabled: true },
            { identifier: "wb-tail", enabled: true },
          ],
        },
      ],
    });
    const messages = assemblePlayWorkerMessages({
      systemPrompt: "创作步骤契约",
      preset: report.preset,
      pack: {
        worldBookBefore: [{ id: "lore", name: "设定", content: "港口" }],
        history: "昨日对话",
        worldBookAfter: [],
        turn: "本轮",
        postTurn: [],
      },
    });
    expect(messages[0]).toEqual({ role: "system", content: "<世界书>" });
    expect(messages.some((m) => m.content === "创作步骤契约")).toBe(false);
    expect(
      messages.some((m) => m.content.includes("### 任务契约\n\n创作步骤契约")),
    ).toBe(true);
  });

  it("does not fill ST charDescription even if resolver returns content", () => {
    const report = importSillyTavernPreset({
      prompts: [
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
      ],
      prompt_order: [
        {
          character_id: 1,
          order: [
            { identifier: "charDescription", enabled: true },
            { identifier: "chatHistory", enabled: true },
          ],
        },
      ],
    });
    const messages = assemblePresetMessages(report.preset, (id) => {
      if (id === "charDescription") return "CARD";
      if (id === "chatHistory") return "HIST";
      return null;
    });
    expect(messages.map((m) => m.content)).toEqual(["HIST"]);
  });
});
