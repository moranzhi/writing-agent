import { describe, expect, it } from "vitest";
import { importSillyTavernPreset } from "../src/preset/importer.js";
import {
  assemblePresetProbe,
  DEFAULT_PROBE_CONTEXT,
  PROBE_SYSTEM_PROMPT,
  runPresetProbe,
} from "../src/preset/probe.js";

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

describe("assemblePresetProbe", () => {
  it("fills the sandwich with sample lore, history, and the current turn", () => {
    const messages = assemblePresetProbe(samplePreset(), {
      message: "我推开门。",
    });

    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["system", PROBE_SYSTEM_PROMPT],
      ["system", "MAIN"],
      ["system", `### 试跑设定\n\n${DEFAULT_PROBE_CONTEXT.loreBefore}`],
      ["system", DEFAULT_PROBE_CONTEXT.history],
      ["system", `### 本轮状态\n\n${DEFAULT_PROBE_CONTEXT.loreAfter}`],
      ["user", "我推开门。"],
      ["system", "PHI"],
    ]);
  });

  it("omits empty optional bags", () => {
    const messages = assemblePresetProbe(samplePreset(), {
      message: "你好",
      loreBefore: "",
      history: "",
      loreAfter: "",
      postTurn: "",
    });

    expect(messages.map((m) => m.content)).toEqual([
      PROBE_SYSTEM_PROMPT,
      "MAIN",
      "你好",
      "PHI",
    ]);
  });
});

describe("runPresetProbe", () => {
  it("returns assembled messages without calling a model", async () => {
    const result = await runPresetProbe({
      preset: samplePreset(),
      input: { message: "我推开门。" },
    });

    expect(result.completed).toBe(false);
    expect(result.reply).toBeNull();
    expect(result.messages.some((m) => m.content === "我推开门。")).toBe(true);
  });

  it("returns the model reply when complete is provided", async () => {
    const result = await runPresetProbe({
      preset: samplePreset(),
      input: { message: "我推开门。" },
      complete: async () => ({ content: "请进。", reasoning: "短回复" }),
    });

    expect(result.completed).toBe(true);
    expect(result.reply).toBe("请进。");
    expect(result.reasoning).toBe("短回复");
  });

  it("keeps messages when generate fails", async () => {
    const result = await runPresetProbe({
      preset: samplePreset(),
      input: { message: "我推开门。" },
      complete: async () => {
        throw new Error("upstream down");
      },
    });

    expect(result.completed).toBe(false);
    expect(result.error).toBe("upstream down");
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("rejects an empty turn", async () => {
    await expect(
      runPresetProbe({
        preset: samplePreset(),
        input: { message: "   " },
      }),
    ).rejects.toThrow("缺少本轮输入");
  });
});
