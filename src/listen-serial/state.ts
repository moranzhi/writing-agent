import { randomUUID } from "node:crypto";
import type { Blackboard } from "../blackboard/blackboard.js";
import {
  DEFAULT_BUFFER_TARGET_CHARS,
  LISTEN_BUFFER_TARGET_TAG,
  LISTEN_CONSUMED_CHARS_TAG,
  LISTEN_OUTLINE_TAG,
  LISTEN_PHASE_TAG,
  LISTEN_PLAY_LAYER_TAG,
  LISTEN_SECTIONS_TAG,
  LISTEN_STRUCTURE_TAG,
  LISTEN_SUMMARIES_TAG,
  LISTEN_THRILL_TAG,
  LISTEN_WORLD_TAG,
  MAX_SUMMARIES_IN_CONTEXT,
  type ListenPhase,
  type ListenSerialState,
  type ListenSerialView,
  type OutlineItem,
  type SectionItem,
} from "./types.js";

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parsePhase(raw: string | undefined): ListenPhase {
  const v = (raw ?? "").trim();
  if (
    v === "intake" ||
    v === "awaiting_confirm" ||
    v === "ready" ||
    v === "running" ||
    v === "soft_stop"
  ) {
    return v;
  }
  return "intake";
}

export function isListenPlayActive(board: Blackboard): boolean {
  return (board.getContentByTag(LISTEN_PLAY_LAYER_TAG) ?? "").trim() === "1";
}

export function setListenPlayActive(board: Blackboard, on: boolean): void {
  writeTag(board, LISTEN_PLAY_LAYER_TAG, on ? "1" : "0");
}

export function readListenState(board: Blackboard): ListenSerialState {
  const bufferRaw = board.getContentByTag(LISTEN_BUFFER_TARGET_TAG);
  const bufferTargetChars = Math.max(
    500,
    Number.parseInt(bufferRaw ?? "", 10) || DEFAULT_BUFFER_TARGET_CHARS,
  );
  const consumedRaw = board.getContentByTag(LISTEN_CONSUMED_CHARS_TAG);
  const consumedChars = Math.max(0, Number.parseInt(consumedRaw ?? "", 10) || 0);
  return {
    phase: parsePhase(board.getContentByTag(LISTEN_PHASE_TAG)),
    thrill: (board.getContentByTag(LISTEN_THRILL_TAG) ?? "").trim(),
    world: (board.getContentByTag(LISTEN_WORLD_TAG) ?? "").trim(),
    structure: (board.getContentByTag(LISTEN_STRUCTURE_TAG) ?? "").trim(),
    outline: parseJson<OutlineItem[]>(board.getContentByTag(LISTEN_OUTLINE_TAG), []),
    sections: parseJson<SectionItem[]>(
      board.getContentByTag(LISTEN_SECTIONS_TAG),
      [],
    ),
    summaries: parseJson<string[]>(
      board.getContentByTag(LISTEN_SUMMARIES_TAG),
      [],
    ),
    bufferTargetChars,
    consumedChars,
  };
}

function writeTag(board: Blackboard, tag: string, content: string): void {
  board.write({ tag, content, source: "agent" });
}

export function writeListenPhase(board: Blackboard, phase: ListenPhase): void {
  writeTag(board, LISTEN_PHASE_TAG, phase);
}

export function writeListenBrief(
  board: Blackboard,
  brief: { thrill: string; world: string; structure: string },
): void {
  writeTag(board, LISTEN_THRILL_TAG, brief.thrill.trim());
  writeTag(board, LISTEN_WORLD_TAG, brief.world.trim());
  writeTag(board, LISTEN_STRUCTURE_TAG, brief.structure.trim());
}

export function writeListenOutline(board: Blackboard, outline: OutlineItem[]): void {
  writeTag(board, LISTEN_OUTLINE_TAG, JSON.stringify(outline));
}

export function writeListenSections(board: Blackboard, sections: SectionItem[]): void {
  writeTag(board, LISTEN_SECTIONS_TAG, JSON.stringify(sections));
}

export function writeListenSummaries(board: Blackboard, summaries: string[]): void {
  const trimmed = summaries
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(-MAX_SUMMARIES_IN_CONTEXT);
  writeTag(board, LISTEN_SUMMARIES_TAG, JSON.stringify(trimmed));
}

export function writeConsumedChars(board: Blackboard, n: number): void {
  writeTag(board, LISTEN_CONSUMED_CHARS_TAG, String(Math.max(0, Math.floor(n))));
}

