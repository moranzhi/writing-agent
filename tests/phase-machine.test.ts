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
    session = applyEvent(session, {
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
    }).session;

    expect(session.waitingReason?.kind).toBe("review_artifact");
    if (session.waitingReason?.kind !== "review_artifact") return;
    expect(session.waitingReason.questions?.length).toBe(1);
    expect(session.waitingReason.questions?.[0]?.required).toBe(false);

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
});
