import { describe, expect, it } from "vitest";
import {
  parseContextFragment,
  projectFragmentContent,
  contextFragmentToView,
  extractFragmentAskSidecar,
} from "../src/skills/context-fragment.js";
import {
  parseContextOrder,
  contextOrderToSegments,
  slotOrderForRef,
  applyContextOrderEdit,
  mergeContextOrderIntoWorkerSetJson,
  serializeContextOrder,
} from "../src/skills/context-order.js";
import { assembleWorkerContext } from "../src/skills/context-segments.js";
import { Blackboard } from "../src/blackboard/blackboard.js";
import { buildDeclaredWorkerSkill } from "../src/skills/declared-worker.js";
import { parseWorkerSetYaml } from "../src/skills/worker-set-parse.js";

describe("context-fragment.v1", () => {
  it("parses public header and projects summary", () => {
    const frag = parseContextFragment({
      schema: "context-fragment.v1",
      技能: "美学纲领与交互范式",
      brief: "特权求生紧张",
      mount: ["world-simulator", "narrator"],
      稳变: "stable",
      正文: { 体验: { 内核: "紧张" } },
      开放问题: [],
    })!;
    expect(frag.技能).toBe("美学纲领与交互范式");
    expect(projectFragmentContent(JSON.stringify(frag), "summary")).toBe(
      "特权求生紧张",
    );
    const view = contextFragmentToView(frag);
    expect(view.ok).toBe(true);
    expect(view.sections.some((s) => s.title === "概要")).toBe(true);
  });

  it("extracts 自评 + 追问 into ask sidecar", () => {
    const side = extractFragmentAskSidecar({
      schema: "context-fragment.v1",
      brief: "孤立免疫",
      正文: { 美学纲领: { 体验内核: "…" } },
      自评: {
        维度: [
          { 名: "交互范式", 分数: 7, 说明: "权限尚可" },
          { 名: "美学纲领", 分数: 5.5, 说明: "边界未锁" },
        ],
        薄弱点: "暴力尺度未定",
      },
      追问: {
        导语: "为贴近质感，还需确认：",
        题目: [
          {
            问: "暴力与血腥如何服务压迫感？",
            建议选项: ["偶发锋利高光", "常态压抑少见血", "其它"],
            示例: "远处尖叫，近处只留锈迹",
          },
        ],
      },
    });
    expect(side.assessment).toContain("交互范式 7/10");
    expect(side.assessment).toContain("美学纲领 5.5/10");
    expect(side.assessment).toContain("薄弱点：暴力尺度未定");
    expect(side.assessment).toContain("为贴近质感");
    expect(side.questions).toHaveLength(1);
    expect(side.questions[0]!.prompt).toContain("暴力与血腥");
    expect(side.questions[0]!.prompt).toContain("示例：远处尖叫");
    expect(side.questions[0]!.options?.map((o) => o.label)).toEqual([
      "偶发锋利高光",
      "常态压抑少见血",
      "其它",
    ]);
  });
});

describe("context-order.v1", () => {
  it("maps flat order to segments (history after stable)", () => {
    const doc = parseContextOrder({
      schema: "context-order.v1",
      slots: [
        {
          ref: "world-simulator",
          inserts: [
            { order: 0, ref: "worker.persona", projection: "fixed" },
            { order: 1, ref: "设计.实现机制", projection: "summary" },
            { order: 2, ref: "对话.历史", projection: "summary" },
            { order: 3, ref: "用户.最新输入", projection: "full" },
          ],
        },
      ],
    })!;
    const slot = slotOrderForRef(doc, "world-simulator")!;
    const segs = contextOrderToSegments({
      slot,
      personaText: "中立主世界层",
    });
    expect(segs[0].inline).toContain("中立主世界层");
    expect(segs[1].tags).toEqual(["设计.实现机制"]);
    expect(segs[2].tags).toEqual(["对话.历史"]);
    expect(segs[3].tier).toBe("dynamic");
  });

  it("reorders flat list and merges into worker set JSON", () => {
    const doc = parseContextOrder({
      schema: "context-order.v1",
      slots: [
        {
          ref: "narrator",
          inserts: [
            { order: 0, ref: "worker.persona", projection: "fixed" },
            { order: 1, ref: "设计.叙事指南", projection: "summary" },
            { order: 2, ref: "设计.美学纲领与交互范式", projection: "summary" },
            { order: 3, ref: "对话.历史", projection: "summary" },
            { order: 4, ref: "运行.本轮.裁决", projection: "full" },
          ],
        },
      ],
    })!;
    const moved = applyContextOrderEdit(doc, {
      action: "move",
      slotRef: "narrator",
      index: 2,
      delta: -1,
    });
    expect(moved.slots[0]!.inserts.map((i) => i.ref)).toEqual([
      "worker.persona",
      "设计.美学纲领与交互范式",
      "设计.叙事指南",
      "对话.历史",
      "运行.本轮.裁决",
    ]);

    const afterHist = applyContextOrderEdit(moved, {
      action: "set_anchor",
      slotRef: "narrator",
      index: 1,
      anchor: "post_history",
    });
    const refs = afterHist.slots[0]!.inserts.map((i) => i.ref);
    const histAt = refs.indexOf("对话.历史");
    expect(refs.indexOf("设计.美学纲领与交互范式")).toBeGreaterThan(histAt);

    const merged = mergeContextOrderIntoWorkerSetJson(
      JSON.stringify({
        play_slots: { gm: true, narrator: true, perspective: false },
        workers: [],
      }),
      afterHist,
    );
    const again = JSON.parse(merged);
    expect(again.context_order.schema).toBe("context-order.v1");
    expect(serializeContextOrder(afterHist)).toContain("对话.历史");
  });

  it("declared worker prefers context_order segments", () => {
    const parsed = parseWorkerSetYaml(
      JSON.stringify({
        play_slots: { gm: true, narrator: true, perspective: false },
        context_order: {
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
        },
        workers: [],
      }),
    );
    expect(parsed.parseError).toBeUndefined();
    const entry = parsed.workers.find((w) => w.ref === "world-simulator")!;
    const { worker } = buildDeclaredWorkerSkill({
      skillPackName: "world-simulator",
      entry,
      template: {
        id: "world-simulator",
        label: "主世界层",
        duty: "裁决",
        suggested_context: { static: ["设计.worker集"], dynamic: ["用户.最新输入"] },
      },
      workerSet: parsed,
    });
    expect(worker.contextSegments?.some((s) => s.inline?.includes("裁决"))).toBe(
      true,
    );
    expect(
      worker.contextSegments?.some(
        (s) => s.tier === "dynamic" && s.tags.includes("用户.最新输入"),
      ),
    ).toBe(true);

    const bb = new Blackboard();
    bb.write({
      tag: "用户.最新输入",
      content: "推门进去",
      source: "test",
    });
    const text = assembleWorkerContext({
      inputs: { "用户.最新输入": "推门进去" },
      segments: worker.contextSegments,
      blackboard: bb,
      workerId: "world-simulator",
      workerName: "主世界层",
      outputTags: ["运行.本轮.裁决"],
    });
    expect(text).toContain("裁决");
    expect(text).toContain("推门进去");
  });
});
