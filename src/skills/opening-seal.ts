/**
 * 开场白终节点：选定后落库开场。不关 DAG；产物靠用户「保存」拆出。
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
import {
  isPresentLikeObject,
  normalizePresentPacket,
  stringifyPresentPacket,
} from "./present-packet.js";

export const OPENING_SETUP_ARTIFACT_TAG = "设计.开场白与开场变量";
/** 对话落盘开场正文族（可 设计.开场白#槽位 增殖） */
export const OPENING_PRODUCT_FAMILY = "设计.开场白";
export const OPENING_OUTPUT_TAG = "输出.开场白";
export const OPENING_INITIAL_VARS_TAG = "运行.初始变量";
export const OPENING_CURRENT_VARS_TAG = "变量.当前";
/** 本条开场自带的用户角色预设（名字+简介），不进全局列表 */
export const OPENING_PERSONA_TAG = "运行.开场用户角色";
/** opening = 本局用开场预设；global = 保持当前用户角色 */
export const OPENING_PERSONA_CHOICE_TAG = "运行.开场用户角色.选用";

export const SLOT_CREATION_SEALED_BY_OPENING = "creationSealedByOpening";
export const SLOT_OPENING_SELECTED_INDEX = "openingSelectedIndex";

export const CREATION_SEALED_WAITING_MESSAGE =
  "开场已选定。可保存为产物后开玩，或继续补节点。";

export const INSTANCE_OPENING_SNAPSHOT_LABEL = "定稿";

export function isOpeningLockTag(tag: string): boolean {
  const t = tag.trim();
  return t === OPENING_OUTPUT_TAG || t === OPENING_INITIAL_VARS_TAG;
}

/** 收口步 id / name（含「开场白与开场变量#2」） */
export function isCloserStepRef(id: string | undefined): boolean {
  const t = (id ?? "").trim();
  if (!t) return false;
  return (
    t === "开场白与开场变量" ||
    t.startsWith("开场白与开场变量#") ||
    t === "开场白"
  );
}

export function isOpeningSealArtifact(artifact: {
  workerId?: string;
  stepId?: string;
  outputTags?: readonly string[];
}): boolean {
  if ((artifact.workerId ?? "").trim() === "opening-generator") return true;
  if ((artifact.outputTags ?? []).includes(OPENING_SETUP_ARTIFACT_TAG)) return true;
  return isCloserStepRef(artifact.stepId);
}

export type OpeningVariable = {
  name: string;
  value: unknown;
  note?: string;
};

export type OpeningUserPersona = {
  name: string;
  description: string;
};

export type OpeningSealPayload = {
  candidates: string[];
  selectedIndex: number;
  selectedText: string;
  variables: OpeningVariable[];
  persona: OpeningUserPersona | null;
};

function asTrimmed(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

type OpeningCandidateEntry = {
  text: string;
  persona: OpeningUserPersona | null;
  variables: OpeningVariable[];
};

function asOpeningBodyText(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return undefined;
    if (t.startsWith("{")) {
      try {
        const doc = JSON.parse(t) as unknown;
        if (
          isPresentLikeObject(doc) ||
          (doc &&
            typeof doc === "object" &&
            !Array.isArray(doc) &&
            (doc as Record<string, unknown>).blocks != null)
        ) {
          return stringifyPresentPacket(
            normalizePresentPacket(doc as Record<string, unknown>),
          );
        }
      } catch {
        /* 散文 */
      }
    }
    return t;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  if (
    isPresentLikeObject(row) ||
    row.blocks != null ||
    typeof row.shell === "string" ||
    typeof row.shell_id === "string"
  ) {
    return stringifyPresentPacket(normalizePresentPacket(row));
  }
  return undefined;
}

function variablesFromCandidate(row: Record<string, unknown>): OpeningVariable[] {
  const fromRow = collectVariables(row.开场变量);
  if (fromRow.length) return fromRow;
  const meta = row.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return collectVariables((meta as Record<string, unknown>).开场变量);
  }
  return [];
}

