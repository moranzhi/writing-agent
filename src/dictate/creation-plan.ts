import {
  catalogModulesForIntake,
  type ModuleCatalog,
  type ModuleCatalogEntry,
} from "../skills/creation-flow.js";
import type { DictateProduct } from "./types.js";

export const CREATION_PLAN_TAG = "设计.本局创作方案";
export const CREATION_PLAN_SCHEMA = "creation-plan.v1";

export const CREATION_PLAN_TIERS = [
  "必须",
  "有必要",
  "有一定效果",
  "没有意义",
] as const;

export type CreationPlanTier = (typeof CREATION_PLAN_TIERS)[number];
export type CreationPresentationMode = "message" | "zero_layer";

const PRESENTATION_MODULE_IDS: Record<
  CreationPresentationMode,
  readonly string[]
> = {
  message: ["status-bar", "reply-format", "opening-setup"],
  zero_layer: [
    "zero-layer-status",
    "zero-layer-reply-format",
    "zero-layer-opening-setup",
  ],
};
const ALL_PRESENTATION_MODULE_IDS = new Set(
  Object.values(PRESENTATION_MODULE_IDS).flat(),
);

export type CreationPlanItem = {
  module_id: string;
  tier: CreationPlanTier;
  why: string;
  missing: string;
  instances: unknown[];
};

export type CreationPlan = {
  schema: typeof CREATION_PLAN_SCHEMA;
  技能: string;
  brief: string;
  /** 缺省兼容旧方案，按普通消息楼层处理。 */
  presentation_mode?: CreationPresentationMode;
  recipe: {
    primary: string;
    secondary_traits: string[];
    method: string[];
    references: string[];
  };
  items: CreationPlanItem[];
};

/**
 * 本局方案只覆盖对话落盘中的内容能力。旧 DAG 收成节点、机械映射节点和方案自身不参与。
 * 新内容能力默认纳入；程序步（auto）默认排除。
 */
export const CREATION_PLAN_EXCLUDED_MODULE_IDS = new Set([
  "creation-plan",
  "narrative",
  "variable-context",
  "context-order",
  "worker-spec",
  "refine",
]);

export function creationPlanModules(
  catalog: ModuleCatalog | null | undefined,
  presentationMode: CreationPresentationMode = "message",
): ModuleCatalogEntry[] {
  if (!catalog) return [];
  const selectedPresentation = new Set(
    PRESENTATION_MODULE_IDS[presentationMode],
  );
  return catalogModulesForIntake(catalog, "dictate").filter(
    (module) =>
      !module.auto &&
      !CREATION_PLAN_EXCLUDED_MODULE_IDS.has(module.id) &&
      (!ALL_PRESENTATION_MODULE_IDS.has(module.id) ||
        selectedPresentation.has(module.id)),
  );
}

function presentationModeOf(
  plan: Pick<CreationPlan, "presentation_mode">,
): CreationPresentationMode {
  return plan.presentation_mode === "zero_layer" ? "zero_layer" : "message";
}

export function parseCreationPlan(raw: string | undefined | null): CreationPlan | null {
  if (!raw?.trim()) return null;
  try {
    const doc = JSON.parse(raw) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
    const row = doc as Record<string, unknown>;
    if (row.schema !== CREATION_PLAN_SCHEMA || !Array.isArray(row.items)) {
      return null;
    }
    const recipe = row.recipe;
    if (
      typeof row.技能 !== "string" ||
      typeof row.brief !== "string" ||
      (row.presentation_mode !== undefined &&
        row.presentation_mode !== "message" &&
        row.presentation_mode !== "zero_layer") ||
      !recipe ||
      typeof recipe !== "object" ||
      Array.isArray(recipe)
    ) {
      return null;
    }
    const recipeRow = recipe as Record<string, unknown>;
    if (
      typeof recipeRow.primary !== "string" ||
      !isStringArray(recipeRow.secondary_traits) ||
      !isStringArray(recipeRow.method) ||
      !isStringArray(recipeRow.references)
    ) {
      return null;
    }
    const validItems = row.items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const value = item as Record<string, unknown>;
      return (
        typeof value.module_id === "string" &&
        CREATION_PLAN_TIERS.includes(value.tier as CreationPlanTier) &&
        typeof value.why === "string" &&
        typeof value.missing === "string" &&
        Array.isArray(value.instances)
      );
    });
    if (!validItems) return null;
    return row as CreationPlan;
  } catch {
    return null;
  }
}

