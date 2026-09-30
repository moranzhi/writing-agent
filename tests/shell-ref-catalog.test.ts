import { describe, expect, it } from "vitest";
import {
  formatShellRefsForPrompt,
  loadShellRefCatalog,
} from "../src/skills/shell-ref-catalog.js";

const PACK = "dialogue/world-simulator";

describe("shell ref catalog", () => {
  it("loads the five reference shells with layout and sample", async () => {
    const shells = await loadShellRefCatalog(PACK);
    expect(shells.map((shell) => shell.id)).toEqual([
      "reading",
      "dual-text",
      "data-cards",
      "alongside",
      "paged",
      "piece",
    ]);
    for (const shell of shells) {
      expect(shell.intro).toBeTruthy();
      expect(shell.note).toContain("不替换");
      expect(shell.note).toContain("可替换");
      expect(shell.layout).toContain(`id: ${shell.id}`);
      expect(shell.sample).toContain("present.onData");
    }
  });

  it("tells creation to drop unused regions", async () => {
    const shells = await loadShellRefCatalog(PACK);
    const block = formatShellRefsForPrompt(shells);
    expect(block).toContain("【壳参考库】");
    expect(block).toContain("不留空位");
    expect(block).toContain("可按本局用途替换");
    expect(block).not.toContain("斗鱼弹幕");
    expect(block).not.toContain("规则怪谈");
    expect(block).toContain("`dual-text`");
    expect(block).not.toContain("chat_monitor");
  });
});
