/**
 * 真值 → 投影 tag：按当前值查档，改投影 tag 内容（槽位固定）。
 * schema: value-map.v1 · 存黑板「设计.变量映射」
 */
import type { Blackboard } from "../blackboard/blackboard.js";
import { parseTableDoc, type TableDoc } from "../blackboard/table-cells.js";
import { tableValueMap } from "../blackboard/table-side-effects.js";
import { extractJsonObjectText } from "./worker-set-parse.js";

export const VALUE_MAP_SCHEMA = "value-map.v1" as const;
export const VALUE_MAP_TAG = "设计.变量映射";
const VARS_TAG = "变量.当前";

export type ValueMapBand =
  | { when: "range"; min?: number; max?: number; content: string }
  | { when: "eq"; value: unknown; content: string }
  | { when: "default"; content: string };

export type ValueMapEntry = {
  id: string;
  /** 真值字段名（变量.当前 的 key） */
  field: string;
  /** 投影 tag（固定槽；内容随真值替换） */
  target_tag: string;
  bands: ValueMapBand[];
  note?: string;
};

export type ValueMapDoc = {
  schema: typeof VALUE_MAP_SCHEMA;
  maps: ValueMapEntry[];
};

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na != null && nb != null) return na === nb;
  return String(a) === String(b);
}

function parseBand(raw: unknown): ValueMapBand | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const content = asString(row.content) ?? asString(row.正文) ?? asString(row.text);
  if (!content) return null;

  const when = asString(row.when) ?? asString(row.op);
  if (when === "default" || when === "默认" || row.default === true) {
    return { when: "default", content };
  }
  if (when === "eq" || when === "等于") {
    return {
      when: "eq",
      value: row.value ?? row.eq ?? row.值,
      content,
    };
  }

  const min =
    typeof row.min === "number"
      ? row.min
      : typeof row.gte === "number"
        ? row.gte
        : toNumber(row.min);
  const max =
    typeof row.max === "number"
      ? row.max
      : typeof row.lt === "number"
        ? row.lt
        : toNumber(row.max);

  if (min != null || max != null || when === "range" || when === "区间") {
    return {
      when: "range",
      min: min ?? undefined,
      max: max ?? undefined,
      content,
    };
  }

  // 仅给了 value → 当精确匹配
  if (row.value !== undefined || row.eq !== undefined || row.值 !== undefined) {
    return {
      when: "eq",
      value: row.value ?? row.eq ?? row.值,
      content,
    };
  }
  return { when: "default", content };
}

export function parseValueMapDoc(raw: string | undefined | null): ValueMapDoc | null {
  if (!raw?.trim()) return null;
  const text = extractJsonObjectText(raw) ?? raw.trim();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    const mapsRaw = row.maps ?? row.映射 ?? row.Data映射;
    if (!Array.isArray(mapsRaw)) return null;
    const maps: ValueMapEntry[] = [];
    for (const item of mapsRaw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const m = item as Record<string, unknown>;
      const id = asString(m.id) ?? asString(m.映射id) ?? "";
      const field = asString(m.field) ?? asString(m.键依真值) ?? asString(m.key) ?? "";
      const target =
        asString(m.target_tag) ??
        asString(m.targetTag) ??
        asString(m.投影tag) ??
        asString(m.tag) ??
        "";
      if (!id || !field || !target) continue;
      const bandsRaw = m.bands ?? m.档 ?? m.分档;
      if (!Array.isArray(bandsRaw)) continue;
      const bands = bandsRaw.map(parseBand).filter((b): b is ValueMapBand => Boolean(b));
      if (!bands.length) continue;
      maps.push({
        id,
        field,
        target_tag: target,
        bands,
        note: asString(m.note) ?? asString(m.说明),
      });
    }
    if (!maps.length) return null;
    return { schema: VALUE_MAP_SCHEMA, maps };
  } catch {
    return null;
  }
}

export function serializeValueMapDoc(doc: ValueMapDoc): string {
  return JSON.stringify(
    {
      schema: VALUE_MAP_SCHEMA,
      maps: doc.maps.map((m) => ({
        id: m.id,
        field: m.field,
        target_tag: m.target_tag,
        bands: m.bands,
        ...(m.note ? { note: m.note } : {}),
      })),
    },
    null,
    2,
  );
}

export function isValidProjectionTag(tag: string): boolean {
  const t = tag.trim();
  if (!t || t.includes("\n")) return false;
  return t.startsWith("上下文.") || t.startsWith("大纲.");
}

export type UpsertMapInput = {
  id: string;
  field: string;
  target_tag: string;
  bands: unknown;
  note?: string;
};

