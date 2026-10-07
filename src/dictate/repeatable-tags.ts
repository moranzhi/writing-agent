/**
 * 对话落盘 · 可增殖产物 tag 拆分
 *
 * catalog 标 repeatable 的能力（生成规则 / 具体实例 / 拓扑图谱等）共用同一 artifact 基名。
 * 对话里若反复 insert 基 tag，后写会整份覆盖先写。
 * 约定：基名#槽位（如 设计.具体实例#lei-ying），每条增殖各占一 tag。
 */

import { tryParseJsonDoc } from "../parse/json-doc.js";

export const REPEATABLE_TAG_SEP = "#";

/** 去掉 #槽位，得到能力 artifact 基名 */
export function dictateProductFamily(tag: string): string {
  const t = tag.trim();
  if (!t) return "";
  const i = t.indexOf(REPEATABLE_TAG_SEP);
  return i >= 0 ? t.slice(0, i).trim() : t;
}

/** 显式槽位；无 # 则空 */
export function dictateProductSlot(tag: string): string {
  const t = tag.trim();
  const i = t.indexOf(REPEATABLE_TAG_SEP);
  if (i < 0) return "";
  return sanitizeRepeatableSlot(t.slice(i + 1));
}

export function isDictateProductFamily(tag: string, family: string): boolean {
  return dictateProductFamily(tag) === family.trim();
}

/** 槽位：英文 kebab / 短中文均可；去掉危险字符 */
export function sanitizeRepeatableSlot(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/[\n\r\0#/\\]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

export function buildRepeatableProductTag(
  family: string,
  slot: string,
): string {
  const base = family.trim();
  const s = sanitizeRepeatableSlot(slot);
  return s ? `${base}${REPEATABLE_TAG_SEP}${s}` : base;
}

function nameFromRecord(row: unknown): string | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const record = row as Record<string, unknown>;
  return (
    asString(record.姓名) ??
    asString(record.名称) ??
    asString(record.名字) ??
    asString(record.name) ??
    asString(record.id)
  );
}

function concreteInstanceName(body: Record<string, unknown>): string | undefined {
  const direct =
    asString(body.名称) ??
    asString(body.实例名) ??
    asString(body.batch_id) ??
    asString(body.批次id) ??
    asString(body.id);
  if (direct) return direct;
  const fromRecord = nameFromRecord(body.记录);
  if (fromRecord) return fromRecord;
  const rows = Array.isArray(body.records)
    ? body.records
    : Array.isArray(body.记录)
      ? body.记录
      : [];
  for (const row of rows) {
    const name = nameFromRecord(row);
    if (name) return name;
  }
  return undefined;
}

function concreteRecordRows(body: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(body.records) && body.records.length > 1) return body.records;
  if (Array.isArray(body.记录) && body.记录.length > 1) return body.记录;
  return null;
}

