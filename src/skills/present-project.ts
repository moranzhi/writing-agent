/**
 * 程序投影：把 变量.当前 / 拓扑等权威数据灌进 present.v1 的 program_projection 区。
 * 模型只填 model_generated；本模块在写盘与视图层补齐投影块。
 */
import { parseTableDoc } from "../blackboard/table-cells.js";
import { tableValueMap } from "../blackboard/table-side-effects.js";
import { extractJsonObjectText } from "./worker-set-parse.js";
import type { ReplyContractBlock, ReplyDataContract } from "./reply-contract.js";
import {
  parsePresentPacket,
  stringifyPresentPacket,
  type PresentBlockValue,
  type PresentShellId,
} from "./present-packet.js";

export type ProjectionBinding = {
  id: string;
  type: string;
  ref?: string;
  fields?: string[];
};

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

/** 从回复呈现（设计.监控栏）取出程序投影绑定 */
export function parseStatusBarProjectionBindings(
  raw: string | null | undefined,
): ProjectionBinding[] {
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
  const regions = body.语义区域 ?? body.regions ?? body.areas;
  if (!Array.isArray(regions)) return [];
  const out: ProjectionBinding[] = [];
  for (const item of regions) {
    const row = asObject(item);
    if (!row) continue;
    const id = asString(row.id);
    if (!id) continue;
    const source = asObject(row.来源) ?? asObject(row.source);
    const mode =
      asString(source?.方式) ??
      asString(source?.mode) ??
      asString(source?.source) ??
      asString(row.来源);
    if (
      mode &&
      mode !== "program_projection" &&
      mode !== "程序投影" &&
      mode !== "projection"
    ) {
      continue;
    }
    // 无方式时：若标了 ref 也当作可投影
    const ref =
      asString(source?.ref) ??
      asString(source?.tag) ??
      asString(row.ref) ??
      asString(row.权威ref);
    const fieldsRaw = source?.字段 ?? source?.fields ?? row.字段 ?? row.fields;
    const fields = Array.isArray(fieldsRaw)
      ? fieldsRaw
          .map((f) => asString(f))
          .filter((f): f is string => Boolean(f))
      : undefined;
    out.push({
      id,
      type:
        asString(row.内容类型) ??
        asString(row.type) ??
        asString(row.类型) ??
        "kv",
      ...(ref ? { ref } : {}),
      ...(fields?.length ? { fields } : {}),
    });
  }
  return out;
}

function pickValues(
  all: Map<string, unknown>,
  fields?: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields?.length) {
    for (const key of fields) {
      if (all.has(key)) out[key] = all.get(key);
    }
    return out;
  }
  for (const [key, value] of all) out[key] = value;
  return out;
}

/** 表单元格常把对象/数组存成 JSON 字符串；投影前解开，避免壳只能看到一坨字。 */
export function coerceJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    const t = value.trim();
    if (
      (t.startsWith("{") && t.endsWith("}")) ||
      (t.startsWith("[") && t.endsWith("]"))
    ) {
      try {
        return coerceJsonValue(JSON.parse(t));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(coerceJsonValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = coerceJsonValue(child);
    }
    return out;
  }
  return value;
}

