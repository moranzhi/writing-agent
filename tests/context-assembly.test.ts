import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import {
  assembleWorkerContext,
  parseContextSegments,
} from "../src/skills/context-segments.js";
import {
  CREATION_ACCEPTED_CONTENT_TAG,
  extractUnitContentFromDraft,
  formatAcceptedContentForPrompt,
  upsertAcceptedUnitContent,
} from "../src/skills/creation-units.js";
import type { ParsedWorkerSet } from "../src/skills/worker-set-parse.js";
import { loadWorkerSkill } from "../src/skills/loader.js";

describe("contextSegments assembly", () => {
  it("parses segments from frontmatter shape", () => {
    const segs = parseContextSegments([
      { id: "a", tier: "static", tags: ["创作.已验收内容"], label: "## 前情" },
      { id: "b", tier: "dynamic", tags: ["用户.需求"], policy: "latest" },
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]?.label).toContain("前情");
  });

  it("assembles markdown with labels when segments present", () => {
    const bb = new Blackboard();
    bb.write({
      tag: CREATION_ACCEPTED_CONTENT_TAG,
      content: upsertAcceptedUnitContent(null, {
        unitId: "phase:core",
        content: { interaction: { user_stance: "单角" } },
        summary: "单位 phase:core · 核心",
        acceptedAt: "2026-01-01T00:00:00.000Z",
      }),
      source: "test",
    });
    bb.write({ tag: "用户.需求", content: "网恋对话", source: "test" });
    bb.write({ tag: "创作.当前单位", content: "worker:narrator", source: "test" });

    const text = assembleWorkerContext({
      inputs: {
        [CREATION_ACCEPTED_CONTENT_TAG]: bb.getContentByTag(CREATION_ACCEPTED_CONTENT_TAG)!,
        "用户.需求": "网恋对话",
        "创作.当前单位": "worker:narrator",
      },
      segments: [
        {
          id: "prior",
          tier: "static",
          tags: [CREATION_ACCEPTED_CONTENT_TAG],
          label: "## 【前情提要 · 已定稿】",
        },
        {
          id: "unit",
          tier: "static",
          tags: ["创作.当前单位"],
          label: "## 【本单位】",
        },
        {
          id: "user",
          tier: "dynamic",
          tags: ["用户.需求"],
          label: "## 用户表述",
        },
      ],
      blackboard: bb,
      workerId: "design-worker",
      workerName: "B",
      outputTags: ["设计.worker集.草稿"],
    });

    expect(text).toContain("【前情提要 · 已定稿】");
    expect(text).toContain("phase:core");
    expect(text).toContain("只读");
    expect(text).toContain("【本单位】");
    expect(text).toContain("worker:narrator");
    expect(text).toContain("网恋对话");
    expect(text).not.toMatch(/^\s*\{/);
  });

  it("falls back to JSON inputs without segments", () => {
    const bb = new Blackboard();
    const text = assembleWorkerContext({
      inputs: { "用户.需求": "x" },
      segments: [],
      blackboard: bb,
      workerId: "x",
      workerName: "x",
      outputTags: [],
    });
    expect(JSON.parse(text).inputs["用户.需求"]).toBe("x");
  });

  it("design-flow skill loads contextSegments", async () => {
    const w = await loadWorkerSkill("world-simulator", "design-flow");
    expect(w.contextSegments?.length).toBeGreaterThan(0);
    expect(w.outputTags).toContain("设计.创作流程");
  });
});

describe("accepted unit content", () => {
  it("extracts worker slice and upserts last accept", () => {
    const parsed: ParsedWorkerSet = {
      interaction: {
        user_stance: "单角",
        system_role: "世界",
        output: "叙事",
      },
      workers: [
        { ref: "narrator", duty: "转述", rationale: "可读", acceptance: "review" },
      ],
    };
    expect(extractUnitContentFromDraft(parsed, "phase:core")).toMatchObject({
      interaction: { user_stance: "单角" },
    });
    expect(extractUnitContentFromDraft(parsed, "worker:narrator")).toMatchObject({
      ref: "narrator",
      duty: "转述",
    });

    const v1 = upsertAcceptedUnitContent(null, {
      unitId: "worker:narrator",
      content: { ref: "narrator", duty: "旧" },
      acceptedAt: "2026-01-01T00:00:00.000Z",
    });
    const v2 = upsertAcceptedUnitContent(v1, {
      unitId: "worker:narrator",
      content: { ref: "narrator", duty: "新" },
      acceptedAt: "2026-01-02T00:00:00.000Z",
    });
    const prompt = formatAcceptedContentForPrompt(v2);
    expect(prompt).toContain("新");
    expect(prompt).not.toContain('"duty": "旧"');
  });
});
