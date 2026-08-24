import { describe, expect, it } from "vitest";
import {
  buildChanceBatchFromGenerationRule,
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
});
