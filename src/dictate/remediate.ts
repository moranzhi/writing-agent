/**
 * 同轮补写用尽后，失败项写入「待补」状态，下轮 select/fill 继续补。
 * 存 readTag/writeTag，不进产物列表，避免污染黑板正文。
 * draft / keptDims 只给下一枪做增量：底稿上改失败点，已接受的自评维度带回去。
 */

export const DICTATE_REMEDIATE_TAG = "设计.对话落盘待补";
export const DICTATE_REMEDIATE_SCHEMA = "dictate-remediate.v1" as const;

export type DictateRemediateKind = "insert" | "delete";

/** 已经合法、可在下一枪原样带回的自评维度。 */
export type DictateKeptDim = {
  name: string;
  score: number;
  gap?: string;
  options?: string[];
};

export type DictateRemediateItem = {
  tag: string;
  moduleId?: string;
  error: string;
  kind: DictateRemediateKind;
  /** 未通过时的正文底稿 */
  draft?: string;
  /** 这次没整份通过、但单项已经合法的自评维度 */
  keptDims?: DictateKeptDim[];
};

export type DictateRemediateDoc = {
  schema: typeof DICTATE_REMEDIATE_SCHEMA;
  items: DictateRemediateItem[];
};

export function parseDictateRemediate(raw: string | undefined | null): DictateRemediateDoc {
  if (!raw?.trim()) return { schema: DICTATE_REMEDIATE_SCHEMA, items: [] };
  try {
    const row = JSON.parse(raw) as Record<string, unknown>;
    const items = Array.isArray(row.items) ? row.items : [];
    const parsed: DictateRemediateItem[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const tag = String(rec.tag ?? "").trim();
      if (!tag) continue;
      const kind = rec.kind === "delete" ? "delete" : "insert";
      const moduleId = String(rec.moduleId ?? rec.module_id ?? "").trim();
      const error = String(rec.error ?? "尚未通过").trim() || "尚未通过";
      const draft = String(rec.draft ?? "").trim();
      const keptDims = parseKeptDims(rec.keptDims ?? rec.kept_dims);
      parsed.push({
        tag,
        error,
        kind,
        ...(moduleId ? { moduleId } : {}),
        ...(draft ? { draft } : {}),
        ...(keptDims.length ? { keptDims } : {}),
      });
    }
    return { schema: DICTATE_REMEDIATE_SCHEMA, items: dedupeRemediate(parsed) };
  } catch {
    return { schema: DICTATE_REMEDIATE_SCHEMA, items: [] };
  }
}

export function serializeDictateRemediate(doc: DictateRemediateDoc): string {
  return JSON.stringify(
    {
      schema: DICTATE_REMEDIATE_SCHEMA,
      items: dedupeRemediate(doc.items),
    },
    null,
    2,
  );
}

export function formatRemediateChecklist(items: readonly DictateRemediateItem[]): string {
  if (!items.length) return "";
  return [
    "失败待补（须继续写入，勿忽略）：",
    ...items.map((item) => {
      const kind = item.kind === "delete" ? "删除" : "写入";
      const mod = item.moduleId ? ` / ${item.moduleId}` : "";
      return `- 〔${kind}〕${item.tag}${mod}：${item.error}`;
    }),
  ].join("\n");
}

function parseKeptDims(raw: unknown): DictateKeptDim[] {
  if (!Array.isArray(raw)) return [];
  const out: DictateKeptDim[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    const score = Number(row.score);
    if (!name || seen.has(name) || !Number.isInteger(score) || score < 1 || score > 5) continue;
    const gap = String(row.gap ?? "").trim();
    const options = Array.isArray(row.options)
      ? row.options.map((option) => String(option).trim()).filter(Boolean)
      : [];
    seen.add(name);
    out.push({
      name,
      score,
      ...(gap ? { gap } : {}),
      ...(options.length ? { options } : {}),
    });
  }
  return out;
}

function dedupeRemediate(items: DictateRemediateItem[]): DictateRemediateItem[] {
  const seen = new Set<string>();
  const out: DictateRemediateItem[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.tag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
