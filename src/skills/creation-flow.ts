/**
 * 创作流程：编排产物（设计.创作流程）。
 * 可变增量 DAG：有序 steps + 每步 id/中文名 + depends_on；可追加、可同能力多次。
 *
 * 两层内容（作者细写，运行时只搭骨架）：
 * - recipes/：配方方法论（适用、核心思路、设计流程、原则）+ 近期起点 steps
 * - modules/：共用能力池；编排注入 meta 选型字段，执行注入方法全文
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { tryParseJsonDoc } from "../parse/json-doc.js";

export const CREATION_FLOW_TAG = "设计.创作流程";
export const CREATION_CURRENT_STEP_TAG = "创作.当前步骤";
/** 确认开干前：待确认的下一步快照（JSON） */
export const CREATION_PROPOSED_STEP_TAG = "创作.待确认步骤";
/** 用户点已完成节点重进：本步继承既有产物（"1"） */
export const CREATION_INHERIT_EXISTING_TAG = "创作.继承修改";
/** 用户手动选定的初始配方（存 recipe id，或 JSON {id,name}） */
export const CREATION_SELECTED_RECIPE_TAG = "创作.选用配方";

/** 进度指针：禁止当作 worker 产物写回或列入验收正文 */
export const PROGRESS_POINTER_TAGS = new Set<string>([
  CREATION_CURRENT_STEP_TAG,
  CREATION_PROPOSED_STEP_TAG,
  CREATION_INHERIT_EXISTING_TAG,
  CREATION_SELECTED_RECIPE_TAG,
  "创作.当前单位",
  "创作.已验收单位",
  "创作.已验收内容",
  "创作.能力开场白",
  "创作.能力开场状态",
]);

/** 旧名：含「设计.创作流程」。写回/验收过滤请用 isProgressPointerTag */
export const RUNTIME_PINNED_TAGS = new Set<string>([
  CREATION_FLOW_TAG,
  ...PROGRESS_POINTER_TAGS,
]);

export function isProgressPointerTag(tag: string): boolean {
  return PROGRESS_POINTER_TAGS.has(tag.trim());
}

export function isRuntimePinnedTag(tag: string): boolean {
  return RUNTIME_PINNED_TAGS.has(tag.trim());
}
export const MODULE_CATALOG_FILENAME = "modules/catalog.yaml";
export const RECIPE_CATALOG_FILENAME = "recipes/catalog.yaml";
/** 转述进料专用配方目录（与节点流程 catalog 不共享） */
export const DICTATE_RECIPE_CATALOG_FILENAME = "recipes/转述/catalog.yaml";
export const DICTATE_RECIPE_DIR = "recipes/转述";
export const DESIGN_STEP_WORKER_ID = "design-step";
export const DESIGN_FLOW_WORKER_ID = "design-flow";

/** 配方所属进料族：节点流程 vs 转述 */
export type RecipeIntakeFamily = "recipe" | "dictate";

const DEFAULT_SKILLS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skills",
);

/** 步骤调用参数。普通节点：编排期钉死、执行只读。〔先验产物〕实例步：步内钉「写什么」，执行期写入 params。 */
export type CreationFlowStepParams = Record<string, unknown>;

/** 原型 = 图上可增殖槽位；实例 = 点原型或历史 spawn 出的可执行步。 */
export type CreationFlowStepRole = "prototype" | "instance";

/** 规划层建议追加的原型节点（尚未编入 steps 时展示在图上）。 */
export type CreationFlowPrototypeSuggestion = {
  name: string;
  /** 建议生成什么 / 为何需要此原型 */
  suggestion: string;
  depends_on?: string[];
};

/**
 * 节点特性。缺省 = 普通执行步。后续会加更多 kind。
 * prior-artifact = 先验产物：须先定「写什么」（生成规则、具体实例）；编排器可提前规划，步内再钉/修订。
 */
export const MODULE_NODE_KINDS = ["prior-artifact"] as const;
export type ModuleNodeKind = (typeof MODULE_NODE_KINDS)[number];

export const MODULE_NODE_KIND_FLAGS: Record<ModuleNodeKind, string> = {
  "prior-artifact": "〔先验产物〕",
};

export function parseModuleNodeKind(raw: unknown): ModuleNodeKind | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim();
  return (MODULE_NODE_KINDS as readonly string[]).includes(key)
    ? (key as ModuleNodeKind)
    : undefined;
}

export function isPriorArtifactModule(
  module: { kind?: ModuleNodeKind } | null | undefined,
): boolean {
  return module?.kind === "prior-artifact";
}

/**
 * 本步怎么跑：
 * - fresh（缺省）= 从零产出。〔可反复〕再编入新 id 必须用这个——彻底新建，不改旧条。
 * - revise = 回头修改：继承 `revises` 所指那步的既有产物继续改。
 */
export type CreationFlowStepMode = "fresh" | "revise";

export type CreationFlowStep = {
  /**
   * 本局步骤唯一 id（验收与 depends_on 用这个）。
   * 同能力可多次出现时必须不同；缺省时程序按 name / name#n 补齐。
   */
  id: string;
  /** 固定中文名，须 ∈ 模块目录（可重复） */
  name: string;
  /** 依赖的其它步骤 id（旧稿若 name 唯一也可写 name） */
  depends_on: string[];
  /**
   * prototype = 科技树槽位，点进去增殖实例；instance = 可执行步。
   * 缺省 = 普通一次性节点。
   */
  role?: CreationFlowStepRole;
  /** role=instance：从哪个原型增殖出来 */
  from?: string;
  /** role=prototype：规划层对本槽位「建议生成什么」的短提示（执行时在步内钉细） */
  suggestion?: string;
  /**
   * 本步调用参数。
   * 普通节点：有必填声明时须在进执行前钉齐。
   * 〔先验产物〕实例：步内钉「写什么」，不写回原型。
   */
  params?: CreationFlowStepParams;
  /** 缺省 fresh。revise = 继承旧产物修改，不是再生成一条。 */
  mode?: CreationFlowStepMode;
  /** mode=revise 时：被改的既有步骤 id（须更前、同 name） */
  revises?: string;
};

export type CreationFlowStatus = "open" | "closed";

export type CreationFlow = {
  version: 1;
  /** 可选一句体验复述（给人看） */
  brief?: string;
  /**
   * open = 当前只是近期 horizon，还可增量追加 / 反复编排同能力；
   * closed = 不再扩步（可走收成）。缺省按 closed（兼容旧固定 DAG）。
   */
  status?: CreationFlowStatus;
  /** 规划层建议追加、尚未编入 steps 的原型节点 */
  suggestions?: CreationFlowPrototypeSuggestion[];
  steps: CreationFlowStep[];
};

/** catalog 声明：编排进 DAG 时本步需要哪些调用参数 */
export type ModuleParamSpec = {
  key: string;
  /** 给人看的中文名 */
  label: string;
  /** 缺省 false；true = validateCreationFlow / 编排必须钉齐 */
  required?: boolean;
  /** 给编排器的短提示（选项从何来、可否其它） */
  hint?: string;
};

export type ModuleCatalogEntry = {
  /** 目录文件夹名，如 aesthetics-interaction */
  id: string;
  name: string;
  /** 给 agent 的短声明：用来决定要不要调度这一步 */
  declaration: string;
  /** 执行期产物 tag（流程 JSON 不写；程序映射） */
  artifact: string;
  /**
   * 可选：默认可反复编排进流程（如生成规则、具体实例）。
   * 程序不硬拦；给编排与校验提示。
   */
  repeatable?: boolean;
  /**
   * 可选：创作终节点。选定后程序收口并保存。
   * 尚未选定前，用户要补前序节点时应插在本步之前，不要当成「已经不能再编排」。
   */
  closer?: boolean;
  /**
   * 可选：程序步。不抛默认问题、不经「同意并开始」，提案后直接执行；
   * 产物仍走验收。适合投影排序这类只排序、几乎不问用户的收成步。
   */
  auto?: boolean;
  /**
   * 可选：节点特性。缺省为普通执行步。
   * prior-artifact = 先验产物，须先定写什么；params 是规划产物而非拦执行的必填项。
   */
  kind?: ModuleNodeKind;
  /**
   * 可选：默认问题（开场白）。优先用 prompt.md 的 ```opening 块；
   * catalog 写了则作覆盖。程序发出，不经 LLM。
   */
  opening?: string;
  /**
   * 可选：步骤参数声明。
   * 普通节点：required 须在进执行前钉齐。
   * 〔先验产物〕：规划产物字段；可提前写入 params，空则步内钉，不拦确认开干。
   */
  params?: ModuleParamSpec[];
  /** 来自 prompt.md ```meta：何时该选用（编排选型） */
  when?: string;
  /** 来自 prompt.md ```meta：何时不该选用 */
  when_not?: string;
  /** 来自 prompt.md ```meta：与其它能力的边界 */
  boundary?: string;
};

/** 本步程序开场白正文（design-step 发出后写入，供 LLM 看见） */
export const CREATION_MODULE_OPENING_TAG = "创作.能力开场白";
/** JSON：{ [步骤中文名]: "shown" | "answered" } */
export const CREATION_MODULE_OPENING_STATE_TAG = "创作.能力开场状态";
export const SLOT_CREATION_MODULE_OPENING_STATE = "creationModuleOpeningState";

export type ModuleOpeningState = Record<string, "shown" | "answered">;

export type ModuleCatalog = {
  modules: ModuleCatalogEntry[];
};

/** 初始配方目录条目（短声明，给选型） */
export type RecipeCatalogEntry = {
  id: string;
  name: string;
  declaration: string;
  /** 条目来自哪本目录；缺省视为节点流程 */
  family?: RecipeIntakeFamily;
};

export type RecipeCatalog = {
  recipes: RecipeCatalogEntry[];
};

/**
 * 单份配方详情。
 * 方法论字段供编排选型；seed = 近期起点 steps（可为空；name 须 ∈ 模块池）。
 */
export type RecipeDetail = {
  id: string;
  name: string;
  declaration: string;
  /** 适用什么体验/任务 */
  when?: string;
  /** 整套设计方法的核心思路与最终目标 */
  core?: string;
  /** 设计流程：如何增量选型、何时收成（字符串或条目列表） */
  process?: string | string[];
  /** 配方特有取舍原则 */
  principles?: string | string[];
  /**
   * @deprecated 旧字段；新配方用 core/process/principles。解析仍可读，格式化时作兜底。
   */
  hint?: string;
  seed: CreationFlow | null;
};

export type CreationFlowValidation = {
  ok: boolean;
  errors: string[];
};

/** 工作流计划节点相对执行进度（给人看的三态） */
export type FlowStepRunState = "done" | "current" | "pending";

/** 可反复能力在图上的「再开一条」入口 */
export type CreationFlowSpawnView = {
  name: string;
  ready: boolean;
  blockedReason?: string;
};

/** 目录里尚未编入本局 DAG、仍可追加的技能 */
export type CreationFlowAvailableModule = {
  name: string;
  declaration?: string;
  repeatable?: boolean;
  closer?: boolean;
};

export type CreationFlowUserView = {
  brief?: string;
  status?: CreationFlowStatus;
  /** 规划层建议追加的原型（尚未在 steps 里） */
  suggestions?: CreationFlowPrototypeSuggestion[];
  /** 技能目录里尚未编入本局、仍可要求追加 */
  availableModules?: CreationFlowAvailableModule[];
  steps: Array<{
    order: number;
    id: string;
    name: string;
    depends_on: string[];
    role?: CreationFlowStepRole;
    from?: string;
    suggestion?: string;
    /** 图上短标题：增殖的是哪条规则 / 哪批实例（不等于技能名） */
    title?: string;
    /** 同能力第几次（>1 时 UI 可标「再来」；回头修改不计入「第 N 次新建」） */
    occurrence?: number;
    /** fresh=从零新建；revise=回头修改 */
    mode?: CreationFlowStepMode;
    /** 回头修改时：被改的既有步骤 id */
    revises?: string;
    /** 目录里的短声明（有则展示） */
    declaration?: string;
    repeatable?: boolean;
    /** 收口节点（开场白）：点进去做这一条，不增殖 */
    closer?: boolean;
    /** 本步调用参数（普通节点编排钉死；先验产物=规划内容） */
    params?: CreationFlowStepParams;
    /** 参数缺必填项时的提示（给人看）；先验产物不拦执行，不出现此项 */
    paramsMissing?: string[];
    /** 节点特性（如先验产物） */
    kind?: ModuleNodeKind;
    /** 依赖层级（0 = 无前置）；图按列/行排 */
    layer: number;
    /** 未验收且 depends_on 均已验收 */
    ready: boolean;
    /** 图上可点进去做这一条（ready 且未完成） */
    selectable: boolean;
    /** 挡住本步的未完成依赖 id */
    blockedBy?: string[];
    /** 已执行 / 将要执行 / 未执行 */
    runState: FlowStepRunState;
    /** 本步产物 tag（已完成节点菜单「查看产物」用） */
    artifactTag?: string;
    /** 黑板已有该步产物 */
    hasArtifact?: boolean;
  }>;
  parseError?: string;
};

