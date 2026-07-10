import { describe, expect, it } from "vitest";
import { createDecision } from "../src/runtime/orchestrator.js";
import {
  applyEvent,
  canApplyEvent,
  createArtifact,
  createSession,
} from "../src/runtime/phase-machine.js";
import { loadSkill } from "../src/skills/loader.js";
import { toActiveSkillSnapshot } from "../src/skills/snapshot.js";

const mockSkills = [{ name: "basic", description: "基础", category: "novel" }];

describe("phase machine", () => {
  it("runs worker loop after skill and startup input", async () => {
    const { loadSkill } = await import("../src/skills/loader.js");
    const { toActiveSkillSnapshot } = await import("../src/skills/snapshot.js");
    const snap = toActiveSkillSnapshot(await loadSkill("basic"));

    let session = createSession("default");
    session = applyEvent(session, {
      type: "session_started",
      payload: { presetId: "default", availableSkills: mockSkills },
    }).session;
    session = applyEvent(session, {
      type: "skill_selected",
      payload: { skill: snap },
    }).session;
    const values: Record<string, string> = {};
    for (const f of snap.intakeFields) {
      values[f.id] = "科幻短篇，第一人称";
    }
    session = applyEvent(session, {
      type: "user_submitted_input",
      payload: { text: "科幻短篇，第一人称", intakeValues: values },
    }).session;
    expect(session.waitingReason?.kind).toBe("intake");
    session = applyEvent(session, {
      type: "user_confirmed_intake",
      payload: {},
    }).session;
    expect(session.phase).toBe("running");
    expect(session.slots["book.brief"]).toBeTruthy();

    const decision = createDecision({
      action: "run_worker",
      reason: "生成大纲",
      workerId: "outline-worker",
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
      payload: { workerId: "outline-worker", acceptanceMode: "user_confirmed" },
    }).session;

    const artifact = createArtifact({
      workerId: "outline-worker",
      outputTags: ["outline.draft"],
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
    expect(session.phase).toBe("running");

    session = applyEvent(session, { type: "flow_completed", payload: {} }).session;
    expect(session.phase).toBe("done");
  });

  it("rejects illegal events from idle", () => {
    const session = createSession("default");
    expect(canApplyEvent(session, { type: "user_submitted_input", payload: { text: "x" } })).toBe(
      false,
    );
    const result = applyEvent(session, {
      type: "user_submitted_input",
      payload: { text: "x" },
    });
    expect(result.session.phase).toBe("error");
  });

  it("merges follow-up input after intake confirm via ask_user", async () => {
    const { createDecision } = await import("../src/runtime/orchestrator.js");
    const snap = toActiveSkillSnapshot(await loadSkill("roleplay-game-theory"));

    let session = createSession("default");
    session = applyEvent(session, {
      type: "session_started",
      payload: { presetId: "default", availableSkills: mockSkills },
    }).session;
    session = applyEvent(session, {
      type: "skill_selected",
      payload: { skill: snap },
    }).session;

    const fields = snap.intakeFields;
    const values: Record<string, string> = {};
    for (const f of fields.filter((x) => x.required)) {
      values[f.id] = "已填";
    }
    session = applyEvent(session, {
      type: "user_submitted_input",
      payload: { text: "首次", intakeValues: values },
    }).session;
    session = applyEvent(session, {
      type: "user_confirmed_intake",
      payload: {},
    }).session;
    expect(session.slots.startupCompleted).toBe(true);

    session = applyEvent(session, {
      type: "main_agent_decision_created",
      payload: {
        decision: createDecision({
          action: "ask_user",
          reason: "输出偏好？",
        }),
      },
    }).session;
    expect(session.waitingReason?.kind).toBe("input");

    session = applyEvent(session, {
      type: "user_submitted_input",
      payload: { text: "需要思考标签，带场景描写" },
    }).session;
    const demand = String(session.slots["用户.博弈需求"]);
    expect(demand).toContain("需要思考标签");
  });

  it("emits one follow-up when roleplay intake required fields incomplete", async () => {
    const snap = toActiveSkillSnapshot(await loadSkill("roleplay-game-theory"));
    let session = createSession("default");
    session = applyEvent(session, {
      type: "session_started",
      payload: { presetId: "default", availableSkills: mockSkills },
    }).session;
    session = applyEvent(session, {
      type: "skill_selected",
      payload: { skill: snap },
    }).session;
    const scenarioField = snap.intakeFields.find((f) => f.label.includes("情境"));
    expect(scenarioField).toBeDefined();
    const result = applyEvent(session, {
      type: "user_submitted_input",
      payload: {
        text: "德州扑克",
        intakeValues: { [scenarioField!.id]: "德州扑克" },
      },
    });
    expect(result.effects.some((e) => e.type === "emit_message")).toBe(true);
    const msg = result.effects.find((e) => e.type === "emit_message");
    expect(msg && "message" in msg && msg.message).toContain("还缺以下必要项");
    expect(result.session.slots.intakeFollowUpSent).toBe(true);
  });
});
