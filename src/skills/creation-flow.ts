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

export const CREATION_FLOW_TAG = "设计.创作流程";
export const CREATION_CURRENT_STEP_TAG = "创作.当前步骤";
/** 确认开干前：待确认的下一步快照（JSON） */
export const CREATION_PROPOSED_STEP_TAG = "创作.待确认步骤";
/** 用户手动选定的初始配方（存 recipe id，或 JSON {id,name}） */
export const CREATION_SELECTED_RECIPE_TAG = "创作.选用配方";

/** 进度指针：禁止当作 worker 产物写回或列入验收正文 */
export const PROGRESS_POINTER_TAGS = new Set<string>([
  CREATION_CURRENT_STEP_TAG,
  CREATION_PROPOSED_STEP_TAG,
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
export const DESIGN_STEP_WORKER_ID = "design-step";
export const DESIGN_FLOW_WORKER_ID = "design-flow";

const DEFAULT_SKILLS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skills",
);

/** 步骤调用参数（编排期钉死；执行期只读） */
export type CreationFlowStepParams = Record<string, unknown>;

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
   * 本步调用参数。有「编排参数」声明的能力必须在进 design-step 前钉齐必填项。
   * 例：生成规则 → target；具体实例 → rule_id。
   */
  params?: CreationFlowStepParams;
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
   * 可选：默认问题（开场白）。优先用 prompt.md 的 ```opening 块；
   * catalog 写了则作覆盖。程序发出，不经 LLM。
   */
  opening?: string;
  /**
   * 可选：编排期步骤参数声明。
   * 有 required 项时，steps[].params 必须在进执行前钉齐；勿把选型推迟到 design-step。
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

export type CreationFlowUserView = {
  brief?: string;
  status?: CreationFlowStatus;
  steps: Array<{
    order: number;
    id: string;
    name: string;
    depends_on: string[];
    /** 同能力第几次（>1 时 UI 可标「再来」） */
    occurrence?: number;
    /** 目录里的短声明（有则展示） */
    declaration?: string;
    repeatable?: boolean;
    /** 本步调用参数（编排期钉死） */
    params?: CreationFlowStepParams;
    /** 参数缺必填项时的提示（给人看） */
    paramsMissing?: string[];
    /** 已执行 / 将要执行 / 未执行 */
    runState: FlowStepRunState;
  }>;
  parseError?: string;
};

/** 从任意正文抽取 JSON 对象 */
export function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* try slice */
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
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

/** 目录声明的必填参数中，本步仍缺失的 key（按声明顺序） */
export function missingRequiredStepParams(
  step: Pick<CreationFlowStep, "params">,
  module: ModuleCatalogEntry | null | undefined,
): string[] {
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

/** 为缺 id 的步骤补齐唯一 id；同 name 多次 → name#2、name#3… */
export function ensureCreationFlowStepIds(
  steps: Array<{
    id?: string;
    name: string;
    depends_on: string[];
    params?: CreationFlowStepParams;
  }>,
): CreationFlowStep[] {
  const used = new Set<string>();
  const nameCount = new Map<string, number>();
  const out: CreationFlowStep[] = [];

  for (const raw of steps) {
    const name = raw.name.trim();
    const n = (nameCount.get(name) ?? 0) + 1;
    nameCount.set(name, n);

    let id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) {
      id = n === 1 ? name : `${name}#${n}`;
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
      ...(raw.params ? { params: raw.params } : {}),
    });
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

  const drafted: Array<{
    id?: string;
    name: string;
    depends_on: string[];
    params?: CreationFlowStepParams;
  }> = [];
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
    drafted.push({ id, name, depends_on, ...(params ? { params } : {}) });
  }

  const steps = ensureCreationFlowStepIds(drafted);

  const brief =
    typeof row.brief === "string" && row.brief.trim() ? row.brief.trim() : undefined;
  const statusRaw = typeof row.status === "string" ? row.status.trim() : "";
  const status: CreationFlowStatus | undefined =
    statusRaw === "open" || statusRaw === "closed" ? statusRaw : undefined;

  return { version: 1, brief, status, steps };
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
    const params = parseModuleParamSpecs(m.params);
    modules.push({
      id,
      name,
      declaration,
      artifact,
      ...(repeatable ? { repeatable: true } : {}),
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
  const next = parseCreationFlow(params.nextRaw);
  const prev = parseCreationFlow(params.prevRaw);
  if (!next || !prev) return { raw: params.nextRaw, restored: [] };

  const accepted = prev.steps.filter((s) => isStepAccepted(s, params.acceptedStepIds));
  if (accepted.length === 0) return { raw: params.nextRaw, restored: [] };

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
      JSON.stringify(current.params ?? null) !== JSON.stringify(frozen.params ?? null);
    if (changed) {
      steps[at] = frozen;
      restored.push(frozen.id);
    }
  }
  if (restored.length === 0) return { raw: params.nextRaw, restored: [] };
  return {
    raw: stringifyCreationFlow({ ...next, version: 1, steps }),
    restored,
  };
}

