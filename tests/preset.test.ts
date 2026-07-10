import { describe, expect, it } from "vitest";
import { assemblePresetMessages } from "../src/preset/assembler.js";
import { listEnabledPresetEntries, countInjectingEntries } from "../src/preset/entries.js";
import { importSillyTavernPreset } from "../src/preset/importer.js";

const samplePreset = {
  temperature: 1,
  top_p: 0.95,
  openai_max_tokens: 60000,
  prompts: [
    {
      identifier: "main",
      name: "主要",
      role: "system",
      content: "",
      marker: true,
    },
    {
      identifier: "custom-a",
      name: "A",
      role: "system",
      content: "instruction A",
    },
    {
      identifier: "custom-b",
      name: "B",
      role: "assistant",
      content: "prefill B",
    },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [{ identifier: "main", enabled: true }],
    },
    {
      character_id: 100001,
      order: [
        { identifier: "custom-a", enabled: true },
        { identifier: "custom-b", enabled: true },
        { identifier: "main", enabled: true },
      ],
    },
  ],
};

describe("importSillyTavernPreset", () => {
  it("picks prompt_order with most enabled content", () => {
    const report = importSillyTavernPreset(samplePreset, { name: "test" });
    expect(report.enabledCount).toBe(3);
    expect(report.preset.promptOrder.map((o) => o.promptId)).toEqual([
      "custom-a",
      "custom-b",
      "main",
    ]);
    expect(report.preset.generation.temperature).toBe(1);
    expect(report.preset.generation.maxOutputTokens).toBe(60000);
    expect(report.warnings.some((w) => w.includes("prompt_order"))).toBe(true);
  });
});

describe("assemblePresetMessages", () => {
  it("skips empty markers and emits enabled content in order", () => {
    const report = importSillyTavernPreset(samplePreset);
    const messages = assemblePresetMessages(report.preset);
    expect(messages).toEqual([
      { role: "system", content: "instruction A" },
      { role: "assistant", content: "prefill B" },
    ]);
  });
});

describe("listEnabledPresetEntries", () => {
  it("lists enabled order with inject flags", () => {
    const report = importSillyTavernPreset(samplePreset);
    const entries = listEnabledPresetEntries(report.preset);
    expect(entries.length).toBe(3);
    expect(countInjectingEntries(entries)).toBe(2);
    expect(entries.filter((e) => e.willInject).map((e) => e.content)).toEqual([
      "instruction A",
      "prefill B",
    ]);
  });
});
