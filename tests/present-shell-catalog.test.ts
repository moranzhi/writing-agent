import { describe, expect, it } from "vitest";
import {
  formatPresentShellsForPrompt,
  loadPresentShellCatalog,
  parsePresentShellCatalog,
} from "../src/skills/present-shell-catalog.js";

const PACK = "dialogue/world-simulator";

describe("present-shell catalog", () => {
  it("parses catalog ids without hardcoding a count", () => {
    const entries = parsePresentShellCatalog(`
shells:
  - id: prose
    name: 纯散文
  - id: extra_shell
    name: 新壳
`);
    expect(entries.map((e) => e.id)).toEqual(["prose", "extra_shell"]);
  });

  it("loads intro and shell from each prompt.md", async () => {
    const shells = await loadPresentShellCatalog(PACK);
    expect(shells.length).toBeGreaterThan(0);
    const ids = shells.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of shells) {
      expect(s.name).toBeTruthy();
      expect(s.intro).toBeTruthy();
      expect(s.shell).toContain(`id: ${s.id}`);
    }
  });

  it("formats an injection block that lists loaded ids", async () => {
    const shells = await loadPresentShellCatalog(PACK);
    const block = formatPresentShellsForPrompt(shells);
    expect(block).toContain("【可选呈现壳】");
    expect(block).toContain("动态装载");
    for (const s of shells) {
      expect(block).toContain(`\`${s.id}\``);
    }
  });
});
