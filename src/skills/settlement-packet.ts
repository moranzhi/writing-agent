/**
 * 主世界层 → 叙事转述的裁决包（settlement / direction packet）。
 * 存黑板 tag：运行.本轮.裁决
 */
import { extractJsonObjectText } from "./worker-set-parse.js";

export const SETTLEMENT_SCHEMA = "settlement.v1" as const;
export const SETTLEMENT_TAG = "运行.本轮.裁决";

export type SettlementNpcMove = {
  who: string;
  move: string;
  wants?: string;
  refuses_to_say?: string;
};

export type SettlementVariableChange = {
  key: string;
  from?: unknown;
  to?: unknown;
  delta?: number;
  note?: string;
};

export type SettlementPacket = {
  schema: typeof SETTLEMENT_SCHEMA;
  /** 玩家本轮行动摘要 */
  player_action?: string;
  /** 已落地的客观变化（短句列表） */
  resolved?: string[];
  /** 转述应呈现的场面现状（玩家安全） */
  visible_now?: string;
  /** NPC 主动动作（binding move） */
  npc_moves?: SettlementNpcMove[];
  /** 真值变更提议（Runtime 合并进 变量.当前） */
  variable_changes?: SettlementVariableChange[];
  /** 禁止写入用户正文的内容 */
  do_not_say?: string[];
  /** 语气提示（通常来自 Progressive 投影） */
  tone_hint?: string;
  /** 可选：建议玩家选项（无主语动作短语） */
  suggested_actions?: string[];
};

export type SettlementPacketView = {
  ok: boolean;
  parseError?: string;
  packet?: SettlementPacket;
  /** 用户友好分节，供 UI 渲染 */
  sections: Array<{ title: string; lines: string[] }>;
};

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asString(x)).filter((x): x is string => Boolean(x));
}

function parseNpcMoves(raw: unknown): SettlementNpcMove[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SettlementNpcMove[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const who = asString(row.who) ?? asString(row.actor) ?? asString(row.name);
    const move = asString(row.move) ?? asString(row.action);
    if (!who || !move) continue;
    out.push({
      who,
      move,
      wants: asString(row.wants),
      refuses_to_say: asString(row.refuses_to_say) ?? asString(row.refusesToSay),
    });
  }
  return out.length ? out : undefined;
}

function parseVariableChanges(
  raw: unknown,
): SettlementVariableChange[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SettlementVariableChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const key = asString(row.key) ?? asString(row.name) ?? asString(row.变量);
    if (!key) continue;
    const delta =
      typeof row.delta === "number" && Number.isFinite(row.delta)
        ? row.delta
        : undefined;
    out.push({
      key,
      from: row.from ?? row.从,
      to: row.to ?? row.到 ?? row.value,
      delta,
      note: asString(row.note) ?? asString(row.备注),
    });
  }
  return out.length ? out : undefined;
}

export function normalizeSettlementPacket(
  row: Record<string, unknown>,
): SettlementPacket {
  const resolved = asStringList(row.resolved);
  const resolvedZh = asStringList(row.已解决);
  const doNot = asStringList(row.do_not_say);
  const doNotZh = asStringList(row.禁止说出);
  const suggested = asStringList(row.suggested_actions);
  const suggestedZh = asStringList(row.建议行动);
  return {
    schema: SETTLEMENT_SCHEMA,
    player_action: asString(row.player_action) ?? asString(row.玩家行动),
    resolved: resolved.length ? resolved : resolvedZh.length ? resolvedZh : undefined,
    visible_now: asString(row.visible_now) ?? asString(row.可见现状),
    npc_moves: parseNpcMoves(row.npc_moves ?? row.npcMoves ?? row.角色动作),
    variable_changes: parseVariableChanges(
      row.variable_changes ?? row.variableChanges ?? row.变量变更,
    ),
    do_not_say: doNot.length ? doNot : doNotZh.length ? doNotZh : undefined,
    tone_hint: asString(row.tone_hint) ?? asString(row.语气),
    suggested_actions: suggested.length
      ? suggested
      : suggestedZh.length
        ? suggestedZh
        : undefined,
  };
}

export function parseSettlementPacket(raw: string | undefined | null): SettlementPacketView {
  const text = raw?.trim();
  if (!text) {
    return { ok: false, parseError: "空裁决包", sections: [] };
  }

  const jsonText = extractJsonObjectText(text) ?? (text.startsWith("{") ? text : null);
  if (!jsonText) {
    // 兼容旧散文裁决：整段当作 visible_now
    return {
      ok: true,
      packet: {
        schema: SETTLEMENT_SCHEMA,
        visible_now: text,
      },
      sections: [{ title: "场面（未结构化）", lines: [text] }],
    };
  }

  try {
    const doc = JSON.parse(jsonText) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      return { ok: false, parseError: "裁决包不是 JSON 对象", sections: [] };
    }
    const packet = normalizeSettlementPacket(doc as Record<string, unknown>);
    return { ok: true, packet, sections: settlementSections(packet) };
  } catch (err) {
    return {
      ok: false,
      parseError: err instanceof Error ? err.message : "裁决包 JSON 解析失败",
      sections: [],
    };
  }
}

export function settlementSections(packet: SettlementPacket): Array<{
  title: string;
  lines: string[];
}> {
  const sections: Array<{ title: string; lines: string[] }> = [];
  if (packet.player_action) {
    sections.push({ title: "玩家行动", lines: [packet.player_action] });
  }
  if (packet.resolved?.length) {
    sections.push({ title: "已落地", lines: packet.resolved });
  }
  if (packet.visible_now) {
    sections.push({ title: "可见现状", lines: [packet.visible_now] });
  }
  if (packet.npc_moves?.length) {
    sections.push({
      title: "角色动作",
      lines: packet.npc_moves.map((m) => {
        const extra = [m.wants && `想要：${m.wants}`, m.refuses_to_say && `回避：${m.refuses_to_say}`]
          .filter(Boolean)
          .join("；");
        return extra ? `${m.who}：${m.move}（${extra}）` : `${m.who}：${m.move}`;
      }),
    });
  }
  if (packet.variable_changes?.length) {
    sections.push({
      title: "变量变更",
      lines: packet.variable_changes.map((c) => {
        if (c.delta != null) {
          return `${c.key} ${c.delta >= 0 ? "+" : ""}${c.delta}` + (c.note ? `（${c.note}）` : "");
        }
        if (c.from !== undefined || c.to !== undefined) {
          return `${c.key}：${String(c.from ?? "?")} → ${String(c.to ?? "?")}`;
        }
        return c.key;
      }),
    });
  }
  if (packet.tone_hint) {
    sections.push({ title: "语气", lines: [packet.tone_hint] });
  }
  if (packet.do_not_say?.length) {
    sections.push({ title: "勿写入正文", lines: packet.do_not_say });
  }
  if (packet.suggested_actions?.length) {
    sections.push({ title: "建议行动", lines: packet.suggested_actions });
  }
  return sections;
}

export function isSettlementLikeObject(doc: unknown): boolean {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  const row = doc as Record<string, unknown>;
  if (row.schema === SETTLEMENT_SCHEMA) return true;
  // 启发式：有裁决包典型键
  const keys = ["player_action", "visible_now", "resolved", "npc_moves", "variable_changes"];
  let hits = 0;
  for (const k of keys) if (k in row) hits += 1;
  return hits >= 2;
}
