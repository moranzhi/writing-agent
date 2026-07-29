/**
 * 表字段格：扁平 rows + 每格 rev，防止用户手改被 worker 覆盖。
 */
export type TableCellSource = `user` | `system` | `worker:${string}`;

export type TableCell = {
  key: string;
  value: unknown;
  rev: number;
  updatedAt: string;
  source: TableCellSource | string;
  visibility?: "visible" | "hidden";
  note?: string;
};

export type TableDoc = {
  rows: TableCell[];
};

export function parseTableDoc(raw: string | undefined | null): TableDoc | null {
  if (!raw?.trim()) return null;
  try {
    const doc = JSON.parse(raw) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
    const rowsRaw = (doc as { rows?: unknown }).rows;
    if (!Array.isArray(rowsRaw)) return null;
    const rows: TableCell[] = [];
    for (const item of rowsRaw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const key = typeof row.key === "string" ? row.key.trim() : "";
      if (!key) continue;
      const rev = typeof row.rev === "number" && row.rev >= 1 ? row.rev : 1;
      rows.push({
        key,
        value: row.value,
        rev,
        updatedAt:
          typeof row.updatedAt === "string" && row.updatedAt
            ? row.updatedAt
            : new Date().toISOString(),
        source:
          typeof row.source === "string" && row.source
            ? row.source
            : "system",
        visibility:
          row.visibility === "hidden" || row.visibility === "visible"
            ? row.visibility
            : "visible",
        note: typeof row.note === "string" ? row.note : undefined,
      });
    }
    return { rows };
  } catch {
    return null;
  }
}

export function stringifyTableDoc(doc: TableDoc): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * 合并表更新：worker 须带读时的 expectedRev；
 * source=user 的格默认不覆盖；rev 不匹配则跳过该格。
 */
export function mergeTableCells(params: {
  current: TableDoc | null;
  patch: TableDoc;
  actor: TableCellSource | string;
  /** 若提供，仅当 current.rev === expectedRev[key] 时才写入 */
  expectedRev?: Record<string, number>;
}): { doc: TableDoc; applied: string[]; skipped: Array<{ key: string; reason: string }> } {
  const byKey = new Map<string, TableCell>();
  for (const row of params.current?.rows ?? []) {
    byKey.set(row.key, { ...row });
  }

  const applied: string[] = [];
  const skipped: Array<{ key: string; reason: string }> = [];
  const now = new Date().toISOString();

  for (const patch of params.patch.rows) {
    const key = patch.key.trim();
    if (!key) continue;
    const existing = byKey.get(key);

    if (existing?.source === "user" && !String(params.actor).startsWith("user")) {
      skipped.push({ key, reason: "user-owned" });
      continue;
    }

    if (params.expectedRev && existing) {
      const expected = params.expectedRev[key];
      if (expected != null && existing.rev !== expected) {
        skipped.push({
          key,
          reason: `rev-conflict have=${existing.rev} expected=${expected}`,
        });
        continue;
      }
    }

    const nextRev = existing ? existing.rev + 1 : patch.rev >= 1 ? patch.rev : 1;
    byKey.set(key, {
      key,
      value: patch.value,
      rev: nextRev,
      updatedAt: now,
      source: params.actor,
      visibility: patch.visibility ?? existing?.visibility ?? "visible",
      note: patch.note ?? existing?.note,
    });
    applied.push(key);
  }

  return {
    doc: { rows: [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)) },
    applied,
    skipped,
  };
}

/** 从零创建：全部 source=actor，rev=1 */
export function createTableFromValues(
  values: Record<string, unknown>,
  actor: TableCellSource | string,
  meta?: Record<string, { visibility?: "visible" | "hidden"; note?: string }>,
): TableDoc {
  const now = new Date().toISOString();
  const rows: TableCell[] = Object.entries(values).map(([key, value]) => ({
    key,
    value,
    rev: 1,
    updatedAt: now,
    source: actor,
    visibility: meta?.[key]?.visibility ?? "visible",
    note: meta?.[key]?.note,
  }));
  return { rows: rows.sort((a, b) => a.key.localeCompare(b.key)) };
}
