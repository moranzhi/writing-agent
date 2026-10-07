/**
 * 有变量真值时固定旁观副 LLM 填表（auditor_bundle）。
 * 旁观上下文刻意保持小：上一份表 + 创作期维护准则 + 本轮主世界正文；
 * 不再按维护复杂度.建议在内联 / 旁观间切换，避免主世界 tool / state_ops 反复探测。
 * 变量设计里的维护复杂度可作旁观备注，不驱动开槽。
 */
import type { Blackboard } from "../blackboard/blackboard.js";
import { extractJsonObjectText } from "./worker-set-parse.js";
import type { PlaySlotsConfig } from "./play-slots.js";
import { VARIABLE_DESIGN_TAG } from "./variable-design-compile.js";

export const MAINTENANCE_STRATEGY_SCHEMA = "maintenance-strategy.v1" as const;
export const MAINTENANCE_STRATEGY_TAG = "设计.维护策略";

export type MaintenanceAdvice =
  | "none"
  | "inline_tool"
  | "inline_structured"
  | "auditor_bundle";

export type MaintenanceStrategyDoc = {
  schema: typeof MAINTENANCE_STRATEGY_SCHEMA;
  advice: MaintenanceAdvice;
  /** 是否启用旁观维护槽 */
  auditor: boolean;
  /** 是否走主世界内联维护（已弃用开槽；固定旁观后恒为 false） */
  inline: boolean;
  source: string;
  依据?: string[];
};

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

export function normalizeMaintenanceAdvice(raw: unknown): MaintenanceAdvice {
  const s = asString(raw)?.toLowerCase() ?? "";
  if (
    s === "auditor_bundle" ||
    s === "auditor" ||
    s === "旁观" ||
    s === "旁观维护" ||
    s === "bundle"
  ) {
    return "auditor_bundle";
  }
  if (
    s === "inline_structured" ||
    s === "structured" ||
    s === "内联结构化" ||
    s === "state_ops"
  ) {
    return "inline_structured";
  }
  if (
    s === "inline_tool" ||
    s === "inline" ||
    s === "tool" ||
    s === "内联" ||
    s === "内联工具"
  ) {
    return "inline_tool";
  }
  if (s === "none" || s === "无" || s === "不维护") return "none";
  return "none";
}

function designHasTruths(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  const text = extractJsonObjectText(raw) ?? raw.trim();
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return false;
  }
  const root = asObject(doc);
  if (!root) return false;
  const body = asObject(root.正文) ?? root;
  const truths = body.真值 ?? body.fields ?? body.变量;
  return Array.isArray(truths) && truths.length > 0;
}

/** 解析变量设计产物中的维护复杂度（仅作备注；开槽不读此建议） */
export function parseMaintenanceAdviceFromVariableDesign(
  raw: string | null | undefined,
): { advice: MaintenanceAdvice; 依据: string[] } | null {
  if (!raw?.trim()) return null;
  const text = extractJsonObjectText(raw) ?? raw.trim();
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  const root = asObject(doc);
  if (!root) return null;
  const body = asObject(root.正文) ?? root;
  const box = asObject(body.维护复杂度) ?? asObject(body.maintenance);
  if (!box) {
    if (designHasTruths(raw)) {
      return {
        advice: "auditor_bundle",
        依据: ["变量设计有真值；程序固定旁观副 LLM 填表"],
      };
    }
    return { advice: "none", 依据: [] };
  }
  const advice = normalizeMaintenanceAdvice(box.建议 ?? box.advice ?? box.strategy);
  const reasonsRaw = box.依据 ?? box.reasons ?? box.why;
  const 依据 = Array.isArray(reasonsRaw)
    ? reasonsRaw.map((r) => asString(r)).filter((r): r is string => Boolean(r))
    : asString(reasonsRaw)
      ? [asString(reasonsRaw)!]
      : [];
  return { advice, 依据 };
}

export function strategyFromAdvice(
  advice: MaintenanceAdvice,
  依据: string[] = [],
  source = VARIABLE_DESIGN_TAG,
): MaintenanceStrategyDoc {
  // 开槽层：仅 auditor_bundle 开旁观；inline_* 在 resolve 阶段会被抬成旁观
  const auditor = advice === "auditor_bundle";
  const inline = advice === "inline_tool" || advice === "inline_structured";
  return {
    schema: MAINTENANCE_STRATEGY_SCHEMA,
    advice,
    auditor,
    inline,
    source,
    ...(依据.length ? { 依据 } : {}),
  };
}

/**
 * 有真值 → 固定旁观填表；无真值 → 不启旁观。
 * 设计里的 inline_* 建议不关闭旁观，只记入依据。
 */
export function resolveMaintenanceStrategyFromBoard(
  board: Blackboard,
): MaintenanceStrategyDoc {
  const designRaw = board.getContentByTag(VARIABLE_DESIGN_TAG);
  if (!designHasTruths(designRaw)) {
    return strategyFromAdvice(
      "none",
      ["无变量真值，不启旁观填表"],
      VARIABLE_DESIGN_TAG,
    );
  }
  const parsed = parseMaintenanceAdviceFromVariableDesign(designRaw);
  const 依据 = [
    "程序固定旁观副 LLM 填表（上一份表 + 维护准则 + 本轮主世界正文）",
    ...(parsed?.依据 ?? []),
  ];
  if (
    parsed &&
    parsed.advice !== "auditor_bundle" &&
    parsed.advice !== "none"
  ) {
    依据.push(`设计原建议 ${parsed.advice}，已忽略内联开槽`);
  }
  return strategyFromAdvice("auditor_bundle", 依据, VARIABLE_DESIGN_TAG);
}

/** 按维护策略覆盖 play_slots.auditor（不改 gm/narrator 等） */
export function applyMaintenanceStrategyToPlaySlots(
  slots: PlaySlotsConfig,
  strategy: MaintenanceStrategyDoc,
): PlaySlotsConfig {
  return {
    ...slots,
    auditor: strategy.auditor,
  };
}

export function serializeMaintenanceStrategy(doc: MaintenanceStrategyDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function writeMaintenanceStrategy(
  board: Blackboard,
  strategy: MaintenanceStrategyDoc,
  source = "system:maintenance-strategy",
): void {
  board.write({
    tag: MAINTENANCE_STRATEGY_TAG,
    content: serializeMaintenanceStrategy(strategy),
    source,
  });
}
