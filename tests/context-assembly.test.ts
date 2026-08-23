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

  it("revision mode asks the worker to apply sidecar answers and keep the draft", () => {
    const bb = new Blackboard();
    bb.write({
      tag: "设计.美学纲领与交互范式",
      content: '{"tone":"warm"}',
      source: "worker",
    });
    const text = assembleWorkerContext({
      inputs: {
        "用户.修订说明": "再冷一点",
        "用户.worker答复": "【追问作答】\n问：偏好？\n答：偏冷",
        "设计.美学纲领与交互范式": '{"tone":"warm"}',
      },
      segments: [
        {
          id: "user",
          tier: "dynamic",
          tags: ["用户.worker答复", "用户.修订说明"],
          label: "## 用户表述",
        },
      ],
      blackboard: bb,
      workerId: "design-step",
      workerName: "创作 · 美学纲领与交互范式",
      outputTags: ["设计.美学纲领与交互范式"],
    });
    expect(text).toContain("待改底稿");
    expect(text).toContain("用户要求");
    expect(text).toContain("冲突时以较新的为准");
    expect(text).toContain("偏冷");
    expect(text).toContain("再冷一点");
    expect(text.split("再冷一点").length - 1).toBe(1);
  });

  it("stale revision note without a draft stays as a user requirement, not revision mode", () => {
    const bb = new Blackboard();
    const text = assembleWorkerContext({
      inputs: {
        "用户.修订说明": "上一步留下的意见",
        "用户.需求": "网恋对话",
      },
      segments: [
        {
          id: "user",
          tier: "dynamic",
          tags: ["用户.需求", "用户.修订说明"],
          label: "## 用户表述",
        },
      ],
      blackboard: bb,
      workerId: "design-step",
      workerName: "创作 · 正文组成",
      outputTags: ["设计.正文组成"],
    });
    expect(text).not.toContain("修订模式");
    expect(text).not.toContain("待改底稿");
    expect(text).toContain("用户要求");
    expect(text).toContain("上一步留下的意见");
    expect(text).toContain("网恋对话");
    expect(text).toContain("按 SKILL 与上方分区完成任务");
  });

  it("collapses duplicate user-demand tags in the same segment", () => {
    const bb = new Blackboard();
    const text = assembleWorkerContext({
      inputs: {
        "用户.需求": "开场需求\n\n需要正文和选项",
        "用户.worker答复": "需要正文和选项",
        "用户.最新输入": "需要正文和选项",
      },
      segments: [
        {
          id: "user",
          tier: "dynamic",
          tags: ["用户.需求", "用户.worker答复", "用户.最新输入"],
          label: "## 用户表述",
        },
      ],
      blackboard: bb,
      workerId: "design-step",
      workerName: "创作 · 正文组成",
      outputTags: ["设计.正文组成"],
    });
    expect(text.split("需要正文和选项").length - 1).toBe(1);
  });

  it("keeps earlier user requirements and puts the newer revision last", () => {
    const bb = new Blackboard();
    bb.write({
      tag: "设计.正文组成",
      content: '{"shell":"split_board"}',
      source: "worker",
    });
    const text = assembleWorkerContext({
      inputs: {
        "用户.需求": "需要正文和监控",
        "用户.修订说明": "状态放到上面",
        "设计.正文组成": '{"shell":"split_board"}',
      },
      segments: [
        {
          id: "user",
          tier: "dynamic",
          tags: ["用户.需求", "用户.修订说明"],
          label: "## 用户表述",
        },
      ],
      blackboard: bb,
      workerId: "design-step",
      workerName: "创作 · 正文组成",
      outputTags: ["设计.正文组成"],
    });
    expect(text).toContain("需要正文和监控");
    expect(text).toContain("状态放到上面");
    expect(text.indexOf("需要正文和监控")).toBeLessThan(text.indexOf("状态放到上面"));
    expect(text).toContain("冲突时以较新的为准");
    expect(text).toContain("待改底稿");
    expect(text).toContain("split_board");
  });

  it("inherit-existing asks the worker to keep the draft without a revision note", () => {
    const bb = new Blackboard();
    bb.write({
      tag: "设计.美学纲领与交互范式",
      content: '{"tone":"warm"}',
      source: "worker",
    });
    const text = assembleWorkerContext({
      inputs: {
        "设计.美学纲领与交互范式": '{"tone":"warm"}',
      },
      segments: [
        {
          id: "inherit-existing",
          tier: "static",
          tags: ["设计.美学纲领与交互范式"],
          label: "## 【既有产物 · 继承修改】在下列正文上继续改",
        },
      ],
      blackboard: bb,
      workerId: "design-step",
      workerName: "创作 · 回头修改 · 美学纲领与交互范式",
      outputTags: ["设计.美学纲领与交互范式"],
    });
    expect(text).toContain("既有产物 · 继承修改");
    expect(text).toContain("回头修改");
    expect(text).toContain("warm");
    expect(text).not.toContain("按 SKILL 与上方分区完成任务");
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
