import { describe, expect, it, vi } from "vitest";
import {
  expandAtDirectives,
  expandIdentityDirectives,
  listDirectiveCatalog,
} from "../src/directives/expand.js";

describe("expandAtDirectives", () => {
  it("replaces @玩家 and @user with persona name", () => {
    const r = expandAtDirectives("你好，@玩家；再见 @user。", {
      persona: { name: "林晚" },
    });
    expect(r.text).toBe("你好，林晚；再见 林晚。");
    expect(r.hits.map((h) => h.kind)).toEqual([
      "persona_name",
      "persona_name",
    ]);
  });

  it("falls back to 玩家 when no persona", () => {
    const r = expandAtDirectives("我是@玩家", {});
    expect(r.text).toBe("我是玩家");
  });

  it("replaces @人设 with description", () => {
    const r = expandAtDirectives("人设：@人设", {
      persona: { name: "林晚", description: "冷静的调查员" },
    });
    expect(r.text).toBe("人设：冷静的调查员");
  });

  it("compat {{user}}", () => {
    const r = expandIdentityDirectives("对{{user}}说", {
      persona: { name: "阿泽" },
    });
    expect(r.text).toBe("对阿泽说");
  });

  it("leaves unknown @token alone", () => {
    const r = expandAtDirectives("写给@某人 的信", {
      persona: { name: "林晚" },
    });
    expect(r.text).toBe("写给@某人 的信");
    expect(r.changed).toBe(false);
  });

  it("does not treat @玩家X as @玩家", () => {
    const r = expandAtDirectives("@玩家X来了", {
      persona: { name: "林晚" },
    });
    expect(r.text).toBe("@玩家X来了");
  });

  it("expands @玩家 when followed by Chinese", () => {
    const r = expandAtDirectives("且对@玩家没有因为", {
      persona: { name: "林晚" },
    });
    expect(r.text).toBe("且对林晚没有因为");
  });

  it("rolls @rd100 with target", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.18); // → 19 on 1..100
    const r = expandAtDirectives("检定 @rd100 30", {
      persona: { name: "林晚" },
    });
    expect(r.text).toBe("检定 投掷结果为 19，目标 30（成功）");
    vi.restoreAllMocks();
  });

  it("rolls @r3d10 without target", () => {
    const seq = [0.3, 0.6, 0.1];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? 0);
    const r = expandAtDirectives("伤害 @r3d10", {});
    expect(r.text).toMatch(/^伤害 投掷结果为 \d\+\d\+\d = \d+（3d10）$/);
    vi.restoreAllMocks();
  });

  it("identity expand skips dice", () => {
    const r = expandIdentityDirectives("先 @rd100 50 再说", {
      persona: { name: "林晚" },
    });
    expect(r.text).toBe("先 @rd100 50 再说");
  });

  it("lists catalog", () => {
    expect(listDirectiveCatalog().some((x) => x.insert === "@玩家")).toBe(
      true,
    );
  });

  it("keeps @玩家 when the persona name is @玩家", () => {
    const r = expandIdentityDirectives("清晨，@玩家推开门。对{{user}}点头。", {
      persona: { name: "@玩家", description: "占位" },
    });
    expect(r.text).toBe("清晨，@玩家推开门。对@玩家点头。");
  });
});
