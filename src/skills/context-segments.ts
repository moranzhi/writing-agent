/**
 * Worker contextSegments 拼装：按 tier 顺序把黑板 tag 拼成 Markdown。
 * 见 docs/context-assembly.md
 */
import type { Blackboard } from "../blackboard/blackboard.js";
import type { BlackboardInputMerge } from "../types/blackboard.js";
import { CONTEXT_BRIEF_TAG } from "../runtime/compress-after-worker.js";
import {
  CREATION_ACCEPTED_CONTENT_TAG,
  CREATION_ACCEPTED_UNITS_TAG,
  formatAcceptedContentForPrompt,
  formatAcceptedUnitsForPrompt,
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

/** 单段投影正文（不含 label）。供世界书 marker 填洞复用。 */
export function renderContextSegmentBody(
  segment: ContextSegmentDef,
  inputs: Record<string, string>,
  blackboard: Blackboard,
  inputMerge: BlackboardInputMerge,
  skipExact?: Set<string>,
  skipTags?: Set<string>,
): string {
  return formatSegmentBody(
    segment,
    inputs,
    blackboard,
    inputMerge,
    skipExact,
    skipTags,
  );
}

function formatSegmentBody(
  segment: ContextSegmentDef,
  inputs: Record<string, string>,
  blackboard: Blackboard,
  inputMerge: BlackboardInputMerge,
  skipExact?: Set<string>,
  skipTags?: Set<string>,
): string {
  if (segment.inline?.trim()) {
    return applyProjection(segment.inline.trim(), segment.projection);
  }
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const tag of segment.tags) {
    if (skipTags?.has(tag)) continue;
    let content: string;
    if (isDialogueHistoryRef(tag)) {
      content = resolveDialogueHistory(inputs, blackboard, inputMerge);
      content = projectDialogueHistory(content, segment.projection);
    } else {
      content = readTagContent(tag, inputs, blackboard, inputMerge);
      if (!content) continue;
      if (tag === CREATION_ACCEPTED_CONTENT_TAG) {
        content = formatAcceptedContentForPrompt(content);
      } else if (tag === CREATION_ACCEPTED_UNITS_TAG) {
        content = formatAcceptedUnitsForPrompt(content);
      }
      content = applyPolicy(content, segment.policy);
      content = applyProjection(content, segment.projection);
    }
    const trimmed = content.trim();
    if (!trimmed) continue;
    if (skipExact?.has(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    if (
      parts.some(
        (p) =>
          p === trimmed ||
          p.includes(`\n\n${trimmed}`) ||
          p.startsWith(`${trimmed}\n\n`),
      )
    ) {
      continue;
    }
    seen.add(trimmed);
    parts.push(trimmed);
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

const USER_REQUIREMENT_TAGS = new Set([
  "用户.需求",
  "book.brief",
  "用户.最新输入",
  "用户.worker答复",
  "用户.修订说明",
]);

const CREATION_REVIEW_WORKERS = new Set([
  "design-step",
  "design-flow",
  "opening-generator",
]);

function alreadyCovered(parts: string[], next: string): boolean {
  const trimmed = next.trim();
  if (!trimmed) return true;
  return parts.some(
    (p) =>
      p === trimmed ||
      p.includes(`\n\n${trimmed}`) ||
      p.startsWith(`${trimmed}\n\n`),
  );
}

function pushUnique(parts: string[], next: string): void {
  const trimmed = next.trim();
  if (!trimmed || alreadyCovered(parts, trimmed)) return;
  parts.push(trimmed);
}

/** 创作步：用户要求按时间排；冲突只看较新，旧条未点名推翻则仍有效。 */
function collectUserRequirementBlock(params: {
  inputs: Record<string, string>;
  blackboard: Blackboard;
  inputMerge: BlackboardInputMerge;
}): string {
  const { inputs, blackboard, inputMerge } = params;
  const ordered = [
    readTagContent("用户.需求", inputs, blackboard, inputMerge),
    readTagContent("book.brief", inputs, blackboard, inputMerge),
    readTagContent("用户.worker答复", inputs, blackboard, inputMerge),
    readTagContent("用户.最新输入", inputs, blackboard, inputMerge),
    readTagContent("用户.修订说明", inputs, blackboard, inputMerge),
  ];
  const parts: string[] = [];
  for (const item of ordered) pushUnique(parts, item);
  if (!parts.length) return "";
  return [
    "## 【用户要求】按先后排列。冲突时以较新的为准；未被较新要求改写的旧条仍有效。",
    "",
    ...parts,
  ].join("\n\n");
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
    const revisionNote = (
      params.inputs["用户.修订说明"] ??
      ""
    ).trim();
    return JSON.stringify(
      {
        workerId: params.workerId,
        workerName: params.workerName,
        outputTags: params.outputTags,
        inputs: params.inputs,
        instruction: revisionNote
          ? "修订模式：在已有产物（inputs 中对应 outputTags）上按「用户.修订说明」以及「用户.worker答复」中的追问作答（选项与补充）修改；保留未点名要改的部分，禁止无故整份重写。节点方法（task/principles/probe/output）仍须遵守。"
          : "根据 SKILL 说明完成任务。若 inputs 含「上下文.定稿摘要」，以终产物为准。" +
            "设计.worker集 / 草稿须为 JSON 对象文本。",
      },
      null,
      2,
    );
  }

  const revisionNote = readTagContent(
    "用户.修订说明",
    params.inputs,
    params.blackboard,
    inputMerge,
  ).trim();
  const inheritExisting = segments.some((s) => s.id === "inherit-existing");
  const splitUserReq = CREATION_REVIEW_WORKERS.has(params.workerId);

  const draftBlocks: string[] = [];
  for (const tag of params.outputTags) {
    const alreadyInSegments = segments.some((s) => s.tags.includes(tag));
    if (alreadyInSegments) continue;
    const draft = readTagContent(
      tag,
      params.inputs,
      params.blackboard,
      inputMerge,
    ).trim();
    if (!draft) continue;
    draftBlocks.push(`### \`${tag}\`\n\n${draft}`);
  }

  // 只有本步真有底稿（或回头修改）才算修订；上一步残留的修订说明仍作为用户要求保留
  const inheritMode = inheritExisting || (Boolean(revisionNote) && draftBlocks.length > 0);

  const skipTags = new Set<string>();
  if (splitUserReq) {
    for (const tag of USER_REQUIREMENT_TAGS) skipTags.add(tag);
  }

  const blocks: string[] = [];

  const render = (seg: ContextSegmentDef) => {
    if (inheritMode && seg.id === "module-opening") return;
    const body = formatSegmentBody(
      seg,
      params.inputs,
      params.blackboard,
      inputMerge,
      undefined,
      skipTags,
    );
    if (!body) return;
    if (seg.label) {
      blocks.push(`${seg.label}\n\n${body}`);
    } else {
      blocks.push(body);
    }
  };

  // 严格按 segments 数组顺序（投影排序表顺序）；不再按 static/dynamic 重排
  for (const seg of segments) render(seg);

  if (splitUserReq) {
    const reqBlock = collectUserRequirementBlock({
      inputs: params.inputs,
      blackboard: params.blackboard,
      inputMerge,
    });
    if (reqBlock) blocks.push(reqBlock);
  }

  // 定稿摘要：若未在 segments 中声明，仍附在末尾
  const brief = params.inputs[CONTEXT_BRIEF_TAG]?.trim();
  const briefInSegments = segments.some((s) => s.tags.includes(CONTEXT_BRIEF_TAG));
  if (brief && !briefInSegments) {
    blocks.push(`## 上下文.定稿摘要\n\n${brief}`);
  }

  if (inheritMode && draftBlocks.length) {
    blocks.push(
      [
        "## 【待改底稿】",
        "",
        "下列为**当前已有产物**（只保留这一份最新稿）。在其上落实【用户要求】里较新的条目；与旧要求冲突时以较新的为准，未点名改写的旧条仍须保留在产物里。",
        "节点方法（task / principles / probe / output）仍须遵守。禁止无视较新要求原样交回。",
        "",
        ...draftBlocks,
      ].join("\n"),
    );
  }

  const taskLines = [
    "## 本步任务",
    "",
    `- workerId: \`${params.workerId}\``,
    `- workerName: ${params.workerName}`,
    `- outputTags: ${params.outputTags.map((t) => `\`${t}\``).join("、") || "（无）"}`,
    "",
  ];
  if (inheritMode) {
    taskLines.push(
      inheritExisting
        ? "**回头修改**：接着上方【既有产物 · 继承修改】（以及【待改底稿】若有）继续改，写回同一产物。"
        : "**修订模式**：以【待改底稿】为底，落实【用户要求】；冲突时以较新的为准。",
      "不要从零另起一份。标为「只读 / 已定稿」的分区仍不可改。",
    );
  } else {
    taskLines.push(
      "按 SKILL 与上方分区完成任务。标为「只读 / 已定稿」的分区不要擅自改写；只改【本单位】范围。",
    );
  }
  taskLines.push("设计.worker集 / 草稿须为 JSON 对象文本（以 `{` 开头）。");
  blocks.push(taskLines.join("\n"));

  return blocks.join("\n\n---\n\n");
}
