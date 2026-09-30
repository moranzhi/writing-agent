import { describe, expect, it } from "vitest";
import type { AgentDriver } from "../src/runtime/driver.js";
import { buildDictateMessages, runDictateTurn } from "../src/dictate/index.js";
import { scoreExperienceAnchor } from "../src/dictate/experience-anchor.js";

const anchored = {
  体验锚定: {
    站位: "完全代入",
    核心感觉: "垄断生存资源的掌控感",
    轮转停点: "用户要做决定时停笔等用户",
  },
};

describe("experience anchor score", () => {
  it("scores the three fields and ignores self-score", () => {
    const onlySelf = scoreExperienceAnchor(
      JSON.stringify({
        自评: { 维度: [{ 名: "美学纲领", 分数: 10 }] },
        正文: { 设定逻辑: { 完备度判断: { 核心状态: "核心明确", 判断依据: "我觉得够了" } } },
      }),
    );
    expect(onlySelf.anchored).toBe(false);
    expect(onlySelf.passed).toBe(0);

    const full = scoreExperienceAnchor(JSON.stringify(anchored));
    expect(full.anchored).toBe(true);
    expect(full.passed).toBe(3);
    expect(full.items.map((item) => item.id)).toEqual(["站位", "核心感觉", "轮转停点"]);
  });

  it("rejects placeholders and unanswered stance", () => {
    const score = scoreExperienceAnchor(
      JSON.stringify({
        体验锚定: {
          站位: "代入还是旁观",
          核心感觉: "未定",
          轮转停点: "等用户",
        },
      }),
    );
    expect(score.anchored).toBe(false);
    expect(score.items.every((item) => !item.ok)).toBe(true);
  });

  it("falls back to aesthetics body fields and prose labels", () => {
    const fromBody = scoreExperienceAnchor(
      JSON.stringify({
        正文: {
          设定逻辑: {
            参与方式: { 用户与user关系: { 结论: "完全代入" } },
            内容维度: { 核心感觉: { 已知: "求生时的紧张感" } },
          },
          交互范式: {
            描写权限: { 思考与抉择: "要替用户做决定时必须停笔等用户" },
          },
        },
      }),
    );
    expect(fromBody.anchored).toBe(true);

    const prose = scoreExperienceAnchor(
      ["站位：旁观", "核心感觉：看棋子互相算计", "轮转停点：场面收束前停笔等用户下令"].join("\n"),
    );
    expect(prose.anchored).toBe(true);
    expect(prose.items.find((item) => item.id === "站位")?.value).toBe("旁观");
  });

  it("does not inject a fixed anchor gate into dictate context", () => {
    const body =
      buildDictateMessages({
        systemPrompt: "SYS",
        products: [
          {
            tag: "设计.美学纲领与交互范式",
            content: JSON.stringify({
              体验锚定: { 站位: "完全代入", 核心感觉: "未定", 轮转停点: "未定" },
            }),
          },
        ],
        dialogue: [],
      })[1]?.content ?? "";
    expect(body).toContain("当前产物");
    expect(body).toContain("设计.美学纲领与交互范式");
    expect(body).not.toContain("体验锚定（程序打分");
    expect(body).not.toContain("不得 insert 开场白");
  });

  it("does not block opening on a fixed 3/3 anchor count", async () => {
    const products = new Map<string, string>();
    const driver: AgentDriver = {
      async run(input) {
        const first = await input.handleStep([
          {
            id: "o1",
            name: "insert",
            arguments: JSON.stringify({ position: "设计.开场白", content: "@玩家睁眼。" }),
          },
        ]);
        expect(first.kind).toBe("continue");
        if (first.kind === "continue") {
          const payload = JSON.parse(first.results[0]!.content) as {
            ok?: boolean;
            error?: string;
          };
          expect(payload.ok).toBe(true);
          expect(payload.error).toBeUndefined();
        }

        const sameStep = await input.handleStep([
          {
            id: "a1",
            name: "insert",
            arguments: JSON.stringify({
              position: "设计.美学纲领与交互范式",
              content: JSON.stringify(anchored),
            }),
          },
          {
            id: "o2",
            name: "insert",
            arguments: JSON.stringify({ position: "设计.开场白", content: "@玩家睁眼。" }),
          },
        ]);
        expect(sameStep.kind).toBe("continue");
        if (sameStep.kind === "continue") {
          const aesthetics = JSON.parse(sameStep.results[0]!.content) as {
            ok?: boolean;
            experience_anchor?: unknown;
          };
          const opening = JSON.parse(sameStep.results[1]!.content) as { ok?: boolean };
          expect(aesthetics.ok).toBe(true);
          expect(aesthetics.experience_anchor).toBeUndefined();
          expect(opening.ok).toBe(true);
        }
        return { iterations: 1, stop: { kind: "text", content: "已补三件并写开场。" } };
      },
    };

    const result = await runDictateTurn({
      llm: {} as never,
      recipeName: "快穿短局",
      dialogue: [{ role: "user", text: "先开场" }],
      driver,
      handlers: {
        listProducts: () => [...products.entries()].map(([tag, content]) => ({ tag, content })),
        writeProduct: (tag, content) => {
          products.set(tag, content);
        },
        deleteProduct: (tag) => products.delete(tag),
        readTag: () => undefined,
        writeTag: () => undefined,
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(products.has("设计.开场白")).toBe(true);
    expect(result.wroteTags).toContain("设计.美学纲领与交互范式");
    expect(result.wroteTags).toContain("设计.开场白");
  });

  it("does not block opening for recipes that skip the aesthetics gate", async () => {
    const products = new Map<string, string>();
    const driver: AgentDriver = {
      async run(input) {
        const outcome = await input.handleStep([
          {
            id: "o1",
            name: "insert",
            arguments: JSON.stringify({ position: "设计.开场白", content: "@玩家睁眼。" }),
          },
        ]);
        expect(outcome.kind).toBe("continue");
        if (outcome.kind === "continue") {
          const payload = JSON.parse(outcome.results[0]!.content) as { ok?: boolean; error?: string };
          expect(payload.ok).toBe(true);
          expect(payload.error).toBeUndefined();
        }
        return { iterations: 1, stop: { kind: "text", content: "开场已写。" } };
      },
    };

    await runDictateTurn({
      llm: {} as never,
      recipeName: "文本生成器",
      dialogue: [{ role: "user", text: "来一段开篇" }],
      driver,
      handlers: {
        listProducts: () => [...products.entries()].map(([tag, content]) => ({ tag, content })),
        writeProduct: (tag, content) => {
          products.set(tag, content);
        },
        deleteProduct: () => false,
        readTag: () => undefined,
        writeTag: () => undefined,
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(products.get("设计.开场白")).toContain("@玩家");
  });
});
