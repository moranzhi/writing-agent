/**
 * 旁观维护包（副 LLM）：表/规则补充工单。
 * 存黑板 tag：运行.本轮.旁观
 * 多数轮为空操作；不写真相权威、不写用户正文。
 */
import {
  createTableFromValues,
  type TableDoc,
} from "../blackboard/table-cells.js";
import { extractJsonObjectText } from "./worker-set-parse.js";

export const MAINTAIN_SCHEMA = "maintain.v1" as const;
export const MAINTAIN_TAG = "运行.本轮.旁观";

export type MaintainNeedGenerate =
  | false
  | {
      rule_id: string;
      reason: string;
    };

export type MaintainTableOp = {
  /** set：写入绝对值；delta：在现有值上加减 */
  op: "set" | "delta";
  /** 目标表 tag；默认 变量.当前 */
  tag?: string;
  key: string;
  value?: unknown;
  delta?: number;
  note?: string;
};

export type MaintainPacket = {
  schema: typeof MAINTAIN_SCHEMA;
  /** 是否需要按生成规则补产物；默认 false */
  need_generate?: MaintainNeedGenerate;
  /** 表字段操作；空数组 = 本轮无需改表 */
  table_ops?: MaintainTableOp[];
  /** 只读意见（漂移/口径），不进用户正文 */
  notes?: string[];
};

export type MaintainPacketView = {
  ok: boolean;
  parseError?: string;
  packet?: MaintainPacket;
  empty: boolean;
};

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function parseNeedGenerate(raw: unknown): MaintainNeedGenerate | undefined {
  if (raw === false || raw === null || raw === undefined) return false;
  if (raw === true) return false;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const row = raw as Record<string, unknown>;
    const ruleId =
      asString(row.rule_id) ?? asString(row.ruleId) ?? asString(row.规则);
    const reason = asString(row.reason) ?? asString(row.原因) ?? "";
    if (!ruleId) return false;
    return { rule_id: ruleId, reason };
  }
  return undefined;
}

function parseTableOps(raw: unknown): MaintainTableOp[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: MaintainTableOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const key = asString(row.key) ?? asString(row.name) ?? asString(row.变量);
    if (!key) continue;
    const opRaw = asString(row.op) ?? "set";
    const op: "set" | "delta" = opRaw === "delta" ? "delta" : "set";
    const delta =
      typeof row.delta === "number" && Number.isFinite(row.delta)
        ? row.delta
        : undefined;
    if (op === "delta" && delta == null) continue;
    if (op === "set" && row.value === undefined && row.to === undefined) continue;
    out.push({
      op,
      tag: asString(row.tag) ?? asString(row.表),
      key,
      value: row.value ?? row.to,
      delta,
      note: asString(row.note) ?? asString(row.备注),
    });
  }
  return out.length ? out : undefined;
}

export function normalizeMaintainPacket(
  row: Record<string, unknown>,
): MaintainPacket {
  const notesRaw = row.notes ?? row.备注;
  const notes = Array.isArray(notesRaw)
    ? notesRaw
        .map((x) => asString(x))
        .filter((x): x is string => Boolean(x))
    : undefined;
  return {
    schema: MAINTAIN_SCHEMA,
    need_generate: parseNeedGenerate(row.need_generate ?? row.needGenerate),
    table_ops: parseTableOps(row.table_ops ?? row.tableOps ?? row.表操作),
    notes: notes?.length ? notes : undefined,
  };
}

export function emptyMaintainPacket(): MaintainPacket {
  return {
    schema: MAINTAIN_SCHEMA,
    need_generate: false,
    table_ops: [],
    notes: [],
  };
}

export function isMaintainPacketEmpty(packet: MaintainPacket): boolean {
  const need =
    packet.need_generate &&
    typeof packet.need_generate === "object" &&
    Boolean(packet.need_generate.rule_id);
  const ops = packet.table_ops?.length ?? 0;
  const notes = packet.notes?.length ?? 0;
  return !need && ops === 0 && notes === 0;
}

export function parseMaintainPacket(
  raw: string | undefined | null,
): MaintainPacketView {
  const text = raw?.trim();
  if (!text) {
    return {
      ok: true,
      packet: emptyMaintainPacket(),
      empty: true,
    };
  }

  // 允许模型用极短词表示空操作
  if (/^(无需|无|空|skip|none|noop)$/i.test(text)) {
    return { ok: true, packet: emptyMaintainPacket(), empty: true };
  }

  const jsonText =
    extractJsonObjectText(text) ?? (text.startsWith("{") ? text : null);
  if (!jsonText) {
    return {
      ok: false,
      parseError: "旁观维护包不是 JSON",
      empty: true,
    };
  }

  try {
    const doc = JSON.parse(jsonText) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      return {
        ok: false,
        parseError: "旁观维护包不是 JSON 对象",
        empty: true,
      };
    }
    const packet = normalizeMaintainPacket(doc as Record<string, unknown>);
    return {
      ok: true,
      packet,
      empty: isMaintainPacketEmpty(packet),
    };
  } catch (err) {
    return {
      ok: false,
      parseError:
        err instanceof Error ? err.message : "旁观维护包 JSON 解析失败",
      empty: true,
    };
  }
}

/**
 * 将针对某一表 tag 的 ops 编成 TableDoc patch（供 mergeTableCells）。
 * 仅处理 op=set|delta；其它 tag 由调用方过滤。
 */
export function maintainOpsToTablePatch(
  ops: MaintainTableOp[],
  current: TableDoc | null,
  targetTag = "变量.当前",
): TableDoc | null {
  const relevant = ops.filter(
    (op) => (op.tag?.trim() || "变量.当前") === targetTag,
  );
  if (!relevant.length) return null;

  const byKey = new Map((current?.rows ?? []).map((r) => [r.key, r]));
  const values: Record<string, unknown> = {};
  const meta: Record<string, { note?: string }> = {};

  for (const op of relevant) {
    const existing = byKey.get(op.key);
    if (op.op === "delta") {
      const cur = existing?.value;
      const n = typeof cur === "number" ? cur : Number(cur);
      values[op.key] = Number.isFinite(n)
        ? (n as number) + (op.delta ?? 0)
        : (op.delta ?? 0);
    } else {
      values[op.key] = op.value;
    }
    if (op.note) meta[op.key] = { note: op.note };
  }

  if (!Object.keys(values).length) return null;
  return createTableFromValues(values, "system", meta);
}
