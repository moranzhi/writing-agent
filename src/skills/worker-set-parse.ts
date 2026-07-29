import { parse as parseYaml } from "yaml";

export type WorkerSetPresentation = {
  tone?: string;
  pacing?: string;
  information_layers?: string[];
  avoid?: string[];
  [key: string]: unknown;
};

export type WorkerSetContext = {
  static?: string[];
  dynamic?: string[];
};

export type WorkerAcceptance = "review" | "continue";

export type WorkerSetEntry = {
  ref: string | null;
  /**
   * 用户可见中文名（创造 worker 时优先填写）。
   * 与 `ref` 分离：`ref` 仍为英文机器 id（调度 / 模板 / mount）。
   */
  name?: string;
  role?: string;
  duty?: string;
  when?: string;
  rationale?: string;
  /**
   * run 验收点：本 worker 完成后是否停下来给人读。
   * review = 用户验收；continue = 可连跑下一 worker。
   */
  acceptance?: WorkerAcceptance;
  merge_considered?: string;
  gap?: string | null;
  presentation?: WorkerSetPresentation | null;
  /** play 阶段冻结的上下文插入顺序（design-intake 设计） */
  context?: WorkerSetContext;
  /** 本 worker 写入黑板的 tag */
  outputs?: string[];
};

export type ParsedWorkerSetInteraction = {
  user_stance?: string;
  system_role?: string;
  output?: string;
  turn_shape?: string;
  [key: string]: unknown;
};

export type ParsedWorkerSet = {
  version?: number;
  form_summary?: string;
  interaction_paradigm?: string;
  /** 新规格：站位 / 系统扮演 / 输出 / 轮转 */
  interaction?: ParsedWorkerSetInteraction;
  experience_check?: Record<string, unknown>;
  core_worker?: string;
  reasoning?: string;
  play_morphology?: string;
  input_protocol?: Record<string, string>;
  workers: WorkerSetEntry[];
  tag_flow?: string[];
  resident_context?: unknown[];
  tables?: Record<string, unknown>;
  narrative_guide?: string;
  core_premises?: string[];
  design_end?: Record<string, unknown>;
  /** @deprecated 旧字段；新规格用 design_end */
  instantiate_hints?: {
    invoke?: string[];
    skip?: string[];
    skip_reason?: string;
    notes?: string;
  };
  open_questions?: string[];
  notes?: string;
  parseError?: string;
};

/** 创作阶段可选 skill 元数据（accept Worker 集之后、play 之前） */
export const DESIGN_STAGE_SKILL_META: Record<
  string,
  { label: string; purpose: string }
> = {
  "opening-generator": {
    label: "开局 · 开场白",
    purpose:
      "创作末尾：结合已定世界/故事写开场白（主）；表初值与开场对齐，能推则推。",
  },
};

/**
 * @deprecated 旧「run worker → instantiate 管道」映射。Worker 集即实例规格，不再用于推导 design 进度。
 */
export const RUN_TO_INSTANTIATE: Record<string, string[]> = {
  "world-simulator": ["world-blueprint"],
  narrator: ["narrative-guide"],
  "variable-update": ["variable-catalog"],
  "input-expand": ["narrative-guide"],
  "plot-continue": ["narrative-guide"],
  "role-decide": ["generation-rules"],
};

/** @deprecated 旧管道 skill 元数据；仅兼容旧 Worker 集 YAML 展示 */
export const INSTANTIATE_SKILL_META: Record<
  string,
  { label: string; purpose: string }
> = {
  "world-blueprint": {
    label: "世界蓝图",
    purpose: "背景板与核心设定，供 world-simulator 等读取。",
  },
  topology: {
    label: "拓扑 / 关系",
    purpose: "地图、关系网或进阶路径（按需多次）。",
  },
  "generation-rules": {
    label: "生成规则",
    purpose: "元规则：如何生成 NPC、物品等实例内容。",
  },
  "narrative-guide": {
    label: "叙事 / 描写指南",
    purpose: "正文 POV、时态、文风（narrator 等 static 上下文）。",
  },
  "variable-catalog": {
    label: "变量目录",
    purpose: "要跟踪的状态与变化规则（variable-update 用）。",
  },
  corpus: {
    label: "语料 / 场景策略",
    purpose: "口吻样例、场景模板、描写与节奏策略。",
  },
};