/** 一条具体实例正文里若含多条记录，拆成每条一份。不足两条时原样返回。 */
export function splitConcreteInstanceContents(content: string): string[] {
  const parsed = tryParseJsonDoc(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [content];
  }
  const doc = parsed as Record<string, unknown>;
  const bodyRaw = doc.正文;
  if (!bodyRaw || typeof bodyRaw !== "object" || Array.isArray(bodyRaw)) {
    return [content];
  }
  const body = bodyRaw as Record<string, unknown>;
  const rows = concreteRecordRows(body);
  if (!rows) return [content];

  const rule =
    asString(body.规则) ?? asString(body.规则名) ?? asString(body.rule_id);
  const used = new Set<string>();
  return rows.map((row, index) => {
    const base = nameFromRecord(row) ?? `第${index + 1}条`;
    let name = base;
    let n = 2;
    while (used.has(name)) {
      name = `${base}-${n}`;
      n += 1;
    }
    used.add(name);
    const nextBody: Record<string, unknown> = {
      ...(rule ? { 规则: rule } : {}),
      名称: name,
      记录: row && typeof row === "object" && !Array.isArray(row) ? row : { 内容: String(row) },
    };
    if (Array.isArray(body.批次条件) && body.批次条件.length) {
      nextBody.批次条件 = body.批次条件;
    }
    return JSON.stringify({ ...doc, brief: name, 正文: nextBody }, null, 2);
  });
}

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function bodyOfFragment(content: string): Record<string, unknown> | null {
  const parsed = tryParseJsonDoc(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const body = (parsed as Record<string, unknown>).正文;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/** 多开场切换用的落盘族。每条必须是 基名#场景短码。 */
export const OPENING_SLOT_FAMILY = "设计.开场白";
/** 旧整包 tag。insert 时改写到 OPENING_SLOT_FAMILY#槽，避免再并列一份。 */
export const LEGACY_OPENING_BUNDLE_FAMILY = "设计.开场白与开场变量";

const OPENING_SLOT_REQUIRED =
  "开场每条单独落盘，position 用「设计.开场白#场景短码」（例如 设计.开场白#opening-cycle2），供之后左右切换。不要写裸「设计.开场白」，也不要写「设计.开场白与开场变量」。改某一条则 insert 同一完整 tag。没有变量的卡不写开场变量，tag 仍然带场景短码。";

/** 旧整包族改写成开场族，槽位原样保留。 */
export function rewriteLegacyOpeningTag(tag: string): string {
  const raw = tag.trim();
  if (dictateProductFamily(raw) !== LEGACY_OPENING_BUNDLE_FAMILY) return raw;
  const slot = dictateProductSlot(raw);
  return slot ? buildRepeatableProductTag(OPENING_SLOT_FAMILY, slot) : OPENING_SLOT_FAMILY;
}

function openingCandidateRows(body: Record<string, unknown>): Record<string, unknown>[] {
  const raw = body.开场白候选 ?? body.候选;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
}

/**
 * 从单张开场正文抽出场景短码。多条候选挤在一份正文里时拒绝，要求拆成多次 insert。
 */
export function extractOpeningSlotFromContent(
  content: string,
): { slot?: string; error?: string } {
  const parsed = tryParseJsonDoc(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const doc = parsed as Record<string, unknown>;
  const nested = bodyOfFragment(content);
  const body = nested ?? doc;
  const direct =
    asString(doc.id) ??
    asString(doc.候选id) ??
    asString(doc.场景短码) ??
    asString(body.id) ??
    asString(body.候选id) ??
    asString(body.场景短码);
  if (direct) {
    const slot = sanitizeRepeatableSlot(direct);
    return slot ? { slot } : {};
  }
  const rows = openingCandidateRows(body);
  if (rows.length > 1) {
    return {
      error:
        "多条开场不要写进同一份产物。每条 insert 一次「设计.开场白#场景短码」。",
    };
  }
  const one = rows[0];
  const fromOne = one
    ? asString(one.id) ?? asString(one.候选id) ?? asString(one.场景短码)
    : undefined;
  const fallback =
    rows.length <= 1
      ? asString(body.默认候选id) ?? asString(body.默认候选ID)
      : undefined;
  const picked = fromOne ?? fallback;
  if (!picked) return {};
  const slot = sanitizeRepeatableSlot(picked);
  return slot ? { slot } : {};
}

/**
 * 从正文抽出建议槽位：生成规则 → 规则名；具体实例 → 名称 / 记录里的姓名。
 */
export function extractRepeatableSlotFromContent(
  family: string,
  content: string,
): string | undefined {
  const body = bodyOfFragment(content);
  if (!body) return undefined;
  const base = family.trim();

  if (base === "设计.生成规则" || /生成规则$/.test(base)) {
    const top =
      asString(body.规则名) ??
      asString(body.rule_id) ??
      asString(body.id) ??
      asString(body.规则id) ??
      asString(body.名称);
    if (top) return sanitizeRepeatableSlot(top) || undefined;
    const rules = body.rules;
    if (Array.isArray(rules)) {
      for (const row of rules) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const r = row as Record<string, unknown>;
        const id =
          asString(r.规则名) ??
          asString(r.rule_id) ??
          asString(r.id) ??
          asString(r.规则id);
        if (id) return sanitizeRepeatableSlot(id) || undefined;
      }
    }
    const target = asString(body.target) ?? asString(body.对象) ?? asString(body.对象族);
    if (target) return sanitizeRepeatableSlot(target) || undefined;
    return undefined;
  }

  if (base === "设计.具体实例" || /具体实例$/.test(base)) {
    const named = concreteInstanceName(body);
    if (named) return sanitizeRepeatableSlot(named) || undefined;
    const ruleId =
      asString(body.规则) ?? asString(body.规则名) ?? asString(body.rule_id);
    if (ruleId) {
      return sanitizeRepeatableSlot(`${ruleId}-1`) || undefined;
    }
    return undefined;
  }

  return undefined;
}

export type ResolveRepeatableInsertResult =
  | { tag: string; remapped?: boolean; note?: string }
  | { error: string };

/**
 * 可增殖 insert：有槽位则落到 基名#槽位；无槽位且基名已有产物 → 拒绝覆盖。
 */
export function resolveRepeatableInsertTag(params: {
  tag: string;
  content: string;
  existingTags: readonly string[];
  repeatableFamilies: ReadonlySet<string>;
}): ResolveRepeatableInsertResult {
  const requested = params.tag.trim();
  if (!requested) return { error: "position 为空" };
  const raw = rewriteLegacyOpeningTag(requested);

  const family = dictateProductFamily(raw);
  if (!params.repeatableFamilies.has(family)) {
    return { tag: raw };
  }

  const explicit = dictateProductSlot(raw);
  const extracted = extractRepeatableSlotFromContent(family, params.content);
  const openingSlot =
    family === OPENING_SLOT_FAMILY && !explicit
      ? extractOpeningSlotFromContent(params.content)
      : {};
  if (openingSlot.error) return { error: openingSlot.error };
  const slot = explicit || extracted || openingSlot.slot || "";

  const siblings = params.existingTags
    .map((t) => t.trim())
    .filter((t) => t && dictateProductFamily(t) === family);

  if (!slot) {
    if (family === OPENING_SLOT_FAMILY) {
      return { error: OPENING_SLOT_REQUIRED };
    }
    // 允许覆盖基名自身；若已有其它 #槽位，禁止再用裸基名（须写明 #id）
    const otherSiblings = siblings.filter((t) => t !== family);
    if (otherSiblings.length > 0 && raw === family) {
      return {
        error: `「${family}」是可增殖产物，追加请用「${family}#唯一id」（生成规则用规则名，具体实例用名称，开场白/主角设定用场景短码），不要覆盖基 tag。改某一条则 insert 同一完整 tag。`,
      };
    }
    return { tag: family };
  }

  const resolved = buildRepeatableProductTag(family, slot);
  if (requested !== resolved) {
    return {
      tag: resolved,
      remapped: true,
      note: `已写入 ${resolved}。之后改这一条用同一完整 tag。`,
    };
  }
  return { tag: resolved };
}

/** 收集同族全部正文（供旁观抽样等仍按「一份生成规则」读的逻辑） */
export function collectFamilyContents(
  entries: ReadonlyArray<{ tag: string; content: string }>,
  family: string,
): string[] {
  const base = family.trim();
  return entries
    .filter((e) => isDictateProductFamily(e.tag, base) && e.content.trim())
    .map((e) => e.content);
}

/**
 * 把多份生成规则 context-fragment 合成一份（合并 rules[]），便于 findRuleBody。
 */
export function mergeGenerationRulesArtifacts(
  rawList: readonly string[],
): string | undefined {
  const rules: unknown[] = [];
  let shell: Record<string, unknown> | null = null;
  for (const raw of rawList) {
    const parsed = tryParseJsonDoc(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }
    const doc = parsed as Record<string, unknown>;
    if (!shell) shell = { ...doc };
    const body = doc.正文;
    if (!body || typeof body !== "object" || Array.isArray(body)) continue;
    const rows = (body as Record<string, unknown>).rules;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) rules.push(row);
  }
  if (!shell || rules.length === 0) {
    // 无法 JSON 合并时：按序拼接，抽样侧仍可能从单份命中
    const nonempty = rawList.map((s) => s.trim()).filter(Boolean);
    return nonempty.length ? nonempty.join("\n\n---\n\n") : undefined;
  }
  const body =
    shell.正文 && typeof shell.正文 === "object" && !Array.isArray(shell.正文)
      ? { ...(shell.正文 as Record<string, unknown>), rules }
      : { rules };
  return JSON.stringify({ ...shell, 正文: body }, null, 2);
}
