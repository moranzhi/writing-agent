import { randomUUID } from "node:crypto";
import { isFullAccessPattern, tagMatchesPattern } from "./tag-match.js";
import type {
  BlackboardItem,
  BlackboardTagIndex,
  BlackboardWriteInput,
} from "../types/blackboard.js";

export class Blackboard {
  private items = new Map<string, BlackboardItem>();
  private writeSeq = 0;

  listTagIndex(options?: { includeArchived?: boolean }): BlackboardTagIndex[] {
    const includeArchived = options?.includeArchived === true;
    return latestItemsByTag([...this.items.values()])
      .filter((item) => includeArchived || item.metadata?.role !== "archived")
      .map(({ id, tag, source, scope, updatedAt }) => ({
        id,
        tag,
        source,
        scope,
        updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): BlackboardItem | undefined {
    return this.items.get(id);
  }

  getLatestByTag(tag: string): BlackboardItem | undefined {
    const matches = [...this.items.values()].filter((item) => item.tag === tag);
    if (matches.length === 0) return undefined;
    return matches.sort((a, b) => compareItemsByRecency(a, b))[0];
  }

  getContentByTag(tag: string): string | undefined {
    return this.getLatestByTag(tag)?.content;
  }

  /**
   * 按 worker inputTags 模式取条目。
   * 同一 pattern 多条命中时：latest 取最新一条；concat 合并 content。
   */
  queryByPatterns(
    patterns: string[],
    merge: "latest" | "concat" = "latest",
    options?: { includeArchived?: boolean },
  ): BlackboardItem[] {
    const includeArchived = options?.includeArchived === true;
    const allItems = [...this.items.values()];

    if (patterns.some(isFullAccessPattern)) {
      const latestByTag = latestItemsByTag(allItems);
      return latestByTag
        .filter((item) => includeArchived || item.metadata?.role !== "archived")
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    }

    const result: BlackboardItem[] = [];

    for (const pattern of patterns) {
      const matchedLatest = latestItemsByTag(
        allItems.filter((item) => tagMatchesPattern(item.tag, pattern)),
      ).filter((item) => includeArchived || item.metadata?.role !== "archived");

      if (matchedLatest.length === 0) continue;

      if (merge === "concat" && matchedLatest.length > 1) {
        const ordered = matchedLatest.sort((a, b) =>
          a.updatedAt.localeCompare(b.updatedAt),
        );
        result.push({
          ...ordered[ordered.length - 1],
          id: `merged:${pattern}`,
          content: ordered.map((m) => m.content).join("\n\n---\n\n"),
        });
      } else {
        result.push(matchedLatest.sort(compareItemsByRecency)[0]);
      }
    }

    return result;
  }

  write(input: BlackboardWriteInput): BlackboardItem {
    const now = new Date().toISOString();
    this.writeSeq += 1;
    const existing = this.getLatestByTag(input.tag);
    const item: BlackboardItem = {
      id: existing?.id ?? randomUUID(),
      tag: input.tag,
      content: input.content,
      source: input.source,
      scope: input.scope ?? existing?.scope,
      createdAt: existing?.createdAt ?? now,
      updatedAt: `${now}#${this.writeSeq}`,
      dependencies: input.dependencies,
      metadata: input.metadata,
    };
    this.items.set(item.id, item);
    return item;
  }

  /** 删除某 tag 的全部条目；返回是否曾存在 */
  deleteByTag(tag: string): boolean {
    const t = tag.trim();
    if (!t) return false;
    let removed = false;
    for (const [id, item] of this.items) {
      if (item.tag === t) {
        this.items.delete(id);
        removed = true;
      }
    }
    return removed;
  }

  seed(items: BlackboardItem[]): void {
    for (const item of items) {
      this.items.set(item.id, item);
    }
  }

  exportItems(): BlackboardItem[] {
    return [...this.items.values()];
  }

  /** 测试 / 调试：当前条目数 */
  size(): number {
    return this.items.size;
  }
}

function compareItemsByRecency(a: BlackboardItem, b: BlackboardItem): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** 每个 tag 只保留最新一条 */
function latestItemsByTag(items: BlackboardItem[]): BlackboardItem[] {
  const byTag = new Map<string, BlackboardItem>();
  for (const item of items) {
    const prev = byTag.get(item.tag);
    if (!prev || item.updatedAt > prev.updatedAt) byTag.set(item.tag, item);
  }
  return [...byTag.values()];
}
