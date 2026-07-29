import { describe, expect, it } from "vitest";
import {
  buildIntakeFollowUpMessage,
  buildIntakeProgress,
  extractIntakeHeuristic,
  intakeFieldsFromInquiry,
} from "../src/intake/intake.js";

describe("intake fields", () => {
  it("marks ready when all required filled", () => {
    const fields = intakeFieldsFromInquiry({
      prompt: "p",
      targetKey: "用户.需求",
      requiredFields: ["情境", "角色", "轮次"],
      optionalFields: ["输出偏好"],
    });
    const partial = buildIntakeProgress(fields, {
      [fields[0].id]: "德州扑克",
    });
    expect(partial.ready).toBe(false);
    expect(partial.requiredFilled).toBe(1);

    const full = buildIntakeProgress(fields, {
      [fields[0].id]: "德州扑克",
      [fields[1].id]: "玩家A算计，玩家B保守",
      [fields[2].id]: "单轮",
    });
    expect(full.ready).toBe(true);
  });

  it("heuristic fills scenario and rounds keywords", () => {
    const fields = intakeFieldsFromInquiry({
      prompt: "p",
      targetKey: "t",
      requiredFields: ["实验情境", "轮次模式"],
      optionalFields: [],
    });
    const values = extractIntakeHeuristic("德州扑克，单轮定胜负", fields, {});
    expect(Object.keys(values).length).toBeGreaterThan(0);
  });

  it("buildIntakeFollowUpMessage lists missing required fields", () => {
    const fields = intakeFieldsFromInquiry({
      prompt: "p",
      targetKey: "t",
      requiredFields: ["情境", "角色", "进程"],
      optionalFields: [],
    });
    const progress = buildIntakeProgress(fields, {
      [fields[0].id]: "德州扑克",
    });
    const msg = buildIntakeFollowUpMessage(progress);
    expect(msg).toContain("还缺以下必要项");
    expect(msg).toContain("角色");
    expect(msg).toContain("进程");
  });
});
