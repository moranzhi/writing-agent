import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import {
  buildDictateContextOrder,
  bindDictateProductsToPlaySpec,
  collectDictateBindProducts,
  isDictateStyleBindTag,
} from "../src/dictate/play-bind.js";
import { DICTATE_ORDER_META_KEY } from "../src/dictate/types.js";
import { DIALOGUE_HISTORY_TAG, WORKER_PERSONA_REF } from "../src/skills/context-order.js";
import { defaultPlaySlots } from "../src/skills/play-slots.js";

describe("dictate play-bind", () => {
  it("classifies style tags", () => {
    expect(isDictateStyleBindTag("设计.美学纲领")).toBe(true);
    expect(isDictateStyleBindTag("设计.正文组成")).toBe(true);
    expect(isDictateStyleBindTag("设计.模仿范例")).toBe(true);
    expect(isDictateStyleBindTag("设计.模仿要点")).toBe(true);
    expect(isDictateStyleBindTag("用户.需求")).toBe(false);
  });

  it("builds gm context_order: persona → products → history → input", () => {
    const order = buildDictateContextOrder({
      products: [
        { tag: "用户.需求", content: "雨夜", order: -40 },
        { tag: "设计.美学纲领", content: "冷色", order: -30 },
        { tag: "设计.正文组成", content: "{}", order: 0 },
      ],
      playSlots: defaultPlaySlots(),
    });
    const gm = order.slots.find((s) => s.ref === "world-simulator");
    expect(gm).toBeTruthy();
    const refs = gm!.inserts.map((i) => i.ref);
    expect(refs[0]).toBe(WORKER_PERSONA_REF);
    expect(refs).toContain("用户.需求");
    expect(refs).toContain("设计.美学纲领");
    expect(refs).toContain("设计.正文组成");
    expect(refs).toContain(DIALOGUE_HISTORY_TAG);
    expect(refs[refs.length - 1]).toBe("用户.最新输入");
    const histIdx = refs.indexOf(DIALOGUE_HISTORY_TAG);
    expect(refs.indexOf("用户.需求")).toBeLessThan(histIdx);
    expect(refs.indexOf("设计.正文组成")).toBeLessThan(histIdx);
  });

  it("skips opening and worker-set tags; narrator only gets style", () => {
    const board = new Blackboard();
    board.write({
      tag: "用户.需求",
      content: "要压抑",
      source: "dictate",
      metadata: { [DICTATE_ORDER_META_KEY]: -40 },
    });
    board.write({
      tag: "设计.美学纲领",
      content: "冷色短句",
      source: "dictate",
      metadata: { [DICTATE_ORDER_META_KEY]: -30 },
    });
    board.write({
      tag: "设计.开场白",
      content: "雨落在檐上。",
      source: "dictate",
    });
    board.write({
      tag: "设计.worker集",
      content: JSON.stringify({
        play_slots: { gm: true, narrator: true, auditor: false, perspective: false },
      }),
      source: "test",
    });

    const products = collectDictateBindProducts(board);
    expect(products.map((p) => p.tag)).toEqual(["用户.需求", "设计.美学纲领"]);
    expect(products.every((p) => p.tag !== "设计.开场白")).toBe(true);

    const result = bindDictateProductsToPlaySpec(board);
    const narr = result.contextOrder.slots.find((s) => s.ref === "narrator");
    expect(narr).toBeTruthy();
    const narrRefs = narr!.inserts.map((i) => i.ref);
    expect(narrRefs).toContain("设计.美学纲领");
    expect(narrRefs).not.toContain("用户.需求");
    expect(narrRefs).toContain("输出.用户展示");
    expect(narrRefs).not.toContain("运行.本轮.裁决");

    const gm = result.contextOrder.slots.find((s) => s.ref === "world-simulator");
    expect(gm!.inserts.map((i) => i.ref)).toContain("用户.需求");
    expect(result.workerSetJson).toContain("context_order");
  });

  it("forces narrator on for 文本生成器 and mounts creation-period style context", () => {
    const board = new Blackboard();
    board.write({
      tag: "创作.选用配方",
      content: JSON.stringify({ id: "文本生成器", name: "文本生成器" }),
      source: "user",
    });
    board.write({
      tag: "设计.模仿范例",
      content: "范例正文",
      source: "dictate",
      metadata: { [DICTATE_ORDER_META_KEY]: -28 },
    });
    board.write({
      tag: "设计.模仿要点",
      content: "- 句式节奏\n- 感官密度",
      source: "dictate",
      metadata: { [DICTATE_ORDER_META_KEY]: -28 },
    });
    board.write({
      tag: "设计.叙事指南与故事推进",
      content: "用户输入用法：大纲扩写。禁止扮演停笔。",
      source: "dictate",
      metadata: { [DICTATE_ORDER_META_KEY]: -22 },
    });
    board.write({
      tag: "用户.需求",
      content: "短篇",
      source: "dictate",
    });
    board.write({
      tag: "设计.worker集",
      content: JSON.stringify({
        play_slots: { gm: true, narrator: false, auditor: false, perspective: false },
      }),
      source: "test",
    });

    const result = bindDictateProductsToPlaySpec(board);
    expect(result.contextOrder.play_slots?.narrator).toBe(true);
    const narr = result.contextOrder.slots.find((s) => s.ref === "narrator");
    expect(narr).toBeTruthy();
    const narrRefs = narr!.inserts.map((i) => i.ref);
    expect(narrRefs).toContain("设计.模仿范例");
    expect(narrRefs).toContain("设计.模仿要点");
    expect(narrRefs).toContain("设计.叙事指南与故事推进");
    expect(narrRefs).not.toContain("用户.需求");
    expect(JSON.parse(result.workerSetJson).play_slots.narrator).toBe(true);
    // 落档不改写创作期叙事指南
    expect(board.getContentByTag("设计.叙事指南与故事推进")).toBe(
      "用户输入用法：大纲扩写。禁止扮演停笔。",
    );
  });

  it("does not invent variable mappings; binds declared map slots and catalog", () => {
    const board = new Blackboard();
    board.write({ tag: "用户.需求", content: "x", source: "dictate" });
    const without = bindDictateProductsToPlaySpec(board);
    const refsWithout = without.contextOrder.slots[0]!.inserts.map((i) => i.ref);
    expect(refsWithout).not.toContain("变量.当前");
    expect(refsWithout).not.toContain("上下文.角色态度");

    board.write({
      tag: "设计.变量目录",
      content: JSON.stringify({
        schema: "variable-catalog.v1",
        fields: [{ key: "好感", type: "number", initial: 10, user_visible: true }],
      }),
      source: "test",
    });
    board.write({
      tag: "设计.变量映射",
      content: JSON.stringify({
        schema: "value-map.v1",
        maps: [
          {
            id: "aff",
            field: "好感",
            target_tag: "上下文.角色态度",
            bands: [{ min: 0, content: "冷" }],
          },
        ],
      }),
      source: "test",
    });
    const withMap = bindDictateProductsToPlaySpec(board);
    const refs = withMap.contextOrder.slots[0]!.inserts.map((i) => i.ref);
    expect(refs).toContain("变量.当前");
    expect(refs).toContain("上下文.角色态度");
    expect(refs).not.toContain("设计.变量映射");
  });
});
