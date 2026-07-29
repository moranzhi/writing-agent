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
});
