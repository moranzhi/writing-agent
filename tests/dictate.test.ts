import { describe, expect, it } from "vitest";
import {
  buildDictateMessages,
  buildDictateSystemPrompt,
  defaultDictateOrder,
  extractDictateDialogue,
  isAllowedProductTag,
  isDictateModeValue,
  sortDictateProducts,
} from "../src/dictate/index.js";

describe("dictate context", () => {
  it("assembles full dialogue + products with almost no filtering", () => {
    const messages = buildDictateMessages({
      systemPrompt: "SYS",
      products: [{ tag: "用户.需求", content: "雨夜压抑" }],
      dialogue: [
        { role: "user", text: "我想要压抑雨夜" },
        { role: "assistant", text: "已写入用户.需求" },
      ],
    });
    expect(messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(messages[1]?.role).toBe("user");
    const body = messages[1]?.content ?? "";
    expect(body).toContain("用户.需求");
    expect(body).toContain("雨夜压抑");
    expect(body).toContain("我想要压抑雨夜");
    expect(body).toContain("已写入用户.需求");
  });

  it("after clear (empty dialogue) still carries products", () => {
    const messages = buildDictateMessages({
      systemPrompt: "SYS",
      products: [{ tag: "设计.美学纲领", content: "冷色短句" }],
      dialogue: [],
    });
    const body = messages[1]?.content ?? "";
    expect(body).toContain("冷色短句");
    expect(body).toContain("尚无对话");
  });

  it("extracts only user + dictate_reply turns", () => {
    const turns = extractDictateDialogue([
      { kind: "orchestrator_prompt", text: "欢迎" },
      { kind: "user_input", text: "你好" },
      { kind: "agent_tool", text: "insert" },
      { kind: "dictate_reply", text: "已记下" },
    ]);
    expect(turns).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "已记下" },
    ]);
  });

  it("validates product tags and mode value", () => {
    expect(isAllowedProductTag("用户.需求")).toBe(true);
    expect(isAllowedProductTag("设计.美学纲领")).toBe(true);
    expect(isAllowedProductTag("设计.正文组成")).toBe(true);
    expect(isAllowedProductTag("设计.开场白")).toBe(true);
    expect(isAllowedProductTag("变量.当前")).toBe(false);
    expect(isDictateModeValue("dictate")).toBe(true);
    expect(isDictateModeValue("recipe")).toBe(false);
  });

  it("system prompt requires insert toolcall and relative order", () => {
    const prompt = buildDictateSystemPrompt({
      recipeName: "数据化跑团体验",
      recipeBrief: "设定 + 真值 + 分档映射\n怎么做：\n- declare_variable\n- declare_map",
    });
    expect(prompt).toContain("设计.正文组成");
    expect(prompt).toContain("设计.开场白");
    expect(prompt).toContain("输出.开场白");
    expect(prompt).toContain("insert");
    expect(prompt).toContain("declare_variable");
    expect(prompt).toContain("declare_map");
    expect(prompt).toContain("数据化跑团体验");
    expect(prompt).toMatch(/order/);
    expect(prompt).toContain("仅允许 toolcall");
    expect(prompt).toContain("设计.模仿范例");
    expect(prompt).toContain("设计.模仿要点");
    expect(prompt).toContain("设计.叙事指南与故事推进");
    expect(prompt).toContain("大纲扩写");
    expect(prompt).toContain("禁止扮演停笔");
    expect(prompt).toContain("只挂载这些产物");
  });

  it("sorts products by relative order: neg then 0 then pos", () => {
    const sorted = sortDictateProducts([
      { tag: "设计.开场白", content: "开", order: 20 },
      { tag: "用户.需求", content: "需", order: -40 },
      { tag: "设计.正文组成", content: "格", order: 0 },
    ]);
    expect(sorted.map((p) => p.tag)).toEqual([
      "用户.需求",
      "设计.正文组成",
      "设计.开场白",
    ]);
  });

  it("default order puts stable/important before volatile", () => {
    expect(defaultDictateOrder("用户.需求")).toBeLessThan(
      defaultDictateOrder("设计.正文组成"),
    );
    expect(defaultDictateOrder("设计.正文组成")).toBeLessThan(
      defaultDictateOrder("设计.开场白"),
    );
  });

  it("context lists products in order", () => {
    const body =
      buildDictateMessages({
        systemPrompt: "SYS",
        products: [
          { tag: "设计.开场白", content: "尾", order: 10 },
          { tag: "用户.需求", content: "头", order: -10 },
        ],
        dialogue: [],
      })[1]?.content ?? "";
    expect(body.indexOf("用户.需求")).toBeLessThan(body.indexOf("设计.开场白"));
    expect(body).toContain("order=-10");
    expect(body).toContain("order=10");
  });
});
