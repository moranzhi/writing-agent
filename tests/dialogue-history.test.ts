import { describe, expect, it } from "vitest";
import {
  appendDialogueHistoryTurn,
  projectDialogueHistory,
  buildHistoryFallback,
  isDialogueHistoryRef,
} from "../src/skills/dialogue-history.js";
import { assembleWorkerContext } from "../src/skills/context-segments.js";
import { Blackboard } from "../src/blackboard/blackboard.js";
import {
  contextOrderToSegments,
  parseContextOrder,
  applyContextOrderEdit,
  synthesizeContextOrderFromWorkers,
} from "../src/skills/context-order.js";

describe("dialogue history projection", () => {
  it("recognizes history refs and projects by level", () => {
    expect(isDialogueHistoryRef("对话.历史")).toBe(true);
    expect(isDialogueHistoryRef("history")).toBe(true);
    const long = Array.from({ length: 30 }, (_, i) => `## 用户\n\n第${i}句`).join(
      "\n\n",
    );
    const summary = projectDialogueHistory(long, "summary");
    expect(summary).toContain("仅最近");
    expect(projectDialogueHistory(long, "fixed")).toContain("不注入");
  });

  it("assembles history tag in flat segment order", () => {
    const bb = new Blackboard();
    bb.write({
      tag: "对话.历史",
      content: appendDialogueHistoryTurn("", { role: "用户", text: "推门" }),
      source: "test",
    });
    bb.write({ tag: "用户.最新输入", content: "再看一眼", source: "test" });
    const text = assembleWorkerContext({
      inputs: {},
      segments: [
        {
          id: "p",
          tier: "static",
          tags: [],
          label: "## persona",
          inline: "GM",
          projection: "fixed",
        },
        {
          id: "h",
          tier: "static",
          tags: ["对话.历史"],
          label: "## 对话.历史",
          projection: "full",
        },
        {
          id: "u",
          tier: "dynamic",
          tags: ["用户.最新输入"],
          label: "## 用户.最新输入",
          projection: "full",
        },
      ],
      blackboard: bb,
      workerId: "world-simulator",
      workerName: "主世界层",
      outputTags: [],
    });
    const iPersona = text.indexOf("GM");
    const iHist = text.indexOf("推门");
    const iUser = text.indexOf("再看一眼");
    expect(iPersona).toBeGreaterThanOrEqual(0);
    expect(iHist).toBeGreaterThan(iPersona);
    expect(iUser).toBeGreaterThan(iHist);
  });

  it("falls back to event stream when history empty", () => {
    expect(
      buildHistoryFallback({
        eventStream: "门开了",
        latestUser: "走进去",
      }),
    ).toContain("门开了");
  });
});

describe("flat context order", () => {
  it("synthesizes history tag and moves across it", () => {
    const doc = synthesizeContextOrderFromWorkers(
      [
        {
          ref: "narrator",
          name: "叙事转述",
          context: {
            static: ["设计.叙事指南"],
            dynamic: ["运行.本轮.裁决", "用户.最新输入"],
          },
        },
      ],
      { gm: true, narrator: true, perspective: false },
    )!;
    expect(doc.slots[0]!.inserts.some((i) => i.ref === "对话.历史")).toBe(true);

    const histIdx = doc.slots[0]!.inserts.findIndex((i) => i.ref === "对话.历史");
    const moved = applyContextOrderEdit(doc, {
      action: "set_anchor",
      slotRef: "narrator",
      index: doc.slots[0]!.inserts.length - 1,
      anchor: "pre_history",
    });
    const newHist = moved.slots[0]!.inserts.findIndex((i) => i.ref === "对话.历史");
    const lastUser = moved.slots[0]!.inserts.findIndex(
      (i) => i.ref === "用户.最新输入",
    );
    expect(lastUser).toBeLessThan(newHist);
    expect(histIdx).toBeGreaterThanOrEqual(0);
  });

  it("maps to segments in list order including history", () => {
    const doc = parseContextOrder({
      schema: "context-order.v1",
      slots: [
        {
          ref: "world-simulator",
          inserts: [
            { order: 0, ref: "worker.persona", projection: "fixed" },
            { order: 1, ref: "对话.历史", projection: "summary" },
            { order: 2, ref: "用户.最新输入", projection: "full" },
          ],
        },
      ],
    })!;
    const segs = contextOrderToSegments({
      slot: doc.slots[0]!,
      personaText: "裁决",
    });
    expect(segs[0]!.inline).toContain("裁决");
    expect(segs[1]!.tags).toEqual(["对话.历史"]);
    expect(segs[2]!.tags).toEqual(["用户.最新输入"]);
  });
});
