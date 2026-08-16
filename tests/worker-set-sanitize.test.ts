import { describe, expect, it } from "vitest";
import {
  extractJsonObjectText,
  isUsableWorkerSet,
  looksLikeProseNotSpec,
  parseWorkerSetYaml,
} from "../src/skills/worker-set-parse.js";
import {
  parseWorkerResponseForTest,
  sanitizeWorkerSetOutputs,
} from "../src/worker/executor.js";

describe("worker-set prose rejection", () => {
  it("does not YAML-crash on Chinese prose; returns clear parseError", () => {
    const prose =
      "我们被要求输出 JSON。首先，根据用户输入和 SKILL，进行实例设计。用户需求是：扮演一个坠机的幸存者…";
    expect(looksLikeProseNotSpec(prose)).toBe(true);
    const parsed = parseWorkerSetYaml(prose);
    expect(parsed?.parseError).toMatch(/不是 JSON 规格|askUser/);
    expect(parsed?.parseError).not.toMatch(/Implicit keys/);
  });

  it("extracts JSON object from surrounding prose", () => {
    const raw = `说明如下：\n\`\`\`json\n{"version":1,"workers":[{"ref":"narrator","duty":"转述","acceptance":"review"}]}\n\`\`\``;
    const extracted = extractJsonObjectText(raw);
    expect(extracted?.startsWith("{")).toBe(true);
    expect(isUsableWorkerSet(parseWorkerSetYaml(extracted!))).toBe(true);
  });
});

