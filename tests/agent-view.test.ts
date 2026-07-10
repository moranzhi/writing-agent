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
    expect(m.title).toContain("invoke_worker");
    expect(m.body).toBe("write-rules");
  });

  it("parses worker output", () => {
    const m = classifyAgentMessage("[Worker] write-rules 已完成\n\n### rules\n\n1. foo");
    expect(m.kind).toBe("worker_output");
    expect(m.actor).toBe("write-rules");
    expect(m.body).toContain("1. foo");
  });

  it("parses worker questions", () => {
    const m = classifyAgentMessage(
      "[Worker] setup-scenario 提问：\n- 请提供玩家人数",
    );
    expect(m.kind).toBe("worker_questions");
    expect(m.actor).toBe("setup-scenario");
    expect(m.body).toContain("请提供玩家人数");
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

  it("infers play after startup completed", () => {
    const session = {
      ...createSession(),
      slots: { ...createSession().slots, startupCompleted: true },
    };
    expect(inferLifecycleStage(session)).toBe("play");
    expect(canEnterPlay(session)).toBe(true);
  });

  it("respects uiLifecycleStage override", () => {
    const session = {
      ...createSession(),
      slots: { ...createSession().slots, uiLifecycleStage: "play" },
    };
    expect(inferLifecycleStage(session)).toBe("play");
  });
});

describe("buildSkillCatalog", () => {
  it("lists design skills for world-simulator", () => {
    const session = createSession();
    const catalog = buildSkillCatalog(session, "world-simulator", "design");
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((s) => s.stage === "design")).toBe(true);
    expect(catalog.some((s) => s.id === "interaction-paradigm")).toBe(true);
    expect(catalog[0].purpose.length).toBeGreaterThan(0);
  });

  it("marks intake active during intake wait", () => {
    const session = {
      ...createSession(),
      waitingReason: { kind: "intake" as const, prompt: "请填写" },
    };
    const catalog = buildSkillCatalog(session, "basic", "design");
    const intake = catalog.find((s) => s.id === "intake");
    expect(intake?.status).toBe("active");
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
        workerId: "setup-scenario",
        questions: ["请提供玩家人数"],
      },
    };
    const focus = buildFocus(session, session.waitingReason);
    expect(focus.actorType).toBe("user");
    expect(focus.action).toContain("setup-scenario");
    expect(focus.detail).toContain("请提供玩家人数");
  });

  it("shows design burst when running in design lifecycle", () => {
    const session = {
      ...createSession(),
      phase: "running" as const,
    };
    const focus = buildFocus(session, undefined, undefined, "design");
    expect(focus.actorLabel).toBe("Agent");
    expect(focus.action).toContain("设计");
  });
});
