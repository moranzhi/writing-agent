/**
 * 常驻上下文：按 Worker 集 resident_context 挂载到指定 worker。
 * 写入黑板 tag，并并入该 worker 的 static 输入。
 */
import type { Blackboard } from "../blackboard/blackboard.js";

export type ResidentContextEntry = {
  id: string;
  /** 注入位提示：static | dynamic（拼装分层） */
  position?: "static" | "dynamic";
  importance?: number;
  content: string;
  /** 挂载到哪些 worker ref；空 = 全部声明 worker */
  mount?: string[];
  /** 显式 tag；默认 上下文.常驻.{id} */
  tag?: string;
};

export function parseResidentContext(raw: unknown): ResidentContextEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ResidentContextEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id =
      typeof row.id === "string"
        ? row.id.trim()
        : typeof row.key === "string"
          ? row.key.trim()
          : "";
    const content =
      typeof row.content === "string"
        ? row.content
        : typeof row.text === "string"
          ? row.text
          : typeof row.summary === "string"
            ? row.summary
            : "";
    if (!id || !content.trim()) continue;
    const mount = Array.isArray(row.mount)
      ? row.mount
          .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
          .map((m) => m.trim())
      : Array.isArray(row.workers)
        ? row.workers
            .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
            .map((m) => m.trim())
        : undefined;
    const position =
      row.position === "dynamic" || row.tier === "dynamic"
        ? "dynamic"
        : row.position === "static" || row.tier === "static"
          ? "static"
          : "static";
    out.push({
      id,
      position,
      importance:
        typeof row.importance === "number" ? row.importance : undefined,
      content: content.trim(),
      mount,
      tag: typeof row.tag === "string" && row.tag.trim() ? row.tag.trim() : undefined,
    });
  }
  return out.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
}

export function residentTagFor(entry: ResidentContextEntry): string {
  return entry.tag ?? `上下文.常驻.${entry.id}`;
}

export function entriesForWorker(
  entries: ResidentContextEntry[],
  workerId: string,
): ResidentContextEntry[] {
  const id = workerId.trim();
  return entries.filter((e) => {
    if (!e.mount || e.mount.length === 0) return true;
    return e.mount.includes(id);
  });
}

/**
 * 把匹配本 worker 的常驻块写入黑板，返回应并入 inputTags 的 tag 列表（按 position）。
 */
export function mountResidentContextForWorker(params: {
  blackboard: Blackboard;
  entries: ResidentContextEntry[];
  workerId: string;
  source?: string;
}): { staticTags: string[]; dynamicTags: string[]; written: string[] } {
  const matched = entriesForWorker(params.entries, params.workerId);
  const staticTags: string[] = [];
  const dynamicTags: string[] = [];
  const written: string[] = [];
  const source = params.source ?? "system:resident-context";

  for (const entry of matched) {
    const tag = residentTagFor(entry);
    const existing = params.blackboard.getContentByTag(tag);
    if (existing !== entry.content) {
      params.blackboard.write({
        tag,
        content: entry.content,
        source,
      });
      written.push(tag);
    }
    if (entry.position === "dynamic") dynamicTags.push(tag);
    else staticTags.push(tag);
  }

  return { staticTags, dynamicTags, written };
}

/** 拼进声明驱动 prompt 的常驻段（无黑板时也可纯文本注入） */
export function formatResidentPromptSection(
  entries: ResidentContextEntry[],
  workerId: string,
): string {
  const matched = entriesForWorker(entries, workerId);
  if (matched.length === 0) return "";
  const blocks = matched.map((e) => {
    const label = e.id;
    return `### ${label}\n\n${e.content}`;
  });
  return `## 常驻上下文（本 worker 挂载）\n\n${blocks.join("\n\n")}`;
}
