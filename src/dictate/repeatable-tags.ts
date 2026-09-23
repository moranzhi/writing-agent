/**
 * 对话落盘 · 可增殖产物 tag 拆分
 *
 * catalog 标 repeatable 的能力（生成规则 / 具体实例）共用同一 artifact 基名。
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

/**
 * 从正文抽出建议槽位：生成规则 → rule_id；具体实例 → batch_id / 首条姓名。
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
      asString(body.rule_id) ?? asString(body.id) ?? asString(body.规则id);
    if (top) return sanitizeRepeatableSlot(top) || undefined;
    const rules = body.rules;
    if (Array.isArray(rules)) {
      for (const row of rules) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const r = row as Record<string, unknown>;
        const id =
          asString(r.rule_id) ?? asString(r.id) ?? asString(r.规则id);
        if (id) return sanitizeRepeatableSlot(id) || undefined;
      }
    }
    const target = asString(body.target) ?? asString(body.对象) ?? asString(body.对象族);
    if (target) return sanitizeRepeatableSlot(target) || undefined;
    return undefined;
  }

  if (base === "设计.具体实例" || /具体实例$/.test(base)) {
    const batch =
      asString(body.batch_id) ??
      asString(body.批次id) ??
      asString(body.id);
    if (batch) return sanitizeRepeatableSlot(batch) || undefined;
    const records = body.records;
    if (Array.isArray(records)) {
      for (const row of records) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const r = row as Record<string, unknown>;
        const name =
          asString(r.姓名) ??
          asString(r.name) ??
          asString(r.名称) ??
          asString(r.id);
        if (name) return sanitizeRepeatableSlot(name) || undefined;
      }
    }
    const ruleId = asString(body.rule_id);
    if (ruleId) {
      return sanitizeRepeatableSlot(`${ruleId}-batch`) || undefined;
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
  const raw = params.tag.trim();
  if (!raw) return { error: "position 为空" };

  const family = dictateProductFamily(raw);
  if (!params.repeatableFamilies.has(family)) {
    return { tag: raw };
  }

  const explicit = dictateProductSlot(raw);
  const extracted = extractRepeatableSlotFromContent(family, params.content);
  const slot = explicit || extracted || "";

  const siblings = params.existingTags
    .map((t) => t.trim())
    .filter((t) => t && dictateProductFamily(t) === family);

  if (!slot) {
    // 允许覆盖基名自身；若已有其它 #槽位，禁止再用裸基名（须写明 #id）
    const otherSiblings = siblings.filter((t) => t !== family);
    if (otherSiblings.length > 0 && raw === family) {
      return {
        error: `「${family}」是可增殖产物，追加请用「${family}#唯一id」（生成规则用 rule_id，具体实例用 batch_id/姓名，开场白/主角设定用场景短码），不要覆盖基 tag。改某一条则 insert 同一完整 tag。`,
      };
    }
    return { tag: family };
  }

  const resolved = buildRepeatableProductTag(family, slot);
  if (raw === family || raw !== resolved) {
    return {
      tag: resolved,
      remapped: raw !== resolved,
      note: raw !== resolved ? `可增殖已拆到 ${resolved}` : undefined,
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
