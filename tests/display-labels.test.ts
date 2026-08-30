import { describe, expect, it } from "vitest";
import {
  displayStageLabel,
  displayWorkerLabel,
  formatWorkerDisplayTitle,
  isFlowPlanReview,
  reviewComposerCopy,
} from "../src/server/display-labels.js";

describe("display-labels", () => {
  it("maps lifecycle stages", () => {
    expect(displayStageLabel("design")).toBe("创作");
    expect(displayStageLabel("play")).toBe("游玩");
  });

  it("maps design workers", () => {
    expect(displayWorkerLabel("design-flow")).toBe("创作 · 流程编排");
    expect(displayWorkerLabel("design-step")).toBe("创作 · 执行步骤");
    expect(formatWorkerDisplayTitle("design-flow", "output")).toBe(
      "创作 · 流程编排 · 产出",
    );
  });

  it("maps creation unit ids", () => {
    expect(displayWorkerLabel("phase:core")).toBe("单位 · 核心");
    expect(displayWorkerLabel("fixed:interaction")).toBe("技能 · 交互范式");
    expect(displayWorkerLabel("fixed:aesthetics-interaction")).toBe(
      "技能 · 美学纲领与交互范式",
    );
    expect(displayWorkerLabel("worker:narrator")).toBe("执行单元 · 叙事转述");
  });

  it("maps review composer copy by worker", () => {
    const flow = reviewComposerCopy("design-flow");
    expect(flow.acceptLabel).toBe("确认编排");
    expect(flow.submitLabel).toBe("按意见改编排");
    expect(flow.kicker).toBe("核对编排");
    expect(flow.tone).toBe("plan");

    const step = reviewComposerCopy("design-step");
    expect(step.acceptLabel).toBe("接受");
    expect(step.submitLabel).toBe("按意见修改");
    expect(step.kicker).toBe("待验收");
    expect(step.tone).toBe("accept");

    const opening = reviewComposerCopy("opening-generator");
    expect(opening.acceptLabel).toBe("选定此开场");
    expect(opening.kicker).toBe("待选定");

    const setup = reviewComposerCopy("design-step", {
      outputTags: ["设计.开场白与开场变量"],
    });
    expect(setup.acceptLabel).toBe("选定此开场");
    expect(setup.kind).toBe("opening");
  });

  it("treats design-flow review as the pick-node surface", () => {
    expect(
      isFlowPlanReview({
        waitingReason: { kind: "review_artifact" },
        reviewArtifact: { workerId: "design-flow" },
      }),
    ).toBe(true);
    expect(
      isFlowPlanReview({
        waitingReason: { kind: "review_artifact" },
        reviewArtifact: { workerId: "design-step" },
      }),
    ).toBe(false);
    expect(
      isFlowPlanReview({
        waitingReason: { kind: "pick_creation_step" },
        reviewArtifact: { workerId: "design-flow" },
      }),
    ).toBe(false);
  });
});
