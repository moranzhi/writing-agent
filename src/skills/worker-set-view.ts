import type {
  ParsedWorkerSet,
  WorkerSetEntry,
  WorkerSetPresentation,
} from "./worker-set-parse.js";
import { instantiateMeta, runWorkerMeta } from "./worker-set-parse.js";
import { listCreationUnits, extractUnitContentFromDraft } from "./creation-units.js";
import type { CreationUnitView } from "./creation-units.js";
import {
  parseResidentContext,
  residentTagFor,
  type ResidentContextEntry,
} from "./resident-context.js";
import {
  PLAY_SLOT_META,
  PLAY_SLOT_ORDER,
  refForSlot,
  type PlaySlotId,
} from "./play-slots.js";
import {
  contextOrderToView,
  parseContextOrder,
  synthesizeContextOrderFromWorkers,
} from "./context-order.js";

export type TagLineView = {
  tag: string;
  note?: string;
  filled?: boolean;
};

export type ContextLayerView = {
  staticTags: TagLineView[];
  dynamicTags: TagLineView[];
  /** false = 部分来自包内默认模板，design-intake 未写全 context */
  explicit: boolean;
};

export type PresentationLineView = {
  label: string;
  value: string;
};

/** tag / 固定上下文 → 会塞进哪些 worker（与 worker 卡片解耦） */
export type ContextTagMountView = {
  workerId: string | null;
  workerName: string;
  /** prompt_body=写入该 worker 提示词正文；input_tag=声明为黑板读入；resident=常驻挂载 */
  how: "prompt_body" | "input_tag" | "resident";
  tier?: "static" | "dynamic";
};

export type ContextTagCardView = {
  /** fixed:… / resident:… / board:tag名 */
  id: string;
  label: string;
  kind: "fixed" | "resident" | "board";
  /** 内容预览（截断） */
  preview?: string;
  filled: boolean;
  mounts: ContextTagMountView[];
  /** 给人看的挂载摘要，如「全部 Worker」「叙事转述 · 世界模拟」 */
  mountSummary: string;
};

export type WorkerCardView = {
  order: number;
  id: string | null;
  displayName: string;
  roleLabel?: string;
  status: "ready" | "gap";
  gapNote?: string;
  purpose: string;
  invokeWhen: string;
  rationale?: string;
  /** run：完成后是否停下来给人验收 */
  acceptance?: "review" | "continue";
  acceptanceLabel?: string;
  mergeConsidered?: string;
  /** @deprecated UI 以 contextTags 独立区为准；卡片上只展示 readsSummary */
  context: ContextLayerView;
  /** 本 worker 会读/注入的上下文短摘要（不含完整 tag 列表） */
  readsSummary?: string;
  writes: string[];
  presentation?: PresentationLineView[];
};

export type TagFlowEdgeView = {
  from: string[];
  to: string[];
};

export type DesignTaskView = {
  id: string;
  label: string;
  status: "planned" | "skipped" | "filled";
  skipReason?: string;
};

export type WorkerSetUserView = {
  headline?: string;
  interactionParadigm?: string;
  coreWorker?: string;
  reasoning?: string;
  playModeLabel?: string;
  playModeHint?: string;
  /** 固定游玩槽位勾选摘要（世界模拟路径） */
  playSlots?: Array<{ id: string; label: string; enabled: boolean; ref: string }>;
  /** 投影排序（可编排）；无表时可由 workers.context 合成 */
  contextOrder?: {
    brief?: string;
    editable?: boolean;
    /** 是否由声明合成（尚未写入规格） */
    synthesized?: boolean;
    slots: Array<{
      ref: string;
      label?: string;
      lines: string[];
      inserts?: Array<{
        index: number;
        order: number;
        anchor: string;
        ref: string;
        projection: string;
        note?: string;
        label?: string;
        line: string;
      }>;
    }>;
  };
  inputProtocol?: PresentationLineView[];
  workers: WorkerCardView[];
  /**
   * 固定 / 常驻 / 黑板上下文（独立于 worker 卡）。
   * 每张卡标明会塞进哪些 worker。
   */
  contextTags?: ContextTagCardView[];
  tagFlow: TagFlowEdgeView[];
  designTasks: DesignTaskView[];
  /** 创作单位：worker 规格 + 固定插入上下文（同级） */
  creationUnits?: CreationUnitView[];
  /**
   * 当前创作单位：用于验收主舞台聚焦。
   * fixed/resident → 高亮「本块上下文」正文；worker → 高亮该卡。
   */
  focusUnit?: {
    id: string;
    kind: CreationUnitView["kind"];
    label: string;
    /** fixed / resident / phase 时抽出的本块内容（给 UI 高亮展示） */
    body?: unknown;
  };
  openQuestions: string[];
  notes?: string;
  parseError?: string;
};

