/**
 * 游玩辅助面：表格 / 开场与角色 等 Tab 的视图截面。
 */
import type { Blackboard } from "../blackboard/blackboard.js";
import {
  isTableCellEditable,
  parseTableDoc,
} from "../blackboard/table-cells.js";
import {
  dictateProductFamily,
  dictateProductSlot,
} from "../dictate/repeatable-tags.js";
import {
  DICTATE_ORDER_META_KEY,
  effectiveDictateOrder,
} from "../dictate/types.js";
import {
  OPENING_PERSONA_CHOICE_TAG,
  OPENING_PRODUCT_FAMILY,
  OPENING_SETUP_ARTIFACT_TAG,
  ZERO_LAYER_OPENING_FAMILY,
  SLOT_OPENING_SELECTED_INDEX,
  parseOpeningSealPayload,
  splitOpeningDocument,
  type OpeningUserPersona,
} from "./opening-seal.js";
import { CURRENT_VARS_TAG } from "./variable-catalog.js";
import {
  personaBoundToOpening,
  readSessionProtagonist,
} from "../persona/protagonist-bind.js";
import { presentReadablePlain } from "./present-packet.js";

export type PlayAuxTableRow = {
  key: string;
  value: unknown;
  rev: number;
  visibility: "visible" | "hidden";
  editable: boolean;
  note?: string;
};

export type PlayAuxOpening = {
  index: number;
  /** 产物 tag：设计.开场白 或 设计.开场白#槽位；opening-setup 候选为假想 tag */
  tag: string;
  slot: string;
  /** 侧栏预览用：present.v1 已压成可读正文 */
  text: string;
  /** 选用时落盘 / 灌呈现壳：保留完整 present.v1 或散文原文 */
  document: string;
  persona: OpeningUserPersona | null;
};

export type PlayAuxView = {
  table: { tag: string; rows: PlayAuxTableRow[] } | null;
  openings: PlayAuxOpening[];
  selectedOpeningIndex: number;
  openingPersona: OpeningUserPersona | null;
  openingPersonaChoice: "opening" | "global" | null;
};

function selectedOpeningIndex(slots: Record<string, unknown> | undefined): number {
  const raw = slots?.[SLOT_OPENING_SELECTED_INDEX];
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.trunc(raw));
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  return 0;
}

type OpeningProductRow = {
  tag: string;
  content: string;
  order: number;
  slot: string;
};

function listOpeningProductRows(board: Blackboard): OpeningProductRow[] {
  const rows: OpeningProductRow[] = [];
  for (const e of board.listTagIndex()) {
    const family = dictateProductFamily(e.tag);
    if (
      family !== OPENING_PRODUCT_FAMILY &&
      family !== ZERO_LAYER_OPENING_FAMILY
    ) {
      continue;
    }
    const item = board.getLatestByTag(e.tag);
    const content = item?.content?.trim() ?? "";
    if (!content) continue;
    const rawOrder = item?.metadata?.[DICTATE_ORDER_META_KEY];
    const order =
      typeof rawOrder === "number" && Number.isFinite(rawOrder)
        ? rawOrder
        : effectiveDictateOrder({ tag: e.tag });
    rows.push({
      tag: e.tag,
      content,
      order,
      slot: dictateProductSlot(e.tag),
    });
  }
  rows.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.tag.localeCompare(b.tag, "zh");
  });
  return rows;
}

function openingsFromRows(
  board: Blackboard,
  rows: OpeningProductRow[],
): PlayAuxOpening[] {
  return rows.map((row, index) => {
    const split = splitOpeningDocument(row.content);
    const document = split.text.trim() || row.content;
    return {
      index,
      tag: row.tag,
      slot: row.slot,
      document,
      text: presentReadablePlain(document) || document,
      persona: personaBoundToOpening(board, row.tag, row.content),
    };
  });
}

/**
 * 可切换开场。已有 `设计.开场白#场景短码` 时只认这些带槽位的卡，
 * 裸 `设计.开场白` 与整包 `设计.开场白与开场变量` 不进切换列表。
 * 还没有槽位卡时，才回退旧整包候选或裸基名。
 */
export function collectOpenings(board: Blackboard): PlayAuxOpening[] {
  const rows = listOpeningProductRows(board);
  const slotted = rows.filter((row) => row.slot);
  if (slotted.length) return openingsFromRows(board, slotted);

  const payload = parseOpeningSealPayload(
    board.getContentByTag(OPENING_SETUP_ARTIFACT_TAG),
    0,
  );
  if (payload?.candidates.length) {
    return payload.candidates.map((text, index) => {
      const one = parseOpeningSealPayload(
        board.getContentByTag(OPENING_SETUP_ARTIFACT_TAG),
        index,
      );
      const tag = `${OPENING_SETUP_ARTIFACT_TAG}#${index + 1}`;
      const document = text.trim();
      return {
        index,
        tag,
        slot: String(index + 1),
        document,
        text: presentReadablePlain(document) || document,
        persona: one?.persona ?? payload.persona,
      };
    });
  }

  return openingsFromRows(board, rows);
}

export function buildPlayAuxView(
  board: Blackboard,
  slots?: Record<string, unknown>,
): PlayAuxView {
  const tableDoc = parseTableDoc(board.getContentByTag(CURRENT_VARS_TAG));
  const table = tableDoc?.rows.length
    ? {
        tag: CURRENT_VARS_TAG,
        rows: tableDoc.rows.map((row) => ({
          key: row.key,
          value: row.value,
          rev: row.rev,
          visibility: row.visibility === "hidden" ? "hidden" : "visible",
          editable: isTableCellEditable(row),
          ...(row.note ? { note: row.note } : {}),
        })),
      }
    : null;

  const openings = collectOpenings(board);
  const idx = selectedOpeningIndex(slots);
  const selectedOpeningIndexClamped = openings.length
    ? Math.min(idx, openings.length - 1)
    : 0;
  const picked = openings[selectedOpeningIndexClamped];
  const sealed = readSessionProtagonist(board);
  const choiceRaw = board.getContentByTag(OPENING_PERSONA_CHOICE_TAG)?.trim();
  const openingPersonaChoice =
    choiceRaw === "opening" || choiceRaw === "global" ? choiceRaw : null;

  return {
    table,
    openings,
    selectedOpeningIndex: selectedOpeningIndexClamped,
    openingPersona: sealed
      ? { name: sealed.name, description: sealed.description }
      : picked?.persona ?? null,
    openingPersonaChoice,
  };
}
