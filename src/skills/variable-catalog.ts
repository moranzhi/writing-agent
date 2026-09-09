/**
 * 变量目录（创作期对话钉死；落档时种进 变量.当前）。
 * schema: variable-catalog.v1
 */
import {
  createTableFromValues,
  parseTableDoc,
  stringifyTableDoc,
  type TableDoc,
} from "../blackboard/table-cells.js";
import { extractJsonObjectText } from "./worker-set-parse.js";

export const VARIABLE_CATALOG_SCHEMA = "variable-catalog.v1" as const;
export const VARIABLE_CATALOG_TAG = "设计.变量目录";
export const CURRENT_VARS_TAG = "变量.当前";

export type VariableFieldType = "number" | "string" | "boolean" | "enum";

export type VariableCatalogField = {
  key: string;
  type: VariableFieldType;
  initial: unknown;
  /** 对用户可见（监控栏等）；默认 true */
  user_visible: boolean;
  note?: string;
};

export type VariableCatalogDoc = {
  schema: typeof VARIABLE_CATALOG_SCHEMA;
  fields: VariableCatalogField[];
};

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function parseType(raw: unknown): VariableFieldType {
  const s = asString(raw)?.toLowerCase();
  if (s === "number" || s === "数字") return "number";
  if (s === "boolean" || s === "布尔") return "boolean";
  if (s === "enum" || s === "枚举") return "enum";
  return "string";
}

function coerceInitial(type: VariableFieldType, raw: unknown): unknown {
  if (type === "number") {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() && !Number.isNaN(Number(raw))) {
      return Number(raw);
    }
    return 0;
  }
  if (type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true" || raw === "是" || raw === 1) return true;
    if (raw === "false" || raw === "否" || raw === 0) return false;
    return false;
  }
  if (raw === undefined || raw === null) return type === "string" ? "" : raw;
  return raw;
}

export function parseVariableCatalog(raw: string | undefined | null): VariableCatalogDoc | null {
  if (!raw?.trim()) return null;
  const text = extractJsonObjectText(raw) ?? raw.trim();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    const fieldsRaw = row.fields ?? row.真值 ?? row.变量;
    if (!Array.isArray(fieldsRaw)) return null;
    const fields: VariableCatalogField[] = [];
    for (const item of fieldsRaw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const f = item as Record<string, unknown>;
      const key = asString(f.key) ?? asString(f.名) ?? asString(f.name);
      if (!key) continue;
      const type = parseType(f.type ?? f.类型);
      const userVisible =
        f.user_visible === false ||
        f.对用户可见 === false ||
        f.userVisible === false
          ? false
          : true;
      fields.push({
        key,
        type,
        initial: coerceInitial(type, f.initial ?? f.初值 ?? f.value),
        user_visible: userVisible,
        note: asString(f.note) ?? asString(f.备注),
      });
    }
    if (!fields.length) return null;
    return { schema: VARIABLE_CATALOG_SCHEMA, fields };
  } catch {
    return null;
  }
}

export function serializeVariableCatalog(doc: VariableCatalogDoc): string {
  return JSON.stringify(
    {
      schema: VARIABLE_CATALOG_SCHEMA,
      fields: doc.fields.map((f) => ({
        key: f.key,
        type: f.type,
        initial: f.initial,
        user_visible: f.user_visible,
        ...(f.note ? { note: f.note } : {}),
      })),
    },
    null,
    2,
  );
}

export type UpsertVariableInput = {
  key: string;
  type?: string;
  initial?: unknown;
  user_visible?: boolean;
  note?: string;
};

export function upsertVariableField(
  current: VariableCatalogDoc | null,
  input: UpsertVariableInput,
): { doc: VariableCatalogDoc; error?: string } {
  const key = input.key.trim();
  if (!key) return { doc: current ?? { schema: VARIABLE_CATALOG_SCHEMA, fields: [] }, error: "key 不能为空" };
  const type = parseType(input.type);
  const field: VariableCatalogField = {
    key,
    type,
    initial: coerceInitial(type, input.initial),
    user_visible: input.user_visible !== false,
    note: input.note?.trim() || undefined,
  };
  const fields = [...(current?.fields ?? [])];
  const idx = fields.findIndex((f) => f.key === key);
  if (idx >= 0) fields[idx] = field;
  else fields.push(field);
  return { doc: { schema: VARIABLE_CATALOG_SCHEMA, fields } };
}

/** 目录 → 表文档（初值）；用于种 运行.初始变量 / 变量.当前 */
export function catalogToTableDoc(
  catalog: VariableCatalogDoc,
  actor: string,
): TableDoc {
  const values: Record<string, unknown> = {};
  const meta: Record<string, { visibility?: "visible" | "hidden"; note?: string }> = {};
  for (const f of catalog.fields) {
    values[f.key] = f.initial;
    meta[f.key] = {
      visibility: f.user_visible ? "visible" : "hidden",
      note: f.note,
    };
  }
  return createTableFromValues(values, actor, meta);
}

/**
 * 若 变量.当前 为空则用目录初值种入；已有格不覆盖。
 * 同步补齐 运行.初始变量（仅当其为空）。
 */
export function seedVariablesFromCatalog(params: {
  catalogRaw: string | undefined | null;
  currentRaw: string | undefined | null;
  initialRaw: string | undefined | null;
  actor?: string;
}): {
  current: string | null;
  initial: string | null;
  seededKeys: string[];
} {
  const catalog = parseVariableCatalog(params.catalogRaw);
  if (!catalog?.fields.length) {
    return { current: null, initial: null, seededKeys: [] };
  }
  const actor = params.actor ?? "system:variable-catalog";
  const fromCatalog = catalogToTableDoc(catalog, actor);
  const seededKeys = fromCatalog.rows.map((r) => r.key);

  const existingCurrent = parseTableDoc(params.currentRaw);
  let currentOut: string | null = null;
  if (!existingCurrent?.rows.length) {
    currentOut = stringifyTableDoc(fromCatalog);
  } else {
    // 补缺键，不覆盖已有
    const have = new Set(existingCurrent.rows.map((r) => r.key));
    const patchValues: Record<string, unknown> = {};
    const meta: Record<string, { visibility?: "visible" | "hidden"; note?: string }> = {};
    for (const f of catalog.fields) {
      if (have.has(f.key)) continue;
      patchValues[f.key] = f.initial;
      meta[f.key] = {
        visibility: f.user_visible ? "visible" : "hidden",
        note: f.note,
      };
    }
    if (Object.keys(patchValues).length) {
      const patch = createTableFromValues(patchValues, actor, meta);
      const merged = {
        rows: [...existingCurrent.rows, ...patch.rows].sort((a, b) =>
          a.key.localeCompare(b.key),
        ),
      };
      currentOut = stringifyTableDoc(merged);
    }
  }

  const existingInitial = parseTableDoc(params.initialRaw);
  let initialOut: string | null = null;
  if (!existingInitial?.rows.length) {
    initialOut = stringifyTableDoc(fromCatalog);
  }

  return { current: currentOut, initial: initialOut, seededKeys };
}
