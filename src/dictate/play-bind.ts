/**
 * 对话落盘 · 落档/开玩时自动把产物 tag 挂到游玩 worker。
 * 只做「固定上下文绑定」；变量清单、可见性、分档映射仍靠对话产出，此处不发明。
 * 保存时按上游产物指纹决定是否重跑：没改过就保留已有排序和运行配置。
 */
import { createHash } from "node:crypto";
import type { Blackboard } from "../blackboard/blackboard.js";
import {
  CONTEXT_ORDER_SCHEMA,
  CONTEXT_ORDER_TAG,
  DIALOGUE_HISTORY_TAG,
  WORKER_PERSONA_REF,
  mergeContextOrderIntoWorkerSetJson,
  renumberContextOrder,
  type ContextOrderDoc,
  type ContextOrderInsert,
  type ContextOrderProjection,
  type ContextOrderSlot,
} from "../skills/context-order.js";
import { parseContextFragment } from "../skills/context-fragment.js";
import {
  WORKER_SET_DRAFT_TAG,
  WORKER_SET_FINAL_TAG,
} from "../skills/creation-units.js";
import {
  defaultPlaySlots,
  enabledPlaySlotIds,
  refForSlot,
  type PlaySlotsConfig,
} from "../skills/play-slots.js";
import { parseWorkerSetYaml } from "../skills/worker-set-parse.js";
import {
  CREATION_SELECTED_RECIPE_TAG,
  parseSelectedRecipeRef,
} from "../skills/creation-flow.js";
import {
  VARIABLE_CATALOG_TAG,
} from "../skills/variable-catalog.js";
import {
  VALUE_MAP_TAG,
  listValueMapTargetTags,
} from "../skills/value-map.js";
import {
  applyMaintenanceStrategyToPlaySlots,
  MAINTENANCE_STRATEGY_TAG,
  resolveMaintenanceStrategyFromBoard,
  writeMaintenanceStrategy,
} from "../skills/maintenance-strategy.js";
import {
  DICTATE_ORDER_META_KEY,
  effectiveDictateOrder,
  sortDictateProducts,
  type DictateProduct,
} from "./types.js";

/** 开场白进对话历史，不重复挂进每轮投影 */
const SKIP_BIND_TAGS = new Set([
  "设计.开场白",
  "设计.开场白与开场变量",
  "设计.0层开场白与初态",
  "设计.worker集",
  "设计.worker集.草稿",
  CONTEXT_ORDER_TAG,
  "创作.进料模式",
  CREATION_SELECTED_RECIPE_TAG,
  VARIABLE_CATALOG_TAG,
  VALUE_MAP_TAG,
  MAINTENANCE_STRATEGY_TAG,
]);

function shouldSkipBindTag(tag: string): boolean {
  const t = tag.trim();
  if (!t) return true;
  if (SKIP_BIND_TAGS.has(t)) return true;
  if (t.startsWith("设计.开场白#")) return true;
  if (t.startsWith("输出.")) return true;
  if (t.startsWith("运行.")) return true;
  if (t.startsWith("创作.")) return true;
  return false;
}

/** 偏文风/呈现/硬约束：有叙事转述时挂转述；否则仍挂主世界层 */
const STYLE_TAG_RE =
  /叙事指南|故事推进|文风|美学|纲领|禁忌|用户约束|用户需求|示例|模仿|正文组成|回复呈现|回复格式|监控栏|篇幅|结构/;

/** 这些配方开玩时刚需叙事转述（主世界出内容、转述出文风） */
const RECIPES_REQUIRE_NARRATOR = new Set(["文本生成器"]);

/** 上次编译时所依据的上游指纹；两边产物一致且未过期则跳过重跑 */
export const DICTATE_PLAY_BIND_INPUT_META = "dictatePlayBindInput";

export type DictatePlayBindResult = {
  workerSetJson: string;
  contextOrder: ContextOrderDoc;
  boundTags: string[];
  changed: boolean;
  /** 上游产物未改，保留已有上下文排序与运行配置 */
  skipped: boolean;
};

function isStyleProductTag(tag: string): boolean {
  return STYLE_TAG_RE.test(tag);
}

function isFrequentlyChangingProduct(product: DictateProduct): boolean {
  const stability = parseContextFragment(product.content)?.稳变;
  return stability === "semi" || stability === "volatile";
}