function collectCandidateEntries(raw: unknown): OpeningCandidateEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: OpeningCandidateEntry[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      const split = splitYamlFrontmatter(item);
      out.push({
        text: asOpeningBodyText(split.text) || split.text,
        persona: split.persona,
        variables: [],
      });
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const row = item as Record<string, unknown>;
      const text =
        asOpeningBodyText(row.正文) ||
        asOpeningBodyText(row.全文) ||
        asOpeningBodyText(row.text) ||
        asOpeningBodyText(row.开场白) ||
        asOpeningBodyText(row.内容);
      if (!text) continue;
      const split = splitYamlFrontmatter(text);
      const persona =
        parseUserPersonaField(row.用户角色) ||
        parseUserPersonaField(row.meta) ||
        parseUserPersonaField(
          row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
            ? (row.meta as Record<string, unknown>).用户角色
            : undefined,
        ) ||
        split.persona;
      out.push({
        text: asOpeningBodyText(split.text) || split.text,
        persona,
        variables: variablesFromCandidate(row),
      });
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

export function parseUserPersonaField(raw: unknown): OpeningUserPersona | null {
  if (!raw) return null;
  if (typeof raw === "string") return parseOpeningUserPersona(raw);
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const nested = row.用户角色;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const fromNested = parseUserPersonaField(nested);
    if (fromNested) return fromNested;
  }
  const name =
    asTrimmed(row.名字) || asTrimmed(row.name) || asTrimmed(row.姓名) || "";
  if (!name || name === "@玩家" || name === "用户" || name === "主角") return null;
  const description =
    asTrimmed(row.简介) ||
    asTrimmed(row.description) ||
    asTrimmed(row.人设) ||
    asTrimmed(row.描述) ||
    "";
  return { name, description };
}

/** 去掉文首用户角色 meta 行（含无 --- 篱笆的旧稿），避免 meta 进开场正文。 */
export function stripLeadingPersonaMeta(raw: string): string {
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  let saw = false;
  let inUserRoleBlock = false;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      if (saw) {
        i++;
        continue;
      }
      break;
    }
    if (/^---+$/.test(trimmed) && saw) {
      i++;
      break;
    }
    if (/^用户角色\s*:\s*$/.test(trimmed)) {
      saw = true;
      inUserRoleBlock = true;
      i++;
      continue;
    }
    if (
      inUserRoleBlock &&
      /^\s+(?:名字|简介|name|description|人设|描述)\s*[：:]/.test(line)
    ) {
      i++;
      continue;
    }
    inUserRoleBlock = false;
    if (/^(?:用户角色\.)?(?:名字|简介)[：:]/.test(trimmed)) {
      saw = true;
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n").trim();
}

function splitYamlFrontmatter(raw: string): {
  text: string;
  persona: OpeningUserPersona | null;
} {
  const text = raw.trim();
  const fence = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fence) {
    const persona = parseOpeningUserPersona(text);
    if (!persona) return { text, persona: null };
    const stripped = stripLeadingPersonaMeta(text);
    // 能认出文首 meta 才剥；正文里偶然出现「名字：」不剥
    if (stripped !== text.trim()) return { text: stripped, persona };
    if (/^(?:用户角色\.|用户角色\s*:)/m.test(text)) {
      return { text: stripped, persona };
    }
    return { text, persona };
  }
  const persona =
    parseUserPersonaField(parseSimpleYamlMap(fence[1] ?? "")) ||
    parseOpeningUserPersona(fence[1] ?? "");
  return { text: (fence[2] ?? "").trim(), persona };
}

/** 开场正文与用户角色 meta 分离；meta 不应进「系统 开场白」。 */
export function splitOpeningDocument(raw: string | null | undefined): {
  text: string;
  persona: OpeningUserPersona | null;
} {
  const text = raw?.trim() ?? "";
  if (!text) return { text: "", persona: null };
  const payload = parseOpeningSealPayload(text, 0);
  if (payload?.selectedText) {
    return { text: payload.selectedText, persona: payload.persona };
  }
  return splitYamlFrontmatter(text);
}