export type CreationPlanValidation = {
  ok: boolean;
  missingIds: string[];
  duplicateIds: string[];
  unknownIds: string[];
  error?: string;
  plan?: CreationPlan;
};

export function validateCreationPlan(
  raw: string,
  catalog: ModuleCatalog | null | undefined,
): CreationPlanValidation {
  const plan = parseCreationPlan(raw);
  if (!plan) {
    return {
      ok: false,
      missingIds: creationPlanModules(catalog).map((m) => m.id),
      duplicateIds: [],
      unknownIds: [],
      error: `本局创作方案必须是合法的 ${CREATION_PLAN_SCHEMA} JSON，且含 items 数组`,
    };
  }

  const presentationMode = presentationModeOf(plan);
  const required = creationPlanModules(catalog, presentationMode).map((m) => m.id);
  if (required.length === 0) {
    return {
      ok: false,
      missingIds: [],
      duplicateIds: [],
      unknownIds: [],
      error: "能力目录不可用，无法校验本局创作方案",
    };
  }

  const ids = plan.items
    .map((item) => String(item?.module_id ?? "").trim())
    .filter(Boolean);
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

  const allowed = new Set(required);
  const missingIds = required.filter((id) => !counts.has(id));
  const duplicateIds = [...counts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const unknownIds = [...counts.keys()].filter((id) => !allowed.has(id));
  const invalidTierIds = plan.items
    .filter(
      (item) =>
        !CREATION_PLAN_TIERS.includes(item?.tier as CreationPlanTier),
    )
    .map((item) => String(item?.module_id ?? "（空 id）"));

  const problems: string[] = [];
  if (missingIds.length) problems.push(`漏项：${missingIds.join("、")}`);
  if (duplicateIds.length) problems.push(`重复：${duplicateIds.join("、")}`);
  if (unknownIds.length) problems.push(`未知：${unknownIds.join("、")}`);
  if (invalidTierIds.length) {
    problems.push(`档位无效：${invalidTierIds.join("、")}`);
  }

  return {
    ok: problems.length === 0,
    missingIds,
    duplicateIds,
    unknownIds,
    ...(problems.length ? { error: `本局创作方案能力覆盖校验失败；${problems.join("；")}` } : {}),
    plan,
  };
}

export function formatCreationPlanCapabilityCatalog(
  catalog: ModuleCatalog | null | undefined,
): string {
  const allContent = catalogModulesForIntake(catalog ?? { modules: [] }, "dictate").filter(
    (module) =>
      !module.auto && !CREATION_PLAN_EXCLUDED_MODULE_IDS.has(module.id),
  );
  const formatModule = (module: ModuleCatalogEntry) => {
    const boundary = compact(module.boundary ?? "", 180);
    return [
      `- ${module.id}（${module.name}）：${compact(module.declaration, 120)}`,
      ...(boundary ? [`  边界：${boundary}`] : []),
    ].join("\n");
  };
  const commonLines = allContent
    .filter((module) => !ALL_PRESENTATION_MODULE_IDS.has(module.id))
    .map(formatModule);
  const byId = new Map(allContent.map((module) => [module.id, module]));
  const modeLines = (mode: CreationPresentationMode) =>
    PRESENTATION_MODULE_IDS[mode]
      .map((id) => byId.get(id))
      .filter((module): module is ModuleCatalogEntry => Boolean(module))
      .map(formatModule);
  if (commonLines.length === 0) return "";
  return [
    "【本局创作方案 · 能力目录】",
    "先选择 presentation_mode=`message|zero_layer`。items 必须覆盖全部公共能力，并且只覆盖所选呈现模式的三项能力；不得同时选两套。分档看能力对抽出的核心体验和可运行性的贡献：用户没点名但缺了体验会明显变差的，标进「必须」或「有必要」。数组顺序不代表执行顺序。",
    "【公共能力】",
    commonLines.join("\n"),
    "【message · 普通消息楼层】",
    modeLines("message").join("\n"),
    "【zero_layer · 持久 0 层卡】",
    modeLines("zero_layer").join("\n"),
  ].join("\n");
}

export function formatCreationPlanProgress(params: {
  plan: CreationPlan;
  catalog: ModuleCatalog | null | undefined;
  products: readonly DictateProduct[];
}): string {
  const modules = new Map(
    creationPlanModules(
      params.catalog,
      presentationModeOf(params.plan),
    ).map((module) => [module.id, module]),
  );
  const productTags = params.products.map((product) => product.tag);
  const productByTag = new Map(params.products.map((product) => [product.tag, product]));
  const groups = new Map<CreationPlanTier, string[]>(
    CREATION_PLAN_TIERS.map((tier) => [tier, []]),
  );

  for (const item of params.plan.items) {
    const module = modules.get(item.module_id);
    if (!module || !CREATION_PLAN_TIERS.includes(item.tier)) continue;
    const landedTags = productTags.filter(
      (tag) => tag === module.artifact || tag.startsWith(`${module.artifact}#`),
    );
    const scores = landedTags
      .map((tag) => {
        const product = productByTag.get(tag);
        const metadataScores = product?.selfScore?.dims.map((dim) => dim.score) ?? [];
        return metadataScores.length
          ? Math.min(...metadataScores)
          : lowestSelfScore(product?.content);
      })
      .filter((score): score is number => score !== undefined);
    const scoreText = scores.length ? `，最低自评分 ${Math.min(...scores)}` : "";
    const state = landedTags.length ? `已落${scoreText}` : "未落";
    const missing = item.missing?.trim() ? `；缺口：${item.missing.trim()}` : "";
    const lines = [
      `- ${item.module_id}（${module.name}）〔${state}〕：${item.why}${missing}`,
    ];
    if (item.tier !== "没有意义") {
      const when = oneLine(module.when ?? "");
      const whenNot = oneLine(module.when_not ?? "");
      if (when) lines.push(`  何时用：${when}`);
      if (whenNot) lines.push(`  何时不用：${whenNot}`);
    }
    groups.get(item.tier)!.push(...lines);
  }

  return [
    "【本局创作方案 · 当前决策】",
    JSON.stringify(
      {
        schema: params.plan.schema,
        brief: params.plan.brief,
        presentation_mode: presentationModeOf(params.plan),
        recipe: params.plan.recipe,
      },
      null,
      2,
    ),
    "",
    "【能力状态】未落的「必须」和「有必要」是收口前的核对清单，不是本轮待办。前三档附带何时用 / 何时不用，方案改写或补全后仍对照它们决定本轮写哪项；可反复能力已落一条也保留。「没有意义」只列名称，不附使用条件。",
    ...CREATION_PLAN_TIERS.flatMap((tier) => [
      `### ${tier}`,
      ...(groups.get(tier)?.length ? groups.get(tier)! : ["- （无）"]),
    ]),
  ].join("\n");
}

export function requiredCreationPlanGaps(params: {
  planRaw: string | undefined;
  catalog: ModuleCatalog | null | undefined;
  products: readonly DictateProduct[];
}): string[] {
  const plan = parseCreationPlan(params.planRaw);
  if (!plan) return [];
  const modules = new Map(
    creationPlanModules(
      params.catalog,
      presentationModeOf(plan),
    ).map((module) => [module.id, module]),
  );
  return plan.items
    .filter((item) => item.tier === "必须")
    .filter((item) => {
      const artifact = modules.get(item.module_id)?.artifact;
      return (
        !artifact ||
        !params.products.some(
          (product) =>
            product.tag === artifact || product.tag.startsWith(`${artifact}#`),
        )
      );
    })
    .map((item) => item.module_id);
}

function lowestSelfScore(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const doc = JSON.parse(raw) as Record<string, unknown>;
    const modern = (doc.self_score as { dims?: Array<{ score?: unknown }> } | undefined)
      ?.dims;
    const legacy = (doc.自评 as { 维度?: Array<{ 分数?: unknown }> } | undefined)
      ?.维度;
    const values = [
      ...(modern ?? []).map((dim) => dim.score),
      ...(legacy ?? []).map((dim) => dim.分数),
    ]
      .map(Number)
      .filter(Number.isFinite);
    return values.length ? Math.min(...values) : undefined;
  } catch {
    return undefined;
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function compact(text: string, max: number): string {
  const line = oneLine(text);
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
