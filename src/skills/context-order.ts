/**
 * 上下文投影排序（context-order.v1）→ contextSegments。
 * 扁平数字序；「对话.历史」也是可投影标签，不是硬分区锚点。
 * 规范：docs/context-fragment-design.md
 */
import type { ContextSegmentDef } from "./context-segments.js";
import { extractJsonObjectText } from "./worker-set-parse.js";
import {
  DEFAULT_ON_DEMAND_REFS,
  DEFAULT_PLAY_SLOT_REFS,
  defaultPlaySlots,
  parsePlaySlots,
  playSlotIdForRef,
  PLAY_SLOT_META,
  PLAY_SLOTS_WITHOUT_DIALOGUE_HISTORY,
  resolvePlayAgentId,
  type PlaySlotsConfig,
} from "./play-slots.js";
import {
  DIALOGUE_HISTORY_TAG,
  isDialogueHistoryRef,
} from "./dialogue-history.js";

export const CONTEXT_ORDER_SCHEMA = "context-order.v1" as const;
export const CONTEXT_ORDER_TAG = "设计.上下文投影排序";
export const WORKER_PERSONA_REF = "worker.persona";
export { DIALOGUE_HISTORY_TAG };

/** @deprecated 仅兼容旧表；拼装按扁平 order，历史靠 ref=对话.历史 */
export type ContextOrderAnchor = "pre_history" | "post_history";
export type ContextOrderProjection = "fixed" | "full" | "summary" | "fields";

export type ContextOrderInsert = {
  order: number;
  /** @deprecated 可选；set_anchor 语义改为「移到历史标签前/后」 */
  anchor?: ContextOrderAnchor;
  ref: string;
  projection: ContextOrderProjection;
  note?: string;
  label?: string;
};

export type ContextOrderSlot = {
  ref: string;
  label?: string;
  inserts: ContextOrderInsert[];
};

export type ContextOrderDoc = {
  schema: typeof CONTEXT_ORDER_SCHEMA;
  brief?: string;
  play_slots?: PlaySlotsConfig;
  slots: ContextOrderSlot[];
};

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function parseAnchor(v: unknown): ContextOrderAnchor {
  if (v === "post_history" || v === "dynamic" || v === "历史后") return "post_history";
  return "pre_history";
}

function parseProjection(v: unknown): ContextOrderProjection {
  if (v === "summary" || v === "fields" || v === "fixed" || v === "full") return v;
  if (v === "摘要") return "summary";
  if (v === "字段") return "fields";
  return "full";
}

function parseInsert(raw: unknown): ContextOrderInsert | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const ref = asString(row.ref) ?? asString(row.tag) ?? asString(row.源);
  if (!ref) return undefined;
  const orderRaw = row.order ?? row.序;
  const order = typeof orderRaw === "number" && Number.isFinite(orderRaw) ? orderRaw : Number(orderRaw);
  const hasAnchor = row.anchor != null || row.锚点 != null;
  return {
    order: Number.isFinite(order) ? order : 99,
    anchor: hasAnchor ? parseAnchor(row.anchor ?? row.锚点) : undefined,
    ref,
    projection: parseProjection(row.projection ?? row.投影),
    note: asString(row.note) ?? asString(row.说明),
    label: asString(row.label) ?? asString(row.标题),
  };
}

function parseSlot(raw: unknown): ContextOrderSlot | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const rawRef = asString(row.ref) ?? asString(row.id);
  if (!rawRef) return undefined;
  const slotId = resolvePlayAgentId(rawRef);
  const ref = slotId
    ? slotId === "chance"
      ? DEFAULT_ON_DEMAND_REFS.chance
      : DEFAULT_PLAY_SLOT_REFS[slotId]
    : rawRef;
  const insertsRaw = Array.isArray(row.inserts) ? row.inserts : [];
  const inserts = insertsRaw
    .map(parseInsert)
    .filter((x): x is ContextOrderInsert => Boolean(x))
    .sort((a, b) => a.order - b.order);
  const label =
    asString(row.label) ??
    asString(row.name) ??
    (slotId && slotId !== "chance" ? PLAY_SLOT_META[slotId].label : undefined);
  return {
    ref,
    label,
    inserts,
  };
}