/** 从黑板收集对话落盘产物（有正文的 用户.* / 设计.*） */
export function collectDictateBindProducts(board: Blackboard): DictateProduct[] {
  const products: DictateProduct[] = [];
  for (const e of board.listTagIndex()) {
    if (!e.tag.startsWith("用户.") && !e.tag.startsWith("设计.")) continue;
    if (shouldSkipBindTag(e.tag)) continue;
    const item = board.getLatestByTag(e.tag);
    const content = item?.content?.trim() ?? "";
    if (!content) continue;
    const rawOrder = item?.metadata?.[DICTATE_ORDER_META_KEY];
    const order =
      typeof rawOrder === "number" && Number.isFinite(rawOrder)
        ? rawOrder
        : undefined;
    products.push({ tag: e.tag, content, order });
  }
  return sortDictateProducts(products);
}

/**
 * 真值 + 映射投影固定槽。
 * - 有目录或已有表 → 挂 变量.当前
 * - 映射声明的 target_tag 一律挂上（槽位固定；内容由重投影填充）
 * - 已有正文的其它 上下文.* 也挂
 */
function collectRuntimeStateTags(board: Blackboard): string[] {
  const out: string[] = [];
  const push = (tag: string) => {
    if (!tag || out.includes(tag)) return;
    out.push(tag);
  };

  const hasCatalog = Boolean(board.getContentByTag(VARIABLE_CATALOG_TAG)?.trim());
  const hasCurrent = Boolean(board.getContentByTag("变量.当前")?.trim());
  if (hasCatalog || hasCurrent) push("变量.当前");

  for (const tag of listValueMapTargetTags(board.getContentByTag(VALUE_MAP_TAG))) {
    push(tag);
  }

  for (const tag of ["上下文.角色态度", "大纲.当前章", "上下文.旁观.状态摘要"]) {
    if (board.getContentByTag(tag)?.trim()) push(tag);
  }
  for (const e of board.listTagIndex()) {
    if (!e.tag.startsWith("上下文.")) continue;
    if (e.tag === "上下文.定稿摘要") continue;
    if (!board.getContentByTag(e.tag)?.trim()) continue;
    push(e.tag);
  }
  return out;
}

function insert(
  order: number,
  ref: string,
  projection: ContextOrderProjection,
  note?: string,
): ContextOrderInsert {
  return { order, ref, projection, ...(note ? { note } : {}) };
}

function buildGmInserts(params: {
  products: DictateProduct[];
  runtimeTags: string[];
  includeStyle: boolean;
}): ContextOrderInsert[] {
  const inserts: ContextOrderInsert[] = [
    insert(0, WORKER_PERSONA_REF, "fixed", "槽位人设"),
  ];
  let o = 1;
  const included = params.products.filter(
    (p) => params.includeStyle || !isStyleProductTag(p.tag),
  );
  const stable = included.filter((p) => !isFrequentlyChangingProduct(p));
  const changing = included.filter(isFrequentlyChangingProduct);
  for (const p of stable) {
    inserts.push(
      insert(
        o++,
        p.tag,
        "full",
        `稳定产物；同频率按重要性序〔order=${effectiveDictateOrder(p)}〕`,
      ),
    );
  }
  inserts.push(
    insert(o++, DIALOGUE_HISTORY_TAG, "summary", "对话历史（按投影裁剪）"),
  );
  for (const p of changing) {
    inserts.push(
      insert(
        o++,
        p.tag,
        "full",
        `较常变化产物；置于历史后〔order=${effectiveDictateOrder(p)}〕`,
      ),
    );
  }
  for (const tag of params.runtimeTags) {
    inserts.push(
      insert(
        o++,
        tag,
        tag === "变量.当前" ? "fields" : "full",
        tag.startsWith("上下文.") || tag.startsWith("大纲.")
          ? "映射投影固定槽（内容随真值）"
          : undefined,
      ),
    );
  }
  inserts.push(insert(o++, "用户.最新输入", "full"));
  return inserts;
}

function buildNarratorInserts(products: DictateProduct[]): ContextOrderInsert[] {
  const inserts: ContextOrderInsert[] = [
    insert(0, WORKER_PERSONA_REF, "fixed", "槽位人设"),
  ];
  let o = 1;
  for (const p of products) {
    if (!isStyleProductTag(p.tag)) continue;
    inserts.push(insert(o++, p.tag, "full", "文风/呈现参考"));
  }
  inserts.push(insert(o++, "输出.用户展示", "full"));
  return inserts;
}

