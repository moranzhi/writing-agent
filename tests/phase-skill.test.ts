import { describe, expect, it } from "vitest";
import {
  applyEvent,
  canApplyEvent,
  createSession,
} from "../src/runtime/phase-machine.js";
import { toActiveSkillSnapshot } from "../src/skills/snapshot.js";
import { loadSkill, listSkills, listWorkerSkills, loadWorkerSkill } from "../src/skills/loader.js";

const mockSkills = [
  { name: "world-simulator", description: "默认能力库", category: "dialogue" },
];

describe("skill loader", () => {
  it("lists only world-simulator", async () => {
    const skills = await listSkills();
    expect(skills.map((s) => s.name)).toEqual(["world-simulator"]);
  });

  it("loads world-simulator pack and design step skills", async () => {
    const skill = await loadSkill("world-simulator");
    expect(skill.name).toBe("world-simulator");
    expect(skill.path).toBe("dialogue/world-simulator/orchestrator.md");
    expect(skill.skillPackRoot).toBe("dialogue/world-simulator");

    const workers = await listWorkerSkills("world-simulator");
    expect(workers.map((w) => w.id).sort()).toEqual([
      "design-flow",
      "design-step",
      "opening-generator",
    ]);
    const flow = await loadWorkerSkill("world-simulator", "design-flow");
    expect(flow.outputTags).toContain("设计.创作流程");
    expect(flow.name).toContain("流程");

    const step = await loadWorkerSkill("world-simulator", "design-step");
    expect(step.id).toBe("design-step");

    const opening = await loadWorkerSkill("world-simulator", "opening-generator");
    expect(opening.outputTags[0]).toBe("输出.开场白");
    expect(opening.body).toContain("开场白");
    expect(opening.body).toContain("填表工具");
    expect(opening.body).toContain("普通大学生");
  });
});

describe("phase machine with world-simulator", () => {
  it("session_started agent-first awaits user input", async () => {
    const skill = await loadSkill("world-simulator");
    const snap = toActiveSkillSnapshot(skill);
    expect(snap.startupMode).toBe("agent-first");

    const result = applyEvent(createSession("default"), {
      type: "session_started",
      payload: {
        presetId: "default",
        availableSkills: mockSkills,
        initialSkill: snap,
      },
    });
    expect(result.session.phase).toBe("waiting_user");
    expect(result.session.waitingReason?.kind).toBe("input");
  });

  it("first user input invokes main agent", async () => {
    const skill = await loadSkill("world-simulator");
    const snap = toActiveSkillSnapshot(skill);

    const session = applyEvent(createSession("default"), {
      type: "session_started",
      payload: { presetId: "default", availableSkills: mockSkills, initialSkill: snap },
    }).session;

    const result = applyEvent(session, {
      type: "user_submitted_input",
      payload: { text: "我要你塑造一个网恋对象和我对话" },
    });
    expect(result.session.phase).toBe("running");
    expect(result.session.slots["用户.需求"]).toContain("网恋");
    expect(result.effects.some((e) => e.type === "invoke_main_agent")).toBe(true);
  });

  it("legacy session_started without initialSkill enters skill_selection", () => {
    const result = applyEvent(createSession("default"), {
      type: "session_started",
      payload: { presetId: "default", availableSkills: mockSkills },
    });
    expect(result.session.waitingReason?.kind).toBe("skill_selection");
  });

  it("rejects input before skill selected", () => {
    const session = applyEvent(createSession("default"), {
      type: "session_started",
      payload: { presetId: "default", availableSkills: mockSkills },
    }).session;
    expect(canApplyEvent(session, { type: "user_submitted_input", payload: { text: "x" } })).toBe(
      false,
    );
  });
});

describe("phase runtime with world-simulator", () => {
  it("starts default orchestrator and accepts stub design-flow", async () => {
    const { PhaseRuntime, createDecision } = await import("../src/runtime/phase-runtime.js");
    const runtime = new PhaseRuntime({ autoStubWorker: true });
    await runtime.start();
    expect(runtime.getActiveSkill()?.name).toBe("world-simulator");

    await runtime.submitInput("西幻升级交互，世界推着走");
    const decision = createDecision({
      action: "run_worker",
      reason: "编排创作流程",
      workerId: "design-flow",
      requiresApproval: false,
    });
    await runtime.submitDecision(decision);
    expect(runtime.getSession().artifacts.length).toBeGreaterThan(0);
  });
});