function agentEnabledFlag(row: Record<string, unknown>): boolean {
  if (typeof row.enabled === "boolean") return row.enabled;
  if (row.enabled === "false" || row.enabled === 0) return false;
  return true;
}

function playSlotsFromAgents(
  rows: Record<string, unknown>[],
): PlaySlotsConfig {
  const base = defaultPlaySlots();
  for (const row of rows) {
    const rawId = asString(row.id) ?? asString(row.ref) ?? asString(row.label);
    if (!rawId) continue;
    const slotId = resolvePlayAgentId(rawId);
    if (!slotId) continue;
    const on = agentEnabledFlag(row);
    if (slotId === "chance") base.chance = on;
    else if (slotId === "auditor") base.auditor = on;
    else base[slotId] = on;
  }
  return base;
}

export function parseContextOrder(raw: unknown): ContextOrderDoc | undefined {
  let row: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    const text = extractJsonObjectText(raw) ?? raw.trim();
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        row = parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    row = raw as Record<string, unknown>;
  }
  if (!row) return undefined;

  const agentsRaw = Array.isArray(row.agents) ? row.agents : [];
  const agentRows = agentsRaw.filter(
    (a): a is Record<string, unknown> =>
      Boolean(a) && typeof a === "object" && !Array.isArray(a),
  );
  const fromAgents = agentRows
    .filter(agentEnabledFlag)
    .map(parseSlot)
    .filter((x): x is ContextOrderSlot => Boolean(x));

  const slotsRaw = Array.isArray(row.slots) ? row.slots : [];
  const fromSlots = slotsRaw
    .map(parseSlot)
    .filter((x): x is ContextOrderSlot => Boolean(x));

  const slots = fromAgents.length ? fromAgents : fromSlots;
  if (!slots.length && row.schema !== CONTEXT_ORDER_SCHEMA) return undefined;

  const play_slots = fromAgents.length
    ? playSlotsFromAgents(agentRows)
    : parsePlaySlots(row.play_slots ?? row.playSlots);

  return {
    schema: CONTEXT_ORDER_SCHEMA,
    brief: asString(row.brief),
    play_slots,
    slots,
  };
}

export function slotOrderForRef(
  doc: ContextOrderDoc | undefined,
  workerRef: string,
): ContextOrderSlot | undefined {
  if (!doc) return undefined;
  const id = workerRef.trim();
  return doc.slots.find((s) => s.ref.trim() === id);
}

/**
 * 将某槽的 inserts 转为 contextSegments：严格按扁平 order。
 * worker.persona 用 inline；对话.历史走专用 tag（拼装时动态投影）。
 */
export function contextOrderToSegments(params: {
  slot: ContextOrderSlot;
  personaText?: string;
}): ContextSegmentDef[] {
  const sorted = renumberContextOrder({
    schema: CONTEXT_ORDER_SCHEMA,
    slots: [params.slot],
  }).slots[0]!.inserts;

  const historyIdx = sorted.findIndex((i) => isDialogueHistoryRef(i.ref));
  const segments: ContextSegmentDef[] = [];

  for (const ins of sorted) {
    const afterHistory =
      historyIdx >= 0 && sorted.indexOf(ins) > historyIdx;
    // tier 仅作缓存提示；拼装按数组顺序，不再重排
    const tier = afterHistory ? "dynamic" : "static";
    const id = `ord${ins.order}-${ins.ref}`.replace(/[^\w.\u4e00-\u9fff-]+/g, "_");
    const label =
      ins.label ||
      (ins.note ? `## ${ins.ref}（${ins.note}）` : `## ${ins.ref}`);

    if (ins.ref === WORKER_PERSONA_REF || ins.ref === "persona") {
      const inline = params.personaText?.trim();
      if (!inline) continue;
      segments.push({
        id,
        tier,
        tags: [],
        label,
        inline,
        projection: ins.projection,
      });
      continue;
    }

    const tag = isDialogueHistoryRef(ins.ref)
      ? DIALOGUE_HISTORY_TAG
      : ins.ref;
    segments.push({
      id,
      tier,
      tags: [tag],
      label,
      projection: ins.projection,
    });
  }
  return segments;
}