describe("sanitizeWorkerSetOutputs", () => {
  it("converts prose-in-draft to askUser and clears bad tag", () => {
    const result = sanitizeWorkerSetOutputs({
      outputs: {
        "设计.worker集.草稿":
          "坠机后伤势如何？\n请描述你的初始状态：轻伤还是重伤？\n也可以让我随机生成。",
      },
      summary: "提问",
      preview: "…",
    });
    expect(result.outputs["设计.worker集.草稿"]).toBeUndefined();
    expect(result.askUser?.length).toBeGreaterThan(0);
  });

  it("keeps valid JSON draft", () => {
    const json = JSON.stringify({
      version: 1,
      workers: [{ ref: "world-simulator", duty: "世界", acceptance: "continue" }],
    });
    const result = sanitizeWorkerSetOutputs({
      outputs: { "设计.worker集.草稿": json },
      summary: "草案",
      preview: json,
    });
    expect(result.outputs["设计.worker集.草稿"]).toContain("world-simulator");
    expect(result.askUser).toBeUndefined();
  });

  it("parseWorkerResponse does not dump raw prose into worker-set tags", () => {
    const raw =
      "我们被要求输出 JSON。请描述你的初始状态？伤势如何？";
    const result = parseWorkerResponseForTest(raw, [
      "设计.worker集.草稿",
      "设计.worker集",
      "用户.需求",
    ]);
    expect(result.outputs["设计.worker集.草稿"]).toBeUndefined();
    expect(result.askUser?.length).toBeGreaterThan(0);
  });

  it("accepts nested object outputs for worker set", () => {
    const result = parseWorkerResponseForTest(
      JSON.stringify({
        outputs: {
          "设计.worker集.草稿": {
            version: 1,
            workers: [{ ref: "narrator", duty: "转述", acceptance: "review" }],
          },
        },
        summary: "ok",
        askUser: null,
      }),
      ["设计.worker集.草稿"],
    );
    expect(result.outputs["设计.worker集.草稿"]).toContain("narrator");
    expect(result.askUser).toBeUndefined();
  });

  it("lifts fragment 追问/自评 into askUser + askAssessment", () => {
    const result = parseWorkerResponseForTest(
      JSON.stringify({
        outputs: {
          "设计.美学纲领与交互范式": {
            schema: "context-fragment.v1",
            brief: "孤立免疫",
            正文: { 美学纲领: { 体验内核: "特权与惊惶" } },
            自评: {
              维度: [{ 名: "美学纲领", 分数: 6, 说明: "边界未锁" }],
              薄弱点: "尺度",
            },
            追问: {
              导语: "还需确认：",
              题目: [
                {
                  问: "血腥如何用？",
                  建议选项: ["少而锋利", "常态压抑"],
                  示例: "锈迹即可",
                },
              ],
            },
          },
        },
        summary: "美学纲领 · 孤立免疫",
      }),
      ["设计.美学纲领与交互范式"],
    );
    expect(result.askUser?.length).toBe(1);
    expect(result.askUser?.[0]?.options?.length).toBe(2);
    expect(result.askAssessment).toContain("美学纲领 6/10");
    expect(result.askAssessment).toContain("还需确认");
  });

  it("drops askUser copies of fragment 追问 and keeps the 示例 prompt", () => {
    const result = parseWorkerResponseForTest(
      JSON.stringify({
        outputs: {
          "设计.美学纲领与交互范式": {
            schema: "context-fragment.v1",
            brief: "孤立免疫",
            正文: { 美学纲领: { 体验内核: "特权与惊惶" } },
            追问: {
              导语: "还需确认：",
              题目: [
                {
                  问: "你最想反复感受到的是哪一种？",
                  建议选项: ["日常从容", "揭示翻转"],
                  示例: "袖口唐纹",
                },
              ],
            },
          },
        },
        summary: "美学纲领 · 孤立免疫",
        askUser: [
          {
            prompt: "为贴近你要的质感：你最想反复感受到的是哪一种？",
            options: ["日常从容", "揭示翻转"],
          },
        ],
      }),
      ["设计.美学纲领与交互范式"],
    );
    expect(result.askUser).toHaveLength(1);
    expect(result.askUser?.[0]?.prompt).toContain("示例：袖口唐纹");
    expect(result.askUser?.[0]?.prompt).not.toContain("为贴近你要的质感");
  });

  it("recovers a root-level context-fragment into the artifact tag", () => {
    const frag = {
      schema: "context-fragment.v1",
      技能: "美学纲领与交互范式",
      brief: "孤立免疫",
      正文: {
        设定逻辑: { 变造: { 原型: "丧尸", 变点: "唯我免疫" } },
        交互范式: { 代入: "完全" },
        美学纲领: { 体验内核: "人人录我" },
      },
    };
    const result = parseWorkerResponseForTest(JSON.stringify(frag), [
      "设计.美学纲领与交互范式",
    ]);
    expect(result.outputs["设计.美学纲领与交互范式"]).toContain("人人录我");
    expect(result.askUser).toBeUndefined();
  });

  it("moves a fragment written to 创作.当前步骤 onto the artifact tag", () => {
    const frag = {
      schema: "context-fragment.v1",
      技能: "美学纲领与交互范式",
      brief: "孤立免疫",
      正文: { 美学纲领: { 体验内核: "特权与惊惶" } },
    };
    const result = parseWorkerResponseForTest(
      JSON.stringify({
        outputs: { "创作.当前步骤": frag },
        summary: "误写入指针",
      }),
      ["设计.美学纲领与交互范式", "创作.当前步骤"],
    );
    expect(result.outputs["创作.当前步骤"]).toBeUndefined();
    expect(result.outputs["设计.美学纲领与交互范式"]).toContain("特权与惊惶");
  });

  it("does not accept a fragment without 正文; keeps 追问 for the LLM loop", () => {
    const result = parseWorkerResponseForTest(
      JSON.stringify({
        outputs: {
          "设计.美学纲领与交互范式": {
            schema: "context-fragment.v1",
            技能: "美学纲领与交互范式",
            brief: "在唯一免疫的末日联接中体验绝望掌控感",
            mount: "world-simulator",
            追问: {
              导语: "还差站位",
              题目: [{ 问: "你代入吗？", 建议选项: ["完全代入", "旁观"] }],
            },
          },
        },
        summary: "半残",
      }),
      ["设计.美学纲领与交互范式"],
    );
    expect(result.outputs["设计.美学纲领与交互范式"]).toBeUndefined();
    expect(result.askUser?.length).toBeGreaterThan(0);
    expect(result.askUser?.[0]?.prompt).toContain("你代入吗");
  });

  it("asks to continue the loop when fragment JSON is unusable", () => {
    const result = parseWorkerResponseForTest(
      JSON.stringify({
        outputs: {
          "设计.美学纲领与交互范式":
            '{"schema":"context-fragment.v1","brief":"孤立免疫","mount":"world-simulator"',
        },
        summary: "截断",
      }),
      ["设计.美学纲领与交互范式"],
    );
    expect(result.outputs["设计.美学纲领与交互范式"]).toBeUndefined();
    expect(result.askUser?.[0]?.prompt).toContain("还没写出可验收的产物");
  });
});
