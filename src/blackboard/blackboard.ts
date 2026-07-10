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

  listTagIndex(): BlackboardTagIndex[] {
    return [...this.items.values()]
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
  ): BlackboardItem[] {
    if (patterns.some(isFullAccessPattern)) {
      return [...this.items.values()].sort((a, b) =>
        a.updatedAt.localeCompare(b.updatedAt),
      );
    }

    const result: BlackboardItem[] = [];

    for (const pattern of patterns) {
      const matched = [...this.items.values()]
        .filter((item) => tagMatchesPattern(item.tag, pattern))
        .sort(compareItemsByRecency);

      if (matched.length === 0) continue;

      if (merge === "concat" && matched.length > 1) {
        result.push({
          ...matched[0],
          id: `merged:${pattern}`,
          content: matched
            .slice()
            .reverse()
            .map((m) => m.content)
            .join("\n\n---\n\n"),
        });
      } else {
        result.push(matched[0]);
      }
    }

    return result;
  }

  write(input: BlackboardWriteInput): BlackboardItem {
    const now = new Date().toISOString();
    this.writeSeq += 1;
    const existing = this.getLatestByTag(input.tag);
    const item: BlackboardItem = {
      id: randomUUID(),
      tag: input.tag,
      content: input.content,
      source: input.source,
      scope: input.scope ?? existing?.scope,
      createdAt: now,
      updatedAt: `${now}#${this.writeSeq}`,
      dependencies: input.dependencies,
      metadata: input.metadata,
    };
    this.items.set(item.id, item);
    return item;
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
