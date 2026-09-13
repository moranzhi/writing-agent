/**
 * 快照内「创作产物」列表：按「设计.创作流程」步骤序展开，其余设计/展示 tag 殿后。
 */

import type { BlackboardItem } from "../types/blackboard.js";
import {
  CREATION_FLOW_TAG,
  parseCreationFlow,
} from "../skills/creation-flow.js";

export type SnapshotProductRow = {
  /** 给人看的步骤名或短标签 */
  label: string;
  tag: string;
  content: string;
};

function latestByTag(items: BlackboardItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    const tag = item.tag?.trim();
    if (!tag) continue;
    map.set(tag, typeof item.content === "string" ? item.content : "");
  }
  return map;
}

function isProductTag(tag: string): boolean {
  if (tag === CREATION_FLOW_TAG) return false;
  if (tag.startsWith("设计.") || tag.startsWith("用户.")) return true;
  return tag === "输出.开场白" || tag === "输出.用户展示";
}

/** 从快照黑板抽出可手改产物；有创作流程时按步骤序。 */
export function listSnapshotProducts(
  items: BlackboardItem[],
): SnapshotProductRow[] {
  const byTag = latestByTag(items);
  const out: SnapshotProductRow[] = [];
  const used = new Set<string>();

  const flow = parseCreationFlow(byTag.get(CREATION_FLOW_TAG) ?? null);
  if (flow) {
    for (const step of flow.steps) {
      if (step.role === "prototype") continue;
      const tag = `设计.${step.name}`;
      const content = byTag.get(tag);
      if (content == null || !content.trim()) continue;
      out.push({ label: step.name, tag, content });
      used.add(tag);
    }
  }

  const rest: SnapshotProductRow[] = [];
  for (const [tag, content] of byTag) {
    if (used.has(tag) || !isProductTag(tag) || !content.trim()) continue;
    const label = tag.startsWith("设计.") ? tag.slice("设计.".length) : tag;
    rest.push({ label, tag, content });
  }
  rest.sort((a, b) => a.tag.localeCompare(b.tag, "zh-CN"));
  out.push(...rest);
  return out;
}

/** 覆盖快照黑板某一 tag 的最新条目内容（同 tag 多条时改最后一条；没有则追加）。 */
export function patchBlackboardTagContent(
  items: BlackboardItem[],
  tag: string,
  content: string,
): BlackboardItem[] {
  const trimmedTag = tag.trim();
  if (!trimmedTag) throw new Error("tag 不能为空");
  const next = items.map((item) => ({ ...item }));
  let last = -1;
  for (let i = 0; i < next.length; i++) {
    if (next[i].tag === trimmedTag) last = i;
  }
  const now = new Date().toISOString();
  if (last >= 0) {
    next[last] = { ...next[last], content, updatedAt: now };
    return next;
  }
  next.push({
    id: `manual-${trimmedTag}-${Date.now()}`,
    tag: trimmedTag,
    content,
    source: "user",
    createdAt: now,
    updatedAt: now,
  });
  return next;
}
