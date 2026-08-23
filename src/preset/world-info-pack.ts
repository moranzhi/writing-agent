import type { Blackboard } from "../blackboard/blackboard.js";
import type { BlackboardInputMerge } from "../types/blackboard.js";
import {
  isDialogueHistoryRef,
  DIALOGUE_HISTORY_TAG,
} from "../skills/dialogue-history.js";
import {
  renderContextSegmentBody,
  type ContextSegmentDef,
} from "../skills/context-segments.js";
import {
  CHAT_HISTORY_MARKER,
  CURRENT_TURN,
  POST_TURN,
  WORLD_BOOK_AFTER,
  WORLD_BOOK_BEFORE,
  isStUnfilledMarker,
} from "./markers.js";

export const CURRENT_TURN_TAG = "用户.最新输入";

const CURRENT_TURN_ALIASES = new Set([
  CURRENT_TURN_TAG,
  "currentTurn",
  "user.latest",
  "用户最新输入",
]);

export function isCurrentTurnRef(ref: string): boolean {
  return CURRENT_TURN_ALIASES.has(ref.trim());
}

export type WorldInfoEntry = {
  id: string;
  name: string;
  content: string;
};

export type WorldInfoPack = {
  worldBookBefore: WorldInfoEntry[];
  history: string;
  worldBookAfter: WorldInfoEntry[];
  turn: string;
  postTurn: WorldInfoEntry[];
};

function emptyPack(): WorldInfoPack {
  return {
    worldBookBefore: [],
    history: "",
    worldBookAfter: [],
    turn: "",
    postTurn: [],
  };
}

function entryName(segment: ContextSegmentDef): string {
  const raw = (segment.label ?? "").replace(/^#+\s*/, "").trim();
  return raw || segment.id;
}

function toEntry(segment: ContextSegmentDef, content: string): WorldInfoEntry {
  return {
    id: segment.id,
    name: entryName(segment),
    content: content.trim(),
  };
}

export function formatWorldInfoEntries(entries: WorldInfoEntry[]): string {
  return entries
    .filter((e) => e.content.trim())
    .map((e) => {
      const title = e.name.trim();
      const body = e.content.trim();
      return title ? `### ${title}\n\n${body}` : body;
    })
    .join("\n\n");
}

/**
 * 按 contextSegments 相对「对话.历史」「用户.最新输入」切成四袋。
 */
export function worldInfoPackFromSegments(params: {
  segments: ContextSegmentDef[];
  inputs: Record<string, string>;
  blackboard: Blackboard;
  inputMerge?: BlackboardInputMerge;
}): WorldInfoPack {
  const inputMerge = params.inputMerge ?? "latest";
  const pack = emptyPack();
  let phase: "before" | "after" | "post" = "before";

  for (const segment of params.segments) {
    const tags = segment.tags ?? [];
    const isHist = tags.some((t) => isDialogueHistoryRef(t));
    const isTurn = tags.some((t) => isCurrentTurnRef(t));
    const body = renderContextSegmentBody(
      segment,
      params.inputs,
      params.blackboard,
      inputMerge,
    ).trim();

    if (isHist) {
      pack.history = body;
      phase = "after";
      continue;
    }
    if (isTurn) {
      pack.turn = body;
      phase = "post";
      continue;
    }
    if (!body) continue;
    const entry = toEntry(segment, body);
    if (phase === "before") pack.worldBookBefore.push(entry);
    else if (phase === "after") pack.worldBookAfter.push(entry);
    else pack.postTurn.push(entry);
  }

  if (!pack.history.trim() && params.inputs[DIALOGUE_HISTORY_TAG]?.trim()) {
    pack.history = params.inputs[DIALOGUE_HISTORY_TAG]!.trim();
  }
  if (!pack.turn.trim() && params.inputs[CURRENT_TURN_TAG]?.trim()) {
    pack.turn = params.inputs[CURRENT_TURN_TAG]!.trim();
  }

  return pack;
}

export function resolveWorldInfoMarker(
  pack: WorldInfoPack,
  identifier: string,
): string | null {
  if (isStUnfilledMarker(identifier)) return null;
  switch (identifier) {
    case WORLD_BOOK_BEFORE: {
      const text = formatWorldInfoEntries(pack.worldBookBefore);
      return text || null;
    }
    case CHAT_HISTORY_MARKER:
      return pack.history.trim() || null;
    case WORLD_BOOK_AFTER: {
      const text = formatWorldInfoEntries(pack.worldBookAfter);
      return text || null;
    }
    case CURRENT_TURN:
      return pack.turn.trim() || null;
    case POST_TURN: {
      const text = formatWorldInfoEntries(pack.postTurn);
      return text || null;
    }
    default:
      return null;
  }
}
