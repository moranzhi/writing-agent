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
  messageBranchState?: PersistedMessageBranchState;
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
  /** 全量 LLM 请求上下文（可选；按设置只保留最新 N 条） */
  contextTrace?: {
    caller: string;
    createdAt: string;
    messages: Array<{ role: string; content: string }>;
    charCount: number;
    model?: string;
  };
  branchGroupId?: string;
  branchIndex?: number;
  branchTotal?: number;
};

export type PersistedMessageBranchState = {
  branches: Record<
    string,
    {
      anchorIndex: number;
      groupId: string;
      activeIndex: number;
      variants: Array<{
        messages: PersistedChatMessage[];
        checkpoint: {
          runtimeSession: RuntimeSession;
          blackboardItems: BlackboardItem[];
        };
      }>;
    }
  >;
  preMessageCheckpoints: Record<
    string,
    {
      runtimeSession: RuntimeSession;
      blackboardItems: BlackboardItem[];
    }
  >;
};
