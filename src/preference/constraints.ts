/**
 * 创作期：把全局偏好库全量摊成「设计.用户约束」，挂进游玩固定上下文。
 * 开玩后本局只读；游玩采集只写回全局库，不改本 tag。
 */

import type { Blackboard } from "../blackboard/blackboard.js";
import {
  CONTEXT_ORDER_SCHEMA,
  CONTEXT_ORDER_TAG,
  mergeContextOrderIntoWorkerSetJson,
  parseContextOrder,
  renumberContextOrder,
  type ContextOrderDoc,
  type ContextOrderInsert,
} from "../skills/context-order.js";
import {
  WORKER_SET_DRAFT_TAG,
  WORKER_SET_FINAL_TAG,
} from "../skills/creation-units.js";
import {
  DEFAULT_PLAY_SLOT_REFS,
  parsePlaySlots,
} from "../skills/play-slots.js";
import { parseWorkerSetYaml } from "../skills/worker-set-parse.js";
import {
  ensureStarterPreferences,
  listActivePreferences,
  type PreferenceEntry,
} from "./store.js";

export const USER_CONSTRAINTS_TAG = "设计.用户约束";

const IDENTITY =
  "【用户约束】跨局偏好。约束展示与写法，不改舞台真值；与本局世界观许可冲突时以本段为准。";

function tryParseOrder(raw: string): ContextOrderDoc | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  try {
    return parseContextOrder(JSON.parse(t));
  } catch {
    return parseContextOrder(t);
  }
}

/** 由偏好条目拼成本局产物正文；空库返回空串 */
export function buildUserConstraintsContent(
  entries?: PreferenceEntry[],
): string {
  const source = entries ?? listActivePreferences();
  const active = source.filter((e) => e.status === "active" && e.content.trim());
  if (!active.length) return "";
  const lines = active.map((e, i) => `${i + 1}. ${e.content.trim()}`);
  return `${IDENTITY}\n\n${lines.join("\n")}`;
}

/** 写入黑板；库空则清空 tag 正文（避免陈旧约束残留） */
export function writeUserConstraintsTag(board: Blackboard): {
  content: string;
  count: number;
} {
  ensureStarterPreferences();
  const entries = listActivePreferences();
  const content = buildUserConstraintsContent(entries);
  board.write({
    tag: USER_CONSTRAINTS_TAG,
    content,
    source: "system:user-constraints",
  });
  return { content, count: entries.length };
}

function alreadyHasRef(inserts: ContextOrderInsert[], ref: string): boolean {
  return inserts.some((ins) => ins.ref === ref);
}

/**
 * 在 persona 之后插入用户约束（靠上，高于世界观长文）。
 * 目标槽：主世界层 + 叙事转述（有则挂）。
 */
export function ensureUserConstraintsInContextOrder(
  doc: ContextOrderDoc,
): ContextOrderDoc {
  const gmRef = DEFAULT_PLAY_SLOT_REFS.gm;
  const narratorRef = DEFAULT_PLAY_SLOT_REFS.narrator;
  const slots = doc.slots.map((slot) => {
    const isGm = slot.ref === gmRef || /world-simulator|主世界/.test(slot.ref);
    const isNarrator = slot.ref === narratorRef || /narrator|转述/.test(slot.ref);
    if (!isGm && !isNarrator) return slot;
    if (alreadyHasRef(slot.inserts, USER_CONSTRAINTS_TAG)) return slot;

    const personaIdx = slot.inserts.findIndex(
      (ins) => ins.ref === "worker.persona",
    );
    const insertAt = personaIdx >= 0 ? personaIdx + 1 : 0;
    const nextInserts = [...slot.inserts];
    nextInserts.splice(insertAt, 0, {
      order: 0,
      ref: USER_CONSTRAINTS_TAG,
      projection: "full",
      note: "用户跨局约束（全量）",
    });
    return { ...slot, inserts: nextInserts };
  });

  return renumberContextOrder({
    ...doc,
    schema: CONTEXT_ORDER_SCHEMA,
    slots,
  });
}

/**
 * 全量落盘 + 挂入运行规格 / 投影排序。
 * 库空：清空 tag，并从 inserts 摘掉该 ref。
 */
export function applyUserConstraintsToPlaySpec(board: Blackboard): {
  content: string;
  count: number;
  mounted: boolean;
} {
  const { content, count } = writeUserConstraintsTag(board);

  const finalRaw =
    board.getContentByTag(WORKER_SET_FINAL_TAG)?.trim() ||
    board.getContentByTag(WORKER_SET_DRAFT_TAG)?.trim() ||
    "";
  const orderRaw = board.getContentByTag(CONTEXT_ORDER_TAG)?.trim() || "";

  let orderDoc =
    tryParseOrder(orderRaw) ??
    (() => {
      if (!finalRaw) return undefined;
      try {
        const row = JSON.parse(finalRaw) as Record<string, unknown>;
        if (row.context_order && typeof row.context_order === "object") {
          return parseContextOrder(row.context_order);
        }
      } catch {
        /* ignore */
      }
      return undefined;
    })();

  if (!orderDoc && finalRaw) {
    const parsed = parseWorkerSetYaml(finalRaw);
    const playSlots = parsed?.play_slots ?? parsePlaySlots(undefined);
    orderDoc = {
      schema: CONTEXT_ORDER_SCHEMA,
      brief: "用户约束挂载",
      play_slots: playSlots,
      slots: [
        {
          ref: DEFAULT_PLAY_SLOT_REFS.gm,
          label: "主世界层",
          inserts: [
            { order: 0, ref: "worker.persona", projection: "fixed" },
            {
              order: 1,
              ref: USER_CONSTRAINTS_TAG,
              projection: "full",
              note: "用户跨局约束（全量）",
            },
            { order: 2, ref: "用户.最新输入", projection: "full" },
          ],
        },
      ],
    };
  }

  if (!orderDoc) {
    return { content, count, mounted: false };
  }

  if (!content.trim()) {
    // 摘掉空约束 ref
    orderDoc = renumberContextOrder({
      ...orderDoc,
      slots: orderDoc.slots.map((slot) => ({
        ...slot,
        inserts: slot.inserts.filter((ins) => ins.ref !== USER_CONSTRAINTS_TAG),
      })),
    });
  } else {
    orderDoc = ensureUserConstraintsInContextOrder(orderDoc);
  }

  board.write({
    tag: CONTEXT_ORDER_TAG,
    content: JSON.stringify(orderDoc, null, 2),
    source: "system:user-constraints",
  });

  const baseJson =
    finalRaw.trim() ||
    JSON.stringify({ play_slots: orderDoc.play_slots ?? {}, brief: "用户约束挂载" }, null, 2);
  const workerSetJson = mergeContextOrderIntoWorkerSetJson(baseJson, orderDoc);
  board.write({
    tag: WORKER_SET_FINAL_TAG,
    content: workerSetJson,
    source: "system:user-constraints",
  });

  return { content, count, mounted: Boolean(content.trim()) };
}
