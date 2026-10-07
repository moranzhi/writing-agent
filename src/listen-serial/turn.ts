import { randomUUID } from "node:crypto";
import type { Blackboard } from "../blackboard/blackboard.js";
import type { LlmProvider } from "../llm/client.js";
import {
  llmIntake,
  llmNextWave,
  llmOutline,
  llmRedirect,
  llmSection,
} from "./generate.js";
import {
  applyRedirectCut,
  ensureBufferTarget,
  isConfirmText,
  isEndText,
  isNextWaveText,
  makeOutlineItems,
  markOutlineDone,
  nextPendingOutline,
  readListenState,
  unreadChars,
  writeConsumedChars,
  writeListenBrief,
  writeListenOutline,
  writeListenPhase,
  writeListenSections,
  writeListenSummaries,
} from "./state.js";
import { MAX_SECTIONS_PER_BURST, type ListenSerialState } from "./types.js";

export type ListenChatTurn = { role: "user" | "assistant"; text: string };

export type ListenSerialTurnResult = {
  reply: string;
  /** 本轮是否进入/保持软停 */
  softStop?: boolean;
};

function persistState(
  board: Blackboard,
  state: ListenSerialState,
  patch: Partial<ListenSerialState>,
): ListenSerialState {
  const next: ListenSerialState = { ...state, ...patch };
  if (patch.phase) writeListenPhase(board, patch.phase);
  if (patch.thrill != null || patch.world != null || patch.structure != null) {
    writeListenBrief(board, {
      thrill: next.thrill,
      world: next.world,
      structure: next.structure,
    });
  }
  if (patch.outline) writeListenOutline(board, next.outline);
  if (patch.sections) writeListenSections(board, next.sections);
  if (patch.summaries) writeListenSummaries(board, next.summaries);
  if (patch.consumedChars != null) writeConsumedChars(board, next.consumedChars);
  return next;
}

async function fillBuffer(
  llm: LlmProvider,
  board: Blackboard,
  state: ListenSerialState,
): Promise<{ state: ListenSerialState; notes: string[]; softStop: boolean }> {
  let cur = state;
  const notes: string[] = [];
  let softStop = false;
  let wrote = 0;

  while (
    unreadChars(cur) < cur.bufferTargetChars &&
    wrote < MAX_SECTIONS_PER_BURST
  ) {
    const pending = nextPendingOutline(cur);
    if (!pending) {
      softStop = true;
      break;
    }
    const section = await llmSection(llm, cur, pending.title);
    if (!section.text) {
      notes.push(`「${pending.title}」正文为空，已跳过。`);
      cur = persistState(board, cur, {
        outline: markOutlineDone(cur.outline, pending.id),
      });
      wrote += 1;
      continue;
    }
    const item = {
      id: randomUUID(),
      outlineId: pending.id,
      title: pending.title,
      text: section.text,
      summary: section.summary || pending.title,
      consumedChars: 0,
    };
    const summaries = [...cur.summaries, item.summary];
    let outline = markOutlineDone(cur.outline, pending.id);
    cur = persistState(board, cur, {
      outline,
      sections: [...cur.sections, item],
      summaries,
      phase: "running",
    });
    notes.push(`已写：${pending.title}（${section.text.length} 字）`);
    wrote += 1;

    if (pending.payoff || section.fulfilled) {
      // 兑现后把剩余 pending 标 cut，进入软停（缓冲里已有兑现节可听完）
      outline = cur.outline.map((o) =>
        o.status === "pending" ? { ...o, status: "cut" as const } : o,
      );
      cur = persistState(board, cur, { outline, phase: "soft_stop" });
      softStop = true;
      notes.push("本段爽点已兑现，听完缓冲后可「下一波」或「收工」。");
      break;
    }
  }

  if (!softStop && !nextPendingOutline(cur) && unreadChars(cur) > 0) {
    cur = persistState(board, cur, { phase: "soft_stop" });
    softStop = true;
  }

  return { state: cur, notes, softStop };
}

function formatUnreadLine(state: ListenSerialState): string {
  const n = unreadChars(state);
  return `目前约有 ${n} 字未读/未听（目标缓冲 ${state.bufferTargetChars} 字）。`;
}

function formatOutlineLine(state: ListenSerialState): string {
  if (!state.outline.length) return "";
  return (
    "大纲：\n" +
    state.outline
      .map((o) => {
        const mark =
          o.status === "done" ? "✓" : o.status === "cut" ? "×" : "·";
        const pay = o.payoff ? "（兑现）" : "";
        return `${mark} ${o.title}${pay}`;
      })
      .join("\n")
  );
}

/**
 * 听书连载单轮：开书 / 确认 / 补货 / 插嘴 / 软停续波。
 */
