import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("libraries registry", () => {
  beforeEach(() => {
    process.env.WRITING_AGENT_DATA_DIR = mkdtempSync(
      path.join(tmpdir(), "wa-lib-"),
    );
  });

  it("formats style-packs and preferences when non-empty", async () => {
    const { createStylePack } = await import("../src/style-pack/store.js");
    const { ensureStarterPreferences } = await import(
      "../src/preference/store.js"
    );
    const {
      formatBoundLibrariesForPrompt,
      collectLibraryIdsFromModules,
    } = await import("../src/libraries/index.js");

    ensureStarterPreferences();
    createStylePack({
      name: "锋利爽文",
      content: "短句推进；示范：他抬眼，门开了。",
    });

    const style = formatBoundLibrariesForPrompt(["style-packs"]);
    expect(style).toContain("【文风库 · 可选用】");
    expect(style).toContain("锋利爽文");

    const pref = formatBoundLibrariesForPrompt(["preferences"]);
    expect(pref).toContain("【偏好库 · 可选用】");
    expect(pref).toContain("被 NTR");

    expect(formatBoundLibrariesForPrompt(["unknown-lib"])).toBe("");
    expect(
      collectLibraryIdsFromModules([
        { libraries: ["style-packs"] },
        { libraries: ["preferences", "style-packs"] },
      ]),
    ).toEqual(["style-packs", "preferences"]);
  });

  it("skips empty style-packs library", async () => {
    const { formatBoundLibrariesForPrompt } = await import(
      "../src/libraries/index.js"
    );
    // 空文风库 → 空串；偏好库有起步条目仍会有内容
    expect(formatBoundLibrariesForPrompt(["style-packs"])).toBe("");
  });
});