export function parseCreationFlowStepRole(
  raw: unknown,
): CreationFlowStepRole | undefined {
  if (raw === "prototype" || raw === "instance") return raw;
  return undefined;
}

export function isPrototypeStep(
  step: Pick<CreationFlowStep, "role"> | null | undefined,
): boolean {
  return step?.role === "prototype";
}

export function isInstanceStep(
  step: Pick<CreationFlowStep, "role"> | null | undefined,
): boolean {
  return step?.role === "instance";
}

/** 图上可点进去跑 design-step 的步（非原型槽位） */
export function isExecutableStep(step: CreationFlowStep): boolean {
  return !isPrototypeStep(step);
}

function parsePrototypeSuggestions(raw: unknown): CreationFlowPrototypeSuggestion[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: CreationFlowPrototypeSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const suggestion =
      typeof row.suggestion === "string"
        ? row.suggestion.trim()
        : typeof row.hint === "string"
          ? row.hint.trim()
          : "";
    if (!name || !suggestion) continue;
    const depsRaw = row.depends_on ?? row.dependsOn ?? [];
    const depends_on = Array.isArray(depsRaw)
      ? depsRaw.map((d) => String(d).trim()).filter(Boolean)
      : undefined;
    out.push({
      name,
      suggestion,
      ...(depends_on?.length ? { depends_on } : {}),
    });
  }
  return out.length ? out : undefined;
}

/** 依赖是否满足：指向原型 = 至少有一条已验收实例；否则 = 该步已验收。 */
export function isCreationDependencySatisfied(
  flow: CreationFlow,
  depRef: string,
  acceptedStepIds: readonly string[],
): boolean {
  const depStep = findStepByRef(flow, depRef);
  if (!depStep) return false;
  if (isPrototypeStep(depStep)) {
    return flow.steps.some(
      (s) =>
        isInstanceStep(s) &&
        s.from === depStep.id &&
        isStepAccepted(s, acceptedStepIds),
    );
  }
  return isStepAccepted(depStep, acceptedStepIds);
}

export function isPrototypeSelectable(
  flow: CreationFlow,
  step: CreationFlowStep,
  acceptedStepIds: readonly string[],
): boolean {
  if (!isPrototypeStep(step)) return false;
  return step.depends_on.every((dep) =>
    isCreationDependencySatisfied(flow, dep, acceptedStepIds),
  );
}

/** 根对象是创作流程 DAG（有 steps，且至少一步带 name） */
export function looksLikeCreationFlowDoc(doc: unknown): boolean {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  const steps = (doc as { steps?: unknown }).steps;
  if (!Array.isArray(steps) || steps.length === 0) return false;
  return steps.some(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as { name?: unknown }).name === "string" &&
      String((item as { name: string }).name).trim().length > 0,
  );
}

/** 从任意正文抽取 JSON 对象 */
export function extractJsonObject(raw: string): unknown | null {
  const parsed = tryParseJsonDoc(raw);
  if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed;
  }
  return null;
}

/** 规范化 steps[].params：仅接受普通对象 */
export function normalizeStepParams(
  raw: unknown,
): CreationFlowStepParams | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: CreationFlowStepParams = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 目录声明的必填参数中，本步仍缺失的 key（按声明顺序）。〔先验产物〕不拦执行，恒为 []。 */
export function missingRequiredStepParams(
  step: Pick<CreationFlowStep, "params">,
  module: ModuleCatalogEntry | null | undefined,
): string[] {
  if (isPriorArtifactModule(module)) return [];
  const specs = module?.params ?? [];
  if (specs.length === 0) return [];
  const params = step.params ?? {};
  const missing: string[] = [];
  for (const spec of specs) {
    if (!spec.required) continue;
    const v = params[spec.key];
    if (v == null) {
      missing.push(spec.key);
      continue;
    }
    if (typeof v === "string" && !v.trim()) {
      missing.push(spec.key);
    }
  }
  return missing;
}

/** 给人 / LLM 看的参数摘要 */
export function formatStepParamsForPrompt(
  params: CreationFlowStepParams | null | undefined,
): string {
  if (!params || Object.keys(params).length === 0) return "（无）";
  return Object.entries(params)
    .map(([k, v]) => {
      const rendered =
        typeof v === "string" ? v : JSON.stringify(v, null, 0);
      return `- ${k}: ${rendered}`;
    })
    .join("\n");
}

const PRIOR_ARTIFACT_CONTEXT_TITLE =
  "## 【本步对象】须在本步与用户钉「写什么」再产出（不依赖编排层预填）";

/** 〔先验产物〕实例步注入块：params 仅来自本步已钉内容；原型 suggestion 作参考。 */
export function formatPriorArtifactContext(
  params: CreationFlowStepParams | null | undefined,
  prototypeSuggestion?: string | null,
): string {
  const body = formatStepParamsForPrompt(params);
  const hint = prototypeSuggestion?.trim()
    ? `\n\n【原型建议】${prototypeSuggestion.trim()}（规划层提示，可在步内修订或忽略）`
    : "";
  const note =
    !params || Object.keys(params).length === 0
      ? "尚未钉本步具体写什么。先与用户确认对象/范围，再填产物。"
      : "以上为本步已钉对象。用户改对象或范围时，以本步最新认定为准，并重钉对应英文 id。";
  return `${PRIOR_ARTIFACT_CONTEXT_TITLE}\n\n${body}\n\n${note}${hint}`;
}

const REVISE_MODE_ALIASES = new Set([
  "revise",
  "amend",
  "edit",
  "修改",
  "回头修改",
  "继承修改",
]);
const FRESH_MODE_ALIASES = new Set([
  "fresh",
  "new",
  "create",
  "新建",
  "再来",
  "再来一次",
]);

/** 解析 DAG 步骤的 mode；无法识别则视为缺省（fresh） */
export function parseCreationFlowStepMode(raw: unknown): CreationFlowStepMode | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (REVISE_MODE_ALIASES.has(key) || REVISE_MODE_ALIASES.has(raw.trim())) {
    return "revise";
  }
  if (FRESH_MODE_ALIASES.has(key) || FRESH_MODE_ALIASES.has(raw.trim())) {
    return "fresh";
  }
  return undefined;
}

export function isReviseStep(
  step: Pick<CreationFlowStep, "mode"> | null | undefined,
): boolean {
  return step?.mode === "revise";
}

export function isInheritExistingFlag(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw !== "string") return false;
  const key = raw.trim().toLowerCase();
  return key === "1" || key === "true" || key === "revise" || key === "回头修改";
}

/**
 * 回头修改不是 DAG 节点：丢掉 mode=revise 步，并把依赖改回原稿 id。
 * 旧会话里编排器排过的修订步靠这一层从执行图上拿掉。
 */
export function stripReviseSteps(flow: CreationFlow): CreationFlow {
  const idMap = new Map<string, string>();
  for (const step of flow.steps) {
    if (!isReviseStep(step)) continue;
    const origin = step.revises
      ? flow.steps.find((s) => s.id === step.revises || s.name === step.revises)
      : undefined;
    idMap.set(step.id, origin?.id || step.revises || step.name);
  }
  if (idMap.size === 0) return flow;

  const resolve = (ref: string): string => {
    let cur = ref.trim();
    const seen = new Set<string>();
    while (idMap.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = idMap.get(cur)!;
    }
    return cur;
  };

  const steps = flow.steps
    .filter((s) => !isReviseStep(s))
    .map((s) => {
      const depends_on = [...new Set(s.depends_on.map(resolve))].filter(
        (d) => d && d !== s.id,
      );
      if (
        depends_on.length === s.depends_on.length &&
        depends_on.every((d, i) => d === s.depends_on[i])
      ) {
        return s;
      }
      return { ...s, depends_on };
    });

  const suggestions = flow.suggestions?.map((sg) => {
    if (!sg.depends_on?.length) return sg;
    return { ...sg, depends_on: [...new Set(sg.depends_on.map(resolve))] };
  });

  return {
    ...flow,
    steps,
    ...(suggestions ? { suggestions } : {}),
  };
}

function parseStepRevisesRef(raw: Record<string, unknown>): string | undefined {
  for (const key of ["revises", "revise_of", "revises_id"] as const) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

type DraftCreationFlowStep = {
  id?: string;
  name: string;
  depends_on: string[];
  role?: CreationFlowStepRole;
  from?: string;
  suggestion?: string;
  params?: CreationFlowStepParams;
  mode?: CreationFlowStepMode;
  revises?: string;
};

function withStepModeFields(
  step: DraftCreationFlowStep,
): Pick<CreationFlowStep, "mode" | "revises"> {
  return {
    ...(step.mode === "revise" ? { mode: "revise" as const } : {}),
    ...(step.revises ? { revises: step.revises } : {}),
  };
}

/**
 * 回头修改步：补 revises（最近一条同名更前步），并继承其 params（本步已写的优先）。
 */
export function normalizeReviseSteps(
  steps: CreationFlowStep[],
): CreationFlowStep[] {
  return steps.map((step, i) => {
    if (step.mode !== "revise") return step;
    let revises = step.revises?.trim() || "";
    if (!revises) {
      for (let j = i - 1; j >= 0; j--) {
        if (steps[j]?.name === step.name) {
          revises = steps[j]!.id;
          break;
        }
      }
    }
    const origin = revises
      ? steps.find((s) => s.id === revises || s.name === revises)
      : undefined;
    const inherited = origin?.params;
    const params =
      inherited && Object.keys(inherited).length
        ? { ...inherited, ...(step.params ?? {}) }
        : step.params;
    return {
      ...step,
      ...(revises ? { revises } : {}),
      ...(params && Object.keys(params).length ? { params } : {}),
    };
  });
}

/** 为缺 id 的步骤补齐唯一 id；同 name 多次 → name#n；回头修改 → name·改 */
export function ensureCreationFlowStepIds(
  steps: Array<DraftCreationFlowStep>,
): CreationFlowStep[] {
  const used = new Set<string>();
  const nameCount = new Map<string, number>();
  const out: CreationFlowStep[] = [];

  for (const raw of steps) {
    const name = raw.name.trim();
    const n = (nameCount.get(name) ?? 0) + 1;
    nameCount.set(name, n);
    const revise = raw.mode === "revise";

    let id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) {
      if (revise) {
        id = n === 1 ? `${name}·改` : `${name}·改`;
        if (used.has(id)) {
          let i = 2;
          while (used.has(`${name}·改#${i}`)) i++;
          id = `${name}·改#${i}`;
        }
      } else {
        id = n === 1 ? name : `${name}#${n}`;
      }
    }
    if (used.has(id)) {
      let i = 2;
      while (used.has(`${id}#${i}`)) i++;
      id = `${id}#${i}`;
    }
    used.add(id);
    out.push({
      id,
      name,
      depends_on: raw.depends_on.map((d) => d.trim()).filter(Boolean),
      ...(raw.role ? { role: raw.role } : {}),
      ...(raw.from ? { from: raw.from } : {}),
      ...(raw.suggestion ? { suggestion: raw.suggestion } : {}),
      ...(raw.params ? { params: raw.params } : {}),
      ...withStepModeFields(raw),
    });
  }
  return normalizeReviseSteps(out);
}

/**
 * 补齐 / 规范化原型与实例角色（旧稿 repeatable 无 role → 升为 prototype + instances）。
 */
