import { describe, expect, it } from "vitest";
import {
  createMockMainAgentResponse,
  createMockToolCall,
  MockLlmProvider,
} from "../src/llm/client.js";
import { PhaseRuntime, createDecision } from "../src/runtime/phase-runtime.js";
import { createSession } from "../src/runtime/phase-machine.js";
import { Blackboard } from "../src/blackboard/blackboard.js";
import { parseCreationFlow } from "../src/skills/creation-flow.js";

describe("phase runtime", () => {
  it("auto-loads default orchestrator and awaits first user input", async () => {
    const runtime = new PhaseRuntime();
    await runtime.start();
    expect(runtime.getActiveSkill()?.name).toBe("world-simulator");
    expect(runtime.getActiveSkill()?.startupMode).toBe("agent-first");
    expect(runtime.getSession().waitingReason?.kind).toBe("input");
  });

  it("writes 用户.需求 and invokes main agent after first input", async () => {
    const llm = new MockLlmProvider([
      createMockMainAgentResponse([
        createMockToolCall("ask_user", {
          question: "还需要补充吗？",
          reason: "确认交互细节",
        }),
      ]),
    ]);
    const runtime = new PhaseRuntime({ llm });
    await runtime.start();
    await runtime.submitInput("西幻升级交互，世界推着走");
    expect(runtime.getSession().slots["用户.需求"]).toContain("西幻");
    expect(runtime.getSession().slots.startupCompleted).toBe(true);
  });

  it("stub run_worker design-flow is allowed before worker set accept", async () => {
    const runtime = new PhaseRuntime({ autoStubWorker: true });
    await runtime.start();
    await runtime.submitInput("网恋对象对话");
    await runtime.submitDecision(
      createDecision({
        action: "run_worker",
        reason: "编排创作流程",
        workerId: "design-flow",
        requiresApproval: false,
      }),
    );
    expect(runtime.getSession().artifacts.some((a) => a.workerId === "design-flow")).toBe(
      true,
    );
  });

  it("play turn runs declared pipeline without review and waits for input", async () => {
    const session = createSession("default");
    session.phase = "waiting_user";
    session.waitingReason = { kind: "input" };
    session.slots = {
      designInstanceReady: true,
      uiLifecycleStage: "play",
      playLayerActive: true,
      startupCompleted: true,
    };
    const blackboard = new Blackboard();
    blackboard.write({
      tag: "设计.worker集",
      content: JSON.stringify({
        version: 1,
        play_slots: {
          auditor: false,
          gm: true,
          narrator: true,
          perspective: false,
        },
        workers: [
          { ref: "world-simulator", acceptance: "continue" },
          { ref: "narrator", acceptance: "review" },
        ],
      }),
      source: "test",
    });
    const runtime = new PhaseRuntime({
      autoStubWorker: true,
      initialSession: session,
      initialBlackboardItems: blackboard.exportItems(),
    });
    await runtime.submitInput("我网购一个金首饰试试");
    expect(runtime.getSession().waitingReason?.kind).toBe("input");
    expect(runtime.getSession().artifacts.map((a) => a.workerId)).toEqual([
      "world-simulator",
      "narrator",
    ]);
    expect(runtime.getSession().artifacts.every((a) => a.status === "accepted")).toBe(
      true,
    );
  });

  it("retryStuckRun restores the in-flight worker snapshot and reruns", async () => {
    const runtime = new PhaseRuntime({ autoStubWorker: true });
    await runtime.start();
    await runtime.submitInput("网恋对象对话");
    await runtime.submitDecision(
      createDecision({
        action: "run_worker",
        reason: "编排创作流程",
        workerId: "design-flow",
        requiresApproval: false,
      }),
    );
    const snap = runtime.getLastWorkerRunSnapshot();
    expect(snap?.workerId).toBe("design-flow");
    const artifactsAtSnapshot = snap!.runtimeSession.artifacts.length;

    const session = runtime.getSession();
    session.phase = "running";
    session.waitingReason = undefined;
    session.currentWorkerId = "design-flow";

    await runtime.retryStuckRun();
    expect(runtime.getSession().artifacts.length).toBeGreaterThan(
      artifactsAtSnapshot,
    );
    expect(
      runtime.getSession().artifacts.filter((a) => a.workerId === "design-flow").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("retryStuckRun throws when nothing is running", async () => {
    const runtime = new PhaseRuntime({ autoStubWorker: true });
    await runtime.start();
    await expect(runtime.retryStuckRun()).rejects.toThrow("当前没有可重试的执行");
  });

  it("first input with seeded DAG waits for node pick instead of calling main agent", async () => {
    const llm = new MockLlmProvider(["Let me analyze the DAG in English prose"]);
    const runtime = new PhaseRuntime({ llm });
    await runtime.start();
    runtime.getBlackboard().write({
      tag: "设计.创作流程",
      content: JSON.stringify({
        version: 1,
        status: "open",
        steps: [
          {
            id: "美学纲领与交互范式",
            name: "美学纲领与交互范式",
            depends_on: [],
          },
        ],
      }),
      source: "runtime",
    });
    await runtime.submitInput("丧尸世界，但只有我不会被感染");
    expect(runtime.getSession().phase).toBe("waiting_user");
    expect(runtime.getSession().waitingReason?.kind).toBe("pick_creation_step");
  });

  it("enterSeededCreationPick skips first demand and waits on the seeded graph", async () => {
    const runtime = new PhaseRuntime();
    await runtime.start();
    runtime.getBlackboard().write({
      tag: "设计.创作流程",
      content: JSON.stringify({
        version: 1,
        status: "open",
        steps: [
          {
            id: "舞台骨架",
            name: "舞台骨架",
            depends_on: [],
          },
        ],
      }),
      source: "runtime",
    });
    await runtime.enterSeededCreationPick();
    expect(runtime.getSession().slots.startupCompleted).toBe(true);
    expect(runtime.getSession().waitingReason?.kind).toBe("pick_creation_step");
  });

  it("unusable main agent output without DAG starts design-flow", async () => {
    const llm = new MockLlmProvider(["Let me think about routing"]);
    const runtime = new PhaseRuntime({ llm, autoStubWorker: true });
    await runtime.start();
    await runtime.submitInput("网恋对象对话");
    expect(runtime.getSession().phase).not.toBe("running");
    expect(
      runtime.getSession().artifacts.some((a) => a.workerId === "design-flow"),
    ).toBe(true);
  });

  it("failRun leaves error phase instead of running", async () => {
    const runtime = new PhaseRuntime();
    await runtime.start();
    await runtime.submitInput("随便写点");
    expect(runtime.getSession().phase).toBe("running");
    await runtime.failRun("fetch failed");
    expect(runtime.getSession().phase).toBe("error");
    expect(runtime.getSession().waitingReason).toBeUndefined();
  });

  it("recoverOrphanedRun turns stuck running into node pick when DAG exists", async () => {
    const runtime = new PhaseRuntime();
    await runtime.start();
    runtime.getBlackboard().write({
      tag: "设计.创作流程",
      content: JSON.stringify({
        version: 1,
        status: "open",
        steps: [
          {
            id: "美学纲领与交互范式",
            name: "美学纲领与交互范式",
            depends_on: [],
          },
        ],
      }),
      source: "runtime",
    });
    const session = runtime.getSession();
    session.phase = "running";
    session.waitingReason = undefined;
    expect(runtime.recoverOrphanedRun()).toBe(true);
    expect(runtime.getSession().phase).toBe("waiting_user");
    expect(runtime.getSession().waitingReason?.kind).toBe("pick_creation_step");
  });

  it("leaveCreationStep returns to pick and unsawns an empty instance", async () => {
    const session = createSession("default");
    session.phase = "waiting_user";
    session.waitingReason = {
      kind: "worker_questions",
      workerId: "design-step",
      questions: [{ id: "module-opening", prompt: "生成规则引导" }],
    };
    session.currentWorkerId = "design-step";
    session.slots = { startupCompleted: true };
    const blackboard = new Blackboard();
    blackboard.write({
      tag: "设计.创作流程",
      content: JSON.stringify({
        version: 1,
        status: "open",
        steps: [
          {
            id: "美学纲领与交互范式",
            name: "美学纲领与交互范式",
            depends_on: [],
          },
          {
            id: "生成规则",
            name: "生成规则",
            role: "prototype",
            depends_on: ["美学纲领与交互范式"],
          },
          {
            id: "生成规则#1",
            name: "生成规则",
            role: "instance",
            from: "生成规则",
            depends_on: ["美学纲领与交互范式"],
          },
          {
            id: "开场白与开场变量",
            name: "开场白与开场变量",
            depends_on: ["美学纲领与交互范式", "生成规则#1"],
          },
        ],
      }),
      source: "runtime",
    });
    blackboard.write({
      tag: "创作.当前步骤",
      content: "生成规则#1",
      source: "runtime",
    });
    const runtime = new PhaseRuntime({
      initialSession: session,
      initialBlackboardItems: blackboard.exportItems(),
    });
    await runtime.leaveCreationStep();
    expect(runtime.getSession().waitingReason?.kind).toBe("pick_creation_step");
    expect(runtime.getSession().currentWorkerId).toBeUndefined();
    const flow = parseCreationFlow(
      runtime.getBlackboard().getContentByTag("设计.创作流程"),
    );
    expect(flow?.steps.map((s) => s.id)).toEqual([
      "美学纲领与交互范式",
      "生成规则",
      "开场白与开场变量",
    ]);
    expect(
      flow?.steps.find((s) => s.name === "开场白与开场变量")?.depends_on,
    ).toEqual(["美学纲领与交互范式"]);
  });
});
