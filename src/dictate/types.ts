/** 转述整理式 · 类型与常量 */

export const CREATION_INTAKE_MODE_TAG = "创作.进料模式";
export const DICTATE_MODE_VALUE = "dictate";

/** 产物相对序写在黑板 item.metadata 里 */
export const DICTATE_ORDER_META_KEY = "dictateOrder";

export type DictateProduct = {
  tag: string;
  content: string;
  /** 相对顺序：负数靠前，正数靠后；缺省时按 tag 启发式 */
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
 * 未显式给 order 时的默认相对序。
 * 越稳定/重要越靠前（更负）；越常改越靠后（更正）。
 */
export function defaultDictateOrder(tag: string): number {
  const t = tag.trim();
  if (t === "用户.需求") return -40;
  if (t === "设计.变量目录" || t === "设计.变量映射") return -25;
  if (t === "设计.模仿范例" || t === "设计.模仿要点") return -28;
  if (/美学|纲领|禁忌|示例|模仿/.test(t)) return -30;
  if (/文风|叙事指南|篇幅|结构/.test(t)) return -20;
  if (/短文集|短文\./.test(t)) return 10;
  if (/正文组成|回复格式/.test(t)) return 0;
  if (/开场白/.test(t)) return 20;
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