export async function runListenSerialTurn(params: {
  llm: LlmProvider;
  board: Blackboard;
  dialogue: ListenChatTurn[];
  userText: string;
}): Promise<ListenSerialTurnResult> {
  const { llm, board, dialogue, userText } = params;
  ensureBufferTarget(board);
  let state = readListenState(board);
  const text = userText.trim();

  // —— 软停：收工 / 下一波 ——
  if (state.phase === "soft_stop") {
    if (isEndText(text)) {
      return {
        reply: "本局收工。想再开可以新建作品，或再说「下一波」。",
        softStop: true,
      };
    }
    if (isNextWaveText(text) || /继续|再来/u.test(text)) {
      const wave = await llmNextWave(llm, state);
      if (wave.thrill) {
        state = persistState(board, state, { thrill: wave.thrill });
      }
      const outline = makeOutlineItems(wave.titles, wave.payoffTitle);
      state = persistState(board, state, {
        outline,
        phase: "running",
      });
      const filled = await fillBuffer(llm, board, state);
      state = filled.state;
      const parts = [
        wave.reply,
        formatOutlineLine(state),
        filled.notes.join("\n"),
        formatUnreadLine(state),
      ].filter(Boolean);
      if (filled.softStop) {
        parts.push("本波已兑现。可输入「下一波」或「收工」。");
      }
      return { reply: parts.join("\n\n"), softStop: filled.softStop };
    }
    // 软停时其他话当作插嘴改向再开波
  }

  // —— 等待确认 ——
  if (state.phase === "awaiting_confirm") {
    if (!isConfirmText(text) && text && !/确认|开始|开写/u.test(text)) {
      // 用户继续改需求 → 回到 intake 再提案
      const intake = await llmIntake(llm, dialogue);
      if (intake.type === "ask") {
        state = persistState(board, state, { phase: "intake" });
        return { reply: intake.reply };
      }
      state = persistState(board, state, {
        phase: "awaiting_confirm",
        thrill: intake.thrill,
        world: intake.world,
        structure: intake.structure,
      });
      return {
        reply: `${intake.reply}\n\n【核心爽点】${intake.thrill}\n【一句世界】${intake.world}\n【结构】${intake.structure}\n\n回复「确认」开始生成大纲与正文。`,
      };
    }

    const outlined = await llmOutline(llm, state);
    const outline = makeOutlineItems(outlined.titles, outlined.payoffTitle);
    state = persistState(board, state, { outline, phase: "running" });
    const filled = await fillBuffer(llm, board, state);
    state = filled.state;
    return {
      reply: [
        outlined.reply,
        formatOutlineLine(state),
        filled.notes.join("\n"),
        formatUnreadLine(state),
        filled.softStop
          ? "本段已兑现。可「下一波」或「收工」。"
          : "不满意某桥段就直接说一句意见，我会改后面的走向。",
      ]
        .filter(Boolean)
        .join("\n\n"),
      softStop: filled.softStop,
    };
  }

  // —— 连载中：空输入/继续 = 补货；有意见 = 改向 ——
  if (state.phase === "running" || state.phase === "soft_stop") {
    const isContinue =
      !text ||
      /^(继续|接着写|补货|下一节)([！!。．\s]*)$/u.test(text);

    if (!isContinue && text) {
      const redirect = await llmRedirect(llm, state, text);
      const cut = applyRedirectCut(state, redirect.titles);
      // 重新标记 payoff
      const outline = cut.outline.map((o, i, arr) => ({
        ...o,
        payoff:
          o.status === "pending" &&
          (o.title === redirect.payoffTitle || i === arr.length - 1),
      }));
      // 只让最后一个 pending 为 payoff
      let lastPending = -1;
      outline.forEach((o, i) => {
        if (o.status === "pending") lastPending = i;
        if (o.status === "pending") o.payoff = false;
      });
      if (lastPending >= 0) outline[lastPending]!.payoff = true;

      state = persistState(board, state, {
        ...cut,
        outline,
        phase: "running",
        ...(redirect.thrillOverride
          ? { thrill: redirect.thrillOverride }
          : {}),
      });
      const filled = await fillBuffer(llm, board, state);
      state = filled.state;
      return {
        reply: [
          redirect.reply,
          formatOutlineLine(state),
          filled.notes.join("\n"),
          formatUnreadLine(state),
        ]
          .filter(Boolean)
          .join("\n\n"),
        softStop: filled.softStop,
      };
    }

    const filled = await fillBuffer(llm, board, state);
    state = filled.state;
    if (!filled.notes.length && unreadChars(state) >= state.bufferTargetChars) {
      return {
        reply: `${formatUnreadLine(state)}\n缓冲仍充足。听/读一些后再说「继续」，或直接一句意见改向。`,
        softStop: state.phase === "soft_stop",
      };
    }
    return {
      reply: [
        filled.notes.join("\n") || "已尝试补货。",
        formatOutlineLine(state),
        formatUnreadLine(state),
        filled.softStop ? "本段已兑现。可「下一波」或「收工」。" : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      softStop: filled.softStop,
    };
  }

  // —— intake ——
  const intake = await llmIntake(llm, dialogue);
  if (intake.type === "ask") {
    state = persistState(board, state, { phase: "intake" });
    return { reply: intake.reply };
  }
  if (!intake.thrill || !intake.world) {
    return {
      reply: intake.reply || "还需要核心爽点和一句世界，请再补一句。",
    };
  }
  state = persistState(board, state, {
    phase: "awaiting_confirm",
    thrill: intake.thrill,
    world: intake.world,
    structure: intake.structure || "三段式：铺垫冲突 → 对抗升级 → 爽点兑现",
  });
  return {
    reply: `${intake.reply}\n\n【核心爽点】${intake.thrill}\n【一句世界】${intake.world}\n【结构】${state.structure}\n\n回复「确认」开始生成大纲与正文。`,
  };
}

/** 前端标记已读：推进消费指针 */
export function markListenConsumed(
  board: Blackboard,
  absoluteConsumedChars: number,
): ListenSerialState {
  const state = readListenState(board);
  const total = state.sections.reduce((n, s) => n + s.text.length, 0);
  const next = Math.max(0, Math.min(total, Math.floor(absoluteConsumedChars)));
  let remaining = next;
  const sections = state.sections.map((sec) => {
    const take = Math.min(sec.text.length, Math.max(0, remaining));
    remaining -= take;
    return { ...sec, consumedChars: take };
  });
  writeListenSections(board, sections);
  writeConsumedChars(board, next);
  return { ...state, sections, consumedChars: next };
}
