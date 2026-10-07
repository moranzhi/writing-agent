import { createHash } from "node:crypto";
import type { ToolDefinition } from "./client.js";

/** 一段请求的位置标签。只存标签、字数和哈希，不存正文。 */
export type ContextSegment = {
  tag: string;
  chars: number;
  hash: string;
};

/** 挂在一条回复上的各次请求轮廓，选题和填写都保留。 */
export type RequestOutline = {
  at: string;
  caller: string;
  step?: string;
  turnId?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cacheMissTokens?: number;
  cacheWriteTokens?: number;
  segments: ContextSegment[];
};

/** 和同会话上一条请求比，前缀从哪里开始对不上。 */
export type CacheBreakInfo = {
  /** 本窗口里没有更早的同会话请求 */
  cold: boolean;
  /** -1：本条在上一请求的前缀里整段对上 */
  breakAt: number;
  tag?: string;
  /** 断点之前、和上一请求逐段相同的段数 */
  matched: number;
};

const SPLIT =
  /(?:^|\n)(#{2,4} [^\n]+|最后一轮用户输入|【用户】|【助手】)/g;

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function segment(tag: string, text: string): ContextSegment {
  return { tag, chars: text.length, hash: hashText(text) };
}

function headingTag(title: string): string {
  const beforeOrder = title.split("〔")[0]?.trim() ?? title;
  const beforeParen = beforeOrder.split(/（|\(/)[0]?.trim() ?? beforeOrder;
  const beforeAt = beforeParen.split(" @ ")[0]?.trim() ?? beforeParen;
  const tag = (beforeAt || title).trim();
  return tag.length > 48 ? `${tag.slice(0, 48)}…` : tag;
}

function collectMarks(content: string): Array<{ index: number; tag: string }> {
  const marks: Array<{ index: number; tag: string }> = [];
  let section = "";
  for (const match of content.matchAll(SPLIT)) {
    const raw = match[1] ?? "";
    const start = (match.index ?? 0) + (match[0].startsWith("\n") ? 1 : 0);
    if (raw.startsWith("#")) {
      const level = /^#+/.exec(raw)?.[0].length ?? 2;
      const title = raw.replace(/^#+\s*/, "");
      const tag = headingTag(title);
      if (level === 2) section = tag;
      marks.push({ index: start, tag });
      continue;
    }
    if (raw === "最后一轮用户输入" && section.startsWith("本轮")) {
      marks.push({ index: start, tag: "最后一轮用户输入" });
      continue;
    }
    if (
      (raw === "【用户】" || raw === "【助手】") &&
      section.startsWith("更早的对话")
    ) {
      marks.push({
        index: start,
        tag: raw === "【用户】" ? "更早·用户" : "更早·助手",
      });
    }
  }
  return marks;
}

/** 把一块正文切成有序标签。前缀里的标题与更早对话轮次分开，方便对上断点。 */
export function outlineBlock(fallbackTag: string, content: string): ContextSegment[] {
  if (!content) return [];
  const marks = collectMarks(content);
  if (marks.length === 0) return [segment(fallbackTag, content)];
  const out: ContextSegment[] = [];
  if (marks[0]!.index > 0) {
    const head = content.slice(0, marks[0]!.index);
    if (head.trim()) out.push(segment(fallbackTag, head));
  }
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1]!.index : content.length;
    out.push(segment(marks[i]!.tag, content.slice(marks[i]!.index, end)));
  }
  return out;
}

function roleTag(role: string): string {
  if (role === "system") return "规则";
  if (role === "user") return "用户";
  if (role === "assistant") return "助手";
  if (role === "tool") return "工具结果";
  return role || "消息";
}

/** 按实际送出的消息切段。工具定义若有，放在正文之前。 */
export function outlineRequest(
  messages: Array<{ role: string; content?: string | null }>,
  tools?: ToolDefinition[],
): ContextSegment[] {
  const out: ContextSegment[] = [];
  if (tools?.length) {
    out.push(segment("工具", JSON.stringify(tools)));
  }
  for (const message of messages) {
    const content = typeof message.content === "string" ? message.content : "";
    out.push(...outlineBlock(roleTag(message.role), content));
  }
  return out;
}

/**
 * 返回下一请求里第一段对不上的下标。
 * 下一请求比上一请求更短、但已有段全部相同，视为整段接上（-1）。
 */
export function firstCacheBreak(
  prev: Array<Pick<ContextSegment, "tag" | "hash">>,
  next: Array<Pick<ContextSegment, "tag" | "hash">>,
): number {
  const shared = Math.min(prev.length, next.length);
  for (let i = 0; i < shared; i++) {
    if (prev[i]!.tag !== next[i]!.tag || prev[i]!.hash !== next[i]!.hash) return i;
  }
  if (next.length > prev.length) return prev.length;
  return -1;
}

export function annotateCacheBreaks<
  T extends { id: string; at: string; sessionId?: string; segments?: ContextSegment[] },
>(records: T[]): Map<string, CacheBreakInfo> {
  const bySession = new Map<string, T[]>();
  for (const record of records) {
    const key = record.sessionId?.trim() || `__none__:${record.id}`;
    const list = bySession.get(key) ?? [];
    list.push(record);
    bySession.set(key, list);
  }
  const marks = new Map<string, CacheBreakInfo>();
  for (const list of bySession.values()) {
    list.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    let prev: ContextSegment[] | undefined;
    for (const record of list) {
      const segments = record.segments ?? [];
      if (!prev) {
        marks.set(record.id, {
          cold: true,
          breakAt: segments.length ? 0 : -1,
          tag: segments[0]?.tag,
          matched: 0,
        });
        prev = segments;
        continue;
      }
      const breakAt = firstCacheBreak(prev, segments);
      marks.set(record.id, {
        cold: false,
        breakAt,
        tag: breakAt >= 0 ? segments[breakAt]?.tag : undefined,
        matched: breakAt < 0 ? segments.length : breakAt,
      });
      prev = segments;
    }
  }
  return marks;
}