export function normalizeFlowStepRoles(
  steps: CreationFlowStep[],
  catalog: ModuleCatalog | null | undefined,
): CreationFlowStep[] {
  const repeatableNames = new Set(
    (catalog?.modules ?? [])
      .filter((m) => m.repeatable === true)
      .map((m) => m.name),
  );
  const prototypeIdByName = new Map<string, string>();
  for (const step of steps) {
    if (isPrototypeStep(step)) prototypeIdByName.set(step.name, step.id);
  }

  const out: CreationFlowStep[] = [];
  for (const step of steps) {
    if (step.role) {
      if (isPrototypeStep(step)) {
        const { params: _drop, ...rest } = step;
        out.push(rest);
      } else {
        out.push(step);
      }
      continue;
    }
    if (!repeatableNames.has(step.name) || isReviseStep(step)) {
      out.push(step);
      continue;
    }
    if (!prototypeIdByName.has(step.name)) {
      prototypeIdByName.set(step.name, step.id);
      const hint =
        step.params && Object.keys(step.params).length
          ? Object.entries(step.params)
              .map(
                ([k, v]) =>
                  `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`,
              )
              .join("；")
          : undefined;
      const { params: _drop, ...rest } = step;
      out.push({
        ...rest,
        role: "prototype",
        ...(hint && !step.suggestion ? { suggestion: hint } : {}),
      });
    } else {
      out.push({
        ...step,
        role: "instance",
        from: prototypeIdByName.get(step.name)!,
      });
    }
  }
  return out;
}

/** 按 id 或（唯一）name 解析步骤引用 */
export function findStepByRef(
  flow: CreationFlow,
  ref: string,
): CreationFlowStep | null {
  const key = ref.trim();
  if (!key) return null;
  const byId = flow.steps.find((s) => s.id === key);
  if (byId) return byId;
  const byName = flow.steps.filter((s) => s.name === key);
  return byName.length === 1 ? byName[0]! : null;
}

/** 验收 / 当前步骤用的单位 id（优先 step.id） */
export function stepUnitId(step: CreationFlowStep): string {
  return step.id || step.name;
}

/**
 * 验收时记下哪一步做完。只认流程里的真实 step.id：
 * LLM 可能把产物误写进「创作.当前步骤」，那种内容不能当进度。
 */
export function pickRecordedStepId(params: {
  flow: CreationFlow | null;
  alreadyAccepted?: readonly string[];
  pinnedUnitId?: string | null;
  writtenCurrentStep?: string | null;
  summaryHint?: string | null;
}): string | null {
  const flow = params.flow;
  const tryRef = (ref: string | undefined | null): string | null => {
    const key = ref?.trim();
    if (!key || key === "flow") return null;
    if (!flow) return key;
    const step = findStepByRef(flow, key);
    return step ? stepUnitId(step) : null;
  };

  const pinned = tryRef(params.pinnedUnitId);
  if (pinned) return pinned;

  const written = tryRef(params.writtenCurrentStep);
  if (written) return written;

  const hinted = tryRef(params.summaryHint);
  if (hinted) return hinted;

  if (flow) {
    const pending = nextPendingStep(flow, params.alreadyAccepted ?? []);
    if (pending) return stepUnitId(pending);
  }
  return null;
}

export function parseCreationFlow(raw: string | undefined | null): CreationFlow | null {
  if (!raw?.trim()) return null;
  const doc = extractJsonObject(raw);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const row = doc as Record<string, unknown>;
  const stepsRaw = row.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) return null;

  const drafted: DraftCreationFlowStep[] = [];
  for (const item of stepsRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const s = item as Record<string, unknown>;
    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (!name) return null;
    const id = typeof s.id === "string" && s.id.trim() ? s.id.trim() : undefined;
    const depsRaw = s.depends_on ?? s.dependsOn ?? [];
    const depends_on = Array.isArray(depsRaw)
      ? depsRaw.map((d) => String(d).trim()).filter(Boolean)
      : [];
    const params = normalizeStepParams(s.params);
    const mode =
      parseCreationFlowStepMode(s.mode) ?? parseCreationFlowStepMode(s.intent);
    const revises = parseStepRevisesRef(s);
    const role = parseCreationFlowStepRole(s.role);
    const from =
      typeof s.from === "string" && s.from.trim() ? s.from.trim() : undefined;
    const suggestion =
      typeof s.suggestion === "string" && s.suggestion.trim()
        ? s.suggestion.trim()
        : undefined;
    drafted.push({
      id,
      name,
      depends_on,
      ...(role ? { role } : {}),
      ...(from ? { from } : {}),
      ...(suggestion ? { suggestion } : {}),
      ...(params ? { params } : {}),
      ...(mode ? { mode } : {}),
      ...(revises ? { revises } : {}),
    });
  }

  const steps = ensureCreationFlowStepIds(drafted);

  const brief =
    typeof row.brief === "string" && row.brief.trim() ? row.brief.trim() : undefined;
  const statusRaw = typeof row.status === "string" ? row.status.trim() : "";
  const status: CreationFlowStatus | undefined =
    statusRaw === "open" || statusRaw === "closed" ? statusRaw : undefined;
  const suggestions = parsePrototypeSuggestions(row.suggestions);

  return { version: 1, brief, status, ...(suggestions ? { suggestions } : {}), steps };
}

export function parseModuleCatalog(raw: string): ModuleCatalog | null {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const modulesRaw = (doc as Record<string, unknown>).modules;
  if (!Array.isArray(modulesRaw)) return null;

  const modules: ModuleCatalogEntry[] = [];
  for (const item of modulesRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const m = item as Record<string, unknown>;
    const name = typeof m.name === "string" ? m.name.trim() : "";
    const declaration =
      typeof m.declaration === "string" ? m.declaration.trim() : "";
    const artifact = typeof m.artifact === "string" ? m.artifact.trim() : "";
    const id =
      typeof m.id === "string" && m.id.trim()
        ? m.id.trim()
        : name
          ? slugFromName(name)
          : "";
    if (!name || !declaration || !artifact || !id) continue;
    const opening =
      typeof m.opening === "string" && m.opening.trim()
        ? m.opening.trim()
        : undefined;
    const repeatable = m.repeatable === true;
    const closer = m.closer === true;
    const auto = m.auto === true;
    const kind = parseModuleNodeKind(m.kind);
    const params = parseModuleParamSpecs(m.params);
    modules.push({
      id,
      name,
      declaration,
      artifact,
      ...(repeatable ? { repeatable: true } : {}),
      ...(closer ? { closer: true } : {}),
      ...(auto ? { auto: true } : {}),
      ...(kind ? { kind } : {}),
      ...(opening ? { opening } : {}),
      ...(params ? { params } : {}),
    });
  }
  if (modules.length === 0) return null;
  return { modules };
}