export type FormatWorkerSetOptions = {
  /** 黑板上已有内容的 tag 名（用于设计任务 / static 是否已填） */
  filledTags?: string[];
  acceptedUnitIds?: string[];
  currentUnitId?: string | null;
};

const PLAY_MORPHOLOGY: Record<string, { label: string; hint: string }> = {
  action_reaction_loop: {
    label: "行动–反应循环",
    hint: "你输入一句，世界推进并回复一段",
  },
  chain: {
    label: "链式输出",
    hint: "按顺序生成，通常无多轮世界机",
  },
  single: {
    label: "单次生成",
    hint: "一次产出成稿，非多轮交互",
  },
  fork_review: {
    label: "分叉验收",
    hint: "生成后分角色验收，非交互小说",
  },
  multi_actor_sim: {
    label: "多角色模拟",
    hint: "多个角色各自决策，世界裁决后汇总",
  },
};

const PRESENTATION_LABELS: Record<string, string> = {
  mode: "输出模式",
  tone: "语气",
  pacing: "节奏",
  information_layers: "信息层",
  avoid: "避免",
  layers: "信息层",
};

const TAG_NOTES: Record<string, string> = {
  "设计.worker集": "实例分工与展示要求（本 worker 读切片）",
  "世界.蓝图.确认稿": "设计阶段写入，游玩时只读",
  "变量.目录.确认稿": "设计阶段写入，游玩时只读",
  "变量.变化规则.确认稿": "设计阶段写入，游玩时只读",
  "叙事.指南.确认稿": "设计阶段写入，游玩时只读",
  "语料.场景策略集.确认稿": "设计阶段写入，游玩时只读",
  "输出.回复格式.规范": "设计阶段写入，游玩时只读",
  "变量.当前": "每轮更新",
  "运行.事件流": "每轮追加",
  "用户.最新输入": "每轮用户输入",
};

/** 包内 run worker 默认上下文契约（design-intake 未写 context 时合并） */
const DEFAULT_WORKER_CONTRACTS: Record<
  string,
  { context: { static: string[]; dynamic: string[] }; outputs: string[] }
> = {
  auditor: {
    context: {
      static: [
        "设计.worker集",
        "设计.变量设计与更新规则",
        "设计.生成规则",
        "设计.变量控制上下文",
      ],
      dynamic: [
        "用户.最新输入",
        "变量.当前",
        "上下文.旁观.状态摘要",
        "运行.本轮.工单",
      ],
    },
    outputs: ["运行.本轮.旁观"],
  },
  "world-simulator": {
    context: {
      static: [
        "设计.worker集",
        "世界.蓝图.确认稿",
        "世界.拓扑.*",
        "设计.变量设计与更新规则",
      ],
      dynamic: [
        "变量.当前",
        "运行.事件流",
        "用户.最新输入",
        "上下文.角色态度",
        "大纲.当前章",
        "运行.本轮.旁观",
      ],
    },
    outputs: ["运行.本轮.裁决", "运行.事件流", "运行.本轮.变量变更"],
  },
  "variable-update": {
    context: {
      static: ["设计.变量设计与更新规则"],
      dynamic: ["运行.本轮.裁决", "变量.当前"],
    },
    outputs: ["运行.本轮.变量变更", "变量.当前"],
  },
  narrator: {
    context: {
      static: [
        "设计.worker集",
        "设计.叙事指南与故事推进",
        "设计.叙事指南",
        "设计.正文组成",
        "设计.监控栏",
      ],
      dynamic: ["运行.本轮.裁决", "用户.最新输入", "变量.当前"],
    },
    outputs: ["输出.用户展示"],
  },
  "input-expand": {
    context: {
      static: ["设计.worker集", "叙事.指南.确认稿", "用户.需求"],
      dynamic: ["用户.最新输入"],
    },
    outputs: ["运行.本轮.拓写"],
  },
  "plot-continue": {
    context: {
      static: ["设计.worker集", "叙事.指南.确认稿", "世界.蓝图.确认稿"],
      dynamic: ["运行.本轮.拓写", "运行.事件流"],
    },
    outputs: ["运行.本轮.续写"],
  },
  "role-decide": {
    context: {
      static: ["设计.worker集", "世界.生成规则.*", "实例.角色.*"],
      dynamic: ["运行.事件流", "可见信息"],
    },
    outputs: ["运行.本轮.角色决策"],
  },
  chance: {
    context: {
      static: ["设计.worker集"],
      dynamic: ["运行.机会请求"],
    },
    outputs: ["运行.本轮.机遇"],
  },
};