export type ContextOrderInsertView = {
  index: number;
  order: number;
  anchor?: ContextOrderAnchor;
  ref: string;
  projection: ContextOrderProjection;
  note?: string;
  label?: string;
  isHistory?: boolean;
  /** 展示一行 */
  line: string;
};

export function contextOrderToView(doc: ContextOrderDoc): {
  brief?: string;
  editable: true;
  slots: Array<{
    ref: string;
    label?: string;
    inserts: ContextOrderInsertView[];
    lines: string[];
  }>;
} {
  return {
    brief: doc.brief,
    editable: true,
    slots: doc.slots.map((s) => {
      const inserts: ContextOrderInsertView[] = s.inserts.map((i, index) => {
        const hist = isDialogueHistoryRef(i.ref);
        const line =
          `${i.order} · ${hist ? "对话.历史" : i.ref}` +
          (i.projection !== "full" ? ` · ${i.projection}` : "") +
          (i.note ? ` — ${i.note}` : "");
        return {
          index,
          order: i.order,
          anchor: i.anchor,
          ref: hist ? DIALOGUE_HISTORY_TAG : i.ref,
          projection: i.projection,
          note: i.note,
          label: i.label,
          isHistory: hist,
          line,
        };
      });
      return {
        ref: s.ref,
        label: s.label,
        inserts,
        lines: inserts.map((x) => x.line),
      };
    }),
  };
}

/** 扁平重编号 0..n；persona 尽量置顶；保证至多一条对话.历史 */
export function renumberContextOrder(doc: ContextOrderDoc): ContextOrderDoc {
  return {
    ...doc,
    schema: CONTEXT_ORDER_SCHEMA,
    slots: doc.slots.map((slot) => {
      let inserts = slot.inserts.map((i) => ({
        ...i,
        ref: isDialogueHistoryRef(i.ref) ? DIALOGUE_HISTORY_TAG : i.ref,
      }));
      // 合并重复历史标签：保留第一条
      const seenHist = new Set<number>();
      inserts = inserts.filter((i, idx) => {
        if (!isDialogueHistoryRef(i.ref)) return true;
        if (seenHist.size) return false;
        seenHist.add(idx);
        return true;
      });
      const personaIdx = inserts.findIndex(
        (i) => i.ref === WORKER_PERSONA_REF || i.ref === "persona",
      );
      if (personaIdx > 0) {
        const [p] = inserts.splice(personaIdx, 1);
        inserts.unshift(p!);
      }
      return {
        ...slot,
        inserts: inserts.map((i, idx) => ({
          ...i,
          order: idx,
          anchor: undefined,
        })),
      };
    }),
  };
}

export type ContextOrderEdit =
  | { action: "move"; slotRef: string; index: number; delta: -1 | 1 }
  | {
      action: "set_anchor";
      slotRef: string;
      index: number;
      anchor: ContextOrderAnchor;
    }
  | {
      action: "set_projection";
      slotRef: string;
      index: number;
      projection: ContextOrderProjection;
    }
  | { action: "replace"; context_order: unknown };

function cloneDoc(doc: ContextOrderDoc): ContextOrderDoc {
  return {
    schema: CONTEXT_ORDER_SCHEMA,
    brief: doc.brief,
    play_slots: doc.play_slots ? { ...doc.play_slots } : undefined,
    slots: doc.slots.map((s) => ({
      ...s,
      inserts: s.inserts.map((i) => ({ ...i })),
    })),
  };
}

