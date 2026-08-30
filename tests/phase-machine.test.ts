import { describe, expect, it } from "vitest";
import { createDecision } from "../src/runtime/orchestrator.js";
import {
  applyEvent,
  createArtifact,
  createSession,
} from "../src/runtime/phase-machine.js";
import { loadSkill } from "../src/skills/loader.js";
import { toActiveSkillSnapshot } from "../src/skills/snapshot.js";

const mockSkills = [
  { name: "world-simulator", description: "默认", category: "dialogue" },
];

describe("phase machine", () => {
  it("runs design-core approve loop on agent-first pack", async () => {
    const snap = toActiveSkillSnapshot(await loadSkill("world-simulator"));

    let session = applyEvent(createSession("default"), {
      type: "session_started",
      payload: {
        presetId: "default",
        availableSkills: mockSkills,
        initialSkill: snap,
      },
    }).session;

    session = applyEvent(session, {
      type: "user_submitted_input",
      payload: { text: "1v1 网恋对话" },
    }).session;
    expect(session.phase).toBe("running");

    const decision = createDecision({
      action: "run_worker",
      reason: "产出 Worker 集",
      workerId: "design-core",
      requiresApproval: true,
    });
    session = applyEvent(session, {
      type: "main_agent_decision_created",
      payload: { decision },
    }).session;
    expect(session.waitingReason?.kind).toBe("approve_step");

    session = applyEvent(session, {
      type: "user_approved_next_step",
      payload: { decisionId: decision.id },
    }).session;
    session = applyEvent(session, {
      type: "worker_started",
      payload: { workerId: "design-core", acceptanceMode: "user_confirmed" },
    }).session;

    const artifact = createArtifact({
      workerId: "design-core",
      outputTags: ["设计.worker集"],
    });
    session = { ...session, artifacts: [artifact] };
    session = applyEvent(session, {
      type: "worker_completed",
      payload: { artifactId: artifact.id },
    }).session;
    expect(session.waitingReason?.kind).toBe("review_artifact");

    session = applyEvent(session, {
      type: "user_accepted_artifact",
      payload: { artifactId: artifact.id },
    }).session;
    expect(session.slots.designInstanceReady).toBe(true);
    expect(session.phase).toBe("running");
  });

  it("hangs optional questions under review_artifact without blocking accept", () => {
    let session = createSession("default");
    session = {
      ...session,
      phase: "running" as const,
      acceptanceMode: "user_confirmed" as const,
    };
    const artifact = createArtifact({
      workerId: "design-core",
      outputTags: ["设计.worker集.草稿"],
    });
    session = { ...session, artifacts: [artifact] };
    const completed = applyEvent(session, {
      type: "worker_completed",
      payload: {
        artifactId: artifact.id,
        questions: [
          {
            id: "q1",
            prompt: "更偏哪种节奏？",
            options: [{ id: "A", label: "慢热拉扯" }],
          },
        ],
      },
    });
    session = completed.session;

    expect(session.waitingReason?.kind).toBe("review_artifact");
    if (session.waitingReason?.kind !== "review_artifact") return;
    expect(session.waitingReason.questions?.length).toBe(1);
    expect(session.waitingReason.questions?.[0]?.required).toBe(false);
    // 追问只挂 waitingReason，不另发「可选追问」消息（与产物同面展示）
    expect(
      completed.effects.some(
        (e) =>
          e.type === "emit_message" &&
          typeof e.message === "string" &&
          /可选追问/.test(e.message),
      ),
    ).toBe(false);

    // 不答追问，直接接受产物
    session = applyEvent(session, {
      type: "user_accepted_artifact",
      payload: { artifactId: artifact.id },
    }).session;
    expect(session.phase).toBe("running");
  });

  it("sidecar skip clears questions but stays in review", () => {
    let session = createSession("default");
    session = {
      ...session,
      phase: "running" as const,
      acceptanceMode: "user_confirmed" as const,
    };
    const artifact = createArtifact({
      workerId: "design-core",
      outputTags: ["设计.worker集.草稿"],
    });
    session = { ...session, artifacts: [artifact] };
    session = applyEvent(session, {
      type: "worker_completed",
      payload: {
        artifactId: artifact.id,
        questions: ["还想补一点感官细节吗？"],
      },
    }).session;

    session = applyEvent(session, {
      type: "user_resolved_sidecar_questions",
      payload: {},
    }).session;
    expect(session.waitingReason?.kind).toBe("review_artifact");
    if (session.waitingReason?.kind !== "review_artifact") return;
    expect(session.waitingReason.questions).toBeUndefined();
    expect(session.pendingArtifactId).toBe(artifact.id);
  });

  it("accepting design-core with only draft does not set designInstanceReady", () => {
    let session = createSession();
    const artifact = createArtifact({
      workerId: "design-core",
      outputTags: ["设计.worker集.草稿", "创作.当前单位"],
    });
    session = {
      ...session,
      artifacts: [artifact],
      pendingArtifactId: artifact.id,
      phase: "waiting_user",
      waitingReason: { kind: "review_artifact", artifactId: artifact.id },
    };
    session = applyEvent(session, {
      type: "user_accepted_artifact",
      payload: { artifactId: artifact.id },
    }).session;
    expect(session.slots.designInstanceReady).toBeUndefined();
  });

  it("rejecting artifact with feedback immediately reruns the same worker", () => {
    let session = createSession("default");
    const artifact = createArtifact({
      workerId: "design-step",
      stepId: "step-aesthetics",
      outputTags: ["设计.美学纲领"],
    });
    session = {
      ...session,
      artifacts: [artifact],
      pendingArtifactId: artifact.id,
      currentStepId: "step-aesthetics",
      phase: "waiting_user",
      waitingReason: { kind: "review_artifact", artifactId: artifact.id },
      slots: {
        "用户.worker答复": "【追问作答】\n问：偏好？\n答：偏冷",
      },
    };

    const result = applyEvent(session, {
      type: "user_rejected_artifact",
      payload: { artifactId: artifact.id, reason: "语气再冷一点" },
    });

    expect(result.session.phase).toBe("running");
    expect(result.session.waitingReason).toBeUndefined();
    expect(result.session.slots["用户.修订说明"]).toBe("语气再冷一点");
    // 追问答复不得被修订说明冲掉
    expect(result.session.slots["用户.worker答复"]).toContain("偏冷");
    expect(result.session.artifacts[0]?.status).toBe("revision_requested");
    // 只有这一份底稿可在重跑写不出新版时退回
    expect(result.session.slots.revisionTargetArtifactId).toBe(artifact.id);
    expect(result.session.currentWorkerId).toBe("design-step");
    expect(result.session.currentStepId).toBe("step-aesthetics");
    expect(result.effects).toEqual([
      { type: "run_worker", workerId: "design-step" },
    ]);
  });

  it("later revision notes accumulate instead of replacing earlier ones", () => {
    let session = createSession("default");
    const artifact = createArtifact({
      workerId: "design-step",
      outputTags: ["设计.正文组成"],
    });
    session = {
      ...session,
      artifacts: [artifact],
      pendingArtifactId: artifact.id,
      phase: "waiting_user",
      waitingReason: { kind: "review_artifact", artifactId: artifact.id },
    };

    session = applyEvent(session, {
      type: "user_rejected_artifact",
      payload: { artifactId: artifact.id, reason: "不如原本的上中下样式" },
    }).session;

    session = {
      ...session,
      phase: "waiting_user",
      waitingReason: { kind: "review_artifact", artifactId: artifact.id },
      pendingArtifactId: artifact.id,
    };

    const second = applyEvent(session, {
      type: "user_rejected_artifact",
      payload: { artifactId: artifact.id, reason: "状态很短，放到上面就行了" },
    });

    expect(second.session.slots["用户.修订说明"]).toContain("不如原本的上中下样式");
    expect(second.session.slots["用户.修订说明"]).toContain("状态很短，放到上面就行了");
  });

  it("accepting a design-step artifact clears stale revision notes", () => {
    let session = createSession("default");
    const artifact = createArtifact({
      workerId: "design-step",
      outputTags: ["设计.监控栏"],
    });
    session = {
      ...session,
      artifacts: [artifact],
      pendingArtifactId: artifact.id,
      phase: "waiting_user",
      waitingReason: { kind: "review_artifact", artifactId: artifact.id },
      slots: {
        "用户.修订说明": "上一步的意见",
        revisionInstruction: "上一步的意见",
        "用户.worker答复": "监控对象是剩余食物",
      },
    };

    session = applyEvent(session, {
      type: "user_accepted_artifact",
      payload: { artifactId: artifact.id },
    }).session;

    expect(session.slots["用户.修订说明"]).toBeUndefined();
    expect(session.slots.revisionInstruction).toBeUndefined();
    expect(session.slots["用户.worker答复"]).toBeUndefined();
    expect(session.slots["用户.需求"]).toContain("监控对象是剩余食物");
    expect(session.slots["用户.需求"]).toContain("上一步的意见");
  });

  it("failed revision rerun falls back to reviewing the previous artifact", () => {
    let session = createSession("default");
    const artifact = {
      ...createArtifact({
        workerId: "design-step",
        stepId: "step-aesthetics",
        outputTags: ["设计.美学纲领"],
      }),
      status: "revision_requested" as const,
    };
    session = {
      ...session,
      artifacts: [artifact],
      currentWorkerId: "design-step",
      currentStepId: "step-aesthetics",
      phase: "running",
      slots: { revisionTargetArtifactId: artifact.id },
    };

    const result = applyEvent(session, {
      type: "worker_revision_produced_nothing",
      payload: {
        artifactId: artifact.id,
        questions: ["这一步还没写出可验收的产物。请再补一点你最在意的体验。"],
      },
    });

    expect(result.session.phase).toBe("waiting_user");
    expect(result.session.waitingReason?.kind).toBe("review_artifact");
    expect(result.session.pendingArtifactId).toBe(artifact.id);
    expect(result.session.artifacts[0]?.status).toBe("under_review");
    // 重试题降级为可选追问，用户仍可直接接受上一版
    const reason = result.session.waitingReason;
    expect(reason?.kind === "review_artifact" && reason.questions?.[0]?.required).toBe(
      false,
    );
    // 退回后不再是重跑目标，避免下一步无产物时又被挂回来
    expect(result.session.slots.revisionTargetArtifactId).toBeUndefined();
  });

  it("rejecting artifact without feedback waits for revision instruction", () => {
    let session = createSession("default");
    const artifact = createArtifact({
      workerId: "design-step",
      outputTags: ["设计.美学纲领"],
    });
    session = {
      ...session,
      artifacts: [artifact],
      pendingArtifactId: artifact.id,
      phase: "waiting_user",
      waitingReason: { kind: "review_artifact", artifactId: artifact.id },
    };

    const rejected = applyEvent(session, {
      type: "user_rejected_artifact",
      payload: { artifactId: artifact.id },
    });
    expect(rejected.session.waitingReason?.kind).toBe("revision");
    expect(rejected.session.artifacts[0]?.status).toBe("rejected");

    const resumed = applyEvent(rejected.session, {
      type: "user_submitted_input",
      payload: { text: "加一点冲突感" },
    });
    expect(resumed.session.phase).toBe("running");
    expect(resumed.session.slots["用户.修订说明"]).toBe("加一点冲突感");
    expect(resumed.effects).toEqual([
      { type: "run_worker", workerId: "design-step" },
    ]);
  });

  it("accepting design-step worker set proposes next step instead of invoking main agent", () => {
    let session = createSession("default");
    const artifact = createArtifact({
      workerId: "design-step",
      stepId: "细化终稿",
      outputTags: ["设计.worker集"],
    });
    session = {
      ...session,
      artifacts: [artifact],
      pendingArtifactId: artifact.id,
      phase: "waiting_user",
      waitingReason: { kind: "review_artifact", artifactId: artifact.id },
    };

    const accepted = applyEvent(session, {
      type: "user_accepted_artifact",
      payload: { artifactId: artifact.id },
    });
    expect(accepted.session.slots.designInstanceReady).toBe(true);
    expect(accepted.session.phase).toBe("running");
    expect(accepted.session.waitingReason).toBeUndefined();
    expect(accepted.effects).toEqual([{ type: "propose_next_creation_step" }]);
    expect(accepted.effects.some((e) => e.type === "invoke_main_agent")).toBe(
      false,
    );
  });

  it("accepting design-step proposes next step instead of invoking main agent", () => {
    let session = createSession("default");
    const artifact = createArtifact({
      workerId: "design-step",
      stepId: "美学纲领与交互范式",
      outputTags: ["设计.美学纲领与交互范式"],
    });
    session = {
      ...session,
      artifacts: [artifact],
      pendingArtifactId: artifact.id,
      phase: "waiting_user",
      waitingReason: { kind: "review_artifact", artifactId: artifact.id },
    };

    const accepted = applyEvent(session, {
      type: "user_accepted_artifact",
      payload: { artifactId: artifact.id },
    });
    expect(accepted.session.phase).toBe("running");
    expect(accepted.effects).toEqual([{ type: "propose_next_creation_step" }]);
    expect(accepted.effects.some((e) => e.type === "invoke_main_agent")).toBe(
      false,
    );
  });

  it("legacy next_intent still proposes next step and records intent", () => {
    let session = createSession("default");
    session = {
      ...session,
      phase: "waiting_user",
      waitingReason: { kind: "next_intent", afterWorkerId: "design-step" },
    };

    const continued = applyEvent(session, {
      type: "user_submitted_input",
      payload: { text: "接下来写怪物生成规则" },
    });
    expect(continued.session.phase).toBe("running");
    expect(continued.session.slots["用户.下一步意向"]).toBe(
      "接下来写怪物生成规则",
    );
    expect(continued.effects).toEqual([
      { type: "propose_next_creation_step" },
    ]);
  });

  it("accepting opening-setup seals creation instead of next_intent", () => {
    let session = createSession("default");
    const artifact = createArtifact({
      workerId: "design-step",
      stepId: "开场白与开场变量",
      outputTags: ["设计.开场白与开场变量"],
    });
    session = {
      ...session,
      artifacts: [artifact],
      pendingArtifactId: artifact.id,
      phase: "waiting_user",
      waitingReason: { kind: "review_artifact", artifactId: artifact.id },
    };

    const accepted = applyEvent(session, {
      type: "user_accepted_artifact",
      payload: { artifactId: artifact.id },
    });
    expect(accepted.session.waitingReason?.kind).toBe("input");
    expect(accepted.session.waitingReason).toMatchObject({
      kind: "input",
    });
    expect(accepted.effects).toEqual([{ type: "seal_creation_opening" }]);
    expect(
      accepted.effects.some((e) => e.type === "invoke_main_agent"),
    ).toBe(false);
  });

  it("accepting opening-generator also seals creation", () => {
    let session = createSession("default");
    const artifact = createArtifact({
      workerId: "opening-generator",
      outputTags: ["输出.开场白", "运行.初始变量"],
    });
    session = {
      ...session,
      artifacts: [artifact],
      pendingArtifactId: artifact.id,
      phase: "waiting_user",
      waitingReason: { kind: "review_artifact", artifactId: artifact.id },
    };

    const accepted = applyEvent(session, {
      type: "user_accepted_artifact",
      payload: { artifactId: artifact.id },
    });
    expect(accepted.session.waitingReason?.kind).toBe("input");
    expect(accepted.effects).toEqual([{ type: "seal_creation_opening" }]);
  });

  it("sealed creation still blocks input until play", () => {
    let session = createSession("default");
    session = {
      ...session,
      phase: "waiting_user",
      waitingReason: { kind: "input" },
      slots: { creationSealedByOpening: true, designInstanceReady: true },
    };
    const blocked = applyEvent(session, {
      type: "user_submitted_input",
      payload: { text: "我买金首饰" },
    });
    expect(blocked.effects).toEqual([
      { type: "emit_message", message: "创作已收口并保存。请切换到「游玩」开始。" },
    ]);
    expect(blocked.effects.some((e) => e.type === "run_play_turn")).toBe(false);
  });

  it("play input starts a play turn even after opening seal", () => {
    let session = createSession("default");
    session = {
      ...session,
      phase: "waiting_user",
      waitingReason: { kind: "input" },
      slots: {
        creationSealedByOpening: true,
        designInstanceReady: true,
        uiLifecycleStage: "play",
      },
    };
    const play = applyEvent(session, {
      type: "user_submitted_input",
      payload: { text: "我买金首饰" },
    });
    expect(play.session.phase).toBe("running");
    expect(play.effects).toEqual([{ type: "run_play_turn" }]);
  });

  it("accepting a play worker continues the play pipeline", () => {
    let session = createSession("default");
    const artifact = createArtifact({
      workerId: "narrator",
      outputTags: ["输出.用户展示"],
    });
    session = {
      ...session,
      artifacts: [artifact],
      pendingArtifactId: artifact.id,
      phase: "waiting_user",
      waitingReason: { kind: "review_artifact", artifactId: artifact.id },
      slots: {
        designInstanceReady: true,
        uiLifecycleStage: "play",
        playLayerActive: true,
      },
    };
    const accepted = applyEvent(session, {
      type: "user_accepted_artifact",
      payload: { artifactId: artifact.id },
    });
    expect(accepted.effects).toEqual([{ type: "continue_play_turn" }]);
    expect(accepted.effects.some((e) => e.type === "invoke_main_agent")).toBe(
      false,
    );
    expect(accepted.effects.some((e) => e.type === "propose_next_creation_step")).toBe(
      false,
    );
  });

  it("rejecting the next step goes back to design-flow instead of the main agent", () => {
    let session = createSession("default");
    const decision = {
      id: "d1",
      action: "run_worker" as const,
      reason: "下一步开场白",
      workerId: "design-step",
      requiresApproval: true,
      statePatchAllowed: false as const,
    };
    session = {
      ...session,
      phase: "waiting_user",
      waitingReason: { kind: "approve_step", decisionId: decision.id },
      pendingDecision: decision,
    };

    const rejected = applyEvent(session, {
      type: "user_rejected_next_step",
      payload: { decisionId: decision.id, reason: "还没做 NPC" },
    });
    expect(rejected.session.phase).toBe("running");
    expect(rejected.session.slots["用户.下一步意向"]).toBe("还没做 NPC");
    expect(rejected.session.pendingDecision).toBeUndefined();
    expect(rejected.effects).toEqual([
      { type: "unseal_creation_opening" },
      { type: "run_worker", workerId: "design-flow" },
    ]);
    expect(rejected.effects.some((e) => e.type === "invoke_main_agent")).toBe(
      false,
    );
  });

  it("replan from opening review runs design-flow without revising the opening", () => {
    let session = createSession("default");
    const artifact = createArtifact({
      workerId: "design-step",
      stepId: "开场白与开场变量",
      outputTags: ["设计.开场白与开场变量"],
    });
    session = {
      ...session,
      artifacts: [artifact],
      pendingArtifactId: artifact.id,
      phase: "waiting_user",
      waitingReason: { kind: "review_artifact", artifactId: artifact.id },
      slots: { creationSealedByOpening: true },
    };

    const replanned = applyEvent(session, {
      type: "user_requested_flow_replan",
      payload: { reason: "漏了开局 NPC" },
    });
    expect(replanned.session.phase).toBe("running");
    expect(replanned.session.pendingArtifactId).toBeUndefined();
    expect(replanned.session.slots.creationSealedByOpening).toBeUndefined();
    expect(replanned.session.artifacts[0]?.status).toBe("rejected");
    expect(replanned.session.slots["用户.修订说明"]).toBe("漏了开局 NPC");
    expect(replanned.effects).toEqual([
      { type: "unseal_creation_opening" },
      { type: "run_worker", workerId: "design-flow" },
    ]);
  });

  it("awaits pick on the layered graph and starts the clicked step", () => {
    let session = createSession("default");
    session = {
      ...session,
      phase: "running",
    };
    const awaited = applyEvent(session, {
      type: "creation_step_pick_awaited",
      payload: {},
    });
    expect(awaited.session.phase).toBe("waiting_user");
    expect(awaited.session.waitingReason?.kind).toBe("pick_creation_step");
    expect(awaited.session.currentWorkerId).toBeUndefined();

    const picked = applyEvent(awaited.session, {
      type: "user_picked_creation_step",
      payload: { stepId: "生成规则" },
    });
    expect(picked.session.phase).toBe("running");
    expect(picked.session.currentWorkerId).toBe("design-step");
    expect(picked.effects).toEqual([
      { type: "run_worker", workerId: "design-step" },
    ]);
  });

  it("leaving a creation step returns to the pick graph", () => {
    let session = createSession("default");
    session = {
      ...session,
      phase: "waiting_user",
      waitingReason: {
        kind: "worker_questions",
        workerId: "design-step",
        questions: [{ id: "module-opening", prompt: "引导" }],
      },
      currentWorkerId: "design-step",
      currentStepId: "生成规则#1",
    };
    const left = applyEvent(session, {
      type: "user_left_creation_step",
      payload: {},
    });
    expect(left.session.phase).toBe("waiting_user");
    expect(left.session.waitingReason?.kind).toBe("pick_creation_step");
    expect(left.session.currentWorkerId).toBeUndefined();
    expect(left.session.currentStepId).toBeUndefined();
    expect(left.session.resumeContext).toBeUndefined();
    expect(left.effects).toEqual([]);
  });

  it("replan from the pick graph runs design-flow", () => {
    let session = createSession("default");
    session = {
      ...session,
      phase: "waiting_user",
      waitingReason: { kind: "pick_creation_step" },
    };
    const replanned = applyEvent(session, {
      type: "user_requested_flow_replan",
      payload: { reason: "补舞台骨架" },
    });
    expect(replanned.session.phase).toBe("running");
    expect(replanned.session.slots["用户.下一步意向"]).toBe("补舞台骨架");
    expect(replanned.effects).toEqual([
      { type: "unseal_creation_opening" },
      { type: "run_worker", workerId: "design-flow" },
    ]);
  });

  it("design-flow without confirmation proposes the pick graph", () => {
    let session = createSession("default");
    session = {
      ...session,
      phase: "running",
      acceptanceMode: "no_confirmation",
    };
    const artifact = createArtifact({
      workerId: "design-flow",
      outputTags: ["设计.创作流程"],
    });
    session = { ...session, artifacts: [artifact] };
    const completed = applyEvent(session, {
      type: "worker_completed",
      payload: { artifactId: artifact.id },
    });
    expect(completed.session.artifacts[0]?.status).toBe("accepted");
    expect(completed.session.pendingArtifactId).toBeUndefined();
    expect(completed.effects).toEqual([
      { type: "propose_next_creation_step" },
    ]);
  });
});