export const RUN_WORKER_META: Record<string, { label: string; purpose: string }> =
  {
    "world-simulator": {
      label: "世界模拟",
      purpose: "裁决规则、更新事件流与可见信息。",
    },
    narrator: {
      label: "转述 / 展示",
      purpose: "把核心/世界层干巴输出转为用户可读回复（文学化或 Markdown 等）。",
    },
    "variable-update": {
      label: "变量更新",
      purpose: "跟踪等级、资源、职业等状态变量。",
    },
    "input-expand": {
      label: "输入拓写",
      purpose: "把用户裸输入拓写为场景内行动/意图。",
    },
    "plot-continue": {
      label: "剧情续写",
      purpose: "基于拓写结果续写剧情片段。",
    },
    "role-decide": {
      label: "角色决策",
      purpose: "单个重要角色独立决策（信息隔绝时用）。",
    },
    "round-present": {
      label: "回合陈述",
      purpose: "结构化陈述本轮事件与各方行动/思考摘要。",
    },
  };

function asString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  return String(value).trim() || undefined;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));
}

function parsePresentation(raw: unknown): WorkerSetPresentation | null | undefined {
  if (raw == null) return raw === null ? null : undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as WorkerSetPresentation;
}

function parseContext(raw: unknown): WorkerSetContext | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const staticTags = asStringList(row.static);
  const dynamicTags = asStringList(row.dynamic);
  if (!staticTags.length && !dynamicTags.length) return undefined;
  return {
    static: staticTags.length ? staticTags : undefined,
    dynamic: dynamicTags.length ? dynamicTags : undefined,
  };
}

function parseWorkers(raw: unknown): WorkerSetEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ref: null };
    }
    const row = item as Record<string, unknown>;
    const refRaw = row.ref;
    const ref =
      refRaw == null
        ? null
        : asString(refRaw) ?? (typeof refRaw === "string" ? refRaw : null);
    const outputs = asStringList(row.outputs);
    const acceptanceRaw = asString(row.acceptance);
    const acceptance: WorkerAcceptance | undefined =
      acceptanceRaw === "review" || acceptanceRaw === "continue"
        ? acceptanceRaw
        : undefined;
    return {
      ref,
      name: asString(row.name),
      role: asString(row.role),
      duty: asString(row.duty),
      when: asString(row.when),
      rationale: asString(row.rationale),
      acceptance,
      merge_considered: asString(row.merge_considered),
      gap: ref == null ? asString(row.gap) ?? null : asString(row.gap) ?? null,
      presentation: parsePresentation(row.presentation),
      context: parseContext(row.context),
      outputs: outputs.length ? outputs : undefined,
    };
  });
}

function parseInstantiateHints(raw: unknown): ParsedWorkerSet["instantiate_hints"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const invoke = asStringList(row.invoke);
  const skip = asStringList(row.skip);
  const skip_reason = asString(row.skip_reason);
  const notes = asString(row.notes);
  if (invoke.length === 0 && skip.length === 0 && !skip_reason && !notes) return undefined;
  return {
    invoke: invoke.length ? invoke : undefined,
    skip: skip.length ? skip : undefined,
    skip_reason,
    notes,
  };
}