function buildAuditorInserts(params: {
  products: DictateProduct[];
  runtimeTags: string[];
}): ContextOrderInsert[] {
  const inserts: ContextOrderInsert[] = [
    insert(0, WORKER_PERSONA_REF, "fixed", "槽位人设"),
  ];
  let o = 1;
  for (const p of params.products) {
    if (!/变量|生成规则/.test(p.tag)) continue;
    inserts.push(insert(o++, p.tag, "full"));
  }
  for (const tag of params.runtimeTags) {
    inserts.push(insert(o++, tag, tag === "变量.当前" ? "fields" : "full"));
  }
  inserts.push(insert(o++, "输出.用户展示", "full"));
  inserts.push(insert(o++, "用户.最新输入", "full"));
  return inserts;
}

/**
 * 按当前 play_slots 与产物，合成 context_order（主世界拿最多；转述只拿文风/呈现）。
 */
export function buildDictateContextOrder(params: {
  products: DictateProduct[];
  playSlots: PlaySlotsConfig;
  runtimeTags?: string[];
}): ContextOrderDoc {
  const runtimeTags = params.runtimeTags ?? [];
  const slots: ContextOrderSlot[] = [];

  for (const slotId of enabledPlaySlotIds(params.playSlots)) {
    const ref = refForSlot(params.playSlots, slotId);
    if (slotId === "gm") {
      slots.push({
        ref,
        label: "主世界层",
        inserts: buildGmInserts({
          products: params.products,
          runtimeTags,
          // 主世界推进剧情：固定产物全挂（含文风）；有转述时转述另挂文风切片
          includeStyle: true,
        }),
      });
      continue;
    }
    if (slotId === "narrator") {
      slots.push({
        ref,
        label: "叙事转述",
        inserts: buildNarratorInserts(params.products),
      });
      continue;
    }
    if (slotId === "auditor") {
      slots.push({
        ref,
        label: "旁观维护",
        inserts: buildAuditorInserts({
          products: params.products,
          runtimeTags,
        }),
      });
      continue;
    }
    if (slotId === "perspective") {
      slots.push({
        ref,
        label: "角色视角",
        inserts: [
          insert(0, WORKER_PERSONA_REF, "fixed", "槽位人设"),
          insert(1, "用户.最新输入", "full"),
          insert(2, "输出.用户展示", "full"),
        ],
      });
    }
  }

  return renumberContextOrder({
    schema: CONTEXT_ORDER_SCHEMA,
    brief:
      "程序按变化频率分组，并在同组内按重要性排列：稳定产物 → 对话.历史 → 较常变化产物与当前状态 → 本轮输入",
    play_slots: params.playSlots,
    slots,
  });
}

function resolvePlaySlots(
  existingRaw: string | undefined,
  board: Blackboard,
): PlaySlotsConfig {
  const parsed = existingRaw?.trim()
    ? parseWorkerSetYaml(existingRaw)
    : null;
  let slots = { ...(parsed?.play_slots ?? defaultPlaySlots()) };
  const recipeRef = parseSelectedRecipeRef(
    board.getContentByTag(CREATION_SELECTED_RECIPE_TAG),
  );
  if (recipeRef && RECIPES_REQUIRE_NARRATOR.has(recipeRef)) {
    slots.gm = true;
    slots.narrator = true;
  }
  // 变量设计.维护复杂度 → auditor true/false（内联则关旁观）
  const strategy = resolveMaintenanceStrategyFromBoard(board);
  slots = applyMaintenanceStrategyToPlaySlots(slots, strategy);
  return slots;
}

/**
 * 生成/更新 设计.worker集：保留已有 play_slots，重写 context_order 为产物挂载表。
 * 文本生成器等配方会强制打开叙事转述。
 */
export function bindDictateProductsToPlaySpec(board: Blackboard): DictatePlayBindResult {
  const products = collectDictateBindProducts(board);
  const existing =
    board.getContentByTag(WORKER_SET_FINAL_TAG)?.trim() ||
    board.getContentByTag(WORKER_SET_DRAFT_TAG)?.trim() ||
    "";
  const playSlots = resolvePlaySlots(existing || undefined, board);
  const strategy = resolveMaintenanceStrategyFromBoard(board);
  writeMaintenanceStrategy(board, strategy, "runtime:play-bind");
  const runtimeTags = collectRuntimeStateTags(board);
  const contextOrder = buildDictateContextOrder({
    products,
    playSlots,
    runtimeTags,
  });

  const baseJson = existing.trim()
    ? existing
    : JSON.stringify(
        {
          play_slots: playSlots,
          brief: "对话落盘落档自动生成",
        },
        null,
        2,
      );

  let row: Record<string, unknown>;
  try {
    const parsed = JSON.parse(baseJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("bad");
    }
    row = parsed as Record<string, unknown>;
  } catch {
    row = { play_slots: playSlots, brief: "对话落盘落档自动生成" };
  }
  row.play_slots = playSlots;
  if (playSlots.narrator) {
    row.brief =
      typeof row.brief === "string" && String(row.brief).includes("转述")
        ? row.brief
        : "对话落盘：主世界出内容，叙事转述出文风";
  }
  if (playSlots.auditor) {
    const base =
      typeof row.brief === "string" && row.brief.trim() ? String(row.brief) : "对话落盘落档自动生成";
    if (!base.includes("旁观")) {
      row.brief = `${base}；旁观副 LLM 填表（固定）`;
    }
  }
  const withSlots = JSON.stringify(row, null, 2);
  const workerSetJson = mergeContextOrderIntoWorkerSetJson(withSlots, contextOrder);

  const boundTags = products.map((p) => p.tag);
  const changed = workerSetJson.trim() !== existing.trim();
  return { workerSetJson, contextOrder, boundTags, changed, skipped: false };
}

