/**
 * 创作流程：编排产物（设计.创作流程）。
 * 可变增量 DAG：有序 steps + 每步 id/中文名 + depends_on；可追加、可同能力多次。
 *
 * 两层内容（作者细写，运行时只搭骨架）：
 * - recipes/：初始配方（给总管 / design-flow 的参考起点，可调味）
 * - modules/：共用组件池（步骤名与方法正文；配方与总管都从这里选型）
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export const CREATION_FLOW_TAG = "设计.创作流程";
export const CREATION_CURRENT_STEP_TAG = "创作.当前步骤";
/** 用户手动选定的初始配方（存 recipe id，或 JSON {id,name}） */
export const CREATION_SELECTED_RECIPE_TAG = "创作.选用配方";
export const MODULE_CATALOG_FILENAME = "modules/catalog.yaml";
export const RECIPE_CATALOG_FILENAME = "recipes/catalog.yaml";
export const DESIGN_STEP_WORKER_ID = "design-step";
export const DESIGN_FLOW_WORKER_ID = "design-flow";

const DEFAULT_SKILLS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skills",
);

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
 * 单份初始配方详情。
 * seed = 建议步骤（可为空；name 须 ∈ 模块池）；编排时允许增删改。
 */
export type RecipeDetail = {
  id: string;
  name: string;
  declaration: string;
  when?: string;
  hint?: string;
  seed: CreationFlow | null;
};

export type CreationFlowValidation = {
  ok: boolean;
  errors: string[];
};

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

/** 为缺 id 的步骤补齐唯一 id；同 name 多次 → name#2、name#3… */
export function ensureCreationFlowStepIds(
  steps: Array<{ id?: string; name: string; depends_on: string[] }>,
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

export function parseCreationFlow(raw: string | undefined | null): CreationFlow | null {
  if (!raw?.trim()) return null;
  const doc = extractJsonObject(raw);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const row = doc as Record<string, unknown>;
  const stepsRaw = row.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) return null;

  const drafted: Array<{ id?: string; name: string; depends_on: string[] }> = [];
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
    drafted.push({ id, name, depends_on });
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
    modules.push({
      id,
      name,
      declaration,
      artifact,
      ...(repeatable ? { repeatable: true } : {}),
      ...(opening ? { opening } : {}),
    });
  }
  if (modules.length === 0) return null;
  return { modules };
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

/** 无 id 时的兜底（目录仍应显式写 id） */
function slugFromName(name: string): string {
  const map: Record<string, string> = {
    美学纲领与交互范式: "aesthetics-interaction",
    交互范式: "interaction",
    美学纲领: "aesthetics",
    叙事指南: "narrative",
    实现机制: "mechanism",
    世界蓝图与人文地理: "world-blueprint",
    生成规则: "generation-rules",
    具体实例: "concrete-instances",
    拓扑图谱: "topology",
    设计状态栏: "status-bar",
    变量设计与更新规则: "variable-design",
    变量控制上下文: "variable-context",
    设计回复格式: "reply-format",
    "Worker 规格": "worker-spec",
    细化终稿: "refine",
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
    return parseModuleCatalog(raw);
  } catch {
    return null;
  }
}

/** 注入 design-flow 的短目录（非全文 prompt） */
export function formatModuleCatalogForAgent(catalog: ModuleCatalog): string {
  const lines = catalog.modules.map((m) => {
    const flags = m.repeatable ? "〔可反复〕" : "";
    return `- ${m.name}${flags}：${m.declaration}`;
  });
  return `【能力 · 可选工序】（按需选用，勿默认全选；步骤名只能从这里选；标〔可反复〕的可多次编入）\n${lines.join("\n")}`;
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
 * 解析单份 recipe.yaml（when / hint / brief / steps）。
 * steps 空或缺失 → seed 为 null（仍可作选型参考）。
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
    hint,
    seed,
  };
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
  return `【可选导演】（须由用户手动选择）\n${lines.join("\n")}`;
}

/** 注入 design-flow：用户已选导演（内部 recipe） */
export function formatSelectedRecipeForAgent(detail: RecipeDetail): string {
  const lines: string[] = [
    `【用户已选导演 · ${detail.name}】`,
    "这是用户手动选定的方法起点，不是锁死流水线。",
    "产出**增量 DAG**：只排近期要做的步骤；已验收步保留，可追加同能力多次调用（如生成规则 / 具体实例）。",
    "按用户表述增删改未验收步骤与依赖（像现场改戏 / 调味）；步骤名只能从【能力】选。",
    "禁止改选其它导演；若用户要换导演，须等用户重新选定后再编排。",
  ];
  if (detail.declaration) lines.push(`简介：${detail.declaration}`);
  if (detail.when) lines.push(`适用：${detail.when}`);
  if (detail.hint) lines.push(`调味提示：${detail.hint}`);
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

/** design-flow 一次注入：已选配方 + 组件池 */
export function formatDesignFlowContentBlocks(params: {
  selectedRecipe?: RecipeDetail | null;
  modules?: ModuleCatalog | null;
  missingSelection?: boolean;
}): string[] {
  const blocks: string[] = [];
  if (params.missingSelection) {
    blocks.push(
      [
        "【导演】用户尚未手动选择。",
        "禁止自行猜测或替用户选定导演。",
        "请 askUser 请用户从可用导演中选择，或等待用户在界面选定后再编排。",
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
  const ids = flow.steps.map((s) => s.id);
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
  }

  return { ok: errors.length === 0, errors };
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
): CreationFlowUserView {
  const decl = new Map(
    (catalog?.modules ?? []).map((m) => [m.name, m] as const),
  );
  const seenName = new Map<string, number>();
  return {
    brief: flow.brief,
    status: flow.status,
    steps: flow.steps.map((s, i) => {
      const n = (seenName.get(s.name) ?? 0) + 1;
      seenName.set(s.name, n);
      const mod = decl.get(s.name);
      return {
        order: i + 1,
        id: s.id,
        name: s.name,
        depends_on: s.depends_on,
        occurrence: n,
        declaration: mod?.declaration,
        repeatable: mod?.repeatable,
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