const INPUT_PROTOCOL_LABELS: Record<string, string> = {
  parens: "（）圆括号",
  quotes: "「」/ \"\" 台词",
  brackets: "【】行动",
  default: "默认规则",
};

const WORKER_ROLE_LABELS: Record<string, string> = {
  core: "核心",
  auxiliary: "辅助",
  transcription: "转述",
  auditor: "旁观维护",
  gm: "主世界层",
  narrator: "叙事转述",
  perspective: "角色视角",
  chance: "机遇裁定",
};

function tagMatchesPattern(tag: string, pattern: string): boolean {
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return tag === prefix || tag.startsWith(`${prefix}.`);
  }
  return tag === pattern;
}

function tagFilled(tag: string, filledTags: string[]): boolean {
  if (filledTags.some((t) => tagMatchesPattern(t, tag))) return true;
  if (tag.endsWith(".*")) {
    const prefix = tag.slice(0, -2);
    return filledTags.some((t) => t === prefix || t.startsWith(`${prefix}.`));
  }
  return filledTags.includes(tag);
}

function resolveContract(entry: WorkerSetEntry): {
  context: { static: string[]; dynamic: string[] };
  outputs: string[];
  explicit: boolean;
} {
  const defaults = entry.ref ? DEFAULT_WORKER_CONTRACTS[entry.ref] : undefined;
  const ctx = entry.context;
  const hasExplicitContext =
    Boolean(ctx?.static?.length) || Boolean(ctx?.dynamic?.length);
  const hasExplicitOutputs = Boolean(entry.outputs?.length);

  return {
    context: {
      static: hasExplicitContext
        ? (ctx?.static ?? [])
        : (defaults?.context.static ?? []),
      dynamic: hasExplicitContext
        ? (ctx?.dynamic ?? [])
        : (defaults?.context.dynamic ?? []),
    },
    outputs: hasExplicitOutputs
      ? (entry.outputs ?? [])
      : (defaults?.outputs ?? []),
    explicit: hasExplicitContext || hasExplicitOutputs,
  };
}

function formatPresentation(pres: WorkerSetPresentation): PresentationLineView[] {
  const lines: PresentationLineView[] = [];
  for (const [key, value] of Object.entries(pres)) {
    if (value == null || value === "") continue;
    const label = PRESENTATION_LABELS[key] ?? key;
    const text = Array.isArray(value) ? value.join("、") : String(value);
    lines.push({ label, value: text });
  }
  return lines;
}

function parseTagFlow(lines: string[] | undefined): TagFlowEdgeView[] {
  if (!lines?.length) return [];
  return lines
    .map((line) => {
      const arrow = line.includes("→") ? "→" : "->";
      const parts = line.split(arrow);
      if (parts.length < 2) return null;
      const from = parts[0]
        .split("+")
        .map((s) => s.trim())
        .filter(Boolean);
      const to = parts
        .slice(1)
        .join(arrow)
        .split("+")
        .map((s) => s.trim())
        .filter(Boolean);
      return { from, to };
    })
    .filter((e): e is TagFlowEdgeView => e != null && e.to.length > 0);
}

function toTagLines(
  tags: string[],
  filledTags: string[],
  tier: "static" | "dynamic",
): TagLineView[] {
  return tags.map((tag) => ({
    tag,
    note:
      TAG_NOTES[tag] ??
      (tier === "static" ? "设计阶段写入，游玩时只读" : "每轮读写"),
    filled: filledTags.length ? tagFilled(tag, filledTags) : undefined,
  }));
}

function previewText(raw: string | undefined, max = 120): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function formatMountSummary(
  mounts: ContextTagMountView[],
  allWorkerCount: number,
): string {
  if (mounts.length === 0) return "尚未指定 Worker";
  const names = [...new Set(mounts.map((m) => m.workerName))];
  if (allWorkerCount > 0 && names.length >= allWorkerCount) {
    return "全部 Worker";
  }
  if (names.length <= 3) return names.join(" · ");
  return `${names.slice(0, 2).join(" · ")} 等 ${names.length} 个`;
}

