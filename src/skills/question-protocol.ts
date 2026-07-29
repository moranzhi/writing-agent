/**
 * Worker / Agent 结构化追问协议。
 * UI：左右分页选项卡；经 composer 发送，payload 须含问+答（可附自由补充）。
 */
import type {
  QuestionAnswer,
  QuestionItem,
  QuestionOption,
} from "../types/questions.js";

export type { QuestionAnswer, QuestionItem, QuestionOption };

function letterId(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

/** 把 askUser 原始值规范成 QuestionItem[]（兼容纯 string[]） */
export function normalizeQuestions(raw: unknown): QuestionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: QuestionItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item === "string") {
      const prompt = item.trim();
      if (!prompt) continue;
      out.push({
        id: `q${i + 1}`,
        prompt,
        allowOther: true,
        required: true,
      });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const prompt =
      typeof row.prompt === "string"
        ? row.prompt.trim()
        : typeof row.question === "string"
          ? row.question.trim()
          : typeof row.text === "string"
            ? row.text.trim()
            : "";
    if (!prompt) continue;
    const id =
      typeof row.id === "string" && row.id.trim()
        ? row.id.trim()
        : `q${i + 1}`;
    let options: QuestionOption[] | undefined;
    if (Array.isArray(row.options)) {
      options = [];
      for (let j = 0; j < row.options.length; j++) {
        const opt = row.options[j];
        if (typeof opt === "string") {
          const label = opt.trim();
          if (!label) continue;
          options.push({ id: letterId(j), label, editable: true });
          continue;
        }
        if (!opt || typeof opt !== "object" || Array.isArray(opt)) continue;
        const o = opt as Record<string, unknown>;
        const label =
          typeof o.label === "string"
            ? o.label.trim()
            : typeof o.text === "string"
              ? o.text.trim()
              : "";
        if (!label) continue;
        options.push({
          id:
            typeof o.id === "string" && o.id.trim()
              ? o.id.trim()
              : letterId(j),
          label,
          editable: o.editable === false ? false : true,
        });
      }
      if (options.length === 0) options = undefined;
    }
    out.push({
      id,
      prompt,
      options,
      allowOther: row.allowOther === false ? false : true,
      required: row.required === false ? false : true,
    });
  }
  return out;
}

/** 发给 AI：必须含问题与答案；可选自由补充 */
export function formatQuestionAnswersForAi(
  questions: QuestionItem[],
  answers: QuestionAnswer[],
  note?: string,
): string {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const lines: string[] = ["【追问作答】"];
  for (const q of questions) {
    const a = byId.get(q.id);
    const answer = a?.text?.trim() || "（未答）";
    lines.push(`问：${q.prompt}`);
    lines.push(`答：${answer}`);
    lines.push("");
  }
  const trimmedNote = note?.trim();
  if (trimmedNote) {
    lines.push("【补充】");
    lines.push(trimmedNote);
  }
  return lines.join("\n").trim();
}

/** 气泡摘要：答句 + 可选补充 */
export function formatQuestionAnswersForDisplay(
  questions: QuestionItem[],
  answers: QuestionAnswer[],
  note?: string,
): string {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const parts: string[] = [];
  for (const q of questions) {
    const a = byId.get(q.id);
    if (!a?.text?.trim()) continue;
    parts.push(a.text.trim());
  }
  const trimmedNote = note?.trim();
  if (trimmedNote) parts.push(trimmedNote);
  return parts.length ? parts.join("\n") : "（已提交追问作答）";
}

export function questionPrompts(questions: QuestionItem[]): string[] {
  return questions.map((q) => q.prompt).filter(Boolean);
}
