/**
 * 从「设计.变量设计与更新规则」编译运行目录，并种进 变量.当前。
 * 创作产物是合同；设计.变量目录 / 变量.当前 是运行表。
 */
import { extractJsonObjectText } from "./worker-set-parse.js";
import {
  parseVariableCatalog,
  seedVariablesFromCatalog,
  serializeVariableCatalog,
  upsertVariableField,
  VARIABLE_CATALOG_TAG,
  type VariableCatalogDoc,
  type VariableCatalogField,
  type VariableFieldType,
} from "./variable-catalog.js";

export const VARIABLE_DESIGN_TAG = "设计.变量设计与更新规则";

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

function parseType(raw: unknown): VariableFieldType {
  const s = asString(raw)?.toLowerCase();
  if (s === "number" || s === "数字" || s === "integer" || s === "int") {
    return "number";
  }
  if (s === "boolean" || s === "布尔") return "boolean";
  if (s === "enum" || s === "枚举") return "enum";
  return "string";
}

/** 解析变量设计产物里的真值列表 → 目录字段（未写入） */
export function catalogFieldsFromVariableDesign(
  raw: string | null | undefined,
): VariableCatalogField[] {
  if (!raw?.trim()) return [];
  const text = extractJsonObjectText(raw) ?? raw.trim();
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const root = asObject(doc);
  if (!root) return [];
  const body = asObject(root.正文) ?? root;
  const truths = body.真值 ?? body.fields ?? body.变量;
  if (!Array.isArray(truths)) return [];

  const fields: VariableCatalogField[] = [];
  const seen = new Set<string>();
  for (const item of truths) {
    const row = asObject(item);
    if (!row) continue;
    const key =
      asString(row.id) ??
      asString(row.key) ??
      asString(row.名) ??
      asString(row.name) ??
      asString(row.名称);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const type = parseType(row.类型 ?? row.type);
    const initBox = asObject(row.初始化) ?? asObject(row.initial);
    const initial =
      initBox?.默认值 ??
      initBox?.default ??
      initBox?.value ??
      row.initial ??
      row.初值 ??
      row.默认值;
    const publicity = asString(row.公开性) ?? asString(row.visibility);
    const userVisible =
      publicity === "hidden" ||
      publicity === "隐藏" ||
      row.user_visible === false ||
      row.对用户可见 === false
        ? false
        : true;
    const note =
      asString(row.名称) ??
      asString(row.用途) ??
      asString(row.note) ??
      asString(row.备注);
    const { doc: one } = upsertVariableField(null, {
      key,
      type,
      initial,
      user_visible: userVisible,
      note,
    });
    const field = one.fields[0];
    if (field) fields.push(field);
  }
  return fields;
}

/** 把设计稿真值并进已有目录（不删目录里多出来的 declare 字段） */
export function mergeCatalogFromVariableDesign(
  existing: VariableCatalogDoc | null,
  designRaw: string | null | undefined,
): {
  doc: VariableCatalogDoc;
  added: string[];
  updated: string[];
} | null {
  const fromDesign = catalogFieldsFromVariableDesign(designRaw);
  if (!fromDesign.length) return null;

  let doc: VariableCatalogDoc = existing ?? {
    schema: "variable-catalog.v1",
    fields: [],
  };
  const added: string[] = [];
  const updated: string[] = [];
  for (const field of fromDesign) {
    const before = doc.fields.find((f) => f.key === field.key);
    const { doc: next } = upsertVariableField(doc, {
      key: field.key,
      type: field.type,
      initial: field.initial,
      user_visible: field.user_visible,
      user_editable: field.user_editable,
      note: field.note,
    });
    doc = next;
    if (!before) added.push(field.key);
    else updated.push(field.key);
  }
  return { doc, added, updated };
}

export type SyncVariableDesignResult = {
  /** 有变更时返回新目录 JSON */
  catalog: string | null;
  current: string | null;
  initial: string | null;
  seededKeys: string[];
  catalogKeys: string[];
  added: string[];
};

/**
 * 设计稿 → 目录 → 种/补 变量.当前 与 运行.初始变量。
 * 已有格不覆盖；目录缺键才追加。
 */
export function syncVariableDesignToRuntime(params: {
  designRaw: string | null | undefined;
  catalogRaw: string | null | undefined;
  currentRaw: string | null | undefined;
  initialRaw: string | null | undefined;
}): SyncVariableDesignResult {
  const empty: SyncVariableDesignResult = {
    catalog: null,
    current: null,
    initial: null,
    seededKeys: [],
    catalogKeys: [],
    added: [],
  };
  const existing = parseVariableCatalog(params.catalogRaw);
  const merged = mergeCatalogFromVariableDesign(existing, params.designRaw);
  if (!merged) return empty;

  const catalogChanged =
    !existing ||
    serializeVariableCatalog(existing) !== serializeVariableCatalog(merged.doc);
  const catalogRaw = catalogChanged
    ? serializeVariableCatalog(merged.doc)
    : (params.catalogRaw?.trim() ?? serializeVariableCatalog(merged.doc));

  const seeded = seedVariablesFromCatalog({
    catalogRaw,
    currentRaw: params.currentRaw,
    initialRaw: params.initialRaw,
    actor: "system:variable-design",
  });

  return {
    catalog: catalogChanged ? catalogRaw : null,
    current: seeded.current,
    initial: seeded.initial,
    seededKeys: seeded.seededKeys,
    catalogKeys: merged.doc.fields.map((f) => f.key),
    added: merged.added,
  };
}

/** 把 sync 结果写回黑板；返回实际写入的 tag */
export function writeVariableDesignSync(
  sync: SyncVariableDesignResult,
  writeTag: (tag: string, content: string) => void,
): string[] {
  const wrote: string[] = [];
  if (sync.catalog) {
    writeTag(VARIABLE_CATALOG_TAG, sync.catalog);
    wrote.push(VARIABLE_CATALOG_TAG);
  }
  if (sync.initial) {
    writeTag("运行.初始变量", sync.initial);
    wrote.push("运行.初始变量");
  }
  if (sync.current) {
    writeTag("变量.当前", sync.current);
    wrote.push("变量.当前");
  }
  return wrote;
}