function workerDisplayName(entry: WorkerSetEntry, index: number): string {
  const meta = entry.ref ? runWorkerMeta(entry.ref) : null;
  return (
    entry.name?.trim() ||
    (entry.ref == null
      ? entry.duty?.slice(0, 24) || `待命名 Worker ${index + 1}`
      : meta!.label)
  );
}

/** 从规格反查：每块固定/常驻/黑板 tag 会塞进哪些 worker */
function buildContextTagCards(
  parsed: ParsedWorkerSet,
  workers: WorkerCardView[],
  filledTags: string[],
): ContextTagCardView[] {
  const cards: ContextTagCardView[] = [];
  const allWorkerMounts: ContextTagMountView[] = workers
    .filter((w) => w.id)
    .map((w) => ({
      workerId: w.id,
      workerName: w.displayName,
      how: "prompt_body" as const,
    }));
  const workerCount = allWorkerMounts.length;

  const narrative = parsed.narrative_guide?.trim();
  if (narrative) {
    const mounts = allWorkerMounts.map((m) => ({ ...m, how: "prompt_body" as const }));
    cards.push({
      id: "fixed:narrative_guide",
      label: "叙事指南",
      kind: "fixed",
      preview: previewText(narrative),
      filled: true,
      mounts,
      mountSummary: formatMountSummary(mounts, workerCount),
    });
  }

  const premises = (parsed.core_premises ?? []).filter(
    (p): p is string => typeof p === "string" && Boolean(p.trim()),
  );
  if (premises.length) {
    const mounts = allWorkerMounts.map((m) => ({ ...m, how: "prompt_body" as const }));
    cards.push({
      id: "fixed:core_premises",
      label: "核心实现前提",
      kind: "fixed",
      preview: previewText(premises.join("；")),
      filled: true,
      mounts,
      mountSummary: formatMountSummary(mounts, workerCount),
    });
  }

  if (parsed.input_protocol && Object.values(parsed.input_protocol).some(Boolean)) {
    const mounts = allWorkerMounts.map((m) => ({ ...m, how: "prompt_body" as const }));
    const bits = Object.entries(parsed.input_protocol)
      .filter(([, v]) => v)
      .map(([k, v]) => `${INPUT_PROTOCOL_LABELS[k] ?? k}：${v}`);
    cards.push({
      id: "fixed:input_protocol",
      label: "输入协议",
      kind: "fixed",
      preview: previewText(bits.join("；")),
      filled: true,
      mounts,
      mountSummary: formatMountSummary(mounts, workerCount),
    });
  }

  // 美学：各 worker 自己的 presentation → 只挂该 worker
  for (const w of workers) {
    if (!w.presentation?.length) continue;
    const preview = w.presentation.map((p) => `${p.label}：${p.value}`).join("；");
    const mounts: ContextTagMountView[] = [
      {
        workerId: w.id,
        workerName: w.displayName,
        how: "prompt_body",
      },
    ];
    cards.push({
      id: `fixed:aesthetics:${w.id ?? w.order}`,
      label: `美学纲领 · ${w.displayName}`,
      kind: "fixed",
      preview: previewText(preview),
      filled: true,
      mounts,
      mountSummary: formatMountSummary(mounts, workerCount),
    });
  }

  const residents = parseResidentContext(parsed.resident_context);
  for (const entry of residents) {
    const mounts = resolveResidentMounts(entry, workers);
    cards.push({
      id: `resident:${entry.id}`,
      label: `常驻 · ${entry.id}`,
      kind: "resident",
      preview: previewText(entry.content),
      filled: true,
      mounts,
      mountSummary: formatMountSummary(mounts, workerCount),
    });
  }

  // 黑板 tag：按「谁读」反查（与固定正文解耦）
  const boardMap = new Map<
    string,
    { mounts: ContextTagMountView[]; tiers: Set<string> }
  >();
  for (const w of workers) {
    for (const t of w.context.staticTags) {
      const cur = boardMap.get(t.tag) ?? { mounts: [], tiers: new Set() };
      cur.mounts.push({
        workerId: w.id,
        workerName: w.displayName,
        how: "input_tag",
        tier: "static",
      });
      cur.tiers.add("static");
      boardMap.set(t.tag, cur);
    }
    for (const t of w.context.dynamicTags) {
      const cur = boardMap.get(t.tag) ?? { mounts: [], tiers: new Set() };
      cur.mounts.push({
        workerId: w.id,
        workerName: w.displayName,
        how: "input_tag",
        tier: "dynamic",
      });
      cur.tiers.add("dynamic");
      boardMap.set(t.tag, cur);
    }
  }

  // 跳过已由 resident 显式 tag 覆盖的
  const residentBoardTags = new Set(residents.map((e) => residentTagFor(e)));
  for (const [tag, info] of boardMap) {
    if (residentBoardTags.has(tag)) continue;
    if (tag === "设计.worker集") continue; // 规格本身，不当「上下文块」
    const mounts = info.mounts;
    cards.push({
      id: `board:${tag}`,
      label: tag,
      kind: "board",
      filled: filledTags.length ? tagFilled(tag, filledTags) : false,
      mounts,
      mountSummary: formatMountSummary(mounts, workerCount),
    });
  }

  return cards;
}