export function upsertValueMapEntry(
  current: ValueMapDoc | null,
  input: UpsertMapInput,
): { doc: ValueMapDoc; error?: string } {
  const id = input.id.trim();
  const field = input.field.trim();
  const target = input.target_tag.trim();
  if (!id) {
    return { doc: current ?? { schema: VALUE_MAP_SCHEMA, maps: [] }, error: "id 不能为空" };
  }
  if (!field) {
    return { doc: current ?? { schema: VALUE_MAP_SCHEMA, maps: [] }, error: "field 不能为空" };
  }
  if (!isValidProjectionTag(target)) {
    return {
      doc: current ?? { schema: VALUE_MAP_SCHEMA, maps: [] },
      error: "target_tag 须以「上下文.」或「大纲.」开头",
    };
  }
  let bandsRaw = input.bands;
  if (typeof bandsRaw === "string") {
    try {
      bandsRaw = JSON.parse(bandsRaw);
    } catch {
      return {
        doc: current ?? { schema: VALUE_MAP_SCHEMA, maps: [] },
        error: "bands 须为 JSON 数组",
      };
    }
  }
  if (!Array.isArray(bandsRaw) || !bandsRaw.length) {
    return {
      doc: current ?? { schema: VALUE_MAP_SCHEMA, maps: [] },
      error: "bands 至少一档",
    };
  }
  const bands = bandsRaw.map(parseBand).filter((b): b is ValueMapBand => Boolean(b));
  if (!bands.length) {
    return {
      doc: current ?? { schema: VALUE_MAP_SCHEMA, maps: [] },
      error: "bands 无法解析（需 content，以及 min/max 或 value 或 default）",
    };
  }
  const entry: ValueMapEntry = {
    id,
    field,
    target_tag: target,
    bands,
    note: input.note?.trim() || undefined,
  };
  const maps = [...(current?.maps ?? [])];
  const idx = maps.findIndex((m) => m.id === id);
  if (idx >= 0) maps[idx] = entry;
  else maps.push(entry);
  return { doc: { schema: VALUE_MAP_SCHEMA, maps } };
}

/** 按真值查一档正文；无命中返回 null */
export function lookupValueMapContent(
  entry: ValueMapEntry,
  fieldValue: unknown,
): string | null {
  let defaultContent: string | null = null;
  for (const band of entry.bands) {
    if (band.when === "default") {
      defaultContent = band.content;
      continue;
    }
    if (band.when === "eq") {
      if (sameValue(fieldValue, band.value)) return band.content;
      continue;
    }
    const n = toNumber(fieldValue);
    if (n == null) continue;
    const minOk = band.min == null || n >= band.min;
    const maxOk = band.max == null || n < band.max;
    if (minOk && maxOk) return band.content;
  }
  return defaultContent;
}

export type ReprojectResult = {
  written: Array<{ mapId: string; tag: string; field: string; value: unknown }>;
  skipped: Array<{ mapId: string; reason: string }>;
};

/**
 * 按 变量.当前 重写所有映射投影 tag（持续投影，非 once）。
 */
export function reprojectValueMaps(params: {
  blackboard: Blackboard;
  mapsRaw?: string | null;
  currentRaw?: string | null;
  source?: string;
}): ReprojectResult {
  const maps =
    parseValueMapDoc(
      params.mapsRaw ?? params.blackboard.getContentByTag(VALUE_MAP_TAG),
    )?.maps ?? [];
  const written: ReprojectResult["written"] = [];
  const skipped: ReprojectResult["skipped"] = [];
  if (!maps.length) return { written, skipped };

  const currentDoc =
    parseTableDoc(
      params.currentRaw ?? params.blackboard.getContentByTag(VARS_TAG),
    ) ?? ({ rows: [] } as TableDoc);
  const values = tableValueMap(currentDoc);
  const source = params.source ?? "system:value-map";

  for (const entry of maps) {
    if (!values.has(entry.field)) {
      skipped.push({ mapId: entry.id, reason: `缺真值字段 ${entry.field}` });
      continue;
    }
    const value = values.get(entry.field);
    const content = lookupValueMapContent(entry, value);
    if (content == null) {
      skipped.push({ mapId: entry.id, reason: "无命中档" });
      continue;
    }
    params.blackboard.write({
      tag: entry.target_tag,
      content,
      source,
    });
    written.push({
      mapId: entry.id,
      tag: entry.target_tag,
      field: entry.field,
      value,
    });
  }
  return { written, skipped };
}

/** 映射表里声明的全部投影 tag（供 context_order 挂固定槽） */
export function listValueMapTargetTags(raw: string | undefined | null): string[] {
  const doc = parseValueMapDoc(raw);
  if (!doc) return [];
  return [...new Set(doc.maps.map((m) => m.target_tag))];
}
