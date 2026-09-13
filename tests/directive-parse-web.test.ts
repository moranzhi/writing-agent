import { describe, expect, it } from "vitest";
import { findDirectiveHits } from "../web/directive-parse.js";

describe("findDirectiveHits (composer highlight)", () => {
  it("marks @玩家 with persona preview (same as expand)", () => {
    const hits = findDirectiveHits("且对@玩家没有因为", {
      persona: { name: "林晚" },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].raw).toBe("@玩家");
    expect(hits[0].previewBody).toBe("发送时 → 林晚");
  });

  it("does not mark @玩家X (same as expand)", () => {
    expect(
      findDirectiveHits("@玩家X来了", { persona: { name: "林晚" } }),
    ).toEqual([]);
  });

  it("marks dice without rolling", () => {
    const hits = findDirectiveHits("检定 @rd100 30", {});
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("dice");
    expect(hits[0].raw).toBe("@rd100 30");
    expect(hits[0].previewBody).toContain("发送时掷");
    expect(hits[0].previewBody).toContain("点数届时生成");
  });

  it("ignores unknown @token", () => {
    expect(findDirectiveHits("写给@某人", { persona: { name: "A" } })).toEqual(
      [],
    );
  });
});
