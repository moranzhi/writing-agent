/**
 * 表字段格：扁平 rows + 每格 rev，防止用户手改被 worker 覆盖。
 */
export type TableCellSource = `user` | `system` | `worker:${string}`;

export type TableCell = {
  key: string;
  value: unknown;
  /** 该格版本号：手改须带读到的 rev，对不上则拒绝，避免盖过后端更新 */
  rev: number;
  updatedAt: string;
  source: TableCellSource | string;
  visibility?: "visible" | "hidden";
  /** 未声明时：可见格可改，隐藏格只读 */
  editable?: boolean;
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
        editable:
          row.editable === true
            ? true
            : row.editable === false
              ? false
              : undefined,
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
      editable: patch.editable ?? existing?.editable,
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

export function isTableCellEditable(row: TableCell): boolean {
  if (row.editable === false) return false;
  if (row.editable === true) return true;
  return (row.visibility ?? "visible") === "visible";
}

export type TableCellPatch = {
  key: string;
  value: unknown;
  expectedRev: number;
};

export type UserTableSkip = {
  key: string;
  reason: string;
  have?: number;
  expected?: number;
  value?: unknown;
};

/** 用户按格手改：必须带读到的 rev；不可改或版本冲突则跳过该格。 */
export function patchUserTableCells(
  current: TableDoc | null,
  patches: readonly TableCellPatch[],
): {
  doc: TableDoc;
  applied: string[];
  skipped: UserTableSkip[];
} {
  const empty: TableDoc = { rows: [] };
  const base = current ?? empty;
  const skipped: UserTableSkip[] = [];
  const allowed: TableCellPatch[] = [];
  for (const patch of patches) {
    const key = patch.key.trim();
    if (!key) continue;
    const existing = base.rows.find((r) => r.key === key);
    if (!existing) {
      skipped.push({ key, reason: "missing" });
      continue;
    }
    if (!isTableCellEditable(existing)) {
      skipped.push({
        key,
        reason: "not-editable",
        have: existing.rev,
        value: existing.value,
      });
      continue;
    }
    if (!Number.isFinite(patch.expectedRev)) {
      skipped.push({ key, reason: "rev-required", have: existing.rev });
      continue;
    }
    allowed.push({ ...patch, key });
  }
  if (!allowed.length) {
    return { doc: base, applied: [], skipped };
  }
  const expectedRev = Object.fromEntries(
    allowed.map((p) => [p.key, p.expectedRev]),
  );
  const merged = mergeTableCells({
    current: base,
    patch: {
      rows: allowed.map((p) => ({
        key: p.key,
        value: p.value,
        rev: 1,
        updatedAt: new Date().toISOString(),
        source: "user",
      })),
    },
    actor: "user",
    expectedRev,
  });
  const byKey = new Map(base.rows.map((r) => [r.key, r]));
  const skippedOut: UserTableSkip[] = [
    ...skipped,
    ...merged.skipped.map((s) => {
      const haveRow = byKey.get(s.key);
      const expected = expectedRev[s.key];
      return {
        key: s.key,
        reason: s.reason,
        have: haveRow?.rev,
        expected,
        value: haveRow?.value,
      };
    }),
  ];
  return { doc: merged.doc, applied: merged.applied, skipped: skippedOut };
}

/** 从零创建：全部 source=actor，rev=1 */
export function createTableFromValues(
  values: Record<string, unknown>,
  actor: TableCellSource | string,
  meta?: Record<
    string,
    { visibility?: "visible" | "hidden"; note?: string; editable?: boolean }
  >,
): TableDoc {
  const now = new Date().toISOString();
  const rows: TableCell[] = Object.entries(values).map(([key, value]) => ({
    key,
    value,
    rev: 1,
    updatedAt: now,
    source: actor,
    visibility: meta?.[key]?.visibility ?? "visible",
    ...(meta?.[key]?.editable !== undefined
      ? { editable: meta[key]?.editable }
      : {}),
    note: meta?.[key]?.note,
  }));
  return { rows: rows.sort((a, b) => a.key.localeCompare(b.key)) };
}