/**
 * 扁平列表编排：
 * - move：与相邻项交换
 * - set_anchor：把该项移到「对话.历史」之前（pre）或之后（post）；无历史则先插入历史标签
 * - set_projection：只改投影
 */
export function applyContextOrderEdit(
  doc: ContextOrderDoc,
  edit: ContextOrderEdit,
): ContextOrderDoc {
  if (edit.action === "replace") {
    const parsed = parseContextOrder(edit.context_order);
    if (!parsed) throw new Error("context_order 无法解析");
    return renumberContextOrder(parsed);
  }

  const next = cloneDoc(doc);
  const slot = next.slots.find((s) => s.ref.trim() === edit.slotRef.trim());
  if (!slot) throw new Error(`未找到槽 ${edit.slotRef}`);
  if (edit.index < 0 || edit.index >= slot.inserts.length) {
    throw new Error("插入项下标越界");
  }

  if (edit.action === "set_projection") {
    slot.inserts[edit.index]!.projection = edit.projection;
    return renumberContextOrder(next);
  }

  if (edit.action === "set_anchor") {
    const item = slot.inserts[edit.index]!;
    if (isDialogueHistoryRef(item.ref)) {
      return renumberContextOrder(next);
    }
    slot.inserts.splice(edit.index, 1);
    ensureHistoryInsert(slot);
    const histIdx = slot.inserts.findIndex((i) => isDialogueHistoryRef(i.ref));
    const insertAt =
      edit.anchor === "pre_history" ? Math.max(0, histIdx) : histIdx + 1;
    slot.inserts.splice(insertAt, 0, item);
    return renumberContextOrder(next);
  }

  // move：整表相邻交换
  const to = edit.index + edit.delta;
  if (to < 0 || to >= slot.inserts.length) {
    return renumberContextOrder(next);
  }
  const tmp = slot.inserts[edit.index]!;
  slot.inserts[edit.index] = slot.inserts[to]!;
  slot.inserts[to] = tmp;
  return renumberContextOrder(next);
}

function ensureHistoryInsert(slot: ContextOrderSlot): void {
  if (slot.inserts.some((i) => isDialogueHistoryRef(i.ref))) return;
  // 插在中段：persona 后、易变前
  const mid = Math.min(
    Math.max(1, Math.ceil(slot.inserts.length / 2)),
    slot.inserts.length,
  );
  slot.inserts.splice(mid, 0, {
    order: mid,
    ref: DIALOGUE_HISTORY_TAG,
    projection: "summary",
    note: "对话历史（按投影裁剪）",
  });
}

export function serializeContextOrder(doc: ContextOrderDoc): string {
  const normalized = renumberContextOrder(doc);
  return JSON.stringify(
    {
      schema: CONTEXT_ORDER_SCHEMA,
      brief: normalized.brief,
      play_slots: normalized.play_slots,
      slots: normalized.slots.map((s) => ({
        ref: s.ref,
        label: s.label,
        inserts: s.inserts.map((i) => ({
          order: i.order,
          ref: i.ref,
          projection: i.projection,
          ...(i.note ? { note: i.note } : {}),
          ...(i.label ? { label: i.label } : {}),
        })),
      })),
    },
    null,
    2,
  );
}

/** 把排序表写入运行规格 JSON 文本的 context_order 字段 */
export function mergeContextOrderIntoWorkerSetJson(
  workerSetRaw: string,
  order: ContextOrderDoc,
): string {
  const text = extractJsonObjectText(workerSetRaw) ?? workerSetRaw.trim();
  let row: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("设计.worker集 不是 JSON 对象");
    }
    row = parsed as Record<string, unknown>;
  } catch {
    throw new Error("设计.worker集 无法解析为 JSON");
  }
  const normalized = renumberContextOrder(order);
  row.context_order = JSON.parse(serializeContextOrder(normalized)) as unknown;
  delete row.contextOrder;
  return JSON.stringify(row, null, 2);
}

/**
 * 无排序表时，从 worker 声明的 static/dynamic 合成可编辑初稿（含 persona）。
 */
