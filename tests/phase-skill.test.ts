import { describe, expect, it } from "vitest";
import { loadSkill, listSkills } from "../src/skills/loader.js";
import { toActiveSkillSnapshot } from "../src/skills/snapshot.js";
import { createDecision } from "../src/runtime/phase-runtime.js";
import {
  applyEvent,
  canApplyEvent,
  createSession,
} from "../src/runtime/phase-machine.js";

const mockSkills = [
  { name: "basic", description: "基础小说", category: "novel" },
];

describe("skill loader", () => {
  it("lists basic skill", async () => {
    const skills = await listSkills();
    expect(skills.some((s) => s.name === "basic")).toBe(true);
  });

  it("loads startup inquiry from SKILL.md", async () => {
    const skill = await loadSkill("basic");
    expect(skill.startupInquiry.targetKey).toBe("book.brief");
    expect(skill.startupInquiry.prompt).toContain("基础小说创作");
    const snap = toActiveSkillSnapshot(skill);
    expect(snap.startupPrompt).toBe(skill.startupInquiry.prompt);
  });

  it("loads weird-rules-short skill pack", async () => {
    const skill = await loadSkill("weird-rules-short");
    expect(skill.name).toBe("weird-rules-short");
    expect(skill.path).toBe("novel/weird-rules-short/orchestrator.md");
    expect(skill.skillPackRoot).toBe("novel/weird-rules-short");
    expect(skill.bookKind).toBe("novel");
    expect(skill.tags).toContain("weird_rules");
    expect(skill.suggestedWorkers).toEqual(["write-rules", "review-infer", "review-author"]);
    expect(skill.sharedContextPath).toBe("shared-context.md");
    expect(skill.startupInquiry.prompt).toContain("规则怪谈");
    expect(skill.startupInquiry.prompt).not.toContain("叙事人称");
  });

  it("loads roleplay-game-theory skill pack (instantiate)", async () => {
    const skill = await loadSkill("roleplay-game-theory");
    expect(skill.name).toBe("roleplay-game-theory");
    expect(skill.path).toBe("dialogue/roleplay-game-theory/orchestrator.md");
    expect(skill.bookKind).toBe("dialogue");
    expect(skill.suggestedWorkers).toEqual(["setup-scenario", "world-engine", "role-decide", "present-round"]);
    expect(skill.startupInquiry.targetKey).toBe("用户.博弈需求");
    expect(skill.startupInquiry.prompt).toContain("角色扮演博弈");
  });

  it("loads worker skills from skill pack", async () => {
    const {
      loadWorkerSkill,
      loadWorkerSkillWithContext,
      loadSkillSharedContext,
      listWorkerSkills,
    } = await import("../src/skills/loader.js");
    const workers = await listWorkerSkills("weird-rules-short");
    expect(workers.map((w) => w.id).sort()).toEqual([
      "review-author",
      "review-infer",
      "write-rules",
    ]);

    const writeRules = await loadWorkerSkill("weird-rules-short", "write-rules");
    expect(writeRules.outputTags).toContain("rules.draft");
    expect(writeRules.body).toContain("shared-context");

    const reviewInfer = await loadWorkerSkill("weird-rules-short", "review-infer");
    expect(reviewInfer.outputTags).toContain("review.infer.notes");
    expect(reviewInfer.body).toContain("verdict:");

    const reviewAuthor = await loadWorkerSkill("weird-rules-short", "review-author");
    expect(reviewAuthor.outputTags).toContain("review.author.notes");
    expect(reviewAuthor.body).toContain("表面矛盾");

    const shared = await loadSkillSharedContext("weird-rules-short");
    expect(shared).toContain("表面矛盾 ≠ 逻辑矛盾");

    const withCtx = await loadWorkerSkillWithContext("weird-rules-short", "write-rules");
    expect(withCtx.sharedContext).toContain("盲人摸象");
    expect(withCtx.promptBody).toContain("固定创作上下文");
  });

  it("loads roleplay role-decide with thinking/action output tags", async () => {
    const { loadWorkerSkill } = await import("../src/skills/loader.js");
    const roleDecide = await loadWorkerSkill("roleplay-game-theory", "role-decide");
    expect(roleDecide.outputTags).toContain("角色.*.思考");
    expect(roleDecide.outputTags).toContain("角色.*.行动");
    expect(roleDecide.body).toContain("仅用户可见");
  });

  it("loads basic skill pack", async () => {
    const skill = await loadSkill("basic");
    expect(skill.path).toBe("novel/basic/orchestrator.md");
    expect(skill.skillPackRoot).toBe("novel/basic");
    expect(skill.suggestedWorkers).toEqual(["outline"]);
  });

  it("lists only registered skills", async () => {
    const skills = await listSkills();
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["basic", "roleplay-game-theory", "weird-rules-short"]);
  });
});

describe("phase machine with skill", () => {
  it("starts with skill_selection", () => {
    let session = createSession("default");
    const result = applyEvent(session, {
      type: "session_started",
      payload: { presetId: "default", availableSkills: mockSkills },
    });
    expect(result.session.phase).toBe("waiting_user");
    expect(result.session.waitingReason?.kind).toBe("skill_selection");
  });

  it("skill_selected shows startup prompt from skill", async () => {
    const skill = await loadSkill("basic");
    const snap = toActiveSkillSnapshot(skill);

    let session = applyEvent(createSession("default"), {
      type: "session_started",
      payload: { presetId: "default", availableSkills: mockSkills },
    }).session;

    const selected = applyEvent(session, {
      type: "skill_selected",
      payload: { skill: snap },
    });
    expect(selected.session.waitingReason?.kind).toBe("input");
    expect(selected.session.slots.activeSkill).toBeDefined();
    expect((selected.session.slots.activeSkill as { name: string }).name).toBe("basic");
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

describe("phase runtime with skill", () => {
  it("runs full loop with basic skill", async () => {
    const { PhaseRuntime, runMinimalClosedLoop } = await import("../src/runtime/phase-runtime.js");
    const session = await runMinimalClosedLoop(new PhaseRuntime({ autoStubWorker: true }));
    expect(session.phase).toBe("done");
    expect(session.slots.startupCompleted).toBe(true);
    expect(session.slots["book.brief"]).toContain("科幻");
  });
});
