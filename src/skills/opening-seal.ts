/**
 * 开场白终节点：选定后落库、关 DAG。
 * 能力 `opening-setup` 与磁盘 worker `opening-generator` 共用这条收口。
 */
import {
  parseTableDoc,
  stringifyTableDoc,
  type TableDoc,
} from "../blackboard/table-cells.js";
import {
  parseCreationFlow,
  stringifyCreationFlow,
} from "./creation-flow.js";
import { parseContextFragment } from "./context-fragment.js";

export const OPENING_SETUP_ARTIFACT_TAG = "设计.开场白与开场变量";
export const OPENING_OUTPUT_TAG = "输出.开场白";
export const OPENING_INITIAL_VARS_TAG = "运行.初始变量";
export const OPENING_CURRENT_VARS_TAG = "变量.当前";

export const SLOT_CREATION_SEALED_BY_OPENING = "creationSealedByOpening";
export const SLOT_OPENING_SELECTED_INDEX = "openingSelectedIndex";

export const CREATION_SEALED_WAITING_MESSAGE =
  "开场已选定，创作已收口并保存。可切换到「游玩」。";

export const INSTANCE_OPENING_SNAPSHOT_LABEL = "创作定稿（开场）";

export function isOpeningLockTag(tag: string): boolean {
  const t = tag.trim();
  return t === OPENING_OUTPUT_TAG || t === OPENING_INITIAL_VARS_TAG;
}

export function isOpeningSealArtifact(artifact: {
  workerId?: string;
  outputTags?: readonly string[];
}): boolean {
  if ((artifact.workerId ?? "").trim() === "opening-generator") return true;
  return (artifact.outputTags ?? []).includes(OPENING_SETUP_ARTIFACT_TAG);
}

export type OpeningVariable = {
  name: string;
  value: unknown;
  note?: string;
};

export type OpeningSealPayload = {
  candidates: string[];
  selectedIndex: number;
  selectedText: string;
  variables: OpeningVariable[];
};

function asTrimmed(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function collectCandidateTexts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const row = item as Record<string, unknown>;
      const text =
        asTrimmed(row.全文) ||
        asTrimmed(row.text) ||
        asTrimmed(row.开场白) ||
        asTrimmed(row.内容);
      if (text) out.push(text);
    }
  }
  return out;
}

function collectVariables(raw: unknown): OpeningVariable[] {
  if (!Array.isArray(raw)) return [];
  const out: OpeningVariable[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const name =
      asTrimmed(row.名) || asTrimmed(row.name) || asTrimmed(row.key) || "";
    if (!name) continue;
    const note = asTrimmed(row.依据) || asTrimmed(row.note);
    out.push({
      name,
      value: row.值 !== undefined ? row.值 : row.value,
      ...(note ? { note } : {}),
    });
  }
  return out;
}

function bodyRecord(fragmentBody: unknown): Record<string, unknown> | null {
  if (!fragmentBody || typeof fragmentBody !== "object" || Array.isArray(fragmentBody)) {
    return null;
  }
  return fragmentBody as Record<string, unknown>;
}

/** 从开场白 fragment（或裸 JSON）抽出候选与变量。 */
export function parseOpeningSealPayload(
  raw: string | null | undefined,
  selectedIndex = 0,
): OpeningSealPayload | null {
  if (!raw?.trim()) return null;
  const fragment = parseContextFragment(raw);
  const body = bodyRecord(fragment?.正文) ?? (() => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return bodyRecord(parsed) ?? bodyRecord((parsed as { 正文?: unknown })?.正文);
    } catch {
      return null;
    }
  })();

  const primary =
    asTrimmed(body?.开场白全文) ||
    asTrimmed(body?.["输出.开场白"]) ||
    (typeof fragment?.正文 === "string" ? asTrimmed(fragment.正文) : undefined);

  const fromList = collectCandidateTexts(body?.开场白候选);
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (text: string | undefined) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    candidates.push(text);
  };
  push(primary);
  for (const t of fromList) push(t);
  if (candidates.length === 0) return null;

  const max = candidates.length - 1;
  const idx = Number.isFinite(selectedIndex)
    ? Math.min(max, Math.max(0, Math.trunc(selectedIndex)))
    : 0;

  return {
    candidates,
    selectedIndex: idx,
    selectedText: candidates[idx] ?? candidates[0]!,
    variables: collectVariables(body?.开场变量),
  };
}

export function openingVariablesToTableDoc(
  variables: readonly OpeningVariable[],
  source = "worker:opening-setup",
): TableDoc {
  const now = new Date().toISOString();
  return {
    rows: variables.map((v) => ({
      key: v.name,
      value: v.value,
      rev: 1,
      updatedAt: now,
      source,
      visibility: "visible" as const,
      ...(v.note ? { note: v.note } : {}),
    })),
  };
}

export function mergeOpeningTablePatch(
  currentRaw: string | null | undefined,
  variables: readonly OpeningVariable[],
  source = "worker:opening-setup",
): string | null {
  if (!variables.length) return null;
  const patch = openingVariablesToTableDoc(variables, source);
  const current = parseTableDoc(currentRaw);
  if (!current) return stringifyTableDoc(patch);
  const byKey = new Map(current.rows.map((r) => [r.key, r]));
  const now = new Date().toISOString();
  for (const row of patch.rows) {
    const prev = byKey.get(row.key);
    if (prev && String(prev.source).startsWith("user")) continue;
    byKey.set(row.key, {
      ...row,
      rev: (prev?.rev ?? 0) + 1,
      updatedAt: now,
    });
  }
  return stringifyTableDoc({ rows: [...byKey.values()] });
}

export function closeCreationFlowRaw(raw: string | null | undefined): string | null {
  const flow = parseCreationFlow(raw);
  if (!flow) return raw?.trim() ? raw : null;
  if (flow.status === "closed") return stringifyCreationFlow(flow);
  return stringifyCreationFlow({ ...flow, status: "closed" });
}
