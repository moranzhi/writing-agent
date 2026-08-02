/**
 * Worker contextSegments 拼装：按 tier 顺序把黑板 tag 拼成 Markdown。
 * 见 docs/context-assembly.md
 */
import type { Blackboard } from "../blackboard/blackboard.js";
import type { BlackboardInputMerge } from "../types/blackboard.js";
import { CONTEXT_BRIEF_TAG } from "../runtime/compress-after-worker.js";
import {
  CREATION_ACCEPTED_CONTENT_TAG,
  formatAcceptedContentForPrompt,
} from "./creation-units.js";
import { projectFragmentContent } from "./context-fragment.js";
import {
  buildHistoryFallback,
  isDialogueHistoryRef,
  projectDialogueHistory,
  DIALOGUE_HISTORY_TAG,
} from "./dialogue-history.js";

export type ContextSegmentTier = "static" | "dynamic";

export type ContextSegmentDef = {
  id: string;
  /** 缓存提示；有序拼装时不再按 tier 重排 */
  tier: ContextSegmentTier;
  tags: string[];
  label?: string;
  /** latest | concat | tail_lines_N */
  policy?: string;
  /** 不读黑板，直接注入（如 worker.persona） */
  inline?: string;
  /** context-order 投影级别：full | summary | fields | fixed */
  projection?: string;
};

export function parseContextSegments(raw: unknown): ContextSegmentDef[] {
  if (!Array.isArray(raw)) return [];
  const out: ContextSegmentDef[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const tier = r.tier === "dynamic" ? "dynamic" : "static";
    const tags = Array.isArray(r.tags)
      ? r.tags.filter((t): t is string => typeof t === "string" && t.trim()).map((t) => t.trim())
      : [];
    const inline = typeof r.inline === "string" ? r.inline.trim() : undefined;
    if (!id || (tags.length === 0 && !inline)) continue;
    out.push({
      id,
      tier,
      tags,
      label: typeof r.label === "string" ? r.label.trim() : undefined,
      policy: typeof r.policy === "string" ? r.policy.trim() : undefined,
      inline: inline || undefined,
      projection: typeof r.projection === "string" ? r.projection.trim() : undefined,
    });
  }
  return out;
}

function applyPolicy(content: string, policy?: string): string {
  if (!policy || policy === "latest" || policy === "concat") return content;
  const m = /^tail_lines_(\d+)$/.exec(policy);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) {
      const lines = content.split(/\r?\n/);
      return lines.slice(-n).join("\n");
    }
  }
  return content;
}

function readTagContent(
  tag: string,
  inputs: Record<string, string>,
  blackboard: Blackboard,
  inputMerge: BlackboardInputMerge,
): string {
  if (inputs[tag]?.trim()) return inputs[tag]!.trim();
  const items = blackboard.queryByPatterns([tag], inputMerge);
  if (items.length === 0) return "";
  if (inputMerge === "concat") {
    return items.map((i) => i.content).filter(Boolean).join("\n\n");
  }
  return items[items.length - 1]?.content?.trim() ?? "";
}

function formatSegmentBody(
  segment: ContextSegmentDef,
  inputs: Record<string, string>,
  blackboard: Blackboard,
  inputMerge: BlackboardInputMerge,
): string {
  if (segment.inline?.trim()) {
    return applyProjection(segment.inline.trim(), segment.projection);
  }
  const parts: string[] = [];
  for (const tag of segment.tags) {
    let content: string;
    if (isDialogueHistoryRef(tag)) {
      content = resolveDialogueHistory(inputs, blackboard, inputMerge);
      content = projectDialogueHistory(content, segment.projection);
    } else {
      content = readTagContent(tag, inputs, blackboard, inputMerge);
      if (!content) continue;
      if (tag === CREATION_ACCEPTED_CONTENT_TAG) {
        content = formatAcceptedContentForPrompt(content);
      }
      content = applyPolicy(content, segment.policy);
      content = applyProjection(content, segment.projection);
    }
    if (!content.trim()) continue;
    parts.push(content.trim());
  }
  return parts.join("\n\n");
}

function resolveDialogueHistory(
  inputs: Record<string, string>,
  blackboard: Blackboard,
  inputMerge: BlackboardInputMerge,
): string {
  const direct =
    readTagContent(DIALOGUE_HISTORY_TAG, inputs, blackboard, inputMerge) ||
    readTagContent("对话历史", inputs, blackboard, inputMerge);
  return buildHistoryFallback({
    dialogueHistory: direct,
    eventStream: readTagContent("运行.事件流", inputs, blackboard, "concat"),
    latestUser: readTagContent("用户.最新输入", inputs, blackboard, inputMerge),
  });
}

function applyProjection(content: string, projection?: string): string {
  if (!projection || projection === "full") return content;
  return projectFragmentContent(content, projection);
}

/**
 * 按 contextSegments 拼装 user 侧上下文。
 * 无 segments 时回退为 JSON inputs（兼容旧 skill）。
 */
export function assembleWorkerContext(params: {
  inputs: Record<string, string>;
  segments?: ContextSegmentDef[] | null;
  blackboard: Blackboard;
  inputMerge?: BlackboardInputMerge;
  workerId: string;
  workerName: string;
  outputTags: string[];
}): string {
  const inputMerge = params.inputMerge ?? "latest";
  const segments = params.segments ?? [];

  if (segments.length === 0) {
    return JSON.stringify(
      {
        workerId: params.workerId,
        workerName: params.workerName,
        outputTags: params.outputTags,
        inputs: params.inputs,
        instruction:
          "根据 SKILL 说明完成任务。若 inputs 含「上下文.定稿摘要」，以终产物为准。" +
          "设计.worker集 / 草稿须为 JSON 对象文本。",
      },
      null,
      2,
    );
  }

  const blocks: string[] = [];

  const render = (seg: ContextSegmentDef) => {
    const body = formatSegmentBody(seg, params.inputs, params.blackboard, inputMerge);
    if (!body) return;
    if (seg.label) {
      blocks.push(`${seg.label}\n\n${body}`);
    } else {
      blocks.push(body);
    }
  };

  // 严格按 segments 数组顺序（投影排序表顺序）；不再按 static/dynamic 重排
  for (const seg of segments) render(seg);

  // 定稿摘要：若未在 segments 中声明，仍附在末尾
  const brief = params.inputs[CONTEXT_BRIEF_TAG]?.trim();
  const briefInSegments = segments.some((s) => s.tags.includes(CONTEXT_BRIEF_TAG));
  if (brief && !briefInSegments) {
    blocks.push(`## 上下文.定稿摘要\n\n${brief}`);
  }

  blocks.push(
    [
      "## 本步任务",
      "",
      `- workerId: \`${params.workerId}\``,
      `- workerName: ${params.workerName}`,
      `- outputTags: ${params.outputTags.map((t) => `\`${t}\``).join("、") || "（无）"}`,
      "",
      "按 SKILL 与上方分区完成任务。标为「只读 / 已定稿」的分区不要擅自改写；只改【本单位】范围。",
      "设计.worker集 / 草稿须为 JSON 对象文本（以 `{` 开头）。",
    ].join("\n"),
  );

  return blocks.join("\n\n---\n\n");
}