function parseModuleParamSpecs(raw: unknown): ModuleParamSpec[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ModuleParamSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!key || !label) continue;
    const hint =
      typeof row.hint === "string" && row.hint.trim()
        ? row.hint.trim()
        : undefined;
    out.push({
      key,
      label,
      ...(row.required === true ? { required: true } : {}),
      ...(hint ? { hint } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * 能力 prompt.md 可切割块（fence 语言标签 = 块 id）。
 * 标准块见 MODULE_SECTION_IDS；程序只认 ```id … ```，不认散文标题 alone。
 */
export const MODULE_SECTION_IDS = [
  "meta",
  "opening",
  "task",
  "principles",
  "probe",
  "output",
  "checklist",
  "examples",
] as const;

export type ModuleSectionId = (typeof MODULE_SECTION_IDS)[number];

export type ModulePromptSections = {
  /** 原文 */
  raw: string;
  /** 按 fence 标签切出的块；缺块则为空串 */
  blocks: Partial<Record<ModuleSectionId, string>> & Record<string, string>;
};

/**
 * 切割能力文档：抽取全部 ```lang … ``` 块。
 * 同一 lang 多次出现时拼接（中间空行）。
 */
export function parseModulePromptSections(promptMd: string): ModulePromptSections {
  const blocks: Record<string, string> = {};
  if (!promptMd?.trim()) return { raw: promptMd ?? "", blocks };
  const re = /```([a-zA-Z][\w-]*)\s*\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(promptMd)) !== null) {
    const id = m[1]!.toLowerCase();
    const body = m[2]!.trim();
    if (!body) continue;
    blocks[id] = blocks[id] ? `${blocks[id]}\n\n${body}` : body;
  }
  return { raw: promptMd, blocks };
}

export function getModuleSection(
  sections: ModulePromptSections,
  id: ModuleSectionId | string,
): string | null {
  const body = sections.blocks[id.toLowerCase()]?.trim();
  return body || null;
}

/** 把 YAML 字段收成可展示的字符串（支持 string / string[]） */
export function coerceYamlTextField(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    const lines = raw
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
    return lines.length ? lines.map((l) => `- ${l}`).join("\n") : undefined;
  }
  return undefined;
}

/**
 * 从 prompt.md 的 ```meta 块解析选型字段。
 * catalog 负责索引/params；when/when_not/boundary 以 meta 为准。
 */
export function parseModuleMetaFromPrompt(promptMd: string): {
  declaration?: string;
  when?: string;
  when_not?: string;
  boundary?: string;
} | null {
  const metaRaw = getModuleSection(parseModulePromptSections(promptMd), "meta");
  if (!metaRaw) return null;
  let doc: unknown;
  try {
    doc = parseYaml(metaRaw);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const row = doc as Record<string, unknown>;
  const declaration = coerceYamlTextField(row.declaration);
  const when = coerceYamlTextField(row.when);
  const when_not = coerceYamlTextField(row.when_not);
  const boundary = coerceYamlTextField(row.boundary);
  if (!declaration && !when && !when_not && !boundary) return null;
  return {
    ...(declaration ? { declaration } : {}),
    ...(when ? { when } : {}),
    ...(when_not ? { when_not } : {}),
    ...(boundary ? { boundary } : {}),
  };
}

/**
 * 用各能力 prompt.md 的 meta 充实目录条目（编排选型用）。
 * declaration：meta 有则覆盖 catalog；when/when_not/boundary：仅来自 meta。
 */
export async function enrichModuleCatalogWithMeta(
  catalog: ModuleCatalog,
  skillPackRoot: string,
  skillsRoot = DEFAULT_SKILLS_ROOT,
): Promise<ModuleCatalog> {
  const modules = await Promise.all(
    catalog.modules.map(async (m) => {
      const prompt = await loadModulePrompt(skillPackRoot, m.id, skillsRoot);
      if (!prompt) return m;
      const meta = parseModuleMetaFromPrompt(prompt);
      if (!meta) return m;
      return {
        ...m,
        ...(meta.declaration ? { declaration: meta.declaration } : {}),
        ...(meta.when ? { when: meta.when } : {}),
        ...(meta.when_not ? { when_not: meta.when_not } : {}),
        ...(meta.boundary ? { boundary: meta.boundary } : {}),
      };
    }),
  );
  return { modules };
}

/**
 * 从能力 prompt.md 抽取默认问题（开场白）。
 * 只认 ```opening … ```（能力标准块）。
 */
export function extractModuleOpening(promptMd: string): string | null {
  return getModuleSection(parseModulePromptSections(promptMd), "opening");
}

/**
 * 拼给 LLM 的方法正文：标准块按固定顺序；无标准块时回退全文。
 * 不含 opening（开场已由程序发出）。
 */
export function formatModulePromptForLlm(promptMd: string): string {
  const { blocks } = parseModulePromptSections(promptMd);
  const order: ModuleSectionId[] = [
    "meta",
    "task",
    "principles",
    "probe",
    "output",
    "checklist",
    "examples",
  ];
  const parts: string[] = [];
  for (const id of order) {
    const body = blocks[id]?.trim();
    if (body) parts.push(`## ${id}\n\n\`\`\`${id}\n${body}\n\`\`\``);
  }
  if (parts.length === 0) return promptMd.trim();
  return parts.join("\n\n");
}

export function parseModuleOpeningState(
  raw: string | unknown | null | undefined,
): ModuleOpeningState {
  if (raw == null) return {};
  const text =
    typeof raw === "string"
      ? raw.trim()
      : typeof raw === "object"
        ? JSON.stringify(raw)
        : String(raw);
  if (!text) return {};
  try {
    const doc = JSON.parse(text) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};
    const out: ModuleOpeningState = {};
    for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
      if (v === "shown" || v === "answered") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function stringifyModuleOpeningState(state: ModuleOpeningState): string {
  return JSON.stringify(state);
}

/**
 * 序列化「设计.创作流程」（程序 seed / 验收写回共用）。
 */
export function stringifyCreationFlow(flow: CreationFlow): string {
  return JSON.stringify({
    version: 1,
    ...(flow.brief ? { brief: flow.brief } : {}),
    ...(flow.status ? { status: flow.status } : {}),
    ...(flow.suggestions?.length ? { suggestions: flow.suggestions } : {}),
    steps: flow.steps,
  });
}

/**
 * 编排层重排流程时，已验收步骤按原样保留：
 * 缺了就按原位置补回，改了名字/参数就还原。编排只能动未验收步。
 */
export function mergeCreationFlowPreservingAccepted(params: {
  prevRaw: string | null | undefined;
  nextRaw: string;
  acceptedStepIds: readonly string[];
}): { raw: string; restored: string[] } {
  const nextParsed = parseCreationFlow(params.nextRaw);
  const prev = parseCreationFlow(params.prevRaw);
  if (!nextParsed) return { raw: params.nextRaw, restored: [] };
  const next = stripReviseSteps(nextParsed);
  if (!prev) {
    return { raw: stringifyCreationFlow(next), restored: [] };
  }

  const accepted = prev.steps.filter(
    (s) => isStepAccepted(s, params.acceptedStepIds) && !isReviseStep(s),
  );
  if (accepted.length === 0) {
    return { raw: stringifyCreationFlow(next), restored: [] };
  }

  const restored: string[] = [];
  const steps = [...next.steps];
  for (let i = 0; i < accepted.length; i++) {
    const frozen = accepted[i]!;
    const at = steps.findIndex((s) => s.id === frozen.id);
    if (at < 0) {
      steps.splice(Math.min(i, steps.length), 0, frozen);
      restored.push(frozen.id);
      continue;
    }
    const current = steps[at]!;
    const changed =
      current.name !== frozen.name ||
      JSON.stringify(current.depends_on) !== JSON.stringify(frozen.depends_on) ||
      JSON.stringify(current.params ?? null) !== JSON.stringify(frozen.params ?? null) ||
      (current.mode ?? "fresh") !== (frozen.mode ?? "fresh") ||
      (current.revises ?? "") !== (frozen.revises ?? "") ||
      (current.role ?? "") !== (frozen.role ?? "") ||
      (current.from ?? "") !== (frozen.from ?? "") ||
      (current.suggestion ?? "") !== (frozen.suggestion ?? "");
    if (changed) {
      steps[at] = frozen;
      restored.push(frozen.id);
    }
  }
  return {
    raw: stringifyCreationFlow(
      stripReviseSteps({ ...next, version: 1, steps }),
    ),
    restored,
  };
}

/**
 * 配方近期起点 → 可写入黑板的开局 DAG。
 * 开局节点跟剧本（配方 seed.steps）走，不在运行时写死某一步。
 * steps 为空则返回 null（仍只当选型参考，不预置流程）。
 */
export function creationFlowFromRecipeSeed(
  detail: Pick<RecipeDetail, "seed">,
): CreationFlow | null {
  const seed = detail.seed;
  if (!seed?.steps?.length) return null;
  return {
    version: 1,
    ...(seed.brief ? { brief: seed.brief } : {}),
    status: seed.status ?? "open",
    steps: ensureCreationFlowStepIds(seed.steps),
  };
}

/** 无 id 时的兜底（目录仍应显式写 id） */
function slugFromName(name: string): string {
  const map: Record<string, string> = {
    美学纲领与交互范式: "aesthetics-interaction",
    交互范式: "interaction",
    美学纲领: "aesthetics",
    叙事指南: "narrative",
    叙事指南与故事推进: "narrative",
    实现机制: "mechanism",
    舞台骨架: "world-blueprint",
    世界蓝图与人文地理: "world-blueprint", // 旧称
    世界蓝图: "world-blueprint", // 旧简称
    生成规则: "generation-rules",
    具体实例: "concrete-instances",
    拓扑图谱: "topology",
    回复呈现: "status-bar",
    设计状态栏: "status-bar",
    设计监控栏: "status-bar",
    变量设计与更新规则: "variable-design",
    变量控制上下文: "variable-context",
    设计回复格式: "reply-format",
    正文组成: "reply-format",
    随机范围整理: "random-range",
    游玩拓扑: "worker-spec",
    "Worker 规格": "worker-spec", // 旧称，等同游玩拓扑
    细化终稿: "refine",
    开场白与开场变量: "opening-setup",
    开场白: "opening-setup",
  };
  return map[name] ?? name;
}

export async function loadModuleCatalog(
  skillPackRoot: string,
  skillsRoot = DEFAULT_SKILLS_ROOT,
): Promise<ModuleCatalog | null> {
  const fullPath = path.join(skillsRoot, skillPackRoot, MODULE_CATALOG_FILENAME);
  try {
    const raw = await readFile(fullPath, "utf8");
    const catalog = parseModuleCatalog(raw);
    if (!catalog) return null;
    return enrichModuleCatalogWithMeta(catalog, skillPackRoot, skillsRoot);
  } catch {
    return null;
  }
}

/** 注入 design-flow：能力名 + 选型字段（meta）+ 编排参数；非执行全文 */
export function formatModuleCatalogForAgent(catalog: ModuleCatalog): string {
  const lines = catalog.modules.map((m) => {
    const flags = [
      m.repeatable ? "〔可反复〕" : "",
      m.closer ? "〔收口〕" : "",
      m.auto ? "〔程序步〕" : "",
      m.kind ? MODULE_NODE_KIND_FLAGS[m.kind] : "",
    ]
      .filter(Boolean)
      .join("");
    const parts: string[] = [`- ${m.name}${flags}：${m.declaration}`];
    if (m.when) parts.push(`  何时用：${indentMultiline(m.when, "  ")}`);
    if (m.when_not) parts.push(`  何时不用：${indentMultiline(m.when_not, "  ")}`);
    if (m.boundary) parts.push(`  边界：${indentMultiline(m.boundary, "  ")}`);
    if (m.params && m.params.length > 0) {
      if (isPriorArtifactModule(m)) {
        parts.push(
          `  规划产物字段（可提前写入 params；空则步内钉）：${m.params
            .map((p) => {
              const hint = p.hint ? `，${p.hint}` : "";
              return `${p.key}（${p.label}${hint}）`;
            })
            .join("；")}`,
        );
      } else {
        parts.push(
          `  编排参数：${m.params
            .map((p) => {
              const req = p.required ? "必填" : "可选";
              const hint = p.hint ? `，${p.hint}` : "";
              return `${p.key}（${p.label}，${req}${hint}）`;
            })
            .join("；")}`,
        );
      }
    }
    return parts.join("\n");
  });
  return [
    "【能力 · 可选工序】",
    "按需选用，勿默认全选；步骤名只能从这里选；标〔可反复〕的可多次编入；标〔收口〕的是终节点：排在细化终稿之后作最后一步；尚未选定开场前，用户要补前序节点（如 NPC）时插在收口之前，勿以「收口已排入」拒绝追加；选定后才结束创作并保存；标〔程序步〕的确认编排后直接执行（不抛默认问题、不经同意并开始），产物仍验收。",
    "标〔先验产物〕（生成规则、具体实例）：编排层只排 role=prototype 槽位 + suggestion；禁止在原型写 params、禁止预排 instance。「写什么」在用户点原型增殖后的实例步内钉。",
    "其它有「编排参数」的步骤：确认开干前写齐必填 params；缺参时用 askUser 选项+其它。",
    "选型依据是下方「何时用 / 何时不用 / 边界」（来自各能力 meta）。对照用户表述与已验收产物判定：该排才排；可跳过或条件含糊则不排。不要用执行细则补脑。",
    "〔可反复〕再编入新 id = 彻底新建一条。已完成节点要改：禁止排 mode=revise 新步；用户会在图上点该节点重进。禁止把改旧稿写成又一条 fresh。",
    "不要把能力执行全文塞进本步；执行由 design-step 注入。",
    lines.join("\n"),
  ].join("\n");
}

/** 多行字段：首行接在标签后，续行缩进 */
function indentMultiline(text: string, indent: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= 1) return text;
  return [lines[0], ...lines.slice(1).map((l) => `${indent}${l}`)].join("\n");
}

export function parseRecipeCatalog(
  raw: string,
  family: RecipeIntakeFamily = "recipe",
): RecipeCatalog | null {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const recipesRaw = (doc as Record<string, unknown>).recipes;
  if (!Array.isArray(recipesRaw)) return null;

  const recipes: RecipeCatalogEntry[] = [];
  for (const item of recipesRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const declaration =
      typeof r.declaration === "string" ? r.declaration.trim() : "";
    const id =
      typeof r.id === "string" && r.id.trim()
        ? r.id.trim()
        : name
          ? slugFromName(name)
          : "";
    if (!name || !declaration || !id) continue;
    recipes.push({ id, name, declaration, family });
  }
  if (recipes.length === 0) return null;
  return { recipes };
}

export async function loadRecipeCatalog(
  skillPackRoot: string,
  skillsRoot = DEFAULT_SKILLS_ROOT,
  family: RecipeIntakeFamily = "recipe",
): Promise<RecipeCatalog | null> {
  const filename =
    family === "dictate"
      ? DICTATE_RECIPE_CATALOG_FILENAME
      : RECIPE_CATALOG_FILENAME;
  const fullPath = path.join(skillsRoot, skillPackRoot, filename);
  try {
    const raw = await readFile(fullPath, "utf8");
    return parseRecipeCatalog(raw, family);
  } catch {
    return null;
  }
}

/**
 * 解析单份 recipe.yaml（when / core / process / principles / brief / steps）。
 * 兼容旧字段 hint。steps 空或缺失 → seed 为 null（仍可作选型参考）。
 */
export function parseRecipeYaml(
  raw: string,
  meta: RecipeCatalogEntry,
): RecipeDetail {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch {
    return {
      id: meta.id,
      name: meta.name,
      declaration: meta.declaration,
      seed: null,
    };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return {
      id: meta.id,
      name: meta.name,
      declaration: meta.declaration,
      seed: null,
    };
  }
  const row = doc as Record<string, unknown>;
  const when =
    typeof row.when === "string" && row.when.trim()
      ? row.when.trim()
      : undefined;
  const core = coerceYamlTextField(row.core);
  const process = normalizeRecipeListOrText(row.process);
  const principles = normalizeRecipeListOrText(row.principles);
  const hint =
    typeof row.hint === "string" && row.hint.trim()
      ? row.hint.trim()
      : undefined;
  const name =
    typeof row.name === "string" && row.name.trim()
      ? row.name.trim()
      : meta.name;

  const seedParsed = parseCreationFlow(JSON.stringify({
    brief: typeof row.brief === "string" ? row.brief : undefined,
    status: "open",
    steps: Array.isArray(row.steps) ? row.steps : [],
  }));
  const seed = seedParsed;

  return {
    id: meta.id,
    name,
    declaration: meta.declaration,
    when,
    ...(core ? { core } : {}),
    ...(process ? { process } : {}),
    ...(principles ? { principles } : {}),
    ...(hint ? { hint } : {}),
    seed,
  };
}

/** process / principles：保留数组，或收成单字符串 */
function normalizeRecipeListOrText(
  raw: unknown,
): string | string[] | undefined {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    const items = raw
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
    return items.length ? items : undefined;
  }
  return undefined;
}

export async function loadRecipeDetail(
  skillPackRoot: string,
  entry: RecipeCatalogEntry,
  skillsRoot = DEFAULT_SKILLS_ROOT,
): Promise<RecipeDetail> {
  const family = entry.family ?? "recipe";
  const fullPath =
    family === "dictate"
      ? path.join(
          skillsRoot,
          skillPackRoot,
          DICTATE_RECIPE_DIR,
          entry.id,
          "recipe.yaml",
        )
      : path.join(skillsRoot, skillPackRoot, "recipes", entry.id, "recipe.yaml");
  try {
    const raw = await readFile(fullPath, "utf8");
    return parseRecipeYaml(raw, entry);
  } catch {
    return {
      id: entry.id,
      name: entry.name,
      declaration: entry.declaration,
      seed: null,
    };
  }
}

export async function loadAllRecipeDetails(
  skillPackRoot: string,
  skillsRoot = DEFAULT_SKILLS_ROOT,
): Promise<RecipeDetail[]> {
  const catalog = await loadRecipeCatalog(skillPackRoot, skillsRoot);
  if (!catalog) return [];
  const out: RecipeDetail[] = [];
  for (const entry of catalog.recipes) {
    out.push(await loadRecipeDetail(skillPackRoot, entry, skillsRoot));
  }
  return out;
}

/**
 * 解析用户选定的配方引用。
 * 接受纯 id / 中文名，或 JSON `{ "id": "…" }` / `{ "name": "…" }`。
 */
export function parseSelectedRecipeRef(
  raw: string | null | undefined,
): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  try {
    const doc = JSON.parse(trimmed) as unknown;
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      const row = doc as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const name = typeof row.name === "string" ? row.name.trim() : "";
      return id || name || null;
    }
  } catch {
    /* plain string */
  }
  return trimmed;
}

export function findRecipeCatalogEntry(
  catalog: RecipeCatalog | null | undefined,
  ref: string,
): RecipeCatalogEntry | null {
  if (!catalog || !ref.trim()) return null;
  const key = ref.trim();
  return (
    catalog.recipes.find((r) => r.id === key || r.name === key) ?? null
  );
}

/** 给人 / API 看的配方目录短列表（不是给 agent 选型） */
export function formatRecipeCatalogForAgent(catalog: RecipeCatalog): string {
  const lines = catalog.recipes.map(
    (r) => `- ${r.name}：${r.declaration}`,
  );
  return `【可选配方】（须由用户手动选择）\n${lines.join("\n")}`;
}

/** 注入 design-flow：用户已选配方（方法论 + 开局起点） */
export function formatSelectedRecipeForAgent(detail: RecipeDetail): string {
  const lines: string[] = [
    `【用户已选配方 · ${detail.name}】`,
    "这是用户手动选定的设计方法。步骤名从【能力】选。",
    "对照美学卡上用户会在意的部分与配方方法论，增删改未验收步骤与依赖；已验收步保留。",
    "能力「何时用 / 何时不用」以【能力 · 可选工序】为准；本配方不重复罗列各能力调用条件。",
    "用户要换配方：等用户在界面重新选定后再编排。",
  ];
  if (detail.declaration) lines.push(`简介：${detail.declaration}`);
  if (detail.when) lines.push(`适用：${detail.when}`);
  if (detail.core) {
    lines.push("核心思路：");
    lines.push(detail.core);
  }
  if (detail.process) {
    lines.push("设计流程：");
    lines.push(formatRecipeFieldBlock(detail.process));
  }
  if (detail.principles) {
    lines.push("原则：");
    lines.push(formatRecipeFieldBlock(detail.principles));
  }
  if (!detail.core && !detail.process && !detail.principles && detail.hint) {
    lines.push(`调味提示（旧字段）：${detail.hint}`);
  }
  if (detail.seed?.steps.length) {
    const stepsJson = JSON.stringify(
      {
        brief: detail.seed.brief,
        status: detail.seed.status ?? "open",
        steps: detail.seed.steps,
      },
      null,
      2,
    );
    lines.push("开局 steps（配方预置起点，可按美学卡上的承诺增删）：");
    lines.push("```json");
    lines.push(stepsJson);
    lines.push("```");
  } else {
    lines.push("开局 steps：（recipe.yaml 尚未写 steps；可从【能力】按美学卡上的承诺编排）");
  }
  return lines.join("\n");
}

function formatRecipeFieldBlock(value: string | string[]): string {
  if (Array.isArray(value)) {
    return value.map((l) => `- ${l}`).join("\n");
  }
  return value;
}

/** design-flow 一次注入：流程进度 + 已选配方 + 技能池 */
export function formatDesignFlowContentBlocks(params: {
  selectedRecipe?: RecipeDetail | null;
  modules?: ModuleCatalog | null;
  flow?: CreationFlow | null;
  acceptedStepIds?: readonly string[];
  filledArtifactTags?: readonly string[];
}): string[] {
  const blocks: string[] = [
    formatFlowProgressForAgent({
      flow: params.flow,
      acceptedStepIds: params.acceptedStepIds,
      catalog: params.modules,
      filledArtifactTags: params.filledArtifactTags,
    }),
  ];
  if (params.selectedRecipe) {
    blocks.push(formatSelectedRecipeForAgent(params.selectedRecipe));
  }
  if (params.modules) {
    blocks.push(formatModuleCatalogForAgent(params.modules));
  }
  return blocks;
}

/**
 * 编排 LLM 必须看见的现场进度：已完成、草案已有、原型槽位、尚未编入。
 * 裸 JSON id 列表不够；此块由程序按现场拼装。
 */
export function formatFlowProgressForAgent(params: {
  flow?: CreationFlow | null;
  acceptedStepIds?: readonly string[];
  catalog?: ModuleCatalog | null;
  filledArtifactTags?: readonly string[];
}): string {
  const accepted = (params.acceptedStepIds ?? []).filter(
    (id) => Boolean(id?.trim()) && id.trim() !== "flow",
  );
  const flow = params.flow ? stripReviseSteps(params.flow) : null;
  const catalog = params.catalog ?? null;
  const filled = new Set(params.filledArtifactTags ?? []);
  const repeatableNames = new Set(
    (catalog?.modules ?? [])
      .filter((m) => m.repeatable === true)
      .map((m) => m.name),
  );

  const doneLines: string[] = [];
  const doneNames = new Set<string>();
  const doneIds = new Set<string>();

  const markDone = (
    name: string,
    id: string | undefined,
    why: string,
    repeatable: boolean,
  ) => {
    const flag = repeatable
      ? "〔可反复：再追加 = 彻底新建；改旧的由用户点该实例重进〕"
      : "〔一次性：这一面已覆盖；要改则用户点该节点重进〕";
    const idBit = id ? `（id: ${id}）` : "";
    doneLines.push(`- ${name}${idBit} · ${why} ${flag}`);
    doneNames.add(name);
    if (id) doneIds.add(id);
  };

  if (flow) {
    for (const step of flow.steps) {
      if (isPrototypeStep(step)) continue;
      const acceptedHere = isStepAccepted(step, accepted);
      const art = catalog ? artifactTagForStep(step.name, catalog) : null;
      const hasArtifact = Boolean(art && filled.has(art));
      const repeatable = repeatableNames.has(step.name);
      if (acceptedHere || (!repeatable && hasArtifact)) {
        markDone(
          step.name,
          step.id,
          acceptedHere ? "已验收" : "产物已在黑板",
          repeatable,
        );
      }
    }
  }

  for (const id of accepted) {
    if (doneIds.has(id)) continue;
    if (flow?.steps.some((s) => isStepAccepted(s, [id]))) continue;
    markDone(id, id, "已验收", repeatableNames.has(id));
  }

  if (catalog) {
    for (const mod of catalog.modules) {
      if (mod.repeatable === true) continue;
      if (!mod.artifact || !filled.has(mod.artifact)) continue;
      if (doneNames.has(mod.name)) continue;
      markDone(mod.name, undefined, "产物已在黑板", false);
    }
  }

  const draftLines: string[] = [];
  if (flow) {
    for (const step of flow.steps) {
      if (isPrototypeStep(step)) continue;
      if (doneIds.has(step.id) || isStepAccepted(step, accepted)) continue;
      draftLines.push(
        `- ${step.name}（id: ${step.id}） · 已在草案，保留原 id`,
      );
    }
  }

  const repeatableList = (catalog?.modules ?? [])
    .filter((m) => m.repeatable === true)
    .map((m) => m.name);

  const prototypeLines: string[] = [];
  if (flow) {
    for (const step of flow.steps) {
      if (!isPrototypeStep(step)) continue;
      const sug = step.suggestion?.trim()
        ? ` · 建议：${step.suggestion.trim()}`
        : "";
      prototypeLines.push(
        `- ${step.name}（id: ${step.id}，role=prototype）${sug} · 保留；用户点此槽增殖 instance`,
      );
    }
  }
  const suggestionLines = (flow?.suggestions ?? []).map(
    (s) =>
      `- ${s.name} · ${s.suggestion}${s.depends_on?.length ? ` · 依赖 ${s.depends_on.join("、")}` : ""}`,
  );

  const lines = [
    "【流程进度】程序按现场列出：已完成、草案已有、原型槽位、尚未编入。编排以这份清单为准。",
    "已完成 = 覆盖标记（原 id 留在 steps）；草案已有 = 保留原 id，在其上追加或改未验收依赖；尚未编入 = 新 name 只从这里选。",
    "〔可反复〕在 steps 里写一条 role=prototype，带 suggestion（点名这局在意的对象）。「写什么」在用户点原型后的实例步里钉。",
    "一次性技能已覆盖的那一面：要改则用户点该节点重进。要改已有实例：用户点该实例重进。点原型增殖 = 全新 instance（role=instance，from=原型 id）。",
  ];
  const closerPending =
    catalog && flow
      ? flow.steps.filter((step) => {
          const mod = catalog.modules.find((m) => m.name === step.name);
          return Boolean(mod?.closer) && !isStepAccepted(step, accepted);
        })
      : [];
  if (closerPending.length) {
    lines.push(
      `草案已有〔收口〕${closerPending
        .map((s) => `「${s.name}」`)
        .join("、")}但尚未选定。用户要补节点时：把新步插在收口之前，保持收口为最后一步，并将 status 改回 open。收口已排入仍可在它前面加步。`,
    );
  }
  if (doneLines.length) {
    lines.push("", "已完成：", ...doneLines);
  } else {
    lines.push(
      "",
      "已完成：尚无已验收步骤。草案里的开局步是配方预置起点，保留原 id。",
    );
  }
  if (draftLines.length) {
    lines.push("", "草案已有、尚未验收（保留原 id）：", ...draftLines);
  }
  if (prototypeLines.length) {
    lines.push("", "原型槽位（保留；用户点增殖）：", ...prototypeLines);
  }
  if (suggestionLines.length) {
    lines.push(
      "",
      "建议追加的原型（可编入 steps 为 role=prototype）：",
      ...suggestionLines,
    );
  }
  const leftover = listCallableCatalogModules({
    flow,
    catalog,
    acceptedStepIds: accepted,
    filledArtifactTags: params.filledArtifactTags,
  });
  if (leftover.length) {
    lines.push(
      "",
      "尚未编入、仍可调用（新 name 只从这里选）：",
      ...leftover.map((m) => {
        const flags = [
          m.repeatable ? "〔可反复〕" : "",
          m.closer ? "〔收口〕" : "",
        ]
          .filter(Boolean)
          .join("");
        const decl = m.declaration?.trim() ? `：${m.declaration.trim()}` : "";
        return `- ${m.name}${flags}${decl}`;
      }),
    );
  } else {
    lines.push(
      "",
      "尚未编入、仍可调用：无。用户只能点图上已有节点，或对〔可反复〕原型增殖。",
    );
  }
  lines.push(
    "",
    repeatableList.length
      ? `目录〔可反复〕：${repeatableList.join("、")}（排骨架时用 role=prototype）`
      : "目录〔可反复〕：以能力目录为准。",
  );
  return lines.join("\n");
}

/** 解析并加载用户已选配方详情 */
export async function resolveSelectedRecipeDetail(params: {
  skillPackRoot: string;
  selectedRecipeRef?: string | null;
  skillsRoot?: string;
}): Promise<RecipeDetail | null> {
  const ref = parseSelectedRecipeRef(params.selectedRecipeRef);
  if (!ref) return null;
  const skillsRoot = params.skillsRoot ?? DEFAULT_SKILLS_ROOT;
  for (const family of ["recipe", "dictate"] as const) {
    const catalog = await loadRecipeCatalog(
      params.skillPackRoot,
      skillsRoot,
      family,
    );
    const entry = findRecipeCatalogEntry(catalog, ref);
    if (entry) {
      return loadRecipeDetail(params.skillPackRoot, entry, skillsRoot);
    }
  }
  return null;
}

export function validateCreationFlow(
  flow: CreationFlow,
  catalog: ModuleCatalog | null,
): CreationFlowValidation {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const allowed = catalog
    ? new Set(catalog.modules.map((m) => m.name))
    : null;
  const reportedFreshDup = new Set<string>();

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i]!;
    if (seenIds.has(step.id)) {
      errors.push(`步骤 id「${step.id}」重复`);
    }
    seenIds.add(step.id);

    if (allowed && !allowed.has(step.name)) {
      errors.push(`「${step.name}」不在模块目录中`);
    }

    const mod = catalog?.modules.find((m) => m.name === step.name);
    if (isReviseStep(step)) {
      const ref = step.revises?.trim() ?? "";
      if (!ref) {
        errors.push(
          `「${step.id}」是回头修改，但未标明 revises（应指向更前的同名步骤 id）`,
        );
      } else {
        const origin = findStepByRef(flow, ref);
        if (!origin) {
          errors.push(
            `「${step.id}」回头修改「${ref}」，但流程中没有该步骤`,
          );
        } else if (origin.id === step.id) {
          errors.push(`「${step.id}」不能回头修改自己`);
        } else if (origin.name !== step.name) {
          errors.push(
            `「${step.id}」回头修改「${origin.id}」，但能力名不同（${step.name} ≠ ${origin.name}）`,
          );
        } else {
          const originIndex = flow.steps.findIndex((s) => s.id === origin.id);
          if (originIndex >= i) {
            errors.push(
              `「${step.id}」回头修改「${origin.id}」，但「${origin.id}」未排在其前面`,
            );
          }
        }
      }
    } else if (isPrototypeStep(step)) {
      if (step.params && Object.keys(step.params).length) {
        errors.push(`原型「${step.id}」不应带 params（「写什么」在实例步内钉）`);
      }
      continue;
    }
    if (
      catalog &&
      mod &&
      mod.repeatable !== true &&
      !reportedFreshDup.has(step.name) &&
      flow.steps.filter((s) => s.name === step.name && !isReviseStep(s)).length >
        1
    ) {
      reportedFreshDup.add(step.name);
      errors.push(
        `「${step.name}」出现多次新建，但目录未标 repeatable（非反复技能请点已完成节点重进，不要再排新建）`,
      );
    }

    for (const dep of step.depends_on) {
      const depStep = findStepByRef(flow, dep);
      if (!depStep) {
        errors.push(`「${step.id}」依赖「${dep}」，但流程中没有该步骤`);
        continue;
      }
      const depIndex = flow.steps.findIndex((s) => s.id === depStep.id);
      if (depIndex >= i) {
        errors.push(
          `「${step.id}」依赖「${depStep.id}」，但「${depStep.id}」未排在其前面`,
        );
      }
    }

    // 必填 params 改在「确认开干」时钉齐，不再阻挡编排产出空壳步骤
  }

  return { ok: errors.length === 0, errors };
}

