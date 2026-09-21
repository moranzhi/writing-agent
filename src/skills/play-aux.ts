/**
 * 游玩辅助面：表格 / 开场与角色 等 Tab 的视图截面。
 */
import type { Blackboard } from "../blackboard/blackboard.js";
import {
  isTableCellEditable,
  parseTableDoc,
} from "../blackboard/table-cells.js";
import {
  OPENING_PERSONA_CHOICE_TAG,
  OPENING_SETUP_ARTIFACT_TAG,
  SLOT_OPENING_SELECTED_INDEX,
  parseOpeningSealPayload,
  splitOpeningDocument,
  type OpeningUserPersona,
} from "./opening-seal.js";
import { CURRENT_VARS_TAG } from "./variable-catalog.js";
import { readSessionProtagonist } from "../persona/protagonist-bind.js";
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
  text: string;
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

function collectOpenings(board: Blackboard): PlayAuxOpening[] {
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
      return {
        index,
        text: presentReadablePlain(text) || text,
        persona: one?.persona ?? payload.persona,
      };
    });
  }
  const split = splitOpeningDocument(board.getContentByTag("设计.开场白"));
  if (split.text) {
    return [{ index: 0, text: split.text, persona: split.persona }];
  }
  return [];
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
      : openings[selectedOpeningIndexClamped]?.persona ?? null,
    openingPersonaChoice,
  };
}
