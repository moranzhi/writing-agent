import { describe, expect, it } from "vitest";
import {
  formatMarkdownSafeSubsetForPrompt,
  loadMarkdownSafeSubsetCatalog,
  parseMarkdownSafeSubsetCatalog,
} from "../src/skills/markdown-safe-subset.js";

const PACK = "dialogue/world-simulator";

describe("markdown safe subset catalog", () => {
  it("parses features from yaml", () => {
    const cat = parseMarkdownSafeSubsetCatalog(`
version: 1
intro: 测试简介
features:
  - id: table
    name: 表格
    syntax: "| a | b |"
  - id: details
    name: 折叠
    syntax: |
      :::details 标题
      内容
      :::
restrictions:
  - 禁止 script
`);
    expect(cat?.features.map((f) => f.id)).toEqual(["table", "details"]);
    expect(cat?.restrictions).toEqual(["禁止 script"]);
  });

  it("loads pack catalog with table and details", async () => {
    const cat = await loadMarkdownSafeSubsetCatalog(PACK);
    expect(cat).toBeTruthy();
    const ids = cat!.features.map((f) => f.id);
    expect(ids).toContain("table");
    expect(ids).toContain("details");
    expect(ids).toContain("heading");
  });

  it("formats injection block for reply-format", async () => {
    const cat = await loadMarkdownSafeSubsetCatalog(PACK);
    const block = formatMarkdownSafeSubsetForPrompt(cat!);
    expect(block).toContain("【正文安全子集】");
    expect(block).toContain("动态装载");
    expect(block).toContain("`table`");
    expect(block).toContain("`details`");
    expect(block).toContain(":::details");
  });
});
