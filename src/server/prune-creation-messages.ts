/**
 * 创作过程对话策略（与黑板固定上下文正交）：
 * - session.messages：全量保留，供用户浏览（编辑分支只暴露当前认可版本）
 * - 拼给 AI 的「创作.对话」：用户全量 + AI 永远只留最后一次（含未完成提问）
 *
 * 「隐藏 AI 历史」只作用于拼接，不删、不藏用户可见消息。
 */

export type DialogueChatMessage = {
  id: string;
  role: "system" | "user";
  text: string;
  createdAt?: string;
  kind?: string;
  actor?: string;
  title?: string;
  body?: string;
  compressed?: boolean;
};

/** @deprecated 用 DialogueChatMessage */
export type PrunableChatMessage = DialogueChatMessage;

/** 写入黑板、注入 design worker 的对话 transcript tag */
export const CREATION_DIALOGUE_TAG = "创作.对话";

const AI_CONTENT_KINDS = new Set([
  "worker_output",
  "worker_questions",
  "orchestrator_thinking",
  "orchestrator_decision",
]);

const AI_EPHEMERAL_KINDS = new Set(["worker_running", "worker_stub", "agent_tool"]);

function isAiContent(m: DialogueChatMessage): boolean {
  const kind = m.kind ?? "";
  if (AI_CONTENT_KINDS.has(kind)) return true;
  if (m.role === "system" && kind.startsWith("worker_")) return true;
  return false;
}

function isAiEphemeral(m: DialogueChatMessage): boolean {
  return AI_EPHEMERAL_KINDS.has(m.kind ?? "");
}

function isUserMessage(m: DialogueChatMessage): boolean {
  return m.role === "user" || m.kind === "user_input";
}

/**
 * 从全量 messages 选出「拼给 AI」的视图：全部用户 + 最后一次 AI 内容。
 * 不修改原数组。
 */
export function selectCreationDialogueForAi<T extends DialogueChatMessage>(
  messages: readonly T[],
): T[] {
  let lastAiIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isAiContent(messages[i]!)) {
      lastAiIdx = i;
      break;
    }
  }

  const out: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.compressed) continue;
    if (isUserMessage(m)) {
      out.push(m);
      continue;
    }
    if (isAiEphemeral(m)) continue;
    if (isAiContent(m) && i === lastAiIdx) out.push(m);
  }
  return out;
}

/**
 * @deprecated 勿再改写 session.messages；改用 selectCreationDialogueForAi / buildCreationDialogueTranscript。
 * 保留空操作兼容旧调用点。
 */
export function trimCreationDialogueMessages<T extends DialogueChatMessage>(
  _messages: T[],
): { removedCount: number } {
  return { removedCount: 0 };
}

function displayText(m: DialogueChatMessage): string {
  const body = (m.body ?? m.text ?? "").trim();
  return body || "（空）";
}

/** 拼给 design worker 的对话前情（用户全量 + 最后一次 AI；不改 messages） */
export function buildCreationDialogueTranscript(
  messages: readonly DialogueChatMessage[],
): string {
  const selected = selectCreationDialogueForAi(messages);
  const lines: string[] = [
    "以下为创作过程对话（用户发言全部保留；AI 仅保留最后一次输出，含未完成提问）。",
    "",
  ];
  for (const m of selected) {
    if (isUserMessage(m)) {
      lines.push(`### 用户`);
      lines.push(displayText(m));
      lines.push("");
      continue;
    }
    if (isAiContent(m)) {
      const who =
        m.kind === "worker_questions"
          ? `AI · ${m.actor ?? "worker"} 提问`
          : m.kind === "worker_output"
            ? `AI · ${m.actor ?? "worker"} 产出`
            : m.kind === "orchestrator_thinking"
              ? "AI · 总管思考"
              : `AI · ${m.title ?? m.kind ?? "系统"}`;
      lines.push(`### ${who}`);
      lines.push(displayText(m));
      lines.push("");
    }
  }
  const text = lines.join("\n").trim();
  return text || "（尚无创作对话）";
}

/**
 * @deprecated 创作验收后不再删 messages（用户可继续浏览）。保留空操作兼容。
 */
export function pruneCreationUnitMessages<T extends DialogueChatMessage>(
  _messages: T[],
  _workerId: string,
  _options: { afterCreatedAt?: string | null } = {},
): { removedCount: number; productKept: boolean } {
  return { removedCount: 0, productKept: false };
}

/** Run 验收：过程消息标 compressed（主 feed 隐藏），不删除。 */
export function foldRunProcessMessages<T extends DialogueChatMessage>(
  messages: T[],
  workerId: string,
): void {
  for (const m of messages) {
    if (m.compressed) continue;
    if (
      (m.kind === "worker_questions" || m.kind === "worker_running") &&
      (m.actor === workerId || (m.text ?? "").includes(workerId))
    ) {
      m.compressed = true;
      continue;
    }
    if (
      m.kind === "worker_output" &&
      m.actor === workerId &&
      !String(m.text ?? "").includes("[上下文已压缩]")
    ) {
      m.compressed = true;
    }
  }
}
