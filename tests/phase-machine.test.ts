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

  it("accepting design-step enters next_intent instead of invoking main agent", () => {
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
    expect(accepted.session.waitingReason?.kind).toBe("next_intent");
    expect(accepted.effects.some((e) => e.type === "invoke_main_agent")).toBe(
      false,
    );

    const continued = applyEvent(accepted.session, {
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
});
