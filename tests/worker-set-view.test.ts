import { describe, expect, it } from "vitest";
import { parseWorkerSetYaml } from "../src/skills/worker-set-parse.js";
import { formatWorkerSetForUser } from "../src/skills/worker-set-view.js";

const FULL_SAMPLE = `
version: 1
form_summary: 西幻升级交互，带状态跟踪
play_morphology: action_reaction_loop
workers:
  - ref: world-simulator
    duty: 世界推进与裁决
    when: 每轮用户输入后
    context:
      static:
        - 设计.worker集
        - 世界.蓝图.确认稿
      dynamic:
        - 用户.最新输入
        - 运行.事件流
    outputs:
      - 运行.本轮.裁决
      - 运行.事件流
  - ref: narrator
    duty: 组装用户可见回复
    when: 中间产物齐后
    presentation:
      tone: 西幻
      avoid: [空泛公告]
    context:
      static:
        - 叙事.指南.确认稿
      dynamic:
        - 运行.事件流
    outputs:
      - 输出.用户展示
instantiate_hints:
  invoke: [opening-generator]
tag_flow:
  - "用户.最新输入 → 运行.本轮.裁决"
  - "运行.本轮.裁决 → 输出.用户展示"
`;

describe("formatWorkerSetForUser", () => {
  it("builds Chinese worker cards with context order", () => {
    const parsed = parseWorkerSetYaml(FULL_SAMPLE)!;
    const view = formatWorkerSetForUser(parsed)!;
    expect(view.headline).toContain("西幻");
    expect(view.playModeLabel).toBe("行动–反应循环");
    expect(view.workers).toHaveLength(2);
    expect(view.workers[0].displayName).toBe("世界模拟");
    expect(view.creationUnits?.map((u) => u.id)).toEqual(
      expect.arrayContaining([
        "fixed:aesthetics", // sample 含 narrator.presentation
        "worker:world-simulator",
        "worker:narrator",
      ]),
    );
    // 未写入的示例话题不出现（不是填空表）
    expect(view.creationUnits?.some((u) => u.id === "fixed:input_protocol")).toBe(
      false,
    );
    expect(view.workers[0].context.staticTags[0].tag).toBe("设计.worker集");
    expect(view.workers[0].writes).toEqual(["运行.本轮.裁决", "运行.事件流"]);
    expect(view.workers[0].context.explicit).toBe(true);
    expect(view.workers[1].presentation?.[0].label).toBe("语气");
    expect(view.tagFlow).toHaveLength(2);
    expect(view.designTasks).toHaveLength(1);
    expect(view.designTasks[0].id).toBe("opening-generator");
  });

  it("exposes contextTags as standalone cards with mount targets", () => {
    const parsed = parseWorkerSetYaml(`
narrative_guide: 残酷、不有求必应
resident_context:
  - id: tone
    content: 文风克制
    mount: [narrator]
workers:
  - ref: world-simulator
    duty: 裁决
  - ref: narrator
    duty: 转述
    presentation:
      tone: 冷峻
`)!;
    const view = formatWorkerSetForUser(parsed)!;
    expect(view.contextTags?.length).toBeGreaterThanOrEqual(2);
    const guide = view.contextTags?.find((c) => c.id === "fixed:narrative_guide");
    expect(guide?.mountSummary).toBe("全部 Worker");
    expect(guide?.mounts.map((m) => m.workerId).sort()).toEqual([
      "narrator",
      "world-simulator",
    ]);
    const tone = view.contextTags?.find((c) => c.id === "resident:tone");
    expect(tone?.mounts).toHaveLength(1);
    expect(tone?.mounts[0].workerId).toBe("narrator");
    expect(tone?.mountSummary).toBe(tone!.mounts[0].workerName);
    const aesthetics = view.contextTags?.find((c) =>
      c.id.startsWith("fixed:aesthetics"),
    );
    expect(aesthetics?.mounts[0].workerId).toBe("narrator");
    expect(view.workers[1].readsSummary).toMatch(/美学|叙事|常驻/);
  });

  it("surfaces interaction paradigm, core worker, and rationale", () => {
    const parsed = parseWorkerSetYaml(`
form_summary: 囚徒困境旁观
interaction_paradigm: 旁观多角（推断）
core_worker: world-simulator
reasoning: 三个角色需信息隔绝，各用 role-decide；陈述用 Markdown，不必文学转述。
workers:
  - ref: world-simulator
    role: core
    rationale: 裁决组合结果，兼任结构化陈述。
  - ref: role-decide
    role: auxiliary
    rationale: 仅 3 个参与者，隔绝决策上下文。
    merge_considered: 不为每个 NPC 各开一个 worker。
`)!;
    const view = formatWorkerSetForUser(parsed)!;
    expect(view.interactionParadigm).toContain("旁观");
    expect(view.coreWorker).toBe("world-simulator");
    expect(view.reasoning).toContain("信息隔绝");
    expect(view.workers[0].roleLabel).toBe("核心");
    expect(view.workers[0].rationale).toContain("裁决");
    expect(view.workers[1].mergeConsidered).toContain("NPC");
  });

  it("merges default context when explicit context omitted", () => {
    const parsed = parseWorkerSetYaml(`
workers:
  - ref: variable-update
    duty: 跟踪变量
    when: 世界机之后
`)!;
    const view = formatWorkerSetForUser(parsed)!;
    expect(view.workers[0].context.staticTags.some((t) => t.tag.includes("变量.目录"))).toBe(
      true,
    );
    expect(view.workers[0].context.explicit).toBe(false);
    expect(view.workers[0].writes).toContain("变量.当前");
  });

  it("marks design tasks filled when blackboard has tags", () => {
    const parsed = parseWorkerSetYaml(`
workers:
  - ref: narrator
instantiate_hints:
  invoke: [opening-generator]
`)!;
    const view = formatWorkerSetForUser(parsed, {
      filledTags: ["运行.初始变量", "输出.开场白"],
    })!;
    expect(view.designTasks[0].status).toBe("filled");
  });

  it("parses context and outputs fields", () => {
    const parsed = parseWorkerSetYaml(FULL_SAMPLE)!;
    expect(parsed.workers[0].context?.static).toContain("世界.蓝图.确认稿");
    expect(parsed.workers[0].outputs).toContain("运行.事件流");
  });
});