/** 进 design-step 前：本步必填编排参数是否已齐。〔先验产物〕不拦。 */
export function validateStepReadyToRun(
  step: CreationFlowStep,
  catalog: ModuleCatalog | null,
): CreationFlowValidation {
  const mod = catalog?.modules.find((m) => m.name === step.name);
  if (!mod?.params?.length) return { ok: true, errors: [] };
  const missing = missingRequiredStepParams(step, mod);
  if (missing.length === 0) return { ok: true, errors: [] };
  const labels = missing
    .map((key) => {
      const spec = mod.params!.find((p) => p.key === key);
      return spec ? `${key}（${spec.label}）` : key;
    })
    .join("、");
  return {
    ok: false,
    errors: [`「${step.id}」缺少必填编排参数：${labels}（确认开干前请补齐）`],
  };
}

/** 写回某步 params（确认下一节点时由用户钉死） */
export function patchCreationFlowStepParams(
  flow: CreationFlow,
  stepId: string,
  params: CreationFlowStepParams,
): CreationFlow {
  const id = stepId.trim();
  return {
    ...flow,
    steps: flow.steps.map((s) =>
      s.id === id
        ? {
            ...s,
            params: Object.keys(params).length ? { ...params } : undefined,
          }
        : s,
    ),
  };
}

