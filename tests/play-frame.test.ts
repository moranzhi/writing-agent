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
      ["system", "SKILL"],
      ["system", "MAIN"],
      ["system", "### 舞台\n\n古镇夜雨"],
      ["system", "用户：昨天来过"],
      ["system", "### 变量\n\nHP 3"],
      ["user", "我推门"],
      ["system", "PHI"],
      ["system", "### 尾注\n\n勿剧透"],
    ]);
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
