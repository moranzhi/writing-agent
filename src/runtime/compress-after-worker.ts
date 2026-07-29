import type { Blackboard } from "../blackboard/blackboard.js";

/** 下一 worker / 总管可读的定稿摘要 tag */
export const CONTEXT_BRIEF_TAG = "上下文.定稿摘要";

export type CompressWorkerResult = {
  archivedTags: string[];
  finals: Array<{ tag: string; chars: number; preview: string }>;
  briefText: string;
};

const ALWAYS_ARCHIVE_AFTER_ACCEPT = ["用户.worker答复", "用户.修订说明"];

/**
 * Worker 产物经用户验收（或自动完工）后：
 * - 终产物打 final
 * - 过程/草稿 tag 归档（不再进入后续 worker 取数）
 * - 写入定稿摘要，供下一阶段「指点」用
 */
export function compressAfterWorkerAccept(params: {
  blackboard: Blackboard;
  workerId: string;
  outputTags: string[];
  summary?: string;
  /**
   * final = 终稿验收（归档草稿、写定稿摘要）
   * unit = 创作单位验收（只归档过程答复，保留 设计.worker集.草稿）
   */
  mode?: "final" | "unit";
}): CompressWorkerResult {
  const { blackboard, workerId, outputTags, summary } = params;
  const mode = params.mode ?? "final";
  const finals: CompressWorkerResult["finals"] = [];
  const archivedTags: string[] = [];

  const uniqueOutputs = [...new Set(outputTags.map((t) => t.trim()).filter(Boolean))];

  if (mode === "final") {
    for (const tag of uniqueOutputs) {
      const content = blackboard.getContentByTag(tag);
      if (content == null) continue;
      blackboard.write({
        tag,
        content,
        source: workerId,
        metadata: {
          role: "final",
          acceptedAt: new Date().toISOString(),
          workerId,
        },
      });
      finals.push({
        tag,
        chars: content.length,
        preview: previewText(content, 120),
      });
    }
  } else {
    // 单位验收：草稿保持活跃，终产物列表仅作面板提示
    for (const tag of uniqueOutputs) {
      if (tag === "用户.需求" || tag === "创作.当前单位") continue;
      const content = blackboard.getContentByTag(tag);
      if (content == null) continue;
      finals.push({
        tag,
        chars: content.length,
        preview: previewText(content, 120),
      });
    }
  }

  const toArchive = new Set<string>(ALWAYS_ARCHIVE_AFTER_ACCEPT);

  if (mode === "final") {
    if (blackboard.getContentByTag("设计.worker集")?.trim()) {
      toArchive.add("设计.worker集.草稿");
    }
    for (const tag of uniqueOutputs) {
      if (tag.endsWith(".草稿")) continue;
      const draft = `${tag}.草稿`;
      if (blackboard.getContentByTag(draft) != null) toArchive.add(draft);
    }
  }

  for (const tag of toArchive) {
    if (uniqueOutputs.includes(tag) && mode === "final") continue;
    if (mode === "unit" && tag.endsWith(".草稿")) continue;
    const content = blackboard.getContentByTag(tag);
    if (content == null) continue;
    blackboard.write({
      tag,
      content: `（已压缩归档）原过程内容已折叠。定稿见：${
        finals.map((f) => f.tag).join("、") || "（无）"
      }\n\n---\n${previewText(content, 400)}`,
      source: "compress",
      metadata: {
        role: "archived",
        archivedAt: new Date().toISOString(),
        fromWorker: workerId,
        compressMode: mode,
      },
    });
    archivedTags.push(tag);
  }

  const briefText =
    mode === "unit"
      ? buildUnitBriefText({ workerId, summary, finals, archivedTags })
      : buildBriefText({
          workerId,
          summary,
          finals,
          archivedTags,
        });

  if (mode === "final") {
    blackboard.write({
      tag: CONTEXT_BRIEF_TAG,
      content: briefText,
      source: "compress",
      metadata: { role: "final", workerId },
    });
  }

  return { archivedTags, finals, briefText };
}

function buildUnitBriefText(params: {
  workerId: string;
  summary?: string;
  finals: CompressWorkerResult["finals"];
  archivedTags: string[];
}): string {
  return [
    `## 创作单位已验收（${params.workerId}）`,
    "",
    params.summary?.trim() ? `摘要：${params.summary.trim()}` : "摘要：（无）",
    "",
    "草稿仍保留在 `设计.worker集.草稿`；下一单位继续增量，勿依赖已删的过程对话。",
  ].join("\n");
}

function buildBriefText(params: {
  workerId: string;
  summary?: string;
  finals: CompressWorkerResult["finals"];
  archivedTags: string[];
}): string {
  const lines = [
    `## 上一阶段定稿（${params.workerId}）`,
    "",
    params.summary?.trim()
      ? `摘要：${params.summary.trim()}`
      : "摘要：（无）",
    "",
    "### 保留的终产物 tag",
  ];
  if (params.finals.length === 0) {
    lines.push("- （无）");
  } else {
    for (const f of params.finals) {
      lines.push(`- \`${f.tag}\`（${f.chars} 字）`);
      lines.push(`  ${f.preview}`);
    }
  }
  if (params.archivedTags.length) {
    lines.push("", "### 已压缩的过程 tag");
    for (const t of params.archivedTags) {
      lines.push(`- \`${t}\`（归档，后续 worker 默认不读）`);
    }
  }
  lines.push(
    "",
    "下一 worker 应以以上终产物为准继续；勿依赖已归档的过程讨论。",
  );
  return lines.join("\n");
}

export function previewText(content: string, max: number): string {
  const t = content.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** 供 UI：黑板可读条目（默认隐藏 archived 全文，只给索引） */
export function buildBoardPanel(blackboard: Blackboard): {
  finals: Array<{ tag: string; source: string; preview: string; updatedAt: string }>;
  active: Array<{ tag: string; source: string; preview: string; updatedAt: string }>;
  archivedCount: number;
  brief?: string;
} {
  const items = latestItemsByTag(blackboard.exportItems());
  const finals: Array<{
    tag: string;
    source: string;
    preview: string;
    updatedAt: string;
  }> = [];
  const active: typeof finals = [];
  let archivedCount = 0;
  let brief: string | undefined;

  for (const item of items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const role = String(item.metadata?.role ?? "");
    if (item.tag === CONTEXT_BRIEF_TAG) {
      brief = item.content;
      continue;
    }
    if (role === "archived") {
      archivedCount += 1;
      continue;
    }
    const row = {
      tag: item.tag,
      source: item.source,
      preview: previewText(item.content, 160),
      updatedAt: item.updatedAt,
    };
    if (role === "final") finals.push(row);
    else active.push(row);
  }

  return { finals, active, archivedCount, brief };
}

function latestItemsByTag(
  items: import("../types/blackboard.js").BlackboardItem[],
): import("../types/blackboard.js").BlackboardItem[] {
  const byTag = new Map<string, (typeof items)[0]>();
  for (const item of items) {
    const prev = byTag.get(item.tag);
    if (!prev || item.updatedAt > prev.updatedAt) byTag.set(item.tag, item);
  }
  return [...byTag.values()];
}
