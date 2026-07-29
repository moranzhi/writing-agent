import { describe, expect, it } from "vitest";
import {
  displayStageLabel,
  displayWorkerLabel,
  formatWorkerDisplayTitle,
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
    expect(displayWorkerLabel("fixed:interaction")).toBe("能力 · 交互范式");
    expect(displayWorkerLabel("fixed:aesthetics-interaction")).toBe(
      "能力 · 美学纲领与交互范式",
    );
    expect(displayWorkerLabel("worker:narrator")).toBe("演员 · 叙事转述");
  });
});