function parseWorkerSetObject(row: Record<string, unknown>): ParsedWorkerSet {
  const interactionRaw = row.interaction;
  const interaction =
    interactionRaw &&
    typeof interactionRaw === "object" &&
    !Array.isArray(interactionRaw)
      ? (interactionRaw as ParsedWorkerSetInteraction)
      : undefined;

  return {
    version: typeof row.version === "number" ? row.version : undefined,
    form_summary: asString(row.form_summary),
    interaction_paradigm: asString(row.interaction_paradigm),
    interaction,
    experience_check:
      row.experience_check &&
      typeof row.experience_check === "object" &&
      !Array.isArray(row.experience_check)
        ? (row.experience_check as Record<string, unknown>)
        : undefined,
    core_worker: asString(row.core_worker),
    reasoning: asString(row.reasoning),
    play_morphology: asString(row.play_morphology),
    input_protocol:
      row.input_protocol &&
      typeof row.input_protocol === "object" &&
      !Array.isArray(row.input_protocol)
        ? Object.fromEntries(
            Object.entries(row.input_protocol as Record<string, unknown>)
              .map(([k, v]) => [k, asString(v) ?? ""])
              .filter(([, v]) => v),
          )
        : undefined,
    workers: parseWorkers(row.workers),
    tag_flow: asStringList(row.tag_flow),
    resident_context: Array.isArray(row.resident_context)
      ? row.resident_context
      : undefined,
    tables:
      row.tables && typeof row.tables === "object" && !Array.isArray(row.tables)
        ? (row.tables as Record<string, unknown>)
        : undefined,
    narrative_guide: asString(row.narrative_guide),
    core_premises: asStringList(row.core_premises),
    design_end:
      row.design_end &&
      typeof row.design_end === "object" &&
      !Array.isArray(row.design_end)
        ? (row.design_end as Record<string, unknown>)
        : undefined,
    instantiate_hints: parseInstantiateHints(row.instantiate_hints),
    open_questions: asStringList(row.open_questions),
    notes: asString(row.notes),
  };
}

/**
 * 解析 `设计.worker集`：优先 JSON（含从说明文字中抽取 `{...}`），失败再试 YAML（兼容旧草稿）。
 * 新产出应为 JSON。散文/提问文字会得到明确的 parseError，而不是晦涩的 YAML 报错。
 */
export function parseWorkerSetYaml(raw: string | undefined): ParsedWorkerSet | null {
  const text = raw?.trim();
  if (!text) return null;

  const jsonCandidate = extractJsonObjectText(text);
  if (jsonCandidate) {
    try {
      const doc = JSON.parse(jsonCandidate) as unknown;
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
        return { workers: [], parseError: "Worker 集不是有效的 JSON 对象" };
      }
      return parseWorkerSetObject(doc as Record<string, unknown>);
    } catch (err) {
      return {
        workers: [],
        parseError: err instanceof Error ? err.message : "JSON 解析失败",
      };
    }
  }

  // 明显是中文说明/提问，不要丢给 YAML（会报 Implicit keys…）
  if (looksLikeProseNotSpec(text)) {
    return {
      workers: [],
      parseError:
        "内容不是 JSON 规格（像是说明或提问文字）。提问应走 askUser，规格字段只能是 {…} JSON。",
    };
  }

  try {
    const doc = parseYaml(text);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      return { workers: [], parseError: "Worker 集不是有效的对象" };
    }
    return parseWorkerSetObject(doc as Record<string, unknown>);
  } catch (err) {
    return {
      workers: [],
      parseError: err instanceof Error ? err.message : "Worker 集解析失败",
    };
  }
}

/** 从纯 JSON、```json 围栏或夹杂说明的文本中抽出对象字面量 */
export function extractJsonObjectText(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith("{")) {
    try {
      JSON.parse(text);
      return text;
    } catch {
      /* fall through to brace scan */
    }
  }
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fence?.[1]) {
    try {
      JSON.parse(fence[1]);
      return fence[1].trim();
    } catch {
      /* continue */
    }
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = text.slice(first, last + 1);
    try {
      JSON.parse(slice);
      return slice;
    } catch {
      return null;
    }
  }
  return null;
}

export function looksLikeProseNotSpec(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith("{") || t.startsWith("[")) return false;
  // YAML 文档常见开头
  if (/^(---|version:|workers:|interaction:|form_summary:)/m.test(t)) return false;
  // 中文叙述 / 明显自然语言
  if (/[\u4e00-\u9fff]{8,}/.test(t) && !/^\s*[\w.-]+\s*:/.test(t)) return true;
  if (/^(我们|首先|根据|请|用户需求|我(?:们)?被要求)/.test(t)) return true;
  return false;
}