function parseSimpleYamlMap(raw: string): Record<string, unknown> {
  const lines = raw.split(/\r?\n/);
  const root: Record<string, unknown> = {};
  let currentKey = "";
  let currentObj: Record<string, string> | null = null;
  for (const line of lines) {
    const nested = line.match(/^[ \t]+([^\s:]+)\s*:\s*(.*)$/);
    if (nested && currentObj) {
      currentObj[nested[1]] = nested[2].trim();
      continue;
    }
    const top = line.match(/^([^\s:]+)\s*:\s*(.*)$/);
    if (!top) continue;
    const key = top[1];
    const val = top[2].trim();
    if (val === "" || val === "|" || val === ">") {
      currentKey = key;
      currentObj = {};
      root[key] = currentObj;
      continue;
    }
    currentKey = "";
    currentObj = null;
    root[key] = val;
  }
  void currentKey;
  return root;
}

export function parseOpeningUserPersona(
  raw: string | null | undefined,
): OpeningUserPersona | null {
  const text = raw?.trim() ?? "";
  if (!text) return null;
  try {
    const doc = JSON.parse(text) as unknown;
    const fromJson =
      parseUserPersonaField(doc) ||
      parseUserPersonaField(
        doc && typeof doc === "object" && !Array.isArray(doc)
          ? (doc as Record<string, unknown>).用户角色
          : undefined,
      );
    if (fromJson) return fromJson;
  } catch {
    /* not json */
  }
  const name =
    text.match(/(?:用户角色\.)?名字[：:]\s*([^\n]+)/)?.[1]?.trim() ||
    text.match(/^名字[：:]\s*([^\n]+)/m)?.[1]?.trim() ||
    "";
  if (!name || name === "@玩家" || name === "用户" || name === "主角") return null;
  const description =
    text.match(/(?:用户角色\.)?简介[：:]\s*([^\n]+)/)?.[1]?.trim() ||
    text.match(/^简介[：:]\s*([^\n]+)/m)?.[1]?.trim() ||
    "";
  return { name, description };
}

export function serializeOpeningPersona(persona: OpeningUserPersona): string {
  return JSON.stringify(
    { 名字: persona.name, 简介: persona.description },
    null,
    2,
  );
}

export function readSealedOpeningPersona(
  raw: string | null | undefined,
): OpeningUserPersona | null {
  return parseUserPersonaField(raw) || parseOpeningUserPersona(raw);
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
    asOpeningBodyText(body?.开场白全文) ||
    asOpeningBodyText(body?.["输出.开场白"]) ||
    (typeof fragment?.正文 === "string"
      ? asOpeningBodyText(fragment.正文)
      : undefined);

  const defaultPersona = parseUserPersonaField(body?.用户角色);
  const sharedVariables = collectVariables(body?.开场变量);
  const fromList = collectCandidateEntries(body?.开场白候选);
  const candidates: string[] = [];
  const personas: Array<OpeningUserPersona | null> = [];
  const variableSets: OpeningVariable[][] = [];
  const seen = new Set<string>();
  const push = (
    text: string | undefined,
    persona: OpeningUserPersona | null,
    variables: OpeningVariable[],
  ) => {
    if (!text) return;
    if (seen.has(text)) {
      const i = candidates.indexOf(text);
      if (i >= 0) {
        if (persona && !personas[i]) personas[i] = persona;
        if (variables.length && !variableSets[i]?.length) {
          variableSets[i] = variables;
        }
      }
      return;
    }
    seen.add(text);
    candidates.push(text);
    personas.push(persona);
    variableSets.push(variables);
  };
  push(primary, defaultPersona, sharedVariables);
  for (const row of fromList) {
    push(row.text, row.persona || defaultPersona, row.variables);
  }
  if (candidates.length === 0) return null;

  const max = candidates.length - 1;
  const idx = Number.isFinite(selectedIndex)
    ? Math.min(max, Math.max(0, Math.trunc(selectedIndex)))
    : 0;
  const selectedVars = variableSets[idx] ?? [];

  return {
    candidates,
    selectedIndex: idx,
    selectedText: candidates[idx] ?? candidates[0]!,
    variables: selectedVars.length ? selectedVars : sharedVariables,
    persona: personas[idx] ?? defaultPersona,
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

/** 再编排：收口前补节点时把 DAG 改回 open。 */
export function reopenCreationFlowRaw(raw: string | null | undefined): string | null {
  const flow = parseCreationFlow(raw);
  if (!flow) return raw?.trim() ? raw : null;
  if (flow.status !== "closed") return stringifyCreationFlow(flow);
  return stringifyCreationFlow({ ...flow, status: "open" });
}
