/**
 * 对话.历史：排序表中的可投影「标签」，不是硬锚点分区。
 * 规范：docs/context-fragment-design.md
 */
export const DIALOGUE_HISTORY_TAG = "对话.历史";

/** 兼容别名（排序表 / 旧文档） */
const HISTORY_ALIASES = new Set([
  DIALOGUE_HISTORY_TAG,
  "history",
  "chat.history",
  "对话历史",
  "历史对话",
]);

export function isDialogueHistoryRef(ref: string): boolean {
  return HISTORY_ALIASES.has(ref.trim());
}

export type HistoryProjection = "fixed" | "full" | "summary" | "fields";

/**
 * 按投影级别裁剪历史正文。
 * - fixed：几乎不注入（占位一句）
 * - fields：最近约 5 段
 * - summary：最近约 20 段
 * - full：最近约 80 段（或整段若更短）
 */
export function projectDialogueHistory(
  raw: string,
  projection?: string,
): string {
  const text = (raw || "").trim();
  const mode = (projection || "full").trim().toLowerCase();
  if (!text) {
    return mode === "fixed" ? "" : "（尚无对话历史）";
  }
  if (mode === "fixed") return "（本步不注入历史正文）";

  const blocks = splitHistoryBlocks(text);
  const n =
    mode === "fields" ? 5 : mode === "summary" || mode === "brief" ? 20 : 80;
  const sliced = blocks.length > n ? blocks.slice(-n) : blocks;
  const body = sliced.join("\n\n");
  if (blocks.length > n) {
    return `（仅最近 ${n} 段，更早已省略）\n\n${body}`;
  }
  return body;
}

function splitHistoryBlocks(text: string): string[] {
  const byFence = text
    .split(/\n(?=##\s|【|用户[:：]|助手[:：]|系统[:：])/u)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byFence.length >= 2) return byFence;
  const byBlank = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byBlank.length >= 2) return byBlank;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines : [text];
}

/** 追加一轮用户/系统可见内容到历史正文 */
export function appendDialogueHistoryTurn(
  existing: string,
  turn: { role: "用户" | "助手" | "系统"; text: string },
): string {
  const body = turn.text.trim();
  if (!body) return (existing || "").trim();
  const block = `## ${turn.role}\n\n${body}`;
  const prev = (existing || "").trim();
  return prev ? `${prev}\n\n${block}` : block;
}

/**
 * 若尚无 对话.历史，用事件流等拼一份可读底稿（仅用于投影，不强制回写）。
 */
export function buildHistoryFallback(params: {
  dialogueHistory?: string;
  eventStream?: string;
  latestUser?: string;
}): string {
  const hist = params.dialogueHistory?.trim();
  if (hist) return hist;
  const parts: string[] = [];
  if (params.eventStream?.trim()) {
    parts.push(`## 事件流\n\n${params.eventStream.trim()}`);
  }
  if (params.latestUser?.trim()) {
    parts.push(`## 用户\n\n${params.latestUser.trim()}`);
  }
  return parts.join("\n\n");
}
