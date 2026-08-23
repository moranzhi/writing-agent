import { describe, expect, it } from "vitest";
import {
  createMockMainAgentResponse,
  createMockToolCall,
  MockLlmProvider,
} from "../src/llm/client.js";
import { PhaseRuntime, createDecision } from "../src/runtime/phase-runtime.js";
import { createSession } from "../src/runtime/phase-machine.js";
import { Blackboard } from "../src/blackboard/blackboard.js";

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
    const artifactsBefore = runtime.getSession().artifacts.length;

    const session = runtime.getSession();
    session.phase = "running";
    session.waitingReason = undefined;
    session.currentWorkerId = "design-flow";

    await runtime.retryStuckRun();
    expect(runtime.getSession().artifacts.length).toBeGreaterThan(artifactsBefore);
    expect(
      runtime.getSession().artifacts.filter((a) => a.workerId === "design-flow").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("retryStuckRun throws when nothing is running", async () => {
    const runtime = new PhaseRuntime({ autoStubWorker: true });
    await runtime.start();
    await expect(runtime.retryStuckRun()).rejects.toThrow("当前没有可重试的执行");
  });
});
