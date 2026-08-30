import { describe, expect, it } from "vitest";
import {
  CAPABILITY_PROBE_REASONING_EFFORT,
  resolveStructuredDeliveryMode,
  type ProfileCapabilities,
} from "../src/llm/capabilities.js";
import { normalizeProfileReasoningEffort } from "../src/config/api-profiles.js";
import {
  coerceToFlatArtifact,
  flatArtifactToFragmentDoc,
  FLAT_ARTIFACT_SCHEMA_ID,
} from "../src/skills/flat-artifact.js";

describe("capability probe defaults", () => {
  it("always probes with low reasoning effort", () => {
    expect(CAPABILITY_PROBE_REASONING_EFFORT).toBe("low");
  });
});

describe("normalizeProfileReasoningEffort", () => {
  it("keeps valid effort and drops auto/empty", () => {
    expect(normalizeProfileReasoningEffort("low")).toBe("low");
    expect(normalizeProfileReasoningEffort("MAX")).toBe("max");
    expect(normalizeProfileReasoningEffort("auto")).toBeUndefined();
    expect(normalizeProfileReasoningEffort("")).toBeUndefined();
    expect(normalizeProfileReasoningEffort("nope")).toBeUndefined();
  });
});

describe("resolveStructuredDeliveryMode", () => {
  it("prefers json_schema then forced_tool then json_object", () => {
    const base: ProfileCapabilities = {
      chat: "ok",
      jsonObject: "ok",
      jsonSchema: "fail",
      tools: "ok",
      forcedTool: "ok",
      strictTool: "fail",
    };
    expect(resolveStructuredDeliveryMode(base)).toBe("forced_tool");
    expect(
      resolveStructuredDeliveryMode({ ...base, jsonSchema: "ok" }),
    ).toBe("json_schema");
    expect(
      resolveStructuredDeliveryMode({
        ...base,
        jsonSchema: "fail",
        forcedTool: "fail",
      }),
    ).toBe("json_object");
  });
});

describe("flat artifact", () => {
  it("round-trips deep fragment body into sections", () => {
    const flat = coerceToFlatArtifact({
      schema: "context-fragment.v1",
      技能: "美学纲领与交互范式",
      brief: "点题",
      mount: ["narrator"],
      稳变: "stable",
      正文: {
        设定逻辑: { 变造: "丧尸" },
        美学纲领: "出租屋",
      },
      开放问题: ["后宫"],
      追问: {
        题目: [{ 问: "身份？", 建议选项: ["幸存者", "其他"] }],
      },
    });
    expect(flat?.sections.map((s) => s.id)).toEqual(["设定逻辑", "美学纲领"]);
    const frag = flatArtifactToFragmentDoc(flat!);
    expect(frag.schema).toBe("context-fragment.v1");
    expect(frag.brief).toBe("点题");
    expect((frag.追问 as { 题目: unknown[] }).题目[0]).toMatchObject({
      问: "身份？",
    });
  });

  it("does not coerce a creation-flow DAG (brief + steps) into a flat artifact", () => {
    const flow = {
      brief: "单角代入",
      status: "open",
      steps: [{ name: "美学纲领与交互范式", depends_on: [] }],
    };
    expect(coerceToFlatArtifact(flow)).toBeNull();
  });

  it("does not coerce a brief-only object into an empty flat artifact", () => {
    expect(coerceToFlatArtifact({ brief: "点题" })).toBeNull();
  });

  it("accepts native flat wire format", () => {
    const flat = coerceToFlatArtifact({
      schema: FLAT_ARTIFACT_SCHEMA_ID,
      skill: "x",
      brief: "b",
      mount: [],
      stability: "semi",
      sections: [{ id: "a", title: "A", text: "hello" }],
      open_questions: [],
      questions: [],
      summary: "s",
    });
    expect(flat?.sections[0]?.text).toBe("hello");
  });

  it("round-trips nested body objects through flat stringify + fragment parse", () => {
    const nested = {
      schema: "context-fragment.v1",
      技能: "美学纲领与交互范式",
      brief: "点题",
      mount: [],
      正文: {
        交互范式: { 前置配置: { 用户角色: "唯一免疫者" } },
        美学纲领: { 体验内核: "报复爽", 呈现要点: "内外对比" },
        设定逻辑: { 变造: { 原型: "丧尸" } },
      },
      开放问题: [],
      追问: { 题目: [] },
    };
    const flat = coerceToFlatArtifact(nested);
    expect(flat).not.toBeNull();
    const frag = flatArtifactToFragmentDoc(flat!);
    expect(frag.技能).toBe("美学纲领与交互范式");
    expect((frag.正文 as Record<string, unknown>).交互范式).toEqual({
      前置配置: { 用户角色: "唯一免疫者" },
    });
    expect(
      ((frag.正文 as Record<string, unknown>).美学纲领 as Record<string, unknown>)
        .体验内核,
    ).toBe("报复爽");
  });
});
