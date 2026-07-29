import type { BlackboardItem } from "./blackboard.js";
import type { PersistedChatMessage } from "./book-session.js";
import type { RuntimeSession } from "./runtime.js";

/** 实例化完成后的对象，或 run 中某一时刻的完整进度 */
export type SnapshotKind = "instance" | "run";

/**
 * Book 快照（手动保存，可多档）
 * - instance：实例化后的对象（情境、规则、角色设定等），用于复用思想实验框架、换角色重跑
 * - run：运行存档，含轮次进度，读档后续玩
 */
export type RunSnapshot = {
  version: 1;
  id: string;
  bookId: string;
  label: string;
  kind: SnapshotKind;
  /** skill 包 id（兼容旧字段名） */
  orchestratorId?: string;
  runtimeSession: RuntimeSession;
  blackboardItems: BlackboardItem[];
  /** 保存时的对话；实例快照通常较短（到 setup 验收为止） */
  messages: PersistedChatMessage[];
  createdAt: string;
  note?: string;
};

/** 列表展示用，不含正文 payload */
export type RunSnapshotMeta = {
  id: string;
  bookId: string;
  label: string;
  kind: SnapshotKind;
  /** skill 包 id（兼容旧字段名） */
  orchestratorId?: string;
  createdAt: string;
  note?: string;
};

export function toRunSnapshotMeta(snapshot: RunSnapshot): RunSnapshotMeta {
  return {
    id: snapshot.id,
    bookId: snapshot.bookId,
    label: snapshot.label,
    kind: snapshot.kind,
    orchestratorId: snapshot.orchestratorId,
    createdAt: snapshot.createdAt,
    note: snapshot.note,
  };
}

export const SNAPSHOT_KIND_LABELS: Record<SnapshotKind, string> = {
  instance: "创作定稿",
  run: "游玩进度",
};
