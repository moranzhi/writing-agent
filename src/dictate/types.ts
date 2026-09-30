/** 转述整理式 · 类型与常量 */

export const CREATION_INTAKE_MODE_TAG = "创作.进料模式";
export const DICTATE_MODE_VALUE = "dictate";

/** 产物相对序写在黑板 item.metadata 里 */
export const DICTATE_ORDER_META_KEY = "dictateOrder";
export const DICTATE_LAYER_META_KEY = "dictateLayer";
export const DICTATE_SELF_SCORE_META_KEY = "dictateSelfScore";

export type DictateSelfScore = {
  dims: Array<{
    name: string;
    score: number;
    gap?: string;
    options?: string[];
  }>;
};

export type DictateProduct = {
  tag: string;
  content: string;
  /** 产物用途层；目录默认值可被具体产物生命周期覆盖 */
  layer?: "intermediate" | "final";
  selfScore?: DictateSelfScore;
  /** 同一变化频率组内的重要性顺序：负数靠前，正数更靠近实际使用位置 */
  order?: number;
};

export type DictateChatTurn = {
  role: "user" | "assistant";
  text: string;
};

export function isDictateModeValue(raw: string | undefined | null): boolean {
  return (raw ?? "").trim() === DICTATE_MODE_VALUE;
}

/** 允许写入的产物 tag */
export function isAllowedProductTag(tag: string): boolean {
  const t = tag.trim();
  if (!t) return false;
  if (t.includes("\n") || t.includes("\0")) return false;
  return t.startsWith("用户.") || t.startsWith("设计.");
}

/**
 * 未显式给 order 时的默认重要性序。
 * 变化频率由产物的「稳变」另行分组；同组内基础材料在前，
 * 越接近本轮生成合同的内容越靠后（更正）。
 * 可增殖拆分 tag（基名#槽）按基名归类。
 */
export function defaultDictateOrder(tag: string): number {
  const t = tag.trim();
  const family = t.includes("#") ? t.slice(0, t.indexOf("#")).trim() : t;
  if (family === "设计.本局创作方案") return -50;
  if (family === "用户.需求" || t === "用户.需求") return -40;
  if (family === "设计.变量目录" || family === "设计.变量映射") return -25;
  if (family === "设计.模仿范例" || family === "设计.模仿要点") return -28;
  if (/美学|纲领|禁忌|示例|模仿/.test(family)) return -30;
  if (/主角设定/.test(family)) return -26;
  if (/文风|叙事指南|故事推进|篇幅|结构/.test(family)) return -20;
  if (/生成规则/.test(family)) return -6;
  if (/具体实例/.test(family)) return -4;
  if (/短文集|短文\./.test(family)) return 10;
  if (/正文组成|回复格式/.test(family)) return 0;
  if (/开场白/.test(family)) return 20;
  return 0;
}

export function effectiveDictateOrder(p: Pick<DictateProduct, "tag" | "order">): number {
  return typeof p.order === "number" && Number.isFinite(p.order)
    ? p.order
    : defaultDictateOrder(p.tag);
}

/** 按相对序升序：负 → 0 → 正；同序再按 tag */
export function compareDictateProducts(
  a: Pick<DictateProduct, "tag" | "order">,
  b: Pick<DictateProduct, "tag" | "order">,
): number {
  const d = effectiveDictateOrder(a) - effectiveDictateOrder(b);
  if (d !== 0) return d;
  return a.tag.localeCompare(b.tag, "zh");
}

export function sortDictateProducts<T extends Pick<DictateProduct, "tag" | "order">>(
  products: T[],
): T[] {
  return [...products].sort(compareDictateProducts);
}

/** 解析 insert 的 order；非法则 undefined（表示沿用/默认） */
export function parseDictateOrder(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n;
}