function coerceValueMap(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = coerceJsonValue(value);
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 名字 → 属性对象 的矩阵，压成带 name 列的行数组，方便 table 渲染。 */
function matrixMapToRows(
  map: Record<string, unknown>,
  nameKey = "name",
): Record<string, unknown>[] {
  return Object.entries(map).map(([name, stats]) => {
    if (isPlainObject(stats)) return { [nameKey]: name, ...stats };
    return { [nameKey]: name, value: stats };
  });
}

function shapeTable(values: Record<string, unknown>): PresentBlockValue {
  const coerced = coerceValueMap(values);
  const keys = Object.keys(coerced);
  if (keys.length === 1) {
    const source = keys[0]!;
    const only = coerced[source];
    if (Array.isArray(only)) {
      return { source, rows: only };
    }
    if (isPlainObject(only)) {
      const entries = Object.entries(only);
      if (
        entries.length &&
        entries.every(([, child]) => isPlainObject(child))
      ) {
        return { source, rows: matrixMapToRows(only) };
      }
    }
  }
  return coerced;
}

function shapeBlock(
  type: string,
  values: Record<string, unknown>,
): PresentBlockValue | undefined {
  const keys = Object.keys(values);
  if (!keys.length) return undefined;
  if (type === "list") {
    const coerced = coerceValueMap(values);
    return Object.keys(coerced).map(
      (key) => `${key}：${typeof coerced[key] === "string" ? coerced[key] : JSON.stringify(coerced[key])}`,
    );
  }
  if (type === "text" || type === "markdown" || type === "safe_markdown") {
    const coerced = coerceValueMap(values);
    return Object.keys(coerced)
      .map((key) => {
        const cell = coerced[key];
        const text =
          typeof cell === "string" ? cell : JSON.stringify(cell, null, 2);
        return `【${key}】${text}`;
      })
      .join("\n");
  }
  if (type === "table") {
    return shapeTable(values);
  }
  // kv / topology / 默认：解开 JSON 字符串后的对象
  return coerceValueMap(values);
}

function readTagContent(
  readTag: ((tag: string) => string | null | undefined) | undefined,
  tag: string,
  fallbacks: Record<string, string | null | undefined>,
): string | null | undefined {
  if (Object.prototype.hasOwnProperty.call(fallbacks, tag)) {
    return fallbacks[tag];
  }
  return readTag?.(tag);
}

function valuesFromRef(params: {
  ref: string;
  fields?: string[];
  readTag?: (tag: string) => string | null | undefined;
  currentVarsRaw?: string | null;
  topologyRaw?: string | null;
}): Record<string, unknown> {
  const ref = params.ref.trim();
  const fallbacks: Record<string, string | null | undefined> = {
    "变量.当前": params.currentVarsRaw,
    "运行.初始变量": params.currentVarsRaw,
    "运行.拓扑": params.topologyRaw,
  };
  const raw = readTagContent(params.readTag, ref, fallbacks);
  if (ref === "变量.当前" || ref === "运行.初始变量") {
    const map = tableValueMap(parseTableDoc(raw));
    return pickValues(map, params.fields);
  }
  if (!raw?.trim()) return {};
  // 表文档
  const table = parseTableDoc(raw);
  if (table?.rows.length) {
    return pickValues(tableValueMap(table), params.fields);
  }
  // JSON 对象（拓扑等）
  try {
    const text = extractJsonObjectText(raw) ?? raw.trim();
    const parsed = JSON.parse(text) as unknown;
    const obj = asObject(parsed);
    if (obj) {
      if (params.fields?.length) {
        const out: Record<string, unknown> = {};
        for (const key of params.fields) {
          if (key in obj) out[key] = obj[key];
        }
        return out;
      }
      return obj;
    }
  } catch {
    /* plain */
  }
  if (params.fields?.length === 1) {
    return { [params.fields[0]!]: raw.trim() };
  }
  return { value: raw.trim() };
}

/**
 * 按正文组成契约 + 回复呈现绑定，从黑板投影 program_projection 块。
 */
export function projectPresentBlocks(params: {
  contract: ReplyDataContract;
  statusBarRaw?: string | null;
  currentVarsRaw?: string | null;
  topologyRaw?: string | null;
  readTag?: (tag: string) => string | null | undefined;
}): Record<string, PresentBlockValue> {
  const bindings = parseStatusBarProjectionBindings(params.statusBarRaw);
  const byId = new Map(bindings.map((b) => [b.id, b]));
  const currentMap = tableValueMap(parseTableDoc(params.currentVarsRaw));
  const out: Record<string, PresentBlockValue> = {};

  for (const block of params.contract.programBlocks) {
    const bound = byId.get(block.id);
    const type = bound?.type || block.type || "kv";
    let values: Record<string, unknown>;
    if (bound?.ref) {
      values = valuesFromRef({
        ref: bound.ref,
        fields: bound.fields,
        readTag: params.readTag,
        currentVarsRaw: params.currentVarsRaw,
        topologyRaw: params.topologyRaw,
      });
    } else if (type === "topology") {
      values = valuesFromRef({
        ref: "运行.拓扑",
        fields: bound?.fields,
        readTag: params.readTag,
        currentVarsRaw: params.currentVarsRaw,
        topologyRaw: params.topologyRaw,
      });
    } else {
      values = pickValues(currentMap, bound?.fields);
    }
    const shaped = shapeBlock(type, values);
    if (shaped !== undefined) out[block.id] = shaped;
  }
  return out;
}

/** 仅用契约（无监控栏）时的便捷入口 */
export function projectPresentBlocksFromContract(
  contract: ReplyDataContract,
  currentVarsRaw: string | null | undefined,
): Record<string, PresentBlockValue> {
  return projectPresentBlocks({ contract, currentVarsRaw });
}

export function mergePresentWithProjections(
  content: string,
  projections: Record<string, PresentBlockValue>,
  fallbackShell: PresentShellId = "prose",
): string {
  if (!Object.keys(projections).length) return content;
  const view = parsePresentPacket(content, fallbackShell);
  const blocks = { ...view.packet.blocks, ...projections };
  return stringifyPresentPacket({
    ...view.packet,
    blocks,
  });
}

export function projectionForBlocks(
  blocks: ReplyContractBlock[],
  currentVarsRaw: string | null | undefined,
): Record<string, PresentBlockValue> {
  if (!blocks.length) return {};
  const contract: ReplyDataContract = {
    modelBlocks: [],
    programBlocks: blocks,
  };
  return projectPresentBlocks({ contract, currentVarsRaw });
}