/**
 * 上游指纹：会挂进游玩上下文的产物正文与次序，加上会改变槽位的配方、变量目录、映射和已启用槽。
 * 不含投影结果（变量.当前、上下文排序、worker 集正文），避免保存后自己把自己标脏。
 */
export function dictatePlayBindInputKey(board: Blackboard): string {
  const products = collectDictateBindProducts(board).map((product) => ({
    tag: product.tag,
    order: product.order ?? null,
    content: product.content,
  }));
  const existing =
    board.getContentByTag(WORKER_SET_FINAL_TAG)?.trim() ||
    board.getContentByTag(WORKER_SET_DRAFT_TAG)?.trim() ||
    "";
  const payload = {
    products,
    recipe: board.getContentByTag(CREATION_SELECTED_RECIPE_TAG)?.trim() ?? "",
    catalog: board.getContentByTag(VARIABLE_CATALOG_TAG)?.trim() ?? "",
    maps: board.getContentByTag(VALUE_MAP_TAG)?.trim() ?? "",
    playSlots: resolvePlaySlots(existing || undefined, board),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function storedPlayBindKey(
  board: Blackboard,
  tag: string,
): string | undefined {
  const stamp = board.getLatestByTag(tag)?.metadata?.[DICTATE_PLAY_BIND_INPUT_META];
  return typeof stamp === "string" && stamp.trim() ? stamp : undefined;
}

function freshPlayBind(
  board: Blackboard,
  key: string,
): DictatePlayBindResult | null {
  const orderItem = board.getLatestByTag(CONTEXT_ORDER_TAG);
  const workerItem = board.getLatestByTag(WORKER_SET_FINAL_TAG);
  const orderRaw = orderItem?.content?.trim() ?? "";
  const workerRaw = workerItem?.content?.trim() ?? "";
  if (!orderRaw || !workerRaw) return null;
  if (storedPlayBindKey(board, CONTEXT_ORDER_TAG) !== key) return null;
  if (storedPlayBindKey(board, WORKER_SET_FINAL_TAG) !== key) return null;
  try {
    const contextOrder = JSON.parse(orderRaw) as ContextOrderDoc;
    if (!contextOrder || typeof contextOrder !== "object") return null;
    return {
      workerSetJson: workerItem!.content,
      contextOrder,
      boundTags: collectDictateBindProducts(board).map((product) => product.tag),
      changed: false,
      skipped: true,
    };
  } catch {
    return null;
  }
}

/** 写入黑板：设计.worker集 + 设计.上下文投影排序。上游未改则不覆盖。 */
export function applyDictatePlayBind(board: Blackboard): DictatePlayBindResult {
  const key = dictatePlayBindInputKey(board);
  const fresh = freshPlayBind(board, key);
  if (fresh) return fresh;

  const result = bindDictateProductsToPlaySpec(board);
  const orderItem = board.getLatestByTag(CONTEXT_ORDER_TAG);
  const workerItem = board.getLatestByTag(WORKER_SET_FINAL_TAG);
  const stamp = { [DICTATE_PLAY_BIND_INPUT_META]: key };
  board.write({
    tag: WORKER_SET_FINAL_TAG,
    content: result.workerSetJson,
    source: "runtime",
    metadata: { ...(workerItem?.metadata ?? {}), ...stamp },
  });
  board.write({
    tag: CONTEXT_ORDER_TAG,
    content: JSON.stringify(result.contextOrder, null, 2),
    source: "runtime",
    metadata: { ...(orderItem?.metadata ?? {}), ...stamp },
  });
  return result;
}

/** @internal 测试用：判断 tag 是否文风类 */
export function isDictateStyleBindTag(tag: string): boolean {
  return isStyleProductTag(tag);
}
