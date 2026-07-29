import type { ActiveSkillSnapshot } from "../types/runtime.js";
import type { IntakeFieldDef } from "../types/intake.js";
import type { ParsedSkill } from "./types.js";
import { intakeFieldsFromInquiry } from "../intake/intake.js";

export function toActiveSkillSnapshot(skill: ParsedSkill): ActiveSkillSnapshot {
  const intakeFields: IntakeFieldDef[] = intakeFieldsFromInquiry(skill.startupInquiry);
  return {
    name: skill.name,
    description: skill.description,
    category: skill.category,
    bookKind: skill.bookKind,
    defaultFlowId: skill.defaultFlowId,
    suggestedWorkers: skill.suggestedWorkers,
    startupMode: skill.startupMode,
    uiPrompt: skill.uiPrompt,
    startupPrompt: skill.startupInquiry.prompt,
    startupTargetKey: skill.startupInquiry.targetKey,
    intakeFields,
  };
}