export function ensureBufferTarget(board: Blackboard): number {
  const existing = board.getContentByTag(LISTEN_BUFFER_TARGET_TAG);
  if (!existing?.trim()) {
    writeTag(board, LISTEN_BUFFER_TARGET_TAG, String(DEFAULT_BUFFER_TARGET_CHARS));
    return DEFAULT_BUFFER_TARGET_CHARS;
  }
  return Math.max(
    500,
    Number.parseInt(existing, 10) || DEFAULT_BUFFER_TARGET_CHARS,
  );
}

export function unreadChars(state: ListenSerialState): number {
  const total = state.sections.reduce((n, s) => n + s.text.length, 0);
  return Math.max(0, total - state.consumedChars);
}

export function toListenView(
  state: ListenSerialState,
  playActive = false,
): ListenSerialView {
  return {
    phase: state.phase,
    playActive,
    thrill: state.thrill,
    world: state.world,
    structure: state.structure,
    outline: state.outline.map((o) => ({
      id: o.id,
      title: o.title,
      status: o.status,
      payoff: o.payoff,
    })),
    sections: state.sections.map((s) => ({
      id: s.id,
      outlineId: s.outlineId,
      title: s.title,
      text: s.text,
      summary: s.summary,
      consumedChars: s.consumedChars,
    })),
    unreadChars: unreadChars(state),
    bufferTargetChars: state.bufferTargetChars,
    consumedChars: state.consumedChars,
  };
}

/** 未写完的大纲项 */
export function nextPendingOutline(state: ListenSerialState): OutlineItem | undefined {
  return state.outline.find((o) => o.status === "pending");
}

export function makeOutlineItems(
  titles: string[],
  payoffTitle?: string,
): OutlineItem[] {
  const payoff = (payoffTitle ?? titles[titles.length - 1] ?? "").trim();
  return titles
    .map((t) => t.trim())
    .filter(Boolean)
    .map((title) => ({
      id: randomUUID(),
      title,
      status: "pending" as const,
      payoff: payoff ? title === payoff : false,
    }));
}

/** 插嘴：丢掉未消费正文尾部，并把对应大纲改回 pending / 用新标题替换未完成段 */
export function applyRedirectCut(
  state: ListenSerialState,
  newPendingTitles: string[],
): Pick<ListenSerialState, "outline" | "sections" | "summaries" | "consumedChars"> {
  let keptChars = 0;
  const keptSections: SectionItem[] = [];
  for (const sec of state.sections) {
    const remaining = sec.text.length - sec.consumedChars;
    if (sec.consumedChars <= 0 && remaining === sec.text.length) {
      // 整节未消费：丢弃
      continue;
    }
    if (sec.consumedChars >= sec.text.length) {
      keptSections.push(sec);
      keptChars += sec.text.length;
      continue;
    }
    // 部分消费：截断到已消费
    const cutText = sec.text.slice(0, sec.consumedChars);
    keptSections.push({
      ...sec,
      text: cutText,
      summary: sec.summary,
      consumedChars: cutText.length,
    });
    keptChars += cutText.length;
  }

  const doneOutlineIds = new Set(
    keptSections.map((s) => s.outlineId).filter(Boolean),
  );
  const keptOutline = state.outline
    .filter((o) => o.status === "done" && doneOutlineIds.has(o.id))
    .map((o) => ({ ...o, status: "done" as const }));

  const newItems = makeOutlineItems(newPendingTitles);
  // 最后一节标为兑现
  if (newItems.length) {
    for (const item of newItems) item.payoff = false;
    newItems[newItems.length - 1]!.payoff = true;
  }

  const summaries = keptSections
    .map((s) => s.summary)
    .filter(Boolean)
    .slice(-MAX_SUMMARIES_IN_CONTEXT);

  return {
    outline: [...keptOutline, ...newItems],
    sections: keptSections,
    summaries,
    consumedChars: keptChars,
  };
}

export function markOutlineDone(
  outline: OutlineItem[],
  outlineId: string,
): OutlineItem[] {
  return outline.map((o) =>
    o.id === outlineId ? { ...o, status: "done" as const } : o,
  );
}

export function isConfirmText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /^(确认|就这样|开始|可以|好的|没问题|开写|写吧)([！!。．\s]*)$/u.test(t);
}

export function isNextWaveText(text: string): boolean {
  const t = text.trim();
  return /下一波|再来一波|继续下一|开下一波/u.test(t);
}

export function isEndText(text: string): boolean {
  const t = text.trim();
  return /^(收工|结束|完结|停)([！!。．\s]*)$/u.test(t);
}
