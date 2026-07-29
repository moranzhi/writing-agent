import { describe, expect, it } from "vitest";
import {
  deriveDesignStageScope,
  deriveInstantiateScope,
  deriveReviewWorkerScope,
  deriveRunWorkerScope,
  parseWorkerSetYaml,
} from "../src/skills/worker-set-parse.js";

const SAMPLE = `
version: 1
form_summary: 西幻升级交互，带状态跟踪
play_morphology: action_reaction_loop
workers:
  - ref: world-simulator
    duty: 世界推进与裁决
    when: 每轮用户输入后
    presentation: null
  - ref: narrator
    duty: 组装用户可见回复
    when: 中间产物齐后
    presentation:
      tone: 冷感
      pacing: 中等
      avoid: [冗长环境描写]
  - ref: variable-update
    duty: 跟踪等级与资源
    when: 每轮结束后
  - ref: opening-generator
    duty: 填初始等级职业与开场白
    when: Worker 集 accept 后、进 play 前
instantiate_hints:
  invoke:
    - opening-generator
  skip: []
  skip_reason: ""
  notes: 需要 swipe 选定开局
tag_flow:
  - "用户.最新输入 → 运行.本轮.拓写"
open_questions: []
notes: ""
`;

describe("parseWorkerSetYaml", () => {
  it("parses worker set structure", () => {
    const parsed = parseWorkerSetYaml(SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed?.form_summary).toContain("西幻");
    expect(parsed?.workers).toHaveLength(4);
    expect(parsed?.workers[1].ref).toBe("narrator");
    expect(parsed?.workers[1].presentation?.tone).toBe("冷感");
    expect(parsed?.instantiate_hints?.invoke).toContain("opening-generator");
    expect(parsed?.instantiate_hints?.notes).toContain("swipe");
  });

  it("parses JSON worker set (preferred format)", () => {
    const json = JSON.stringify({
      version: 1,
      interaction: {
        user_stance: "单角代入",
        system_role: "世界执行+叙事",
        turn_shape: "对话回合",
      },
      experience_check: {
        satisfaction_source: "关系推进",
      },
      workers: [
        {
          ref: "world-simulator",
          duty: "推进",
          rationale: "需要世界结果",
          acceptance: "continue",
        },
        {
          ref: "narrator",
          duty: "展示",
          rationale: "需要可读终稿",
          acceptance: "review",
        },
      ],
      design_end: { opening: "optional" },
      narrative_guide: "不有求必应",
      core_premises: ["主角免疫"],
    });
    const parsed = parseWorkerSetYaml(json);
    expect(parsed?.parseError).toBeUndefined();
    expect(parsed?.interaction?.user_stance).toBe("单角代入");
    expect(parsed?.workers).toHaveLength(2);
    expect(parsed?.workers[0].acceptance).toBe("continue");
    expect(parsed?.workers[1].acceptance).toBe("review");
    expect(parsed?.narrative_guide).toBe("不有求必应");
    expect(parsed?.core_premises).toEqual(["主角免疫"]);
    expect(deriveDesignStageScope(parsed)).toEqual(["opening-generator"]);
    expect(deriveReviewWorkerScope(parsed)).toEqual(["narrator"]);
  });
});

describe("deriveDesignStageScope", () => {
  it("uses instantiate_hints.invoke and design-end worker refs", () => {
    const workerSet = parseWorkerSetYaml(SAMPLE)!;
    const scope = deriveDesignStageScope(workerSet);
    expect(scope).toEqual(["opening-generator"]);
    expect(scope).not.toContain("world-blueprint");
    expect(scope).not.toContain("variable-catalog");
  });

  it("deriveInstantiateScope aliases deriveDesignStageScope", () => {
    const workerSet = parseWorkerSetYaml(SAMPLE)!;
    expect(deriveInstantiateScope(workerSet)).toEqual(
      deriveDesignStageScope(workerSet),
    );
  });
});

describe("deriveRunWorkerScope", () => {
  it("lists play run worker refs excluding opening-generator", () => {
    const workerSet = parseWorkerSetYaml(SAMPLE)!;
    expect(deriveRunWorkerScope(workerSet)).toEqual([
      "world-simulator",
      "narrator",
      "variable-update",
    ]);
  });
});