function resolveResidentMounts(
  entry: ResidentContextEntry,
  workers: WorkerCardView[],
): ContextTagMountView[] {
  const withIds = workers.filter((w) => w.id);
  if (!entry.mount || entry.mount.length === 0) {
    return withIds.map((w) => ({
      workerId: w.id,
      workerName: w.displayName,
      how: "resident" as const,
      tier: entry.position === "dynamic" ? ("dynamic" as const) : ("static" as const),
    }));
  }
  const wanted = new Set(entry.mount);
  return withIds
    .filter((w) => w.id && wanted.has(w.id))
    .map((w) => ({
      workerId: w.id,
      workerName: w.displayName,
      how: "resident" as const,
      tier: entry.position === "dynamic" ? ("dynamic" as const) : ("static" as const),
    }));
}

function summarizeWorkerReads(
  w: WorkerCardView,
  contextTags: ContextTagCardView[],
): string {
  const injected = contextTags
    .filter(
      (c) =>
        (c.kind === "fixed" || c.kind === "resident") &&
        c.mounts.some((m) => m.workerId === w.id || (!m.workerId && !w.id)),
    )
    .map((c) => c.label);
  // 「全部 Worker」挂载的 fixed 也算
  const allInjected = contextTags
    .filter(
      (c) =>
        (c.kind === "fixed" || c.kind === "resident") &&
        (c.mountSummary === "全部 Worker" ||
          c.mounts.some((m) => m.workerId === w.id)),
    )
    .map((c) => c.label);
  const labels = [...new Set(allInjected.length ? allInjected : injected)];
  const boardCount =
    w.context.staticTags.length + w.context.dynamicTags.length;
  const parts: string[] = [];
  if (labels.length) parts.push(labels.slice(0, 3).join("、") + (labels.length > 3 ? "…" : ""));
  if (boardCount) parts.push(`黑板 ${boardCount} 项`);
  return parts.length ? parts.join(" · ") : "（未声明上下文）";
}

