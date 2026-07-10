import { describe, expect, it } from "vitest";
import {
  buildIntakeFollowUpMessage,
  buildIntakeProgress,
  extractIntakeHeuristic,
  intakeFieldsFromInquiry,
  synthesizeDemandText,
} from "../src/intake/intake.js";
import { applyEvent, createSession } from "../src/runtime/phase-machine.js";
import { toActiveSkillSnapshot } from "../src/skills/snapshot.js";
import { loadSkill } from "../src/skills/loader.js";

describe("intake fields", () => {
  it("parses required and optional from roleplay skill", async () => {
    const skill = await loadSkill("roleplay-game-theory");
    const fields = intakeFieldsFromInquiry(skill.startupInquiry);
    expect(fields.filter((f) => f.required).length).toBe(3);
    expect(fields.filter((f) => !f.required).length).toBe(3);
  });

  it("marks ready when all required filled", () => {
    const fields = intakeFieldsFromInquiry({
      prompt: "p",
      targetKey: "用户.博弈需求",
      requiredFields: ["情境", "角色", "轮次"],
      optionalFields: ["输出偏好"],
    });
    const partial = buildIntakeProgress(fields, {
      [fields[0].id]: "德州扑克",
    });
    expect(partial.ready).toBe(false);
    expect(partial.requiredFilled).toBe(1);

    const full = buildIntakeProgress(fields, {
      [fields[0].id]: "德州扑克",
      [fields[1].id]: "玩家A算计，玩家B保守",
      [fields[2].id]: "单轮",
    });
    expect(full.ready).toBe(true);
  });

  it("heuristic fills scenario and rounds keywords", () => {
    const fields = intakeFieldsFromInquiry({
      prompt: "p",
      targetKey: "t",
      requiredFields: ["实验情境", "轮次模式"],
      optionalFields: [],
    });
    const values = extractIntakeHeuristic(
      "德州扑克，单轮定胜负",
      fields,
      {},
    );
    expect(Object.keys(values).length).toBeGreaterThan(0);
  });

  it("parses roleplay intake fields as 3 required + optional", async () => {
    const skill = await loadSkill("roleplay-game-theory");
    const fields = intakeFieldsFromInquiry(skill.startupInquiry);
    expect(fields.filter((f) => f.required).length).toBe(3);
    expect(fields.filter((f) => !f.required).length).toBe(3);
    expect(fields.some((f) => f.label.includes("情境"))).toBe(true);
    expect(fields.some((f) => f.label.includes("进程"))).toBe(true);
  });

  it("buildIntakeFollowUpMessage lists missing required fields", () => {
    const fields = intakeFieldsFromInquiry({
      prompt: "p",
      targetKey: "t",
      requiredFields: ["情境", "角色", "进程"],
      optionalFields: [],
    });
    const progress = buildIntakeProgress(fields, {
      [fields[0].id]: "德州扑克",
    });
    const msg = buildIntakeFollowUpMessage(progress);
    expect(msg).toContain("还缺以下必要项");
    expect(msg).toContain("角色");
    expect(msg).toContain("进程");
  });

  it("confirm intake writes structured demand tag", async () => {
    const snap = toActiveSkillSnapshot(await loadSkill("basic"));
    let session = createSession("default");
    session = applyEvent(session, {
      type: "session_started",
      payload: {
        presetId: "default",
        availableSkills: [{ name: "basic", description: "", category: "novel" }],
      },
    }).session;
    session = applyEvent(session, {
      type: "skill_selected",
      payload: { skill: snap },
    }).session;
    expect(session.waitingReason?.kind).toBe("intake");

    const fields = snap.intakeFields;
    const values: Record<string, string> = {};
    for (const f of fields) {
      values[f.id] = `值-${f.label}`;
    }
    session = applyEvent(session, {
      type: "user_submitted_input",
      payload: { text: "一次性提交", intakeValues: values },
    }).session;
    expect(session.waitingReason?.kind).toBe("intake");

    session = applyEvent(session, {
      type: "user_confirmed_intake",
      payload: {},
    }).session;
    expect(session.slots.startupCompleted).toBe(true);
    expect(String(session.slots["book.brief"])).toContain("题材");
    expect(synthesizeDemandText(fields, values)).toContain("值-题材");
  });
});
