import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import {
  applyDictatePlayBind,
  bindDictateProductsToPlaySpec,
} from "../src/dictate/play-bind.js";
import {
  applyMaintenanceStrategyToPlaySlots,
  normalizeMaintenanceAdvice,
  parseMaintenanceAdviceFromVariableDesign,
  resolveMaintenanceStrategyFromBoard,
  strategyFromAdvice,
  MAINTENANCE_STRATEGY_TAG,
} from "../src/skills/maintenance-strategy.js";
import { defaultPlaySlots } from "../src/skills/play-slots.js";
import { parseWorkerSetYaml } from "../src/skills/worker-set-parse.js";
import { VARIABLE_DESIGN_TAG } from "../src/skills/variable-design-compile.js";

function designWithAdvice(advice: string) {
  return JSON.stringify({
    schema: "context-fragment.v1",
    技能: "变量设计与更新规则",
    正文: {
      真值: [
        {
          id: "affection",
          名称: "好感",
          类型: "number",
          初始化: { 默认值: 0 },
          公开性: "public",
        },
      ],
      维护复杂度: {
        建议: advice,
        依据: ["测试依据"],
      },
    },
  });
}

describe("maintenance-strategy", () => {
  it("normalizes advice aliases", () => {
    expect(normalizeMaintenanceAdvice("auditor_bundle")).toBe("auditor_bundle");
    expect(normalizeMaintenanceAdvice("旁观")).toBe("auditor_bundle");
    expect(normalizeMaintenanceAdvice("inline_tool")).toBe("inline_tool");
    expect(normalizeMaintenanceAdvice("内联")).toBe("inline_tool");
    expect(normalizeMaintenanceAdvice("inline_structured")).toBe(
      "inline_structured",
    );
    expect(normalizeMaintenanceAdvice("none")).toBe("none");
  });

  it("parses variable-design maintenance box", () => {
    const parsed = parseMaintenanceAdviceFromVariableDesign(
      designWithAdvice("auditor_bundle"),
    );
    expect(parsed?.advice).toBe("auditor_bundle");
    expect(parsed?.依据).toContain("测试依据");
  });

  it("defaults to auditor_bundle when truths exist but advice missing", () => {
    const raw = JSON.stringify({
      schema: "context-fragment.v1",
      正文: { 真值: [{ id: "a", 类型: "number", 初始化: { 默认值: 1 } }] },
    });
    expect(parseMaintenanceAdviceFromVariableDesign(raw)?.advice).toBe(
      "auditor_bundle",
    );
  });

  it("maps advice to auditor/inline flags at strategyFromAdvice level", () => {
    expect(strategyFromAdvice("auditor_bundle")).toMatchObject({
      auditor: true,
      inline: false,
    });
    expect(strategyFromAdvice("inline_tool")).toMatchObject({
      auditor: false,
      inline: true,
    });
    expect(strategyFromAdvice("none")).toMatchObject({
      auditor: false,
      inline: false,
    });
  });

  it("forces auditor_bundle when truths exist even if design said inline", () => {
    const board = new Blackboard();
    board.write({
      tag: VARIABLE_DESIGN_TAG,
      content: designWithAdvice("inline_tool"),
      source: "test",
    });
    const strategy = resolveMaintenanceStrategyFromBoard(board);
    expect(strategy.advice).toBe("auditor_bundle");
    expect(strategy.auditor).toBe(true);
    expect(strategy.inline).toBe(false);
    expect(strategy.依据?.some((x) => x.includes("inline_tool"))).toBe(true);
  });

  it("keeps auditor off when there are no truths", () => {
    const board = new Blackboard();
    const strategy = resolveMaintenanceStrategyFromBoard(board);
    expect(strategy.advice).toBe("none");
    expect(strategy.auditor).toBe(false);
  });

  it("overrides play_slots.auditor from strategy", () => {
    const slots = applyMaintenanceStrategyToPlaySlots(defaultPlaySlots(), {
      schema: "maintenance-strategy.v1",
      advice: "auditor_bundle",
      auditor: true,
      inline: false,
      source: VARIABLE_DESIGN_TAG,
    });
    expect(slots.auditor).toBe(true);
    expect(slots.gm).toBe(true);
  });
});

describe("play-bind applies maintenance strategy", () => {
  it("turns auditor on for auditor_bundle", () => {
    const board = new Blackboard();
    board.write({
      tag: VARIABLE_DESIGN_TAG,
      content: designWithAdvice("auditor_bundle"),
      source: "test",
    });
    board.write({
      tag: "设计.世界蓝图",
      content: "舞台",
      source: "test",
    });
    const result = bindDictateProductsToPlaySpec(board);
    const parsed = parseWorkerSetYaml(result.workerSetJson);
    expect(parsed?.play_slots?.auditor).toBe(true);
    const strategy = resolveMaintenanceStrategyFromBoard(board);
    expect(strategy.advice).toBe("auditor_bundle");
  });

  it("still opens auditor when design said inline_tool", () => {
    const board = new Blackboard();
    board.write({
      tag: VARIABLE_DESIGN_TAG,
      content: designWithAdvice("inline_tool"),
      source: "test",
    });
    board.write({
      tag: "设计.世界蓝图",
      content: "舞台",
      source: "test",
    });
    applyDictatePlayBind(board);
    const worker = parseWorkerSetYaml(
      board.getContentByTag("设计.worker集") ?? "",
    );
    expect(worker?.play_slots?.auditor).toBe(true);
    const strategyRaw = board.getContentByTag(MAINTENANCE_STRATEGY_TAG);
    expect(strategyRaw).toContain("auditor_bundle");
    expect(strategyRaw).toContain('"auditor": true');
    expect(strategyRaw).toContain("inline_tool");
  });
});
