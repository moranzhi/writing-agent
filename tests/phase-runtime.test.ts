import { describe, expect, it } from "vitest";
import {
  createMockMainAgentResponse,
  createMockToolCall,
  MockLlmProvider,
  type LlmProvider,
} from "../src/llm/client.js";
import { PhaseRuntime, createDecision } from "../src/runtime/phase-runtime.js";
import { createArtifact, createSession } from "../src/runtime/phase-machine.js";
import { Blackboard } from "../src/blackboard/blackboard.js";
import { parseCreationFlow } from "../src/skills/creation-flow.js";

function countLlmCalls(llm: MockLlmProvider): { calls: () => number } {
  let n = 0;
  const bump = () => {
    n += 1;
  };
  const origComplete = llm.complete.bind(llm);
  llm.complete = (async (messages, options) => {
    bump();
    return origComplete(messages, options);
  }) as LlmProvider["complete"];
  const origStream = llm.completeStream.bind(llm);
  llm.completeStream = (async (messages, options, callbacks) => {
    bump();
    return origStream(messages, options, callbacks);
  }) as LlmProvider["completeStream"];
  const origTools = llm.completeWithTools.bind(llm);
  llm.completeWithTools = (async (messages, options) => {
    bump();
    return origTools(messages, options);
  }) as LlmProvider["completeWithTools"];
  return { calls: () => n };
}

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

  it("picking a node shows module opening instead of calling LLM", async () => {
    const llm = new MockLlmProvider([
      JSON.stringify({
        outputs: { "设计.舞台骨架": { 范围: "不该到这一步" } },
        summary: "不应生成",
        askUser: null,
      }),
    ]);
    const llmCalls = countLlmCalls(llm);
    const runtime = new PhaseRuntime({ llm });
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
    await runtime.pickCreationStep("舞台骨架");
    const session = runtime.getSession();
    expect(session.phase).toBe("waiting_user");
    expect(session.waitingReason?.kind).toBe("worker_questions");
    if (session.waitingReason?.kind === "worker_questions") {
      expect(session.waitingReason.questions[0]?.id).toBe("module-opening");
      expect(session.waitingReason.questions[0]?.prompt).toContain(
        "玩家实际会待着玩的地方",
      );
    }
    expect(llmCalls.calls()).toBe(0);
  });

  it("picking a root node still shows opening even if 用户.需求 already has text", async () => {
    const llm = new MockLlmProvider([
      JSON.stringify({
        outputs: { "设计.舞台骨架": { 范围: "不该到这一步" } },
        summary: "不应生成",
        askUser: null,
      }),
    ]);
    const llmCalls = countLlmCalls(llm);
    const runtime = new PhaseRuntime({ llm });
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
    runtime.getBlackboard().write({
      tag: "用户.需求",
      content: "丧尸世界只有我不会被感染",
      source: "user",
    });
    runtime.getSession().slots["用户.需求"] = "丧尸世界只有我不会被感染";
    await runtime.enterSeededCreationPick();
    await runtime.pickCreationStep("舞台骨架");
    expect(runtime.getSession().waitingReason?.kind).toBe("worker_questions");
    expect(llmCalls.calls()).toBe(0);
  });

  it("leaving during opening and picking again shows opening instead of calling LLM", async () => {
    const llm = new MockLlmProvider([
      JSON.stringify({
        outputs: { "设计.舞台骨架": { 范围: "不该到这一步" } },
        summary: "不应生成",
        askUser: null,
      }),
    ]);
    const llmCalls = countLlmCalls(llm);
    const runtime = new PhaseRuntime({ llm });
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
    await runtime.pickCreationStep("舞台骨架");
    expect(runtime.getSession().waitingReason?.kind).toBe("worker_questions");
    await runtime.leaveCreationStep();
    expect(runtime.getSession().waitingReason?.kind).toBe("pick_creation_step");
    await runtime.pickCreationStep("舞台骨架");
    expect(runtime.getSession().waitingReason?.kind).toBe("worker_questions");
    expect(llmCalls.calls()).toBe(0);
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

  it("submitInput recovers from error phase", async () => {
    const runtime = new PhaseRuntime({ autoStubWorker: true });
    await runtime.start();
    await runtime.submitInput("随便写点");
    await runtime.failRun("fetch failed");
    expect(runtime.getSession().phase).toBe("error");

    await runtime.submitInput("重试一下");
    expect(runtime.getSession().phase).not.toBe("error");
    expect(runtime.getSession().slots.lastUserInput).toBe("重试一下");
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

  it("leaveCreationStep from review_artifact returns to pick without unsawning a filled instance", async () => {
    const artifact = createArtifact({
      workerId: "design-step",
      stepId: "生成规则#1",
      outputTags: ["设计.生成规则"],
    });
    const session = createSession("default");
    session.phase = "waiting_user";
    session.waitingReason = { kind: "review_artifact", artifactId: artifact.id };
    session.pendingArtifactId = artifact.id;
    session.currentWorkerId = "design-step";
    session.currentStepId = "生成规则#1";
    session.artifacts = [artifact];
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
    expect(runtime.getSession().pendingArtifactId).toBeUndefined();
    const flow = parseCreationFlow(
      runtime.getBlackboard().getContentByTag("设计.创作流程"),
    );
    expect(flow?.steps.map((s) => s.id)).toContain("生成规则#1");
  });

  it("abortCurrentRun restores the snapshot and waits instead of rerunning", async () => {
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

    runtime.abortCurrentRun();
    expect(runtime.getSession().phase).toBe("waiting_user");
    expect(runtime.getSession().currentWorkerId).toBeUndefined();
    expect(runtime.getSession().artifacts.length).toBe(artifactsAtSnapshot);
  });

  it("reentering an accepted instance reopens its artifact for revision", async () => {
    const artifact = {
      ...createArtifact({
        workerId: "design-step",
        stepId: "生成规则#1",
        outputTags: ["设计.生成规则"],
      }),
      status: "accepted",
    };
    const session = createSession("default");
    session.phase = "waiting_user";
    session.waitingReason = { kind: "pick_creation_step" };
    session.slots = {
      startupCompleted: true,
      creationAcceptedUnits: ["生成规则#1"],
    };
    session.artifacts = [artifact];
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
            params: { target: "4位核心女性" },
          },
        ],
      }),
      source: "runtime",
    });
    blackboard.write({
      tag: "创作.已验收单位",
      content: JSON.stringify(["生成规则#1"]),
      source: "runtime",
    });
    blackboard.write({
      tag: "设计.生成规则",
      content: "已有规则正文",
      source: "runtime",
    });
    const runtime = new PhaseRuntime({
      initialSession: session,
      initialBlackboardItems: blackboard.exportItems(),
    });
    await runtime.pickCreationStep("生成规则#1", undefined, { reenter: true });
    const next = runtime.getSession();
    expect(next.waitingReason?.kind).toBe("review_artifact");
    if (next.waitingReason?.kind === "review_artifact") {
      expect(next.waitingReason.artifactId).toBe(artifact.id);
    }
    expect(next.pendingArtifactId).toBe(artifact.id);
    expect(next.currentStepId).toBe("生成规则#1");
    expect(next.phase).toBe("waiting_user");
    expect(runtime.getBlackboard().getContentByTag("创作.继承修改")).toBe("1");
    expect(next.slots.revisionTargetArtifactId).toBe(artifact.id);
    expect(
      next.artifacts.find((a) => a.id === artifact.id)?.status,
    ).toBe("under_review");
  });

  it("revising a reentered accepted instance does not bounce to the node graph", async () => {
    const artifact = {
      ...createArtifact({
        workerId: "design-step",
        stepId: "生成规则#1",
        outputTags: ["设计.生成规则"],
      }),
      status: "accepted",
    };
    const session = createSession("default");
    session.phase = "waiting_user";
    session.waitingReason = { kind: "pick_creation_step" };
    session.slots = {
      startupCompleted: true,
      creationAcceptedUnits: ["生成规则#1"],
    };
    session.artifacts = [artifact];
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
            params: { target: "4位核心女性" },
          },
        ],
      }),
      source: "runtime",
    });
    blackboard.write({
      tag: "创作.已验收单位",
      content: JSON.stringify(["生成规则#1"]),
      source: "runtime",
    });
    blackboard.write({
      tag: "设计.生成规则",
      content: "已有规则正文",
      source: "runtime",
    });
    const runtime = new PhaseRuntime({
      initialSession: session,
      initialBlackboardItems: blackboard.exportItems(),
    });
    await runtime.pickCreationStep("生成规则#1", undefined, { reenter: true });
    await runtime.rejectArtifact("把对象改成四位男性");
    const next = runtime.getSession();
    expect(next.waitingReason?.kind).not.toBe("pick_creation_step");
    expect(next.phase).toBe("running");
    expect(next.currentWorkerId).toBe("design-step");
    expect(next.slots.revisionTargetArtifactId).toBe(artifact.id);
  });

  it("deleteCreationStep removes an accepted repeatable instance", async () => {
    const artifact = {
      ...createArtifact({
        workerId: "design-step",
        stepId: "生成规则#1",
        outputTags: ["设计.生成规则"],
      }),
      status: "accepted",
    };
    const session = createSession("default");
    session.phase = "waiting_user";
    session.waitingReason = { kind: "pick_creation_step" };
    session.slots = {
      startupCompleted: true,
      creationAcceptedUnits: ["美学纲领与交互范式", "生成规则#1"],
    };
    session.artifacts = [artifact];
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
            params: { target: "4位核心女性", rule_id: "core-female-roles" },
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
      tag: "创作.已验收单位",
      content: JSON.stringify(["美学纲领与交互范式", "生成规则#1"]),
      source: "runtime",
    });
    blackboard.write({
      tag: "设计.生成规则",
      content: JSON.stringify({
        schema: "context-fragment.v1",
        技能: "生成规则",
        brief: "女臣",
        正文: { rules: [{ rule_id: "core-female-roles", 对象: "女臣" }] },
      }),
      source: "runtime",
    });
    const runtime = new PhaseRuntime({
      initialSession: session,
      initialBlackboardItems: blackboard.exportItems(),
    });
    await runtime.deleteCreationStep("生成规则#1");
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
    expect(runtime.getSession().slots.creationAcceptedUnits).toEqual([
      "美学纲领与交互范式",
    ]);
    expect(
      runtime.getSession().artifacts.find((a) => a.id === artifact.id)?.status,
    ).toBe("rejected");
    await expect(
      runtime.deleteCreationStep("美学纲领与交互范式"),
    ).rejects.toThrow(/可增殖/);
  });

  it("prepareEnterPlay seals when closer is already accepted", () => {
    const session = createSession("default");
    const blackboard = new Blackboard();
    blackboard.write({
      tag: "设计.创作流程",
      content: JSON.stringify({
        status: "open",
        steps: [
          {
            id: "开场白与开场变量",
            name: "开场白与开场变量",
            depends_on: [],
          },
        ],
      }),
      source: "runtime",
    });
    const runtime = new PhaseRuntime({
      initialSession: {
        ...session,
        slots: {
          ...session.slots,
          creationAcceptedUnits: ["开场白与开场变量"],
        },
      },
      initialBlackboardItems: blackboard.exportItems(),
    });
    runtime.prepareEnterPlay();
    expect(runtime.getSession().slots.creationSealedByOpening).toBe(true);
    expect(runtime.getSession().slots.designInstanceReady).toBe(true);
    expect(
      runtime.getBlackboard().getContentByTag("设计.worker集")?.trim(),
    ).toBeTruthy();
    const flow = parseCreationFlow(
      runtime.getBlackboard().getContentByTag("设计.创作流程"),
    );
    expect(flow?.status).not.toBe("closed");
  });
});
