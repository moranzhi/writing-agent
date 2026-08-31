import { describe, expect, it } from "vitest";
import {
  closeCreationFlowRaw,
  isOpeningSealArtifact,
  parseOpeningSealPayload,
  openingVariablesToTableDoc,
  reopenCreationFlowRaw,
} from "../src/skills/opening-seal.js";

const fragment = JSON.stringify({
  schema: "context-fragment.v1",
  技能: "开场白与开场变量",
  brief: "宿舍缺水",
  mount: ["narrator"],
  正文: {
    开场白全文: "你在宿舍醒来，瓶里只剩一口水。",
    开场白候选: [
      "你在宿舍醒来，瓶里只剩一口水。",
      "门外有人砸门。你还没想好要不要开。",
    ],
    开场变量: [{ 名: "口粮", 值: 1, 依据: "开场只剩一口水" }],
  },
  开放问题: [],
});

describe("opening-seal", () => {
  it("detects opening-setup and opening-generator artifacts", () => {
    expect(
      isOpeningSealArtifact({
        workerId: "design-step",
        outputTags: ["设计.开场白与开场变量"],
      }),
    ).toBe(true);
    expect(
      isOpeningSealArtifact({
        workerId: "opening-generator",
        outputTags: ["输出.开场白"],
      }),
    ).toBe(true);
    expect(
      isOpeningSealArtifact({
        workerId: "design-step",
        stepId: "开场白与开场变量",
        outputTags: ["artifact.flat.v1"],
      }),
    ).toBe(true);
    expect(
      isOpeningSealArtifact({
        workerId: "design-step",
        outputTags: ["设计.美学纲领与交互范式"],
      }),
    ).toBe(false);
  });

  it("parses 1+ opening candidates and selects by index", () => {
    const first = parseOpeningSealPayload(fragment, 0);
    expect(first?.candidates).toHaveLength(2);
    expect(first?.selectedText).toContain("宿舍醒来");
    const second = parseOpeningSealPayload(fragment, 1);
    expect(second?.selectedText).toContain("砸门");
    expect(second?.variables).toEqual([
      { name: "口粮", value: 1, note: "开场只剩一口水" },
    ]);
  });

  it("builds table rows from opening variables", () => {
    const payload = parseOpeningSealPayload(fragment, 0);
    const doc = openingVariablesToTableDoc(payload!.variables);
    expect(doc.rows[0]?.key).toBe("口粮");
    expect(doc.rows[0]?.value).toBe(1);
  });

  it("closes an open creation flow", () => {
    const raw = JSON.stringify({
      version: 1,
      status: "open",
      steps: [{ id: "开场白与开场变量", name: "开场白与开场变量", depends_on: [] }],
    });
    const closed = JSON.parse(closeCreationFlowRaw(raw)!);
    expect(closed.status).toBe("closed");
  });

  it("reopens a closed creation flow", () => {
    const raw = JSON.stringify({
      version: 1,
      status: "closed",
      steps: [{ id: "开场白与开场变量", name: "开场白与开场变量", depends_on: [] }],
    });
    const opened = JSON.parse(reopenCreationFlowRaw(raw)!);
    expect(opened.status).toBe("open");
  });
});