/** 将解析后的 Worker 集格式化为用户可读视图 */
export function formatWorkerSetForUser(
  parsed: ParsedWorkerSet | null,
  options: FormatWorkerSetOptions = {},
): WorkerSetUserView | null {
  if (!parsed) return null;
  const filledTags = options.filledTags ?? [];

  if (parsed.parseError) {
    return {
      workers: [],
      contextTags: [],
      tagFlow: [],
      designTasks: [],
      openQuestions: parsed.open_questions ?? [],
      parseError: parsed.parseError,
    };
  }

  const morphKey = parsed.play_morphology?.trim();
  const morph = morphKey ? PLAY_MORPHOLOGY[morphKey] : undefined;

  const workers: WorkerCardView[] = parsed.workers.map((entry, index) => {
    const meta = entry.ref ? runWorkerMeta(entry.ref) : null;
    const contract = resolveContract(entry);
    const displayName = workerDisplayName(entry, index);

    return {
      order: index + 1,
      id: entry.ref,
      displayName,
      roleLabel: entry.role ? WORKER_ROLE_LABELS[entry.role] ?? entry.role : undefined,
      status: entry.ref == null ? "gap" : "ready",
      gapNote: entry.gap ?? (entry.ref == null ? "尚未有对应 SKILL" : undefined),
      purpose: entry.duty?.trim() || meta?.purpose || "—",
      invokeWhen: entry.when?.trim() || "由 Agent 按本轮状态决定",
      rationale: entry.rationale,
      acceptance: entry.acceptance,
      acceptanceLabel:
        entry.acceptance === "review"
          ? "完成后验收"
          : entry.acceptance === "continue"
            ? "可连跑"
            : undefined,
      mergeConsidered: entry.merge_considered,
      context: {
        staticTags: toTagLines(contract.context.static, filledTags, "static"),
        dynamicTags: toTagLines(contract.context.dynamic, filledTags, "dynamic"),
        explicit: contract.explicit,
      },
      writes: contract.outputs,
      presentation: entry.presentation
        ? formatPresentation(entry.presentation)
        : undefined,
    };
  });

  const contextTags = buildContextTagCards(parsed, workers, filledTags);
  for (const w of workers) {
    w.readsSummary = summarizeWorkerReads(w, contextTags);
  }

  const invoke = parsed.instantiate_hints?.invoke ?? [];
  const designTasks: DesignTaskView[] = [];

  for (const id of invoke) {
    const meta = instantiateMeta(id);
    const relatedTags = instantiateTagsForSkill(id);
    const filled = relatedTags.some((t) => tagFilledOnBoard(t, filledTags));
    designTasks.push({
      id,
      label: meta.label,
      status: filled ? "filled" : "planned",
    });
  }
  for (const id of parsed.instantiate_hints?.skip ?? []) {
    designTasks.push({
      id,
      label: instantiateMeta(id).label,
      status: "skipped",
      skipReason: parsed.instantiate_hints?.skip_reason,
    });
  }

  const inputProtocol = parsed.input_protocol
    ? Object.entries(parsed.input_protocol)
        .filter(([, v]) => v)
        .map(([key, value]) => ({
          label: INPUT_PROTOCOL_LABELS[key] ?? key,
          value,
        }))
    : undefined;

  const creationUnits = listCreationUnits(parsed, {
    acceptedUnitIds: options.acceptedUnitIds,
    currentUnitId: options.currentUnitId,
  });

  const currentUnit =
    creationUnits.find((u) => u.current) ??
    (options.currentUnitId
      ? creationUnits.find((u) => u.id === options.currentUnitId)
      : undefined);

  let focusUnit: WorkerSetUserView["focusUnit"];
  if (currentUnit) {
    const body =
      currentUnit.kind === "fixed" || currentUnit.kind === "phase"
        ? extractUnitContentFromDraft(parsed, currentUnit.id)
        : currentUnit.kind === "worker"
          ? extractUnitContentFromDraft(parsed, currentUnit.id)
          : null;
    focusUnit = {
      id: currentUnit.id,
      kind: currentUnit.kind,
      label: currentUnit.label,
      body: body ?? undefined,
    };
  }

  return {
    headline: parsed.form_summary,
    interactionParadigm: parsed.interaction_paradigm,
    coreWorker: parsed.core_worker,
    reasoning: parsed.reasoning,
    playModeLabel: morph?.label ?? morphKey,
    playModeHint: morph?.hint,
    playSlots: parsed.play_slots
      ? PLAY_SLOT_ORDER.map((id: PlaySlotId) => ({
          id,
          label: PLAY_SLOT_META[id].label,
          enabled:
            id === "auditor"
              ? parsed.play_slots!.auditor !== false
              : Boolean(parsed.play_slots![id]),
          ref: refForSlot(parsed.play_slots!, id),
        }))
      : undefined,
    contextOrder: (() => {
      const order = parseContextOrder(parsed.context_order);
      if (order) return contextOrderToView(order);
      const workersForSynth = parsed.workers.map((w) => {
        const ref = w.ref?.trim() ?? "";
        const def = ref ? DEFAULT_WORKER_CONTRACTS[ref] : undefined;
        return {
          ref: w.ref,
          name: w.name,
          context: {
            static: w.context?.static ?? def?.context.static,
            dynamic: w.context?.dynamic ?? def?.context.dynamic,
          },
        };
      });
      const synth = synthesizeContextOrderFromWorkers(
        workersForSynth,
        parsed.play_slots,
      );
      if (!synth) return undefined;
      return { ...contextOrderToView(synth), synthesized: true };
    })(),
    inputProtocol,
    workers,
    contextTags,
    tagFlow: parseTagFlow(parsed.tag_flow),
    designTasks,
    creationUnits,
    focusUnit,
    openQuestions: parsed.open_questions ?? [],
    notes: parsed.notes,
  };
}

function tagFilledOnBoard(tagPattern: string, filledTags: string[]): boolean {
  if (tagPattern.endsWith(".")) {
    return filledTags.some((t) => t.startsWith(tagPattern));
  }
  return tagFilled(tagPattern, filledTags);
}

/** 创作阶段收尾 skill 典型写入 tag（用于设计任务「已填」检测） */
function instantiateTagsForSkill(skillId: string): string[] {
  if (skillId === "opening-generator") {
    return ["输出.开场白", "运行.初始变量"];
  }
  return [];
}
