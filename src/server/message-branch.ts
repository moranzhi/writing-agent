import { randomUUID } from "node:crypto";
import type { BlackboardItem } from "../types/blackboard.js";
import type { RuntimeSession } from "../types/runtime.js";

export type BranchableMessage = {
  id: string;
  role: "system" | "user";
  text: string;
  createdAt: string;
  kind?: string;
  actor?: string;
  title?: string;
  body?: string;
  branchGroupId?: string;
  branchIndex?: number;
  branchTotal?: number;
};

export type SessionCheckpoint = {
  runtimeSession: RuntimeSession;
  blackboardItems: BlackboardItem[];
};

export type MessageBranchVariant = {
  /** 从分支点起的消息链（含分支点消息本身） */
  messages: BranchableMessage[];
  checkpoint: SessionCheckpoint;
};

export type MessageBranch = {
  anchorIndex: number;
  groupId: string;
  variants: MessageBranchVariant[];
  activeIndex: number;
};

export type MessageBranchState = {
  branches: Record<string, MessageBranch>;
  /** 下标 i = 追加 messages[i] 之前的 runtime 快照 */
  preMessageCheckpoints: Record<number, SessionCheckpoint>;
};

export function createMessageBranchState(): MessageBranchState {
  return { branches: {}, preMessageCheckpoints: {} };
}

export function cloneCheckpoint(cp: SessionCheckpoint): SessionCheckpoint {
  return {
    runtimeSession: structuredClone(cp.runtimeSession),
    blackboardItems: structuredClone(cp.blackboardItems),
  };
}

export function recordPreMessageCheckpoint(
  state: MessageBranchState,
  index: number,
  checkpoint: SessionCheckpoint,
): void {
  state.preMessageCheckpoints[index] = cloneCheckpoint(checkpoint);
}

export function attachBranchMeta(messages: BranchableMessage[], groupId: string, activeIndex: number): void {
  const count = messages.filter((m) => m.branchGroupId === groupId).length || 1;
  const total = Math.max(count, activeIndex + 1);
  for (const m of messages) {
    if (m.branchGroupId === groupId && m.branchIndex === activeIndex) {
      m.branchTotal = total;
    }
  }
}

export function syncBranchTotals(
  messages: BranchableMessage[],
  branch: MessageBranch,
): void {
  const total = branch.variants.length;
  const active = branch.activeIndex;
  const head = branch.variants[active]?.messages[0];
  if (!head) return;
  for (const m of messages) {
    if (m.id === head.id || (m.branchGroupId === branch.groupId && m.branchIndex === active)) {
      m.branchGroupId = branch.groupId;
      m.branchIndex = active;
      m.branchTotal = total;
    }
  }
}

function cloneMessages(msgs: BranchableMessage[]): BranchableMessage[] {
  return msgs.map((m) => ({ ...m }));
}

export function ensureBranchForEdit(
  state: MessageBranchState,
  messages: BranchableMessage[],
  messageIndex: number,
  checkpoint: SessionCheckpoint,
): MessageBranch {
  const msg = messages[messageIndex];
  const groupId = msg.branchGroupId ?? msg.id;
  let branch = state.branches[groupId];
  if (!branch) {
    branch = {
      anchorIndex: messageIndex,
      groupId,
      activeIndex: 0,
      variants: [
        {
          messages: cloneMessages(messages.slice(messageIndex)),
          checkpoint: cloneCheckpoint(checkpoint),
        },
      ],
    };
    state.branches[groupId] = branch;
    for (const m of messages.slice(messageIndex)) {
      m.branchGroupId = groupId;
      m.branchIndex = 0;
      m.branchTotal = 1;
    }
  }
  return branch;
}

export function ensureBranchForRefresh(
  state: MessageBranchState,
  messages: BranchableMessage[],
  messageIndex: number,
  checkpoint: SessionCheckpoint,
): MessageBranch {
  const msg = messages[messageIndex];
  const groupId = msg.branchGroupId ?? msg.id;
  let branch = state.branches[groupId];
  if (!branch) {
    branch = {
      anchorIndex: messageIndex,
      groupId,
      activeIndex: 0,
      variants: [
        {
          messages: cloneMessages(messages.slice(messageIndex)),
          checkpoint: cloneCheckpoint(checkpoint),
        },
      ],
    };
    state.branches[groupId] = branch;
    for (const m of messages.slice(messageIndex)) {
      m.branchGroupId = groupId;
      m.branchIndex = 0;
      m.branchTotal = 1;
    }
  }
  return branch;
}

export function appendBranchVariant(
  branch: MessageBranch,
  headMessage: BranchableMessage,
  checkpoint: SessionCheckpoint,
): number {
  const index = branch.variants.length;
  branch.variants.push({
    messages: [{ ...headMessage, branchGroupId: branch.groupId, branchIndex: index }],
    checkpoint: cloneCheckpoint(checkpoint),
  });
  branch.activeIndex = index;
  return index;
}

export function updateActiveBranchVariant(
  branch: MessageBranch,
  tailMessages: BranchableMessage[],
  checkpoint: SessionCheckpoint,
): void {
  const variant = branch.variants[branch.activeIndex];
  if (!variant) return;
  variant.messages = cloneMessages(tailMessages);
  variant.checkpoint = cloneCheckpoint(checkpoint);
}

export function switchBranchVariant(
  state: MessageBranchState,
  messages: BranchableMessage[],
  groupId: string,
  delta: -1 | 1,
): { messages: BranchableMessage[]; checkpoint: SessionCheckpoint } | null {
  const branch = state.branches[groupId];
  if (!branch) return null;
  const next = branch.activeIndex + delta;
  if (next < 0 || next >= branch.variants.length) return null;
  branch.activeIndex = next;
  const variant = branch.variants[next];
  const prefix = messages.slice(0, branch.anchorIndex);
  const merged = [...prefix, ...cloneMessages(variant.messages)];
  syncBranchTotals(merged, branch);
  return { messages: merged, checkpoint: cloneCheckpoint(variant.checkpoint) };
}

export function createUserVariantMessage(text: string, groupId: string, branchIndex: number): BranchableMessage {
  return {
    id: randomUUID(),
    role: "user",
    text,
    createdAt: new Date().toISOString(),
    kind: "user_input",
    title: "你的输入",
    body: text,
    branchGroupId: groupId,
    branchIndex,
  };
}

export function isRefreshableMessage(msg: BranchableMessage): boolean {
  if (msg.role === "user") return false;
  const kind = msg.kind ?? "system_info";
  return kind === "worker_questions" || kind === "worker_output";
}

export function findPrecedingUserIndex(messages: BranchableMessage[], fromIndex: number): number {
  for (let i = fromIndex - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}
