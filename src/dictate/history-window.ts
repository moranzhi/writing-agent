import type { DictateChatTurn } from "./types.js";

/**
 * 创作上下文保留的更早对话轮数。
 * 1 轮 = 一次用户输入 + 一次助手输出（不含本轮正在处理的末句用户话）。
 * 默认 2；0 = 不保留更早对话；负数 = 不限制。
 * 可用环境变量 `DICTATE_HISTORY_TURNS` 或调用参数覆盖。
 */
export const DEFAULT_DICTATE_HISTORY_TURNS = 2;

export function resolveDictateHistoryTurns(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return Math.trunc(override);
  }
  const raw = process.env.DICTATE_HISTORY_TURNS?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return DEFAULT_DICTATE_HISTORY_TURNS;
}

/**
 * 裁剪进模型的对话：保留末句用户输入 + 最近 `historyTurns` 轮更早问答。
 * `historyTurns < 0` 时原样返回。
 */
export function clipDictateDialogue(
  dialogue: DictateChatTurn[],
  historyTurns: number,
): DictateChatTurn[] {
  if (historyTurns < 0) return dialogue;
  const last = dialogue.at(-1);
  const hasCurrentUser = last?.role === "user";
  const earlier = hasCurrentUser ? dialogue.slice(0, -1) : [...dialogue];
  const current = hasCurrentUser && last ? [last] : [];
  if (historyTurns === 0) return current;

  let userCount = 0;
  let start = 0;
  for (let i = earlier.length - 1; i >= 0; i -= 1) {
    if (earlier[i]?.role === "user") {
      userCount += 1;
      if (userCount === historyTurns) {
        start = i;
        break;
      }
    }
  }
  return [...earlier.slice(start), ...current];
}