export function artifactTagForStep(
  name: string,
  catalog: ModuleCatalog | null,
): string | null {
  return catalog?.modules.find((m) => m.name === name)?.artifact ?? null;
}

export function finalizeCreationFlow(
  flow: CreationFlow,
  catalog: ModuleCatalog | null | undefined,
): CreationFlow {
  const stripped = stripReviseSteps(flow);
  return {
    ...stripped,
    steps: normalizeFlowStepRoles(stripped.steps, catalog),
  };
}

const FLOW_TITLE_MAX = 28;

function flowParamText(
  params: CreationFlowStepParams | undefined,
  key: string,
): string {
  const v = params?.[key];
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function firstFlowTitle(...vals: Array<string | undefined>): string | undefined {
  for (const v of vals) {
    const t = v?.trim();
    if (t) return t;
  }
  return undefined;
}

function clampFlowTitle(raw: string, max = FLOW_TITLE_MAX): string {
  const t = raw.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function asTitleRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** 建议文案的短标题：冒号前；无冒号且足够短则整句。 */
export function titleFromSuggestion(suggestion?: string): string | undefined {
  const t = suggestion?.trim();
  if (!t) return undefined;
  const colon = t.search(/[：:]/);
  if (colon > 0 && colon <= FLOW_TITLE_MAX) {
    const head = t.slice(0, colon).trim();
    const rest = t.slice(colon + 1).trim();
    if (head && rest) return head;
  }
  if (t.length <= FLOW_TITLE_MAX) return t;
  return undefined;
}

function titleFromStepParams(
  params: CreationFlowStepParams | undefined,
): string | undefined {
  const target =
    flowParamText(params, "target") ||
    flowParamText(params, "object") ||
    flowParamText(params, "对象") ||
    flowParamText(params, "生成对象");
  if (target) return clampFlowTitle(target);
  const batch = flowParamText(params, "batch_goal");
  if (batch) return clampFlowTitle(batch);
  const ruleId = flowParamText(params, "rule_id");
  if (ruleId) return clampFlowTitle(ruleId);
  return undefined;
}

function titleFromAcceptedSummary(
  summary: string | undefined,
  skillName: string,
): string | undefined {
  const t = summary?.trim();
  if (!t) return undefined;
  const parts = t
    .split(/\s*·\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2 && (parts[0] === skillName || parts[0] === "生成规则" || parts[0] === "具体实例")) {
    return clampFlowTitle(parts[1]!);
  }
  if (t.length <= FLOW_TITLE_MAX) return t;
  return undefined;
}

function titleFromAcceptedContent(content: unknown): string | undefined {
  const row = asTitleRecord(content);
  if (!row) return undefined;
  const body = asTitleRecord(row.正文) ?? row;
  const pinned = asTitleRecord(body.本步参数);
  if (typeof pinned?.target === "string" && pinned.target.trim()) {
    return clampFlowTitle(pinned.target);
  }
  const nec = asTitleRecord(body.必要性判断);
  if (typeof nec?.生成对象 === "string" && nec.生成对象.trim()) {
    return clampFlowTitle(nec.生成对象);
  }
  const rules = Array.isArray(body.rules) ? body.rules : [];
  for (const item of rules) {
    const rec = asTitleRecord(item);
    if (typeof rec?.对象 === "string" && rec.对象.trim()) {
      return clampFlowTitle(rec.对象);
    }
  }
  if (typeof row.brief === "string" && row.brief.trim() && row.brief.trim().length <= FLOW_TITLE_MAX) {
    return row.brief.trim();
  }
  return undefined;
}

export type FlowStepTitleHint = {
  summary?: string;
  content?: unknown;
};

/** 图上「增殖的是啥」短标题：验收内容 > 规划参数 > 建议文案。 */
export function deriveFlowStepTitle(params: {
  name: string;
  stepParams?: CreationFlowStepParams;
  suggestion?: string;
  prototypeSuggestion?: string;
  hint?: FlowStepTitleHint;
}): string | undefined {
  const raw = firstFlowTitle(
    titleFromAcceptedContent(params.hint?.content),
    titleFromAcceptedSummary(params.hint?.summary, params.name),
    titleFromStepParams(params.stepParams),
    titleFromSuggestion(params.suggestion),
    titleFromSuggestion(params.prototypeSuggestion),
  );
  if (!raw || raw === params.name) return undefined;
  return raw;
}

/** 目录里尚未编入本局、且非反复技能也未有产物的条目——用户仍可要求追加。 */
export function listCallableCatalogModules(params: {
  flow?: CreationFlow | null;
  catalog?: ModuleCatalog | null;
  acceptedStepIds?: readonly string[];
  filledArtifactTags?: readonly string[];
}): CreationFlowAvailableModule[] {
  const catalog = params.catalog ?? null;
  if (!catalog?.modules.length) return [];
  const scheduled = new Set((params.flow?.steps ?? []).map((s) => s.name));
  const filled = new Set(params.filledArtifactTags ?? []);
  const accepted = new Set(
    (params.acceptedStepIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const out: CreationFlowAvailableModule[] = [];
  for (const mod of catalog.modules) {
    if (scheduled.has(mod.name)) continue;
    if (!mod.repeatable) {
      if (mod.artifact && filled.has(mod.artifact)) continue;
      if (accepted.has(mod.name)) continue;
    }
    out.push({
      name: mod.name,
      ...(mod.declaration ? { declaration: mod.declaration } : {}),
      ...(mod.repeatable ? { repeatable: true } : {}),
      ...(mod.closer ? { closer: true } : {}),
    });
  }
  return out;
}

export function formatCreationFlowForUser(
  flow: CreationFlow,
  catalog?: ModuleCatalog | null,
  acceptedStepIds: readonly string[] = [],
  filledArtifactTags: readonly string[] = [],
  titleHints: Readonly<Record<string, FlowStepTitleHint>> = {},
): CreationFlowUserView {
  const normalized = finalizeCreationFlow(flow, catalog ?? null);
  const decl = new Map(
    (catalog?.modules ?? []).map((m) => [m.name, m] as const),
  );
  const seenInstanceName = new Map<string, number>();
  const layers = computeStepLayers(normalized);
  const prototypeNames = new Set(
    normalized.steps.filter(isPrototypeStep).map((s) => s.name),
  );
  const pendingSuggestions = (normalized.suggestions ?? []).filter(
    (s) => !prototypeNames.has(s.name),
  );
  const filled = new Set(filledArtifactTags);
  const byId = new Map(normalized.steps.map((s) => [s.id, s] as const));
  const availableModules = listCallableCatalogModules({
    flow: normalized,
    catalog,
    acceptedStepIds,
    filledArtifactTags,
  });
  return {
    brief: normalized.brief,
    status: normalized.status,
    ...(pendingSuggestions.length ? { suggestions: pendingSuggestions } : {}),
    ...(availableModules.length ? { availableModules } : {}),
    steps: normalized.steps.map((s, i) => {
      const revise = isReviseStep(s);
      const proto = isPrototypeStep(s);
      let occurrence: number | undefined;
      if (!revise && isInstanceStep(s)) {
        const n = (seenInstanceName.get(s.name) ?? 0) + 1;
        seenInstanceName.set(s.name, n);
        occurrence = n;
      }
      const mod = decl.get(s.name);
      const paramsMissing = proto
        ? []
        : missingRequiredStepParams(s, mod);
      const accepted = isStepAccepted(s, acceptedStepIds);
      const ready = proto
        ? isPrototypeSelectable(normalized, s, acceptedStepIds)
        : isStepReady(normalized, s, acceptedStepIds);
      const blockedBy =
        accepted || ready
          ? undefined
          : s.depends_on.filter(
              (dep) =>
                !isCreationDependencySatisfied(
                  normalized,
                  dep,
                  acceptedStepIds,
                ),
            );
      const runState: FlowStepRunState = proto
        ? "pending"
        : accepted
          ? "done"
          : "pending";
      const parent = s.from ? byId.get(s.from) : undefined;
      const title = deriveFlowStepTitle({
        name: s.name,
        stepParams: s.params,
        suggestion: s.suggestion,
        prototypeSuggestion: parent?.suggestion,
        hint: titleHints[s.id],
      });
      return {
        order: i + 1,
        id: s.id,
        name: s.name,
        depends_on: s.depends_on,
        ...(s.role ? { role: s.role } : {}),
        ...(s.from ? { from: s.from } : {}),
        ...(s.suggestion ? { suggestion: s.suggestion } : {}),
        ...(title ? { title } : {}),
        occurrence,
        ...(revise ? { mode: "revise" as const } : {}),
        ...(s.revises ? { revises: s.revises } : {}),
        declaration: mod?.declaration,
        repeatable: mod?.repeatable,
        ...(isCloserModule(mod, s.name) ? { closer: true } : {}),
        ...(mod?.kind ? { kind: mod.kind } : {}),
        layer: layers.get(s.id) ?? 0,
        ready,
        selectable: ready,
        ...(blockedBy?.length ? { blockedBy } : {}),
        runState,
        ...(mod?.artifact ? { artifactTag: mod.artifact } : {}),
        ...(mod?.artifact && filled.has(mod.artifact) ? { hasArtifact: true } : {}),
        ...(!proto && s.params ? { params: s.params } : {}),
        ...(paramsMissing.length > 0 ? { paramsMissing } : {}),
      };
    }),
  };
}

export function findModuleByName(
  catalog: ModuleCatalog | null | undefined,
  name: string,
): ModuleCatalogEntry | null {
  if (!catalog) return null;
  return catalog.modules.find((m) => m.name === name) ?? null;
}

/** 已验收步骤名列表（JSON 数组或换行文本） */
export function parseAcceptedSteps(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const doc = JSON.parse(raw);
    if (Array.isArray(doc)) {
      return doc.map((x) => String(x).trim()).filter(Boolean);
    }
  } catch {
    /* fall through */
  }
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 某步是否已验收：认 step.id；兼容旧会话只记了中文 name（且当时 name 唯一）。
 */
export function isStepAccepted(
  step: CreationFlowStep,
  acceptedStepIds: readonly string[],
): boolean {
  const done = new Set(acceptedStepIds);
  if (done.has(step.id)) return true;
  // 旧稿：验收列表里是中文名，且 id 就是 name
  if (step.id === step.name && done.has(step.name)) return true;
  return false;
}

/** 未验收且 depends_on 均已满足（原型步不可执行，恒 false） */
export function isStepReady(
  flow: CreationFlow,
  step: CreationFlowStep,
  acceptedStepIds: readonly string[],
): boolean {
  if (isPrototypeStep(step)) return false;
  if (isStepAccepted(step, acceptedStepIds)) return false;
  return step.depends_on.every((dep) =>
    isCreationDependencySatisfied(flow, dep, acceptedStepIds),
  );
}

/**
 * 当前所有可点进去的步骤（依赖已齐、尚未验收）。
 * 编排器排出的回头修改步不进入可执行队列。
 */
export function listReadySteps(
  flow: CreationFlow | null,
  acceptedStepIds: readonly string[],
): CreationFlowStep[] {
  if (!flow?.steps.length) return [];
  return flow.steps.filter(
    (step) =>
      isExecutableStep(step) &&
      !isReviseStep(step) &&
      isStepReady(flow, step, acceptedStepIds),
  );
}

export function listSelectablePrototypes(
  flow: CreationFlow | null,
  acceptedStepIds: readonly string[],
): CreationFlowStep[] {
  if (!flow?.steps.length) return [];
  return flow.steps.filter((step) =>
    isPrototypeSelectable(flow, step, acceptedStepIds),
  );
}

/**
 * 流程中下一个待做步骤：未验收，且 depends_on 均已验收。
 */
export function nextPendingStep(
  flow: CreationFlow | null,
  acceptedStepIds: readonly string[],
): CreationFlowStep | null {
  const ready = listReadySteps(flow, acceptedStepIds);
  return ready[0] ?? null;
}

/** 依赖层级：根=0，某步 = max(依赖层级)+1。环则记 0。 */
export function computeStepLayers(flow: CreationFlow): Map<string, number> {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const layerOf = (stepId: string): number => {
    if (memo.has(stepId)) return memo.get(stepId)!;
    if (visiting.has(stepId)) return 0;
    const step = findStepByRef(flow, stepId);
    if (!step || step.depends_on.length === 0) {
      memo.set(stepId, 0);
      return 0;
    }
    visiting.add(stepId);
    let max = 0;
    for (const dep of step.depends_on) {
      const depStep = findStepByRef(flow, dep);
      if (!depStep) continue;
      max = Math.max(max, layerOf(depStep.id) + 1);
    }
    visiting.delete(stepId);
    memo.set(stepId, max);
    return max;
  };
  for (const step of flow.steps) layerOf(step.id);
  return memo;
}

export function isCloserModule(
  module: { closer?: boolean } | null | undefined,
  name?: string,
): boolean {
  if (module?.closer === true) return true;
  const t = (name ?? "").trim();
  return t === "开场白与开场变量" || t.startsWith("开场白与开场变量#") || t === "开场白";
}

export function hasAcceptedCloserStep(
  flow: CreationFlow | null | undefined,
  acceptedStepIds: readonly string[],
  catalog?: ModuleCatalog | null,
): boolean {
  if (flow?.steps.length) {
    return flow.steps.some(
      (s) =>
        isCloserModule(findModuleByName(catalog, s.name), s.name) &&
        isStepAccepted(s, acceptedStepIds),
    );
  }
  return acceptedStepIds.some((id) => isCloserModule(null, id));
}

export function findCloserStepIndex(
  flow: CreationFlow,
  catalog?: ModuleCatalog | null,
): number {
  return flow.steps.findIndex((s) =>
    isCloserModule(findModuleByName(catalog, s.name), s.name),
  );
}

/** 同能力新 id：name / name#n */
export function allocateCreationStepId(
  existingIds: Iterable<string>,
  name: string,
): string {
  const used = new Set(
    [...existingIds].map((id) => id.trim()).filter(Boolean),
  );
  const base = name.trim();
  if (!base) return "步骤";
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}#${n}`)) n += 1;
  return `${base}#${n}`;
}

const CONCRETE_INSTANCE_NAME = "具体实例";
const GENERATION_RULE_NAME = "生成规则";

function lastAcceptedNonCloser(
  flow: CreationFlow,
  catalog: ModuleCatalog | null | undefined,
  acceptedStepIds: readonly string[],
): CreationFlowStep | null {
  for (let i = flow.steps.length - 1; i >= 0; i--) {
    const step = flow.steps[i]!;
    if (!isStepAccepted(step, acceptedStepIds)) continue;
    if (isCloserModule(findModuleByName(catalog, step.name), step.name)) {
      continue;
    }
    return step;
  }
  return null;
}

/** 新开一条可反复能力时钉的 depends_on（优先跟原型步） */
export function spawnDependsOn(
  flow: CreationFlow,
  catalog: ModuleCatalog | null | undefined,
  moduleName: string,
  acceptedStepIds: readonly string[],
): string[] {
  const prototype = flow.steps.find(
    (s) => s.name === moduleName && isPrototypeStep(s),
  );
  if (prototype?.depends_on.length) {
    return prototype.depends_on.filter((dep) =>
      Boolean(findStepByRef(flow, dep)),
    );
  }
  const existing = flow.steps.find(
    (s) => s.name === moduleName && !isReviseStep(s) && !isPrototypeStep(s),
  );
  if (existing?.depends_on.length) {
    return existing.depends_on.filter((dep) => Boolean(findStepByRef(flow, dep)));
  }
  if (moduleName === CONCRETE_INSTANCE_NAME) {
    const rules = flow.steps.filter(
      (s) =>
        s.name === GENERATION_RULE_NAME &&
        isInstanceStep(s) &&
        isStepAccepted(s, acceptedStepIds),
    );
    if (rules.length) return [rules[rules.length - 1]!.id];
  }
  const last = lastAcceptedNonCloser(flow, catalog, acceptedStepIds);
  return last ? [last.id] : [];
}

export function repeatableSpawnBlockedReason(
  flow: CreationFlow,
  catalog: ModuleCatalog | null | undefined,
  moduleName: string,
  acceptedStepIds: readonly string[],
): string | undefined {
  const mod = findModuleByName(catalog, moduleName);
  if (!mod?.repeatable) return "不是可反复能力";
  if (!acceptedStepIds.some((id) => id.trim() && id.trim() !== "flow")) {
    return "先完成至少一步再追加";
  }
  if (moduleName === CONCRETE_INSTANCE_NAME) {
    const hasRule = flow.steps.some(
      (s) =>
        s.name === GENERATION_RULE_NAME &&
        isInstanceStep(s) &&
        isStepAccepted(s, acceptedStepIds),
    );
    if (!hasRule) return "先完成一条生成规则";
  }
  const deps = spawnDependsOn(flow, catalog, moduleName, acceptedStepIds);
  const blocked = deps.filter(
    (dep) => !isCreationDependencySatisfied(flow, dep, acceptedStepIds),
  );
  if (blocked.length) return `还差：${blocked.join("、")}`;
  return undefined;
}

export function listRepeatableSpawns(
  flow: CreationFlow,
  catalog: ModuleCatalog,
  acceptedStepIds: readonly string[],
): CreationFlowSpawnView[] {
  return catalog.modules
    .filter((m) => m.repeatable === true && !m.closer)
    .filter(
      (m) => !flow.steps.some((s) => s.name === m.name && isPrototypeStep(s)),
    )
    .map((m) => {
      const blockedReason = repeatableSpawnBlockedReason(
        flow,
        catalog,
        m.name,
        acceptedStepIds,
      );
      return {
        name: m.name,
        ready: !blockedReason,
        ...(blockedReason ? { blockedReason } : {}),
      };
    });
}

export function hasSelectableCreationWork(
  flow: CreationFlow | null,
  catalog: ModuleCatalog | null | undefined,
  acceptedStepIds: readonly string[],
): boolean {
  if (listReadySteps(flow, acceptedStepIds).length > 0) return true;
  if (listSelectablePrototypes(flow, acceptedStepIds).length > 0) return true;
  if (!flow || !catalog) return false;
  return listRepeatableSpawns(flow, catalog, acceptedStepIds).some((s) => s.ready);
}

function allocateInstanceStepId(
  prototypeId: string,
  flow: CreationFlow,
): string {
  let n = flow.steps.filter((s) => s.from === prototypeId).length + 1;
  while (flow.steps.some((s) => s.id === `${prototypeId}#${n}`)) n += 1;
  return `${prototypeId}#${n}`;
}

/**
 * 点原型槽位：增殖一条 instance 并写入 DAG（插在收口之前）。
 */
export function spawnInstanceFromPrototype(params: {
  flow: CreationFlow;
  catalog: ModuleCatalog | null | undefined;
  prototypeId: string;
  acceptedStepIds: readonly string[];
}): { flow: CreationFlow; step: CreationFlowStep } | { error: string } {
  const prototype = findStepByRef(params.flow, params.prototypeId.trim());
  if (!prototype || !isPrototypeStep(prototype)) {
    return { error: `找不到原型节点：${params.prototypeId}` };
  }
  if (!isPrototypeSelectable(params.flow, prototype, params.acceptedStepIds)) {
    const blocked = prototype.depends_on.filter(
      (dep) =>
        !isCreationDependencySatisfied(
          params.flow,
          dep,
          params.acceptedStepIds,
        ),
    );
    return {
      error: blocked.length
        ? `还差：${blocked.join("、")}`
        : `「${prototype.name}」暂不可增殖`,
    };
  }
  const mod = findModuleByName(params.catalog, prototype.name);
  if (!mod) return { error: `未知能力：${prototype.name}` };

  const instanceDeps = resolveInstanceDependsOn({
    flow: params.flow,
    catalog: params.catalog,
    prototype,
    acceptedStepIds: params.acceptedStepIds,
  });
  const id = allocateInstanceStepId(prototype.id, params.flow);
  const step: CreationFlowStep = {
    id,
    name: prototype.name,
    role: "instance",
    from: prototype.id,
    depends_on: instanceDeps,
    mode: "fresh",
  };

  const steps = [...params.flow.steps];
  const protoIndex = steps.findIndex((s) => s.id === prototype.id);
  if (protoIndex >= 0) {
    steps.splice(protoIndex + 1, 0, step);
  } else {
    const closerAt = findCloserStepIndex(params.flow, params.catalog);
    if (closerAt >= 0) {
      steps.splice(closerAt, 0, step);
    } else {
      steps.push(step);
    }
  }
  const closerAt = findCloserStepIndex(
    { ...params.flow, steps },
    params.catalog,
  );
  if (closerAt >= 0) {
    const closer = steps[closerAt]!;
    if (!closer.depends_on.includes(id)) {
      steps[closerAt] = {
        ...closer,
        depends_on: [...closer.depends_on, id],
      };
    }
  }
  return {
    flow: {
      ...params.flow,
      version: 1,
      status: params.flow.status === "closed" ? "open" : params.flow.status,
      steps,
    },
    step,
  };
}

/**
 * 误点增殖后尚未验收：从图上撤掉这条 instance，并解开其它步对它的依赖。
 * 普通一次性节点、已验收实例原样返回。
 */
export function removeUnstartedInstance(
  flow: CreationFlow,
  stepId: string,
  acceptedStepIds: readonly string[],
): CreationFlow {
  const step = findStepByRef(flow, stepId.trim());
  if (!step || !isInstanceStep(step) || isStepAccepted(step, acceptedStepIds)) {
    return flow;
  }
  return dropInstanceFromFlow(flow, step.id);
}

function dropInstanceFromFlow(flow: CreationFlow, stepId: string): CreationFlow {
  return {
    ...flow,
    steps: flow.steps
      .filter((s) => s.id !== stepId)
      .map((s) => ({
        ...s,
        depends_on: s.depends_on.filter((d) => d !== stepId),
      })),
  };
}

function repeatableInstanceLabel(step: CreationFlowStep): string {
  const target = titleFromStepParams(step.params);
  if (target && target !== step.name) return `${step.name} · ${target}`;
  return step.id !== step.name ? `${step.name}（${step.id}）` : step.name;
}

/**
 * 图上删除可增殖产物：已验收也可删。
 * 另有实例依赖这条时拒绝；收口等一次性节点只解开依赖。
 */
export function removeRepeatableInstance(params: {
  flow: CreationFlow;
  stepId: string;
  catalog?: ModuleCatalog | null;
}): { flow: CreationFlow; removed: CreationFlowStep } | { error: string } {
  const step = findStepByRef(params.flow, params.stepId.trim());
  if (!step) return { error: "找不到节点" };
  if (!isInstanceStep(step)) {
    return { error: "只能删除可增殖能力长出来的产物" };
  }
  const mod = findModuleByName(params.catalog, step.name);
  if (mod && mod.repeatable !== true) {
    return { error: `「${step.name}」不是可增殖能力，不能从图上删` };
  }
  if (!mod && !step.from) {
    return { error: "只能删除可增殖能力长出来的产物" };
  }
  const blockers = params.flow.steps.filter(
    (s) =>
      s.id !== step.id &&
      isInstanceStep(s) &&
      s.depends_on.includes(step.id),
  );
  if (blockers.length) {
    return {
      error: `还有产物依赖这条：${blockers.map(repeatableInstanceLabel).join("、")}。请先删那些产物。`,
    };
  }
  return { flow: dropInstanceFromFlow(params.flow, step.id), removed: step };
}

/** 共享产物 tag 里按 rule_id 抽掉已删实例；同能力已无实例则清空。 */
export function pruneRepeatableArtifactContent(params: {
  raw: string;
  step: CreationFlowStep;
  remainingSameModule: number;
}): string {
  if (params.remainingSameModule <= 0) return "";
  const stripped = stripFragmentRowsMatchingStep(params.raw, params.step);
  return stripped ?? params.raw;
}

function stripFragmentRowsMatchingStep(
  raw: string,
  step: CreationFlowStep,
): string | null {
  const parsed = tryParseJsonDoc(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const doc = structuredClone(parsed) as Record<string, unknown>;
  const bodyRaw = doc.正文;
  if (!bodyRaw || typeof bodyRaw !== "object" || Array.isArray(bodyRaw)) {
    return null;
  }
  const body = bodyRaw as Record<string, unknown>;
  const ruleId = flowParamText(step.params, "rule_id");
  if (!ruleId) return null;
  let changed = false;
  for (const key of ["rules", "records"] as const) {
    const rows = body[key];
    if (!Array.isArray(rows)) continue;
    const next = rows.filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return true;
      return (
        String((item as Record<string, unknown>).rule_id ?? "").trim() !==
        ruleId
      );
    });
    if (next.length !== rows.length) {
      body[key] = next;
      changed = true;
    }
  }
  if (!changed) return null;
  doc.正文 = body;
  return JSON.stringify(doc, null, 2);
}

/** 实例步 depends_on：具体实例钉最近已验收规则实例；其余跟原型。 */
function resolveInstanceDependsOn(params: {
  flow: CreationFlow;
  catalog: ModuleCatalog | null | undefined;
  prototype: CreationFlowStep;
  acceptedStepIds: readonly string[];
}): string[] {
  if (params.prototype.name === CONCRETE_INSTANCE_NAME) {
    const rules = params.flow.steps.filter(
      (s) =>
        s.name === GENERATION_RULE_NAME &&
        isInstanceStep(s) &&
        isStepAccepted(s, params.acceptedStepIds),
    );
    if (rules.length) return [rules[rules.length - 1]!.id];
  }
  return params.prototype.depends_on.filter((dep) =>
    Boolean(findStepByRef(params.flow, dep)),
  );
}

/**
 * 在 DAG 里新编一条可反复能力（兼容：优先找原型增殖，无原型则 legacy 新建）。
 */
export function spawnRepeatableCreationStep(params: {
  flow: CreationFlow;
  catalog: ModuleCatalog | null | undefined;
  moduleName: string;
  acceptedStepIds: readonly string[];
}): { flow: CreationFlow; step: CreationFlowStep } | { error: string } {
  const name = params.moduleName.trim();
  const prototype = params.flow.steps.find(
    (s) => s.name === name && isPrototypeStep(s),
  );
  if (prototype) {
    return spawnInstanceFromPrototype({
      flow: params.flow,
      catalog: params.catalog,
      prototypeId: prototype.id,
      acceptedStepIds: params.acceptedStepIds,
    });
  }

  const mod = findModuleByName(params.catalog, name);
  if (!mod) return { error: `未知能力：${name}` };
  if (mod.repeatable !== true) return { error: `「${name}」不能反复新开` };
  if (isCloserModule(mod, name)) return { error: `「${name}」是收口，不能增殖` };
  const blocked = repeatableSpawnBlockedReason(
    params.flow,
    params.catalog,
    name,
    params.acceptedStepIds,
  );
  if (blocked) return { error: blocked };

  const protoId = allocateCreationStepId(
    params.flow.steps.map((s) => s.id),
    name,
  );
  const protoStep: CreationFlowStep = {
    id: protoId,
    name,
    role: "prototype",
    depends_on: spawnDependsOn(
      params.flow,
      params.catalog,
      name,
      params.acceptedStepIds,
    ),
  };
  const steps = [...params.flow.steps];
  const closerAt = findCloserStepIndex(params.flow, params.catalog);
  if (closerAt >= 0) {
    steps.splice(closerAt, 0, protoStep);
  } else {
    steps.push(protoStep);
  }
  const withProto: CreationFlow = {
    ...params.flow,
    steps,
  };
  return spawnInstanceFromPrototype({
    flow: withProto,
    catalog: params.catalog,
    prototypeId: protoId,
    acceptedStepIds: params.acceptedStepIds,
  });
}

/** 当前已列出的步骤是否都已验收（不管 status） */
export function areListedStepsAccepted(
  flow: CreationFlow | null,
  acceptedStepIds: readonly string[],
): boolean {
  if (!flow?.steps.length) return false;
  return flow.steps.every((s) => isStepAccepted(s, acceptedStepIds));
}

/**
 * 流程是否收束完毕：listed steps 全验收，且 status 非 open。
 * status=open 或缺省但还要扩步 → 应再调 design-flow。
 * 缺省 status：兼容旧固定 DAG，视为 closed。
 */
export function isCreationFlowComplete(
  flow: CreationFlow | null,
  acceptedStepIds: readonly string[],
): boolean {
  if (!areListedStepsAccepted(flow, acceptedStepIds)) return false;
  if (flow?.status === "open") return false;
  return true;
}

/**
 * 当前步骤做完、但 DAG 仍 open → 需要再编排（追加 / 关闭）。
 */
export function needsFlowExpansion(
  flow: CreationFlow | null,
  acceptedStepIds: readonly string[],
): boolean {
  if (!flow?.steps.length) return true;
  if (nextPendingStep(flow, acceptedStepIds)) return false;
  return flow.status === "open";
}

export async function loadModulePrompt(
  skillPackRoot: string,
  moduleId: string,
  skillsRoot = DEFAULT_SKILLS_ROOT,
): Promise<string | null> {
  const fullPath = path.join(
    skillsRoot,
    skillPackRoot,
    "modules",
    moduleId,
    "prompt.md",
  );
  try {
    return await readFile(fullPath, "utf8");
  } catch {
    return null;
  }
}

/** 依赖步骤 → 产物 tag（执行期注入；按依赖步的能力 name 映射） */
export function dependencyArtifactTags(
  step: CreationFlowStep,
  catalog: ModuleCatalog | null,
  flow?: CreationFlow | null,
): string[] {
  if (!catalog) return [];
  const tags: string[] = [];
  for (const dep of step.depends_on) {
    const depName = flow
      ? findStepByRef(flow, dep)?.name ?? dep
      : dep;
    const art = artifactTagForStep(depName, catalog);
    if (art) tags.push(art);
  }
  return [...new Set(tags)];
}

export type DesignStepBinding = {
  step: CreationFlowStep;
  module: ModuleCatalogEntry;
  depTags: string[];
  modulePrompt: string;
  /** 程序开场白；无则本步直接调 LLM。回头修改不抛 opening。 */
  opening: string | null;
  /** 回头修改时注入的既有产物 tag */
  inheritTag: string | null;
  /** 实例步对应原型的规划建议（参考，步内钉） */
  prototypeSuggestion?: string | null;
};

/**
 * 解析 design-step 本轮绑定：当前步骤、模块 prompt、依赖 tag、产物 tag。
 */
export async function resolveDesignStepBinding(params: {
  skillPackRoot: string;
  flowRaw: string | null | undefined;
  currentStepName?: string | null;
  acceptedStepNames?: readonly string[];
  skillsRoot?: string;
  /** 用户点已完成节点重进：注入既有产物，不走开场 */
  inheritExisting?: boolean;
}): Promise<DesignStepBinding | null> {
  const skillsRoot = params.skillsRoot ?? DEFAULT_SKILLS_ROOT;
  const catalog = await loadModuleCatalog(params.skillPackRoot, skillsRoot);
  const flow = parseCreationFlow(params.flowRaw);
  if (!catalog || !flow) return null;

  const accepted = params.acceptedStepNames ?? [];
  let step: CreationFlowStep | null = null;
  const named = params.currentStepName?.trim();
  if (named) {
    step = findStepByRef(flow, named);
  }
  if (!step) {
    step = nextPendingStep(flow, accepted);
  }
  if (!step || isPrototypeStep(step)) return null;

  const module = findModuleByName(catalog, step.name);
  if (!module) return null;

  let prototypeSuggestion: string | null = null;
  if (step.from) {
    const proto = findStepByRef(flow, step.from);
    prototypeSuggestion = proto?.suggestion?.trim() || null;
  }

  const modulePromptRaw =
    (await loadModulePrompt(params.skillPackRoot, module.id, skillsRoot)) ??
    `# ${module.name}\n\n（模块 prompt.md 缺失，请补充 skills/.../modules/${module.id}/prompt.md）`;

  const inherit =
    Boolean(params.inheritExisting) || isReviseStep(step);
  const inheritTag = inherit ? module.artifact : null;
  const opening =
    inherit || module.auto
      ? null
      : module.opening?.trim() || extractModuleOpening(modulePromptRaw) || null;

  return {
    step,
    module,
    depTags: dependencyArtifactTags(step, catalog, flow),
    modulePrompt: formatModulePromptForLlm(modulePromptRaw),
    opening,
    inheritTag,
    prototypeSuggestion,
  };
}
