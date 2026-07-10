import type {
  IntakeFieldDef,
  IntakeFieldStatus,
  IntakeProgress,
} from "../types/intake.js";
import type { StartupInquiry } from "../skills/types.js";

export function intakeFieldId(
  label: string,
  index: number,
  required: boolean,
): string {
  const slug = label
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\*\*/g, "")
    .replace(/至少\s*\d+\s*个/g, "")
    .trim()
    .slice(0, 28)
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${required ? "r" : "o"}-${index}-${slug || "field"}`;
}

export function intakeFieldsFromInquiry(inquiry: StartupInquiry): IntakeFieldDef[] {
  const required = inquiry.requiredFields.map((label, i) => ({
    id: intakeFieldId(label, i, true),
    label,
    required: true as const,
  }));
  const optional = (inquiry.optionalFields ?? []).map((label, i) => ({
    id: intakeFieldId(label, i, false),
    label,
    required: false as const,
  }));
  return [...required, ...optional];
}

export function readIntakeValues(
  slots: Record<string, unknown>,
): Record<string, string> {
  const raw = slots.intakeValues;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

export function buildIntakeProgress(
  fields: IntakeFieldDef[],
  values: Record<string, string>,
): IntakeProgress {
  const items: IntakeFieldStatus[] = fields.map((f) => {
    const value = values[f.id]?.trim();
    return {
      id: f.id,
      label: f.label,
      required: f.required,
      value: value || undefined,
      filled: Boolean(value),
    };
  });
  const required = items.filter((i) => i.required);
  const optional = items.filter((i) => !i.required);
  return {
    fields: items,
    requiredTotal: required.length,
    requiredFilled: required.filter((i) => i.filled).length,
    optionalTotal: optional.length,
    optionalFilled: optional.filter((i) => i.filled).length,
    ready: required.length > 0 ? required.every((i) => i.filled) : items.some((i) => i.filled),
  };
}

/** 将各字段拼成写入黑板 / slots 的需求文档 */
export function synthesizeDemandText(
  fields: IntakeFieldDef[],
  values: Record<string, string>,
): string {
  const parts: string[] = [];
  for (const f of fields) {
    const v = values[f.id]?.trim();
    if (!v) continue;
    parts.push(`## ${f.label}\n${v}`);
  }
  return parts.join("\n\n");
}

/** 必要项未齐时的一次追问文案 */
export function buildIntakeFollowUpMessage(progress: IntakeProgress): string {
  const missing = progress.fields.filter((f) => f.required && !f.filled);
  if (!missing.length) return "";
  const lines = missing.map((f) => `- ${f.label}`);
  return `还缺以下必要项，请补充（可简短回答）：\n${lines.join("\n")}`;
}

/** 合并用户在启动阶段的原始输入（worker 兜底用） */
export function collectUserInputTranscript(
  slots: Record<string, unknown>,
): string {
  const parts: string[] = [];
  const userInputs = slots.userInputs;
  if (Array.isArray(userInputs)) {
    for (const entry of userInputs) {
      if (typeof entry === "string" && entry.trim()) {
        parts.push(entry.trim());
      }
    }
  }
  return parts.join("\n\n");
}

/** 无 LLM 时的启发式：优先填第一个未填必要项，并尝试关键词匹配 */
export function extractIntakeHeuristic(
  text: string,
  fields: IntakeFieldDef[],
  current: Record<string, string>,
): Record<string, string> {
  const trimmed = text.trim();
  if (!trimmed) return { ...current };

  const next = { ...current };
  const unfilledRequired = fields.filter((f) => f.required && !next[f.id]?.trim());

  for (const field of fields) {
    if (next[field.id]?.trim()) continue;
    const keywords = fieldKeywords(field.label);
    if (keywords.some((kw) => trimmed.includes(kw))) {
      next[field.id] = mergeFieldValue(next[field.id], trimmed);
    }
  }

  if (unfilledRequired.length === 1 && !next[unfilledRequired[0].id]?.trim()) {
    next[unfilledRequired[0].id] = trimmed;
  } else if (
    unfilledRequired.length > 1 &&
    !fields.some((f) => next[f.id]?.trim() && !current[f.id]?.trim())
  ) {
    next[unfilledRequired[0].id] = mergeFieldValue(next[unfilledRequired[0].id], trimmed);
  }

  return next;
}

function mergeFieldValue(existing: string | undefined, addition: string): string {
  const a = addition.trim();
  if (!existing?.trim()) return a;
  if (existing.includes(a)) return existing;
  return `${existing.trim()}\n${a}`;
}

function fieldKeywords(label: string): string[] {
  const words: string[] = [];
  if (/情境|实验|局面|框架/.test(label)) {
    words.push("情境", "实验", "囚徒", "通牒", "扑克", "博弈", "游戏");
  }
  if (/角色|参与/.test(label)) words.push("角色", "参与", "玩家", "人", "赌徒");
  if (/轮次|轮|进程|结束|破产/.test(label)) {
    words.push("轮", "单轮", "多轮", "进程", "结束", "破产", "直到");
  }
  if (/题材/.test(label)) words.push("题材", "科幻", "悬疑", "言情");
  if (/篇幅/.test(label)) words.push("篇幅", "短篇", "中篇", "长篇");
  if (/人称/.test(label)) words.push("人称", "第一", "第三");
  if (/输出|思考|描写/.test(label)) words.push("思考", "描写", "报告", "场景");
  if (/信息/.test(label)) words.push("信息", "私密", "公开");
  if (words.length === 0) words.push(label.slice(0, 4));
  return words;
}
