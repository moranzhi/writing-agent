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
import { parsePresentPacket } from "../src/skills/present-packet.js";
import { selectJsonPayload } from "../src/parse/json-doc.js";
import { parseCreationFlow } from "../src/skills/creation-flow.js";

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

  it("keeps nested aesthetics 正文 objects for specialty cards", () => {
    const frag = {
      schema: "context-fragment.v1",
      技能: "美学纲领与交互范式",
      brief: "孤立免疫",
      正文: {
        设定逻辑: {
          参与方式: {
            用户与user关系: {
              结论: "完全代入",
              完备度: "80%",
              依据: "用户明确只有我不会被感染",
            },
          },
        },
        交互范式: { 前置配置: { 人称: "你" } },
        美学纲领: { 体验内核: "特权与惊惶" },
      },
      自评: {
        维度: [{ 名: "美学纲领", 分数: 8, 说明: "点题" }],
      },
    };
    const result = parseWorkerResponseForTest(JSON.stringify(frag), [
      "设计.美学纲领与交互范式",
    ]);
    const parsed = JSON.parse(result.outputs["设计.美学纲领与交互范式"]!);
    const body = parsed.正文;
    expect(typeof body.设定逻辑).toBe("object");
    expect(body.设定逻辑.参与方式.用户与user关系.结论).toBe("完全代入");
    expect(body.美学纲领.体验内核).toBe("特权与惊惶");
    expect(parsed.自评.维度[0].分数).toBe(8);
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

  it("accepts unprefixed outputs keys and JSON sitting after thinking prose", () => {
    const frag = {
      schema: "context-fragment.v1",
      技能: "美学纲领与交互范式",
      brief: "孤立免疫",
      正文: { 美学纲领: { 体验内核: "人人录我" } },
    };
    const prefixed = parseWorkerResponseForTest(
      JSON.stringify({
        outputs: { "美学纲领与交互范式": frag },
        summary: "ok",
      }),
      ["设计.美学纲领与交互范式"],
    );
    expect(prefixed.outputs["设计.美学纲领与交互范式"]).toContain("人人录我");

    const mixed = parseWorkerResponseForTest(
      `We must output JSON. Example { "foo": 1 }.\n${JSON.stringify(frag)}`,
      ["设计.美学纲领与交互范式"],
    );
    expect(mixed.outputs["设计.美学纲领与交互范式"]).toContain("人人录我");
  });

  it("uses product JSON in reasoning when content is a closing sentence", () => {
    const frag = {
      schema: "context-fragment.v1",
      技能: "美学纲领与交互范式",
      brief: "点题",
      正文: { 美学纲领: { 体验内核: "内核" } },
    };
    const payload = selectJsonPayload(
      "The artifact is ready.",
      JSON.stringify(frag),
    );
    const result = parseWorkerResponseForTest(payload, [
      "设计.美学纲领与交互范式",
    ]);
    expect(result.outputs["设计.美学纲领与交互范式"]).toContain("内核");
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

  it("keeps incomplete fragment (no 正文) for review; 追问 hangs as sidecar", () => {
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
    expect(result.outputs["设计.美学纲领与交互范式"]).toContain("还差站位");
    expect(result.askUser?.length).toBeGreaterThan(0);
    expect(result.askUser?.[0]?.prompt).toContain("你代入吗");
  });

  it("keeps truncated fragment JSON as a reviewable draft", () => {
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
    expect(result.outputs["设计.美学纲领与交互范式"]).toContain("孤立免疫");
    expect(result.askUser).toBeUndefined();
  });

  it("canonicalizes context-order agents[] into slots on the artifact tag", () => {
    const result = parseWorkerResponseForTest(
      JSON.stringify({
        outputs: {
          "设计.上下文投影排序": {
            schema: "context-order.v1",
            brief: "主世界层",
            agents: [
              {
                id: "gm",
                enabled: true,
                inserts: [
                  { order: 0, ref: "worker.persona", projection: "fixed" },
                ],
              },
            ],
          },
        },
        summary: "ok",
      }),
      ["设计.上下文投影排序"],
    );
    const doc = JSON.parse(result.outputs["设计.上下文投影排序"]!);
    expect(doc.slots[0].ref).toBe("world-simulator");
    expect(doc.play_slots.gm).toBe(true);
  });

  it("keeps a root-level creation flow DAG on 设计.创作流程", () => {
    const dag = {
      brief: "单角代入",
      status: "open",
      steps: [
        { id: "美学纲领与交互范式", name: "美学纲领与交互范式", depends_on: [] },
        {
          id: "生成规则",
          name: "生成规则",
          role: "prototype",
          depends_on: ["美学纲领与交互范式"],
        },
      ],
    };
    const result = parseWorkerResponseForTest(JSON.stringify(dag), [
      "设计.创作流程",
    ]);
    const parsed = parseCreationFlow(result.outputs["设计.创作流程"]);
    expect(parsed?.brief).toBe("单角代入");
    expect(parsed?.steps.map((s) => s.name)).toEqual([
      "美学纲领与交互范式",
      "生成规则",
    ]);
    expect(result.outputs["设计.创作流程"]).not.toContain("context-fragment");
    expect(result.askUser).toBeUndefined();
  });

  it("keeps creation flow written under outputs bag", () => {
    const result = parseWorkerResponseForTest(
      JSON.stringify({
        outputs: {
          "设计.创作流程": {
            status: "open",
            steps: [{ name: "美学纲领与交互范式", depends_on: [] }],
          },
        },
        summary: "流程 · 1 步 · open",
      }),
      ["设计.创作流程"],
    );
    expect(parseCreationFlow(result.outputs["设计.创作流程"])?.steps[0]?.name).toBe(
      "美学纲领与交互范式",
    );
  });

  it("keeps a whole-response truncated JSON as the artifact draft", () => {
    const raw =
      '{"outputs":{"设计.上下文投影排序":{"schema":"context-order.v1","brief":"旁观+转述","agents":[';
    const result = parseWorkerResponseForTest(raw, ["设计.上下文投影排序"]);
    expect(result.outputs["设计.上下文投影排序"]).toContain("context-order.v1");
    expect(result.askUser).toBeUndefined();
  });

  it("puts full 输出.用户展示 into preview without tag fence or 4000 cap", () => {
    const body = "场面".repeat(2100);
    const result = sanitizeWorkerSetOutputs({
      outputs: { "输出.用户展示": body },
      summary: "ok",
      preview: "旧",
    });
    expect(result.preview).toBe(body);
    expect(result.preview).not.toContain("### ");
    expect(result.preview.length).toBeGreaterThan(4000);
  });

  it("play narrator: present root without askUser", () => {
    const result = parseWorkerResponseForTest(
      JSON.stringify({
        schema: "present.v1",
        shell: "prose",
        blocks: { body: "她端起碗，热气模糊了视线。" },
        meta: { suggested_actions: [] },
      }),
      ["输出.用户展示"],
      { fallbackShell: "prose" },
    );
    expect(result.askUser).toBeUndefined();
    expect(result.outputs["输出.用户展示"]).toContain("她端起碗");
    const view = parsePresentPacket(result.outputs["输出.用户展示"], "prose");
    expect(view.packet.blocks.body).toContain("她端起碗");
  });

  it("play narrator: fragment with 追问 does not surface askUser", () => {
    const result = parseWorkerResponseForTest(
      JSON.stringify({
        schema: "context-fragment.v1",
        技能: "叙事转述",
        brief: "吃饭场面",
        正文: "他决定先吃饭。",
        追问: {
          导语: "还差体验",
          题目: [{ 问: "你要什么节奏？", 建议选项: ["慢", "快"] }],
        },
      }),
      ["输出.用户展示"],
      { fallbackShell: "prose" },
    );
    expect(result.askUser).toBeUndefined();
    expect(result.outputs["输出.用户展示"]).toContain("他决定先吃饭");
  });

  it("play narrator: empty output falls back to present body", () => {
    const result = parseWorkerResponseForTest(
      JSON.stringify({ askUser: ["这一步还没写出可验收的产物"] }),
      ["输出.用户展示"],
      { fallbackShell: "turn_panel" },
    );
    expect(result.askUser).toBeUndefined();
    expect(result.outputs["输出.用户展示"]).toBeTruthy();
    const view = parsePresentPacket(result.outputs["输出.用户展示"], "prose");
    expect(view.packet.shell).toBe("turn_panel");
  });
});
