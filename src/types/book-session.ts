import type { BlackboardItem } from "../types/blackboard.js";
import type { RuntimeSession } from "../types/runtime.js";

/** 磁盘上保存的 Book 绑定的 Session 快照（用于续作） */
export type PersistedBookSession = {
  version: 1;
  sessionId: string;
  bookId: string;
  orchestratorId?: string;
  runtimeSession: RuntimeSession;
  blackboardItems: BlackboardItem[];
  messages: PersistedChatMessage[];
  savedAt: string;
};

/** 与 session-manager ChatMessage 同形，独立类型避免循环依赖 */
export type PersistedChatMessage = {
  id: string;
  role: "system" | "user";
  text: string;
  createdAt: string;
  kind?: string;
  actor?: string;
  title?: string;
  body?: string;
  thinking?: string;
  tokenUsage?: {
    totalTokens: number;
    cachedTokens?: number;
    cacheMissTokens?: number;
    caller?: string;
    model?: string;
  };
};
