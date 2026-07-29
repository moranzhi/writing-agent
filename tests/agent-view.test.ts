import { describe, expect, it } from "vitest";
import {
  classifyAgentMessage,
  buildFocus,
  buildSkillCatalog,
  buildToolTrace,
  inferLifecycleStage,
  canEnterPlay,
} from "../src/server/agent-view.js";
import { createSession } from "../src/runtime/phase-machine.js";

describe("classifyAgentMessage", () => {
  it("parses orchestrator decisions", () => {
    const m = classifyAgentMessage("[总管] run_worker: 生成规则");
    expect(m.kind).toBe("orchestrator_decision");
    expect(m.body).toBe("生成规则");
  });

  it("parses agent tool calls", () => {
    const m = classifyAgentMessage("[总管 tool] invoke_worker: write-rules");
    expect(m.kind).toBe("agent_tool");
    expect(m.title).toContain("工具 ·");
    expect(m.title).toContain("invoke_worker");
    expect(m.body).toBe("write-rules");
  });

  it("parses worker output", () => {
    const m = classifyAgentMessage("[Worker] design-core 已完成\n\n### rules\n\n1. foo");
    expect(m.kind).toBe("worker_output");
    expect(m.actor).toBe("design-core");
    expect(m.title).toBe("创作 · 核心 · 产出");
    expect(m.body).toContain("1. foo");
  });

  it("parses worker questions", () => {
    const m = classifyAgentMessage(
      "[Worker] design-core 提问：\n- 请提供玩家人数",
    );
    expect(m.kind).toBe("worker_questions");
    expect(m.actor).toBe("design-core");
    expect(m.title).toBe("创作 · 核心 · 提问");
    expect(m.body).toContain("请提供玩家人数");
  });

  it("parses agent assessment and ask prompts", () => {
    const a = classifyAgentMessage(
      "[Agent] 内容评价：\n核心感觉: 完备度 40%\n  已知: 权力幻想",
    );
    expect(a.kind).toBe("orchestrator_assessment");
    expect(a.title).toContain("内容评价");
    expect(a.body).toContain("完备度 40%");

    const q = classifyAgentMessage("[Agent] 提问：\n- 你更倾向于哪种享受？");
    expect(q.kind).toBe("worker_questions");
    expect(q.actor).toBe("orchestrator");
    expect(q.body).toContain("哪种享受");

    const opt = classifyAgentMessage(
      "[Agent] 可选追问（可跳过）：\n- 还想补感官吗？",
    );
    expect(opt.kind).toBe("worker_questions");
    expect(opt.title).toContain("可选追问");
  });

  it("falls back when worker question body is empty", () => {
    const m = classifyAgentMessage("Worker 提问：\n");
    expect(m.kind).toBe("worker_questions");
    expect(m.body).toContain("请补充当前步骤");
  });
});

describe("lifecycle", () => {
  it("infers design before startup completed", () => {
    const session = createSession();
    expect(inferLifecycleStage(session)).toBe("design");
    expect(canEnterPlay(session)).toBe(false);
  });

  it("stays in design until worker set accepted", () => {
    const session = {
      ...createSession(),
      slots: { ...createSession().slots, startupCompleted: true },
    };
    expect(inferLifecycleStage(session)).toBe("design");
    expect(canEnterPlay(session)).toBe(false);
  });

  it("allows play only after accepted worker set", () => {
    const session = {
      ...createSession(),
      slots: { ...createSession().slots, designInstanceReady: true },
    };
    expect(canEnterPlay(session)).toBe(true);
    expect(inferLifecycleStage(session)).toBe("design");
  });

  it("respects uiLifecycleStage play when instance ready", () => {
    const session = {
      ...createSession(),
      slots: {
        ...createSession().slots,
        uiLifecycleStage: "play",
        designInstanceReady: true,
      },
    };
    expect(inferLifecycleStage(session)).toBe("play");
  });

  it("blocks play override when instance not ready", () => {
    const session = {
      ...createSession(),
      slots: { ...createSession().slots, uiLifecycleStage: "play" },
    };
    expect(inferLifecycleStage(session)).toBe("design");
  });
});

