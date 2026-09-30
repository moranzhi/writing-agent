/**
 * 体验是否锚定：程序按三件打分，不读模型自评 / 完备度。
 * 权威字段是产物里的「体验锚定」；缺则回退到美学正文里对应的短句。
 */

import { tryParseJsonDoc } from "../parse/json-doc.js";

export const AESTHETICS_PRODUCT_TAG = "设计.美学纲领与交互范式";

export const EXPERIENCE_ANCHOR_RECIPE_NAMES = ["快穿短局", "数据化跑团体验"] as const;

const STANCES = ["完全代入", "部分代入", "旁观", "操控", "跟着体验"] as const;

const PLACEHOLDER =
  /^(未定|待定|无|没有|不知道|不详|未知|待补|待探|仍混沌|核心明确|稍后|以后再说|待写|…+|\.{2,}|TBD|tbd|—+|-+|null|undefined)$/i;

export type AnchorItemId = "站位" | "核心感觉" | "轮转停点";

export type ExperienceAnchorItem = {
  id: AnchorItemId;
  ok: boolean;
  /** 通过时记下程序采信的短句 */
  value?: string;
  reason: string;
};

export type ExperienceAnchorScore = {
  total: 3;
  passed: number;
  anchored: boolean;
  items: ExperienceAnchorItem[];
};

export function recipeRequiresExperienceAnchor(recipeName?: string): boolean {
  const name = recipeName?.trim() ?? "";
  return (EXPERIENCE_ANCHOR_RECIPE_NAMES as readonly string[]).includes(name);
}

export function isDictateOpeningTag(tag: string): boolean {
  const t = tag.trim();
  return (
    t === "设计.开场白" ||
    t.startsWith("设计.开场白#") ||
    t === "设计.开场白与开场变量" ||
    t === "设计.0层开场白与初态"
  );
}

export function scoreExperienceAnchor(content: string | undefined | null): ExperienceAnchorScore {
  const raw = content?.trim() ?? "";
  const doc = raw ? asRecord(tryParseJsonDoc(raw)) : undefined;
  const anchor = asRecord(doc?.体验锚定) ?? asRecord(asRecord(doc?.正文)?.体验锚定);
  const body = asRecord(doc?.正文);

  const stance = scoreStance(
    firstText(
      anchor?.站位,
      dig(body, ["设定逻辑", "参与方式", "用户与user关系"]),
      dig(body, ["交互范式", "前置配置", "用户与user关系"]),
      labeled(raw, "站位"),
    ),
  );
  const feeling = scoreFeeling(
    firstText(
      anchor?.核心感觉,
      dig(body, ["设定逻辑", "内容维度", "核心感觉", "已知"]),
      dig(body, ["美学纲领", "体验内核"]),
      labeled(raw, "核心感觉"),
    ),
  );
  const turn = scoreTurnStop(
    firstText(
      anchor?.轮转停点,
      dig(body, ["交互范式", "描写权限", "思考与抉择"]),
      labeled(raw, "轮转停点"),
    ),
  );

  const items = [stance, feeling, turn];
  const passed = items.filter((item) => item.ok).length;
  return { total: 3, passed, anchored: passed === 3, items };
}

export function formatExperienceAnchorBlock(score: ExperienceAnchorScore): string {
  const lines = [
    "## 体验锚定（程序打分，不采用模型自评）",
    `分数：${score.passed}/${score.total}`,
    `已锚定：${score.anchored ? "是" : "否"}`,
  ];
  for (const item of score.items) {
    const shown = item.ok && item.value ? `（${clip(item.value)}）` : `（${item.reason}）`;
    lines.push(`- ${item.id}：${item.ok ? "通过" : "未通过"}${shown}`);
  }
  lines.push(
    score.anchored
      ? "3/3：各能力何时用里的「已有美学」成立。开场白仍须等其它何时用已成立的能力落完。"
      : "未满 3/3：「已有美学」不成立。本轮只把缺口写进「设计.美学纲领与交互范式」的「体验锚定」（站位、核心感觉、轮转停点）。不得宣称已锚定，不得 insert 开场白。",
  );
  return lines.join("\n");
}

export function experienceAnchorToolPayload(score: ExperienceAnchorScore): {
  passed: number;
  total: 3;
  anchored: boolean;
  missing: AnchorItemId[];
} {
  return {
    passed: score.passed,
    total: 3,
    anchored: score.anchored,
    missing: score.items.filter((item) => !item.ok).map((item) => item.id),
  };
}

export function openingBlockedByAnchorMessage(score: ExperienceAnchorScore): string {
  const missing = score.items.filter((item) => !item.ok).map((item) => item.id);
  return `拒绝写入开场白：体验锚定 ${score.passed}/${score.total}，缺 ${missing.join("、") || "三件"}。先补「设计.美学纲领与交互范式」的「体验锚定」，再写开场。`;
}

function scoreStance(raw: string | undefined): ExperienceAnchorItem {
  const id: AnchorItemId = "站位";
  const t = clean(raw);
  if (!t) return { id, ok: false, reason: "空或未定" };
  if (/还是|或者/.test(t)) return { id, ok: false, reason: "还是问句，没有选定" };
  const hit = STANCES.find((s) => t === s || t.startsWith(s));
  if (hit) return { id, ok: true, value: hit, reason: "选定" };
  if (t.includes("棋子") || t.includes("观察")) {
    return { id, ok: true, value: "旁观", reason: "选定" };
  }
  return { id, ok: false, reason: "须是完全代入、部分代入、旁观、操控之一" };
}

function scoreFeeling(raw: string | undefined): ExperienceAnchorItem {
  const id: AnchorItemId = "核心感觉";
  const t = clean(raw);
  if (!t || t.length < 4) return { id, ok: false, reason: "空、未定，或短于一句" };
  return { id, ok: true, value: t, reason: "有一句" };
}

function scoreTurnStop(raw: string | undefined): ExperienceAnchorItem {
  const id: AnchorItemId = "轮转停点";
  const t = clean(raw);
  if (!t || t.length < 8) return { id, ok: false, reason: "空、未定，或没写清何时停" };
  if (!/停|等/.test(t)) return { id, ok: false, reason: "没写停笔或等用户" };
  return { id, ok: true, value: t, reason: "写了何时停" };
}

function clean(raw: string | undefined): string {
  const t = raw?.trim().replace(/\s+/g, " ") ?? "";
  if (!t || PLACEHOLDER.test(t)) return "";
  return t;
}

function firstText(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const text = textOf(candidate);
    if (text) return text;
  }
  return undefined;
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") {
    const t = value.trim();
    return t || undefined;
  }
  const row = asRecord(value);
  if (!row) return undefined;
  for (const key of ["结论", "已知", "体验内核"]) {
    if (typeof row[key] === "string" && row[key].trim()) return row[key].trim();
  }
  return undefined;
}

function labeled(raw: string, label: string): string | undefined {
  if (!raw || raw.startsWith("{") || raw.startsWith("[")) return undefined;
  const re = new RegExp(`(?:^|\\n)\\s*${label}\\s*[：:]\\s*([^\\n]+)`);
  return re.exec(raw)?.[1]?.trim();
}

function dig(root: Record<string, unknown> | undefined, path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    const row = asRecord(cur);
    if (!row) return undefined;
    cur = row[key];
  }
  return cur;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function clip(text: string): string {
  const t = text.trim();
  return t.length > 36 ? `${t.slice(0, 36)}…` : t;
}
