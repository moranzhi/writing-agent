/**
 * 同轮不再 fill-retry：失败项写入「待补」状态，下轮 select/fill 继续补。
 * 存 readTag/writeTag，不进产物列表，避免污染黑板正文。
 */

export const DICTATE_REMEDIATE_TAG = "设计.对话落盘待补";
export const DICTATE_REMEDIATE_SCHEMA = "dictate-remediate.v1" as const;

export type DictateRemediateKind = "insert" | "delete";

export type DictateRemediateItem = {
  tag: string;
  moduleId?: string;
  error: string;
  kind: DictateRemediateKind;
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
      parsed.push({
        tag,
        error,
        kind,
        ...(moduleId ? { moduleId } : {}),
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