describe("buildSkillCatalog", () => {
  it("lists design skills for world-simulator from worker set scope", () => {
    const session = createSession();
    const yaml = `
form_summary: 测试
workers:
  - ref: narrator
    duty: 展示
instantiate_hints:
  invoke: [narrative-guide]
`;
    const catalog = buildSkillCatalog(session, "world-simulator", "design", {
      workerSetYaml: yaml,
    });
    expect(catalog.some((s) => s.id === "design-flow")).toBe(true);
    expect(catalog.some((s) => s.id === "design-refine")).toBe(false);
    expect(catalog.some((s) => s.id === "narrative-guide")).toBe(true);
    expect(catalog.some((s) => s.id === "declare-ready")).toBe(true);
    expect(catalog.every((s) => s.stage === "design")).toBe(true);
    expect(catalog.find((s) => s.id === "world-blueprint")).toBeUndefined();
  });

  it("lists run workers in play lifecycle from worker set", () => {
    const session = {
      ...createSession(),
      slots: { ...createSession().slots, designInstanceReady: true },
    };
    const yaml = `
workers:
  - ref: world-simulator
  - ref: narrator
`;
    const catalog = buildSkillCatalog(session, "world-simulator", "play", {
      workerSetYaml: yaml,
    });
    expect(catalog.some((s) => s.id === "agent-burst")).toBe(true);
    expect(catalog.some((s) => s.id === "world-simulator")).toBe(true);
    expect(catalog.some((s) => s.id === "narrator")).toBe(true);
  });

  it("lists design step skills when no worker set yet", () => {
    const session = {
      ...createSession(),
      waitingReason: { kind: "input" as const, message: "描述需求" },
    };
    const catalog = buildSkillCatalog(session, "world-simulator", "design");
    expect(catalog.some((s) => s.id === "design-flow")).toBe(true);
    expect(catalog.some((s) => s.id === "design-step")).toBe(true);
    expect(catalog.some((s) => s.id === "design-core")).toBe(false);
  });
});

describe("buildToolTrace", () => {
  it("collects agent_tool messages since last user input", () => {
    const trace = buildToolTrace([
      {
        kind: "user_input",
        text: "hello",
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        kind: "agent_tool",
        text: "[总管 tool] read_blackboard: tags=3",
        createdAt: "2026-01-01T00:00:01Z",
      },
    ]);
    expect(trace).toHaveLength(1);
    expect(trace[0].name).toBe("read_blackboard");
  });
});

describe("buildFocus", () => {
  it("focuses user on input wait", () => {
    const session = {
      ...createSession(),
      phase: "waiting_user" as const,
      waitingReason: { kind: "input" as const, message: "请描述场景" },
    };
    const focus = buildFocus(session, session.waitingReason);
    expect(focus.actorType).toBe("user");
  });

  it("focuses user on worker questions", () => {
    const session = {
      ...createSession(),
      phase: "waiting_user" as const,
      waitingReason: {
        kind: "worker_questions" as const,
        workerId: "design-core",
        questions: [{ id: "q1", prompt: "请提供玩家人数" }],
      },
    };
    const focus = buildFocus(session, session.waitingReason);
    expect(focus.actorType).toBe("user");
    expect(focus.action).toContain("创作 · 核心");
    expect(focus.detail).toContain("请提供玩家人数");
  });

  it("shows design burst when running in design lifecycle", () => {
    const session = {
      ...createSession(),
      phase: "running" as const,
    };
    const focus = buildFocus(session, undefined, undefined, "design");
    expect(focus.actorLabel).toBe("总管");
    expect(focus.action).toContain("创作");
  });
});

