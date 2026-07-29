/**
 * 表边沿副作用：prev 不满足且 now 满足才触发；once 规则记 fired。
 * 规则来自 设计.worker集.tables.side_effects。
 */
import type { Blackboard } from "./blackboard.js";
import type { TableDoc } from "./table-cells.js";

export type SideEffectOp = "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "truthy" | "changed";

export type SideEffectMode = "once" | "edge" | "every_edge";

export type SideEffectAction =
  | { type: "write_tag"; tag: string; content: string }
  | { type: "replace_tag"; tag: string; content: string }
  | { type: "queue_worker"; workerId: string; note?: string };

export type SideEffectRule = {
  id: string;
  field: string;
  op: SideEffectOp;
  value?: unknown;
  /** once = 边沿 + 记 fired；edge/every_edge = 仅边沿，可反复跨边沿 */
  mode: SideEffectMode;
  action: SideEffectAction;
};

export type FiredRegistry = Record<string, { at: string; round?: number }>;

export const SIDE_EFFECT_FIRED_TAG = "运行.表副作用.fired";

export function parseSideEffectRules(tables: unknown): SideEffectRule[] {
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) return [];
  const raw = (tables as { side_effects?: unknown }).side_effects;
  if (!Array.isArray(raw)) return [];
  const out: SideEffectRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const field = typeof row.field === "string" ? row.field.trim() : "";
    if (!id || !field) continue;
    const op = normalizeOp(row.op);
    const mode = normalizeMode(row.mode);
    const action = parseAction(row.action);
    if (!action) continue;
    out.push({ id, field, op, value: row.value, mode, action });
  }
  return out;
}

function normalizeOp(raw: unknown): SideEffectOp {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "eq";
  const allowed: SideEffectOp[] = [
    "eq",
    "neq",
    "gte",
    "lte",
    "gt",
    "lt",
    "truthy",
    "changed",
  ];
  return (allowed.includes(s as SideEffectOp) ? s : "eq") as SideEffectOp;
}

function normalizeMode(raw: unknown): SideEffectMode {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "once";
  if (s === "edge" || s === "every_edge") return "every_edge";
  return "once";
}

function parseAction(raw: unknown): SideEffectAction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  const type = typeof a.type === "string" ? a.type.trim() : "";
  if (type === "write_tag" || type === "replace_tag") {
    const tag = typeof a.tag === "string" ? a.tag.trim() : "";
    const content = typeof a.content === "string" ? a.content : "";
    if (!tag) return null;
    return { type, tag, content };
  }
  if (type === "queue_worker") {
    const workerId =
      typeof a.workerId === "string"
        ? a.workerId.trim()
        : typeof a.worker_id === "string"
          ? a.worker_id.trim()
          : "";
    if (!workerId) return null;
    return {
      type: "queue_worker",
      workerId,
      note: typeof a.note === "string" ? a.note : undefined,
    };
  }
  return null;
}

export function tableValueMap(doc: TableDoc | null | undefined): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const row of doc?.rows ?? []) {
    map.set(row.key, row.value);
  }
  return map;
}

export function conditionSatisfied(
  values: Map<string, unknown>,
  rule: SideEffectRule,
  prevValues?: Map<string, unknown>,
): boolean {
  const now = values.get(rule.field);
  if (rule.op === "changed") {
    if (!prevValues) return false;
    return !sameValue(prevValues.get(rule.field), now);
  }
  return compareOp(now, rule.op, rule.value);
}

function compareOp(actual: unknown, op: SideEffectOp, expected: unknown): boolean {
  switch (op) {
    case "eq":
      return sameValue(actual, expected);
    case "neq":
      return !sameValue(actual, expected);
    case "truthy":
      return Boolean(actual);
    case "gte":
    case "lte":
    case "gt":
    case "lt": {
      const a = toNumber(actual);
      const b = toNumber(expected);
      if (a == null || b == null) return false;
      if (op === "gte") return a >= b;
      if (op === "lte") return a <= b;
      if (op === "gt") return a > b;
      return a < b;
    }
    case "changed":
      return false;
    default:
      return false;
  }
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "number" || typeof b === "number") {
    const na = toNumber(a);
    const nb = toNumber(b);
    return na != null && nb != null && na === nb;
  }
  return String(a) === String(b);
}

export type SideEffectTrigger = {
  rule: SideEffectRule;
  reason: "edge";
};

/**
 * 对本轮 prev→now 快照算边沿；同 round 同 ruleId 最多一次。
 * once：已 fired 则跳过；触发后写入 nextFired。
 * every_edge：每次边沿都触发，不记 fired。
 */
export function evaluateSideEffects(params: {
  prev: TableDoc | null;
  next: TableDoc;
  rules: SideEffectRule[];
  fired: FiredRegistry;
  round?: number;
}): {
  triggers: SideEffectTrigger[];
  nextFired: FiredRegistry;
  queuedWorkers: Array<{ workerId: string; ruleId: string; note?: string }>;
} {
  const prevMap = tableValueMap(params.prev);
  const nextMap = tableValueMap(params.next);
  const nextFired: FiredRegistry = { ...params.fired };
  const triggers: SideEffectTrigger[] = [];
  const seen = new Set<string>();
  const queuedWorkers: Array<{ workerId: string; ruleId: string; note?: string }> =
    [];

  for (const rule of params.rules) {
    if (seen.has(rule.id)) continue;
    if (rule.mode === "once" && nextFired[rule.id]) continue;

    const was = conditionSatisfied(prevMap, rule, undefined);
    const now = conditionSatisfied(nextMap, rule, prevMap);
    // 边沿：prev 不满足、now 满足（changed 用 prev/now 值差）
    const edge =
      rule.op === "changed"
        ? conditionSatisfied(nextMap, rule, prevMap)
        : !was && now;
    if (!edge) continue;

    seen.add(rule.id);
    triggers.push({ rule, reason: "edge" });
    if (rule.mode === "once") {
      nextFired[rule.id] = {
        at: new Date().toISOString(),
        round: params.round,
      };
    }
    if (rule.action.type === "queue_worker") {
      queuedWorkers.push({
        workerId: rule.action.workerId,
        ruleId: rule.id,
        note: rule.action.note,
      });
    }
  }

  return { triggers, nextFired, queuedWorkers };
}

export function parseFiredRegistry(raw: string | undefined | null): FiredRegistry {
  if (!raw?.trim()) return {};
  try {
    const doc = JSON.parse(raw) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};
    const out: FiredRegistry = {};
    for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
      if (!k.trim()) continue;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const row = v as Record<string, unknown>;
        out[k] = {
          at: typeof row.at === "string" ? row.at : new Date().toISOString(),
          round: typeof row.round === "number" ? row.round : undefined,
        };
      } else if (v === true) {
        out[k] = { at: new Date().toISOString() };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function stringifyFiredRegistry(fired: FiredRegistry): string {
  return JSON.stringify(fired, null, 2);
}

/** 执行 write_tag / replace_tag；queue_worker 只返回，由上层调度 */
export function applySideEffectTagActions(params: {
  blackboard: Blackboard;
  triggers: SideEffectTrigger[];
  source?: string;
}): { writtenTags: string[] } {
  const writtenTags: string[] = [];
  const source = params.source ?? "system:table-side-effect";
  for (const { rule } of params.triggers) {
    const action = rule.action;
    if (action.type !== "write_tag" && action.type !== "replace_tag") continue;
    params.blackboard.write({
      tag: action.tag,
      content: action.content,
      source,
    });
    writtenTags.push(action.tag);
  }
  return { writtenTags };
}