/** 声明缺 context 时的兜底（与模板/检查器默认对齐的最小集） */
const SYNTH_FALLBACK_CONTEXT: Record<
  string,
  { static: string[]; dynamic: string[]; /** 默认不注入对话.历史 */ skipHistory?: boolean }
> = {
  auditor: {
    static: [
      "设计.变量设计与更新规则",
      "设计.生成规则",
      "设计.变量控制上下文",
    ],
    dynamic: [
      "运行.本轮.裁决",
      "用户.最新输入",
      "变量.当前",
      "上下文.旁观.状态摘要",
    ],
    skipHistory: true,
  },
  "world-simulator": {
    static: [
      "设计.舞台骨架",
      "设计.实现机制",
      "设计.变量设计与更新规则",
      "设计.生成规则",
      "设计.叙事指南与故事推进",
      "设计.正文组成",
      "设计.监控栏",
    ],
    dynamic: [
      "变量.当前",
      "运行.事件流",
      "上下文.角色态度",
      "用户.最新输入",
    ],
  },
  narrator: {
    static: [
      "设计.叙事指南与故事推进",
      "设计.正文组成",
      "设计.监控栏",
    ],
    dynamic: ["运行.本轮.裁决"],
    skipHistory: true,
  },
  "role-decide": {
    static: [],
    dynamic: ["用户.最新输入", "运行.本轮.裁决"],
  },
};

export function synthesizeContextOrderFromWorkers(
  workers: Array<{
    ref?: string;
    name?: string;
    context?: { static?: string[]; dynamic?: string[] };
  }>,
  playSlots?: PlaySlotsConfig,
): ContextOrderDoc | undefined {
  const slots: ContextOrderSlot[] = [];
  for (const w of workers) {
    const ref = w.ref?.trim();
    if (!ref) continue;
    const fallback = SYNTH_FALLBACK_CONTEXT[ref];
    const staticTags = w.context?.static ?? fallback?.static ?? [];
    const dynamicTags =
      w.context?.dynamic ?? fallback?.dynamic ?? ["用户.最新输入"];
    const slotId = playSlotIdForRef(ref);
    const skipHistory =
      Boolean(fallback?.skipHistory) ||
      (slotId != null && PLAY_SLOTS_WITHOUT_DIALOGUE_HISTORY.has(slotId));
    const inserts: ContextOrderInsert[] = [
      {
        order: 0,
        ref: WORKER_PERSONA_REF,
        projection: "fixed",
        note: "槽位人设",
      },
    ];
    let o = 1;
    for (const tag of staticTags) {
      if (!tag?.trim() || tag === "设计.worker集") continue;
      if (isDialogueHistoryRef(tag)) continue;
      inserts.push({
        order: o++,
        ref: tag.trim(),
        projection: tag.includes("事件流") ? "summary" : "full",
      });
    }
    if (!skipHistory) {
      inserts.push({
        order: o++,
        ref: DIALOGUE_HISTORY_TAG,
        projection: "summary",
        note: "对话历史（按投影裁剪）",
      });
    }
    for (const tag of dynamicTags) {
      if (!tag?.trim()) continue;
      if (isDialogueHistoryRef(tag)) continue;
      inserts.push({
        order: o++,
        ref: tag.trim(),
        projection: "full",
      });
    }
    slots.push({
      ref,
      label: w.name,
      inserts,
    });
  }
  if (!slots.length) return undefined;
  return renumberContextOrder({
    schema: CONTEXT_ORDER_SCHEMA,
    brief: skipHistoryBrief(slots)
      ? "扁平投影序（旁观维护无对话.历史；主世界层等可含历史）"
      : "扁平投影序（含对话.历史标签，可编排）",
    play_slots: playSlots,
    slots,
  });
}

function skipHistoryBrief(slots: ContextOrderSlot[]): boolean {
  return slots.some(
    (s) =>
      !s.inserts.some((i) => isDialogueHistoryRef(i.ref)) &&
      playSlotIdForRef(s.ref) === "auditor",
  );
}
