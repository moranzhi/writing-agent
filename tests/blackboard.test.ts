import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import { tagMatchesPattern } from "../src/blackboard/tag-match.js";

describe("tag matching", () => {
  it("matches exact and prefix patterns", () => {
    expect(tagMatchesPattern("角色.A.台词.候选", "角色.A.台词.候选")).toBe(true);
    expect(tagMatchesPattern("角色.A.台词.候选", "角色.A.*")).toBe(true);
    expect(tagMatchesPattern("角色.B.台词.候选", "角色.A.*")).toBe(false);
    expect(tagMatchesPattern("任意.tag", "**")).toBe(true);
  });
});

describe("blackboard", () => {
  it("writes and queries by tag pattern", () => {
    const bb = new Blackboard();
    bb.write({ tag: "book.brief", content: "科幻短篇", source: "user" });
    bb.write({ tag: "outline.draft", content: "第一章…", source: "outline" });

    expect(bb.getContentByTag("book.brief")).toBe("科幻短篇");
    expect(bb.listTagIndex()).toHaveLength(2);

    const items = bb.queryByPatterns(["book.brief", "outline.*"]);
    expect(items.map((i) => i.tag).sort()).toEqual(["book.brief", "outline.draft"]);
  });

  it("returns latest item for duplicate tags", () => {
    const bb = new Blackboard();
    bb.write({ tag: "正文.草稿", content: "v1", source: "w" });
    bb.write({ tag: "正文.草稿", content: "v2", source: "w" });
    expect(bb.getContentByTag("正文.草稿")).toBe("v2");
  });
});