/** 是否像一份可用的 Worker 集（而非空壳 / 仅 parseError） */
export function isUsableWorkerSet(parsed: ParsedWorkerSet | null | undefined): boolean {
  if (!parsed || parsed.parseError) return false;
  if ((parsed.workers?.length ?? 0) > 0) return true;
  if (parsed.interaction && Object.keys(parsed.interaction).length > 0) return true;
  if (parsed.form_summary?.trim() || parsed.interaction_paradigm?.trim()) return true;
  if (parsed.narrative_guide?.trim() || (parsed.core_premises?.length ?? 0) > 0) {
    return true;
  }
  return false;
}

/**
 * 从 Worker 集推导创作阶段收尾可选 skill（如 opening-generator）。
 * 读 design_end / instantiate_hints.invoke + workers[].ref。
 */
export function deriveDesignStageScope(workerSet: ParsedWorkerSet | null): string[] {
  if (!workerSet) return [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (id: string) => {
    const key = id.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(key);
  };

  const designEnd = workerSet.design_end;
  if (designEnd) {
    const opening = designEnd.opening;
    if (
      opening === "optional" ||
      opening === true ||
      opening === "opening-generator"
    ) {
      add("opening-generator");
    }
    for (const id of asStringList(designEnd.invoke)) add(id);
  }

  for (const id of workerSet.instantiate_hints?.invoke ?? []) add(id);

  for (const worker of workerSet.workers) {
    const ref = worker.ref?.trim();
    if (ref && DESIGN_STAGE_SKILL_META[ref]) add(ref);
  }

  for (const id of workerSet.instantiate_hints?.skip ?? []) {
    seen.delete(id);
    const idx = ordered.indexOf(id);
    if (idx >= 0) ordered.splice(idx, 1);
  }

  return ordered;
}

/** @deprecated 请用 deriveDesignStageScope */
export function deriveInstantiateScope(workerSet: ParsedWorkerSet | null): string[] {
  return deriveDesignStageScope(workerSet);
}

/** play 阶段启用的 run worker ref 列表（保序、去重；不含 opening-generator 等 design-end skill） */
export function deriveRunWorkerScope(workerSet: ParsedWorkerSet | null): string[] {
  if (!workerSet) return [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const worker of workerSet.workers) {
    const ref = worker.ref?.trim();
    if (!ref || seen.has(ref)) continue;
    if (DESIGN_STAGE_SKILL_META[ref]) continue;
    seen.add(ref);
    ordered.push(ref);
  }
  return ordered;
}

/**
 * run 阶段需用户验收的 worker ref 列表（acceptance === review）。
 * 未写 acceptance 的不列入（创作时应写全；运行时缺省策略另议）。
 */
export function deriveReviewWorkerScope(workerSet: ParsedWorkerSet | null): string[] {
  if (!workerSet) return [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const worker of workerSet.workers) {
    const ref = worker.ref?.trim();
    if (!ref || seen.has(ref)) continue;
    if (DESIGN_STAGE_SKILL_META[ref]) continue;
    if (worker.acceptance !== "review") continue;
    seen.add(ref);
    ordered.push(ref);
  }
  return ordered;
}

/** 该 run worker 完成后是否应停下来给人验收 */
export function workerRequiresReview(
  workerSet: ParsedWorkerSet | null,
  workerId: string,
): boolean {
  if (!workerSet) return false;
  const id = workerId.trim();
  const entry = workerSet.workers.find((w) => w.ref?.trim() === id);
  return entry?.acceptance === "review";
}

export function instantiateMeta(id: string): { label: string; purpose: string } {
  return (
    DESIGN_STAGE_SKILL_META[id] ??
    INSTANTIATE_SKILL_META[id] ?? {
      label: id,
      purpose: "创作阶段可选 skill。",
    }
  );
}

export function runWorkerMeta(id: string): { label: string; purpose: string } {
  return (
    RUN_WORKER_META[id] ?? {
      label: id,
      purpose: "play 阶段按需 invoke。",
    }
  );
}
