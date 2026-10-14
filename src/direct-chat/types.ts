import type { LlmContextTrace } from "../types/context-trace.js";

/** L1：上下文壳（系统提示 / 设定 / 种子历史等） */
export type DirectChatShellSlots = {
  /** 任务契约 / 系统提示（进 worldBookBefore 任务袋） */
  systemPrompt: string;
  /** 史前设定 */
  loreBefore: string;
  /** 种子历史（拼在多轮之前） */
  seedHistory: string;
  /** 史后状态 */
  loreAfter: string;
  /** 尾注 */
  postTurn: string;
};

export type DirectChatShell = DirectChatShellSlots & {
  id: string;
  name: string;
  /** 缺省用全局 activePresetId */
  presetId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 并列助手窗口（一个 API 配置一列） */
export type DirectChatWindow = {
  id: string;
  profileId: string;
  profileName?: string;
  model?: string;
};

export type DirectChatAssistantReply = {
  windowId: string;
  content: string;
  thinking?: string;
  model?: string;
  error?: string;
  contextTrace?: LlmContextTrace;
};

/** 一轮：共用用户消息 + 各窗口助手回复 */
export type DirectChatTurn = {
  id: string;
  user: { content: string; createdAt: string };
  replies: DirectChatAssistantReply[];
  /**
   * 若选定某窗口：之后所有窗口发下一轮时，本轮助手侧都以该回复进历史。
   * 未选定：各窗口继续用自己的回复。
   */
  selectedWindowId?: string | null;
  createdAt: string;
};

/** 旧版扁平消息（读盘兼容；新写入用 turns） */
export type DirectChatMessageRole = "user" | "assistant";

export type DirectChatMessage = {
  id: string;
  role: DirectChatMessageRole;
  content: string;
  thinking?: string;
  createdAt: string;
  model?: string;
  contextTrace?: LlmContextTrace;
  variants?: Array<{
    content: string;
    thinking?: string;
    model?: string;
    profileId?: string;
    profileName?: string;
  }>;
  branchIndex?: number;
};

/** L2：壳下的具体会话 */
export type DirectChatConversation = {
  id: string;
  shellId: string;
  name: string;
  /** @deprecated 兼容旧数据；优先 turns */
  messages?: DirectChatMessage[];
  windows: DirectChatWindow[];
  turns: DirectChatTurn[];
  createdAt: string;
  updatedAt: string;
};

export type DirectChatShellSummary = {
  id: string;
  name: string;
  presetId: string | null;
  conversationCount: number;
  updatedAt: string;
};

export type DirectChatConversationSummary = {
  id: string;
  shellId: string;
  name: string;
  messageCount: number;
  updatedAt: string;
};

export const EMPTY_SHELL_SLOTS: DirectChatShellSlots = {
  systemPrompt: "",
  loreBefore: "",
  seedHistory: "",
  loreAfter: "",
  postTurn: "",
};

export const DEFAULT_DIRECT_CHAT_SYSTEM =
  "直聊：按上下文与历史继续对话。回答简洁、直接；用户未要求时不另起长篇设定。";

/** 把旧扁平 messages 收成单窗口 turns */
export function migrateMessagesToTurns(
  messages: DirectChatMessage[],
  windowId = "default",
): DirectChatTurn[] {
  const turns: DirectChatTurn[] = [];
  let pendingUser: { content: string; createdAt: string } | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      pendingUser = { content: m.content, createdAt: m.createdAt };
      continue;
    }
    if (m.role === "assistant" && pendingUser) {
      turns.push({
        id: m.id || `turn_${turns.length}`,
        user: pendingUser,
        replies: [
          {
            windowId,
            content: m.content,
            thinking: m.thinking,
            model: m.model,
            contextTrace: m.contextTrace,
          },
        ],
        createdAt: m.createdAt,
      });
      pendingUser = null;
    }
  }
  return turns;
}

/**
 * 为某个窗口拼 prior：用户消息共用；
 * 若该轮 selectedWindowId 有值则全员用选定回复，否则用本窗口自己的回复。
 */
export function buildPriorForWindow(
  turns: DirectChatTurn[],
  windowId: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of turns) {
    const userText = turn.user?.content?.trim();
    if (userText) out.push({ role: "user", content: userText });
    const selected = turn.selectedWindowId?.trim();
    const reply = selected
      ? turn.replies.find((r) => r.windowId === selected)
      : turn.replies.find((r) => r.windowId === windowId);
    const text = reply?.content?.trim();
    if (text) out.push({ role: "assistant", content: text });
  }
  return out;
}

export function countTurnMessages(turns: DirectChatTurn[]): number {
  let n = 0;
  for (const t of turns) {
    if (t.user?.content) n += 1;
    n += t.replies.filter((r) => r.content || r.error).length;
  }
  return n;
}
