import { describe, expect, it } from "vitest";
import { assemblePresetMessages } from "../src/preset/assembler.js";
import {
  applyPresetEntryPatches,
  countInjectingEntries,
  listAllPresetEntries,
  listEnabledPresetEntries,
} from "../src/preset/entries.js";
import {
  applyPresetGeneration,
  normalizeGeneration,
} from "../src/preset/generation.js";
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
    expect(report.preset.promptOrder.map((o) => o.promptId)).toEqual([
      "custom-a",
      "custom-b",
      "main",
      "worldBookBefore",
      "chatHistory",
      "worldBookAfter",
      "currentTurn",
      "postTurn",
    ]);
    expect(report.enabledCount).toBe(8);
    expect(report.preset.generation.temperature).toBe(1);
    expect(report.preset.generation.maxOutputTokens).toBe(60000);
    expect(report.warnings.some((w) => w.includes("prompt_order"))).toBe(true);
  });

  it("inserts app markers around chatHistory and leaves ST card/WI empty", () => {
    const report = importSillyTavernPreset({
      prompts: [
        { identifier: "main", name: "Main", role: "system", content: "MAIN" },
        {
          identifier: "charDescription",
          name: "Char Description",
          role: "system",
          marker: true,
        },
        {
          identifier: "chatHistory",
          name: "Chat History",
          role: "system",
          marker: true,
        },
        {
          identifier: "jailbreak",
          name: "Post-History",
          role: "system",
          content: "PHI",
        },
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
    expect(report.preset.promptOrder.map((o) => o.promptId)).toEqual([
      "main",
      "charDescription",
      "worldBookBefore",
      "chatHistory",
      "worldBookAfter",
      "currentTurn",
      "jailbreak",
      "postTurn",
    ]);
    const messages = assemblePresetMessages(report.preset);
    expect(messages).toEqual([
      { role: "system", content: "MAIN" },
      { role: "system", content: "PHI" },
    ]);
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
    expect(entries.length).toBe(8);
    expect(countInjectingEntries(entries)).toBe(2);
    expect(entries.filter((e) => e.willInject).map((e) => e.content)).toEqual([
      "instruction A",
      "prefill B",
    ]);
  });
});

describe("applyPresetEntryPatches", () => {
  it("toggles enable and edits content", () => {
    const report = importSillyTavernPreset(samplePreset);
    const disabled = applyPresetEntryPatches(report.preset, [
      { id: "custom-a", enabled: false },
    ]);
    expect(listAllPresetEntries(disabled).find((e) => e.id === "custom-a")?.enabled).toBe(
      false,
    );
    expect(assemblePresetMessages(disabled).map((m) => m.content)).toEqual([
      "prefill B",
    ]);

    const edited = applyPresetEntryPatches(disabled, [
      { id: "main", enabled: true, content: "hello main", name: "主提示" },
    ]);
    const main = listAllPresetEntries(edited).find((e) => e.id === "main");
    expect(main?.enabled).toBe(true);
    expect(main?.willInject).toBe(true);
    expect(main?.name).toBe("主提示");
    expect(
      assemblePresetMessages(edited).some((m) => m.content === "hello main"),
    ).toBe(true);
  });
});

describe("normalizeGeneration / applyPresetGeneration", () => {
  it("keeps finite numbers and clears empty fields on replace", () => {
    expect(
      normalizeGeneration({
        temperature: "0.9",
        topP: "",
        maxOutputTokens: 4096,
        reasoningEffort: "  high  ",
        verbosity: "   ",
        stream: true,
        seed: "not-a-number",
      }),
    ).toEqual({
      temperature: 0.9,
      maxOutputTokens: 4096,
      stream: true,
    });
  });

  it("replaces preset generation wholesale", () => {
    const report = importSillyTavernPreset(samplePreset);
    expect(report.preset.generation.temperature).toBe(1);
    const next = applyPresetGeneration(report.preset, {
      topP: 0.8,
      maxOutputTokens: 2048,
    });
    expect(next.generation).toEqual({ topP: 0.8, maxOutputTokens: 2048 });
    expect(next.prompts).toBe(report.preset.prompts);
  });
});
