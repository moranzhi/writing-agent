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

/** 能力默认问题（opening）：与追问卡分流，对齐美学纲领开局引导 */
export const MODULE_OPENING_QUESTION_ID = "module-opening";

/** 是否仅为能力默认问题（应走说话面 + openingGuide，不进答题卡） */
export function isModuleOpeningQuestions(
  questions: readonly QuestionItem[] | undefined | null,
): boolean {
  if (!questions?.length || questions.length !== 1) return false;
  return questions[0]?.id === MODULE_OPENING_QUESTION_ID;
}

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

const EXAMPLE_SUFFIX = /(?:\n|^)\s*示例[：:][\s\S]*$/;

/** 去掉「示例：」后比题干，避免同一问因示例行对不上 */
export function questionPromptStem(prompt: string): string {
  return prompt.replace(EXAMPLE_SUFFIX, "").replace(/\s+/g, "").trim();
}

function optionSignature(q: QuestionItem): string {
  return (q.options ?? [])
    .map((o) => o.label.trim())
    .filter((label) => label && !/^其它/.test(label))
    .join("\n");
}

export function isSameFollowUpQuestion(a: QuestionItem, b: QuestionItem): boolean {
  const sigA = optionSignature(a);
  const sigB = optionSignature(b);
  if (sigA && sigA === sigB) return true;
  const sa = questionPromptStem(a.prompt);
  const sb = questionPromptStem(b.prompt);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  return sa.includes(sb) || sb.includes(sa);
}

export const SLOT_ASKED_QUESTIONS = "askedFollowUps";

/** 已问过的题目留痕（写进 slots 供跨 worker 去重） */
export type AskedQuestionRecord = {
  prompt: string;
  options?: string[];
};

const ASKED_HISTORY_LIMIT = 40;

export function toAskedQuestionRecord(q: QuestionItem): AskedQuestionRecord {
  const options = (q.options ?? []).map((o) => o.label.trim()).filter(Boolean);
  return options.length ? { prompt: q.prompt, options } : { prompt: q.prompt };
}

export function parseAskedQuestions(raw: unknown): AskedQuestionRecord[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return null;
          }
        })()
      : null;
  if (!Array.isArray(list)) return [];
  const out: AskedQuestionRecord[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
    if (!prompt) continue;
    const options = Array.isArray(row.options)
      ? row.options.map((o) => String(o).trim()).filter(Boolean)
      : undefined;
    out.push(options?.length ? { prompt, options } : { prompt });
  }
  return out;
}

function recordAsItem(rec: AskedQuestionRecord): QuestionItem {
  return {
    id: "asked",
    prompt: rec.prompt,
    options: rec.options?.map((label, i) => ({ id: letterId(i), label })),
  };
}

export function wasAlreadyAsked(
  q: QuestionItem,
  history: readonly AskedQuestionRecord[],
): boolean {
  return history.some((rec) => isSameFollowUpQuestion(q, recordAsItem(rec)));
}

/** 过滤掉本局已经问过的题（用于可跳过的挂载追问） */
export function dropAlreadyAskedQuestions(
  questions: readonly QuestionItem[],
  history: readonly AskedQuestionRecord[],
): QuestionItem[] {
  if (!history.length) return [...questions];
  return questions.filter((q) => !wasAlreadyAsked(q, history));
}

export function appendAskedQuestions(
  history: readonly AskedQuestionRecord[],
  questions: readonly QuestionItem[],
): AskedQuestionRecord[] {
  const next = [...history];
  for (const q of questions) {
    if (wasAlreadyAsked(q, next)) continue;
    next.push(toAskedQuestionRecord(q));
  }
  return next.slice(-ASKED_HISTORY_LIMIT);
}

/**
 * askUser 与片段「追问」合并：同一问只留一份，优先带示例的片段题。
 * 仅片段没有的缺口才保留 askUser。
 */
export function mergeQuestionsPreferFragment(
  askUser: QuestionItem[] | undefined,
  fragment: QuestionItem[],
): QuestionItem[] {
  if (!fragment.length) return askUser?.length ? [...askUser] : [];
  if (!askUser?.length) return [...fragment];

  const usedAsk = new Set<number>();
  const out: QuestionItem[] = [];
  for (const fq of fragment) {
    const matchIdx = askUser.findIndex(
      (aq, i) => !usedAsk.has(i) && isSameFollowUpQuestion(aq, fq),
    );
    if (matchIdx >= 0) usedAsk.add(matchIdx);
    if (!out.some((q) => isSameFollowUpQuestion(q, fq))) out.push(fq);
  }
  for (let i = 0; i < askUser.length; i++) {
    if (usedAsk.has(i)) continue;
    const aq = askUser[i]!;
    if (out.some((q) => isSameFollowUpQuestion(q, aq))) continue;
    out.push(aq);
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