/**
 * 配方近期起点 → 可写入黑板的开局 DAG。
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

/**
 * 已坐在配方开局步（无 depends_on）且「用户.需求」有首句时：
 * 跳过程序再抛模块 opening——首句即该步对话，不是「先开场再进 DAG」。
 */
export function shouldSkipModuleOpening(opts: {
  demand: string;
  dependsOn?: string[] | null;
  phase?: "shown" | "answered" | null;
}): boolean {
  if (opts.phase === "shown" || opts.phase === "answered") return false;
  if (!String(opts.demand ?? "").trim()) return false;
  const deps = opts.dependsOn ?? [];
  return deps.length === 0;
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
    设计状态栏: "status-bar",
    设计监控栏: "status-bar",
    变量设计与更新规则: "variable-design",
    变量控制上下文: "variable-context",
    设计回复格式: "reply-format",
    正文组成: "reply-format",
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
    const flags = m.repeatable ? "〔可反复〕" : "";
    const parts: string[] = [`- ${m.name}${flags}：${m.declaration}`];
    if (m.when) parts.push(`  何时用：${indentMultiline(m.when, "  ")}`);
    if (m.when_not) parts.push(`  何时不用：${indentMultiline(m.when_not, "  ")}`);
    if (m.boundary) parts.push(`  边界：${indentMultiline(m.boundary, "  ")}`);
    if (m.params && m.params.length > 0) {
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
    return parts.join("\n");
  });
  return [
    "【能力 · 可选工序】",
    "按需选用，勿默认全选；步骤名只能从这里选；标〔可反复〕的可多次编入。",
    "选型依据是下方「何时用 / 何时不用 / 边界」（来自各能力 meta）；有「编排参数」的步骤必须在 DAG 里写齐 params，缺参时用 askUser 选项+其它，禁止空壳进执行。",
    "生成规则：改 target 时必须同步改 rule_id（英文 kebab-case）与步骤 id（生成规则·{对象}）；禁止只改中文对象沿用旧后台 id。",
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

export function parseRecipeCatalog(raw: string): RecipeCatalog | null {
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
    recipes.push({ id, name, declaration });
  }
  if (recipes.length === 0) return null;
  return { recipes };
}

