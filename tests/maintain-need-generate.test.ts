import { describe, expect, it } from "vitest";
import {
  buildChanceBatchFromGenerationRule,
  isElementPool,
  runMaintainNeedGenerateSampling,
} from "../src/skills/maintain-need-generate.js";

const SAMPLE_RULES = JSON.stringify({
  schema: "context-fragment.v1",
  正文: {
    rules: [
      {
        rule_id: "npc-trait",
        池: [
          {
            pool_id: "mood",
            条目: [
              { id: "calm", 权重: 2 },
              { id: "angry", 权重: 1 },
            ],
          },
        ],
      },
    ],
  },
});

describe("maintain need_generate sampling", () => {
  it("builds pick requests from generation rule pools", () => {
    const batch = buildChanceBatchFromGenerationRule(SAMPLE_RULES, "npc-trait");
    expect(batch).toHaveLength(1);
    expect(batch![0]!.id).toBe("pool:mood");
    expect(batch![0]!.op).toBe("pick");
  });

  it("runs batch sampling for need_generate", () => {
    const result = runMaintainNeedGenerateSampling({
      need: { rule_id: "npc-trait", reason: "补一条" },
      generationRulesRaw: SAMPLE_RULES,
    });
    expect(result?.schema).toBe("chance.batch.v1");
    expect(result?.results[0]?.id).toBe("pool:mood");
  });

  it("treats 方向池 as non-element even if leftover 条目 exist", () => {
    expect(
      isElementPool({
        池型: "方向",
        方向: { 冷焰系: "静、刺、余烬不散，如…" },
        条目: [{ id: "should-not-draw" }],
      }),
    ).toBe(false);
  });

  it("skips 方向池 when building chance batch", () => {
    const rules = JSON.stringify({
      正文: {
        rules: [
          {
            rule_id: "stand",
            池: [
              {
                pool_id: "ability",
                池型: "方向",
                方向: { 时空操作系: "暂停、加速、回溯。例如 The World" },
              },
              {
                pool_id: "stand-type",
                池型: "元素",
                条目: [{ id: "close-range", 权重: 1 }],
              },
            ],
          },
        ],
      },
    });
    const batch = buildChanceBatchFromGenerationRule(rules, "stand");
    expect(batch).toHaveLength(1);
    expect(batch![0]!.id).toBe("pool:stand-type");
  });

  it("returns null when a rule only has 方向池", () => {
    const rules = JSON.stringify({
      正文: {
        rules: [
          {
            rule_id: "nickname",
            池: [
              {
                pool_id: "nick-style",
                池型: "方向",
                方向: { 自然现象系: "以天气、地理命名" },
              },
            ],
          },
        ],
      },
    });
    expect(buildChanceBatchFromGenerationRule(rules, "nickname")).toBeNull();
  });

  it("reads flat single-rule body and string pool entries", () => {
    const rules = JSON.stringify({
      正文: {
        rule_id: "wasteland-npc",
        池: [
          {
            名称: "公开职业池",
            条目: ["厨师", "医生", "掮客"],
          },
        ],
      },
    });
    const batch = buildChanceBatchFromGenerationRule(rules, "wasteland-npc");
    expect(batch).toHaveLength(1);
    expect(batch![0]!.id).toBe("pool:公开职业池");
    expect(batch![0]!.items?.map((item) => item.id)).toEqual([
      "厨师",
      "医生",
      "掮客",
    ]);
  });
});