export async function loadRecipeCatalog(
  skillPackRoot: string,
  skillsRoot = DEFAULT_SKILLS_ROOT,
): Promise<RecipeCatalog | null> {
  const fullPath = path.join(skillsRoot, skillPackRoot, RECIPE_CATALOG_FILENAME);
  try {
    const raw = await readFile(fullPath, "utf8");
    return parseRecipeCatalog(raw);
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
  const fullPath = path.join(
    skillsRoot,
    skillPackRoot,
    "recipes",
    entry.id,
    "recipe.yaml",
  );
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

/** 注入 design-flow：用户已选配方（方法论 + 近期起点） */
export function formatSelectedRecipeForAgent(detail: RecipeDetail): string {
  const lines: string[] = [
    `【用户已选配方 · ${detail.name}】`,
    "这是用户手动选定的设计方法，不是锁死流水线。",
    "产出**增量工作流计划（DAG）**：只排近期要做的步骤；已验收步保留，可追加同技能多次调用。",
    "按用户表述与配方方法论增删改未验收步骤与依赖；步骤名只能从【能力】选。",
    "能力「何时用 / 何时不用」以【能力 · 可选工序】为准；本配方不重复罗列各能力调用条件。",
    "禁止改选其它配方；若用户要换配方，须等用户重新选定后再编排。",
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
    lines.push("建议近期 steps（增量起点，可改；勿一次排完全程）：");
    lines.push("```json");
    lines.push(stepsJson);
    lines.push("```");
  } else {
    lines.push("建议 steps：（待作者完善 recipe.yaml；可从【能力】自行编排近期 horizon）");
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
  missingSelection?: boolean;
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
  if (params.missingSelection) {
    blocks.push(
      [
        "【配方】用户尚未手动选择。",
        "禁止自行猜测或替用户选定配方。",
        "请 askUser 请用户从可用配方中选择，或等待用户在界面选定后再编排。",
      ].join("\n"),
    );
  } else if (params.selectedRecipe) {
    blocks.push(formatSelectedRecipeForAgent(params.selectedRecipe));
  }
  if (params.modules) {
    blocks.push(formatModuleCatalogForAgent(params.modules));
  }
  return blocks;
}

/**
 * 编排器必须看见的进度：哪些步已做完、草案里已有什么、哪些能力才允许再编入。
 * 裸 JSON id 列表不够；此块由程序钉死。
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
  const flow = params.flow ?? null;
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
      ? "〔可反复：可再追加不同 id〕"
      : "〔不可反复：禁止再排一次执行〕";
    const idBit = id ? `（id: ${id}）` : "";
    doneLines.push(`- ${name}${idBit} · ${why} ${flag}`);
    doneNames.add(name);
    if (id) doneIds.add(id);
  };

  if (flow) {
    for (const step of flow.steps) {
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
      if (doneIds.has(step.id) || doneNames.has(step.name)) continue;
      draftLines.push(
        `- ${step.name}（id: ${step.id}）· 已在草案，保留原 id；不要当作新规划再写一遍`,
      );
    }
  }

  const repeatableList = (catalog?.modules ?? [])
    .filter((m) => m.repeatable === true)
    .map((m) => m.name);

  const lines = [
    "【流程进度】（程序钉死，必须遵守）",
    "你的任务是追加缺口，不是从头规划。",
    "已完成的非反复技能：只保留原 id 作 depends_on 锚点，禁止再作为将要执行的一步。",
    "草案里已有的步骤：原样保留，不要重排一遍开局。",
    "只有能力目录标了〔可反复〕的（如生成规则、具体实例）才允许再编入新 id。",
  ];
  if (doneLines.length) {
    lines.push("", "已完成：", ...doneLines);
  } else {
    lines.push(
      "",
      "已完成：尚无已验收步骤。若草案已有开局步，那是配方预置起点，不是你新规划的。",
    );
  }
  if (draftLines.length) {
    lines.push("", "草案已有、尚未验收（保留，勿重排）：", ...draftLines);
  }
  lines.push(
    "",
    repeatableList.length
      ? `可反复追加：${repeatableList.join("、")}`
      : "可反复追加：以能力目录〔可反复〕为准。",
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
  const catalog = await loadRecipeCatalog(params.skillPackRoot, skillsRoot);
  const entry = findRecipeCatalogEntry(catalog, ref);
  if (!entry) return null;
  return loadRecipeDetail(params.skillPackRoot, entry, skillsRoot);
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
  const nameCount = new Map<string, number>();
  for (const step of flow.steps) {
    nameCount.set(step.name, (nameCount.get(step.name) ?? 0) + 1);
  }

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
    if (
      catalog &&
      (nameCount.get(step.name) ?? 0) > 1 &&
      mod &&
      mod.repeatable !== true
    ) {
      errors.push(
        `「${step.name}」出现多次，但目录未标 repeatable（仅可反复能力可同名多次）`,
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

/** 进 design-step 前：本步必填编排参数是否已齐 */
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

export function formatCreationFlowForUser(
  flow: CreationFlow,
  catalog?: ModuleCatalog | null,
  acceptedStepIds: readonly string[] = [],
): CreationFlowUserView {
  const decl = new Map(
    (catalog?.modules ?? []).map((m) => [m.name, m] as const),
  );
  const seenName = new Map<string, number>();
  const next = nextPendingStep(flow, acceptedStepIds);
  return {
    brief: flow.brief,
    status: flow.status,
    steps: flow.steps.map((s, i) => {
      const n = (seenName.get(s.name) ?? 0) + 1;
      seenName.set(s.name, n);
      const mod = decl.get(s.name);
      const paramsMissing = missingRequiredStepParams(s, mod);
      const runState: FlowStepRunState = isStepAccepted(s, acceptedStepIds)
        ? "done"
        : next && next.id === s.id
          ? "current"
          : "pending";
      return {
        order: i + 1,
        id: s.id,
        name: s.name,
        depends_on: s.depends_on,
        occurrence: n,
        declaration: mod?.declaration,
        repeatable: mod?.repeatable,
        runState,
        ...(s.params ? { params: s.params } : {}),
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

/**
 * 流程中下一个待做步骤：未验收，且 depends_on 均已验收。
 */
export function nextPendingStep(
  flow: CreationFlow | null,
  acceptedStepIds: readonly string[],
): CreationFlowStep | null {
  if (!flow?.steps.length) return null;
  for (const step of flow.steps) {
    if (isStepAccepted(step, acceptedStepIds)) continue;
    const depsOk = step.depends_on.every((dep) => {
      const depStep = findStepByRef(flow, dep);
      if (!depStep) return false;
      return isStepAccepted(depStep, acceptedStepIds);
    });
    if (depsOk) return step;
  }
  return null;
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
  /** 程序开场白；无则本步直接调 LLM */
  opening: string | null;
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
  if (!step) return null;

  const module = findModuleByName(catalog, step.name);
  if (!module) return null;

  const modulePromptRaw =
    (await loadModulePrompt(params.skillPackRoot, module.id, skillsRoot)) ??
    `# ${module.name}\n\n（模块 prompt.md 缺失，请补充 skills/.../modules/${module.id}/prompt.md）`;

  const opening =
    module.opening?.trim() || extractModuleOpening(modulePromptRaw) || null;

  return {
    step,
    module,
    depTags: dependencyArtifactTags(step, catalog, flow),
    modulePrompt: formatModulePromptForLlm(modulePromptRaw),
    opening,
  };
}
