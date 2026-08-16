/**
 * 创作单位：与 run worker 调度正交。
 *
 * 两大族（同级）：
 * - worker：独立 LLM 工序
 * - fixed：已写入规格的固定上下文（不上 worker ≠ 不重要）
 *
 * FIXED_CONTEXT_CATALOG = 给 design 的「可向用户询问的示例话题」提示目录，
 * 不是填空表；默认 listCreationUnits 只列出**已有内容**的固定块。
 *
 * 见 docs/design-orchestrator-guide.md §6、§7.2
 */
import type { ParsedWorkerSet } from "./worker-set-parse.js";
import { parseResidentContext } from "./resident-context.js";

export const WORKER_SET_FINAL_TAG = "设计.worker集";
export const WORKER_SET_DRAFT_TAG = "设计.worker集.草稿";
export const CREATION_CURRENT_UNIT_TAG = "创作.当前单位";
export const CREATION_ACCEPTED_UNITS_TAG = "创作.已验收单位";
/** 各单位最后一次验收时的内容切片（JSON store → 拼装时格式化为前情提要） */
export const CREATION_ACCEPTED_CONTENT_TAG = "创作.已验收内容";

export const SLOT_CREATION_CURRENT_UNIT = "creationCurrentUnitId";
export const SLOT_CREATION_ACCEPTED_UNITS = "creationAcceptedUnits";
export const SLOT_CREATION_UNIT_ANCHOR_AT = "creationUnitAnchorAt";

/** 创作阶段磁盘 skill（新流程：编排 + 按步执行） */
export const DESIGN_DISK_WORKERS = [
  "design-flow",
  "design-step",
] as const;

export type DesignDiskWorkerId = (typeof DESIGN_DISK_WORKERS)[number];

/** @deprecated 旧分步 skill；已废弃，仅兼容读旧会话 */
const LEGACY_DESIGN_DISK_WORKERS = [
  "design-core",
  "design-worker",
  "design-fixed",
  "design-refine",
  "design-intake",
] as const;

/** 含历史 id，便于读旧会话 */
export function isDesignDiskWorker(workerId: string): boolean {
  const id = workerId.trim();
  return (
    (DESIGN_DISK_WORKERS as readonly string[]).includes(
      id as (typeof DESIGN_DISK_WORKERS)[number],
    ) ||
    (LEGACY_DESIGN_DISK_WORKERS as readonly string[]).includes(
      id as (typeof LEGACY_DESIGN_DISK_WORKERS)[number],
    )
  );
}

/** 新流程不再注入 design-common.md */
export function usesDesignCommon(_workerId: string): boolean {
  return false;
}

/** worker = 工序；fixed = 固定上下文；phase = A/C 阶段单位 */
export type CreationUnitKind = "worker" | "fixed" | "phase";

/**
 * 固定上下文示例话题 → 规格落点（提示用，不是必填问卷）。
 * 仅当草稿里已有对应内容时，才作为创作单位列出（除非显式 includeCatalogFixed）。
 */
export type FixedContextFlavor =
  | "interaction"
  | "narrative_guide"
  | "aesthetics"
  | "input_protocol"
  | "core_premises"
  | "resident";

export type CreationUnitView = {
  id: string;
  kind: CreationUnitKind;
  label: string;
  /** 固定上下文族内的细分；worker / phase 无此字段 */
  flavor?: FixedContextFlavor;
  /** 规格里是否已有实质内容 */
  filled: boolean;
  /** session 是否已验收本单位 */
  accepted?: boolean;
  /** 是否为当前正在谈的单位 */
  current?: boolean;
  /**
   * 创作时是否应优先谈清（纲领/范式类默认真）。
   * 杂项 resident 可为 false，但不代表可忽略——由体验决定。
   */
  weighty?: boolean;
  detail?: string;
};

/** 示例话题目录：告诉 design 可以问用户类似内容；非 UI 填空项 */
export const FIXED_CONTEXT_CATALOG: Array<{
  id: string;
  flavor: FixedContextFlavor;
  label: string;
  weighty: boolean;
  hint: string;
}> = [
  {
    id: "fixed:interaction",
    flavor: "interaction",
    label: "交互范式",
    weighty: true,
    hint: "站位、系统扮演、输出形态、与用户怎么轮转（旧称交互骨架；现多由 phase:core 收）",
  },
  {
    id: "fixed:narrative_guide",
    flavor: "narrative_guide",
    label: "叙事指南与故事推进",
    weighty: true,
    hint: "世界态度与体验边界（残酷/不有求必应/随机危险等）；≠ 文风",
  },
  {
    id: "fixed:aesthetics",
    flavor: "aesthetics",
    label: "美学纲领",
    weighty: true,
    hint: "可读终稿的呈现气质；转述 presentation 或常驻美学块",
  },
  {
    id: "fixed:input_protocol",
    flavor: "input_protocol",
    label: "输入协议",
    weighty: true,
    hint: "() 元要求、\"\" 对白、无包裹=事实等",
  },
  {
    id: "fixed:core_premises",
    flavor: "core_premises",
    label: "核心实现前提",
    weighty: true,
    hint: "不能瞎发挥又关键的硬前提",
  },
];

/** @deprecated 旧 id；读进度时兼容 */
const LEGACY_UNIT_ALIASES: Record<string, string> = {
  "skeleton:interaction": "fixed:interaction",
  "fixed:interaction": "phase:core",
};

export function normalizeCreationUnitId(id: string): string {
  let cur = id;
  const seen = new Set<string>();
  while (LEGACY_UNIT_ALIASES[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = LEGACY_UNIT_ALIASES[cur]!;
  }
  return cur;
}

/** 验收判定：旧 fixed:interaction 与 phase:core 互通 */
function unitIdMatches(candidate: string, target: string): boolean {
  const a = normalizeCreationUnitId(candidate);
  const b = normalizeCreationUnitId(target);
  if (a === b) return true;
  // 双向：未规范化的旧 id 也要对上
  if (
    (candidate === "fixed:interaction" || candidate === "phase:core") &&
    (target === "fixed:interaction" || target === "phase:core")
  ) {
    return true;
  }
  return false;
}

function workerLabel(
  ref: string | null,
  name?: string,
  role?: string,
  duty?: string,
): string {
  if (name?.trim()) return name.trim();
  // role 若是 taxonomy（core/auxiliary…）不当作展示名
  const roleTrim = role?.trim();
  if (roleTrim && !/^(core|auxiliary|transcription)$/i.test(roleTrim)) {
    return roleTrim;
  }
  if (ref?.trim()) return ref.trim();
  if (duty?.trim()) return duty.trim().slice(0, 40);
  return "（未命名 worker）";
}

function workerFilled(entry: {
  ref: string | null;
  duty?: string;
  rationale?: string;
  gap?: string | null;
}): boolean {
  if (entry.gap) return false;
  return Boolean(entry.ref?.trim() && (entry.duty?.trim() || entry.rationale?.trim()));
}

function interactionFilled(parsed: ParsedWorkerSet): boolean {
  const i = parsed.interaction;
  if (!i) return false;
  return Boolean(
    String(i.user_stance ?? "").trim() &&
      String(i.system_role ?? "").trim() &&
      String(i.output ?? "").trim(),
  );
}

function experienceCheckFilled(parsed: ParsedWorkerSet): boolean {
  const e = parsed.experience_check;
  if (!e || typeof e !== "object") return false;
  return Object.values(e).some((v) => typeof v === "string" && v.trim());
}

function corePhaseFilled(parsed: ParsedWorkerSet): boolean {
  return interactionFilled(parsed) || experienceCheckFilled(parsed);
}

function refinePhaseFilled(parsed: ParsedWorkerSet): boolean {
  const tables = parsed.tables;
  if (!tables || typeof tables !== "object") return false;
  const schemas = (tables as { schemas?: unknown }).schemas;
  const effects = (tables as { side_effects?: unknown }).side_effects;
  return (
    (Array.isArray(schemas) && schemas.length > 0) ||
    (Array.isArray(effects) && effects.length > 0)
  );
}

function textFilled(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function aestheticsFilled(parsed: ParsedWorkerSet): boolean {
  for (const w of parsed.workers) {
    const p = w.presentation;
    if (!p || typeof p !== "object") continue;
    if (Object.values(p).some((x) => (typeof x === "string" ? x.trim() : x != null))) {
      return true;
    }
  }
  // 仅显式美学 id，不把普通 tone/文风常驻当成「美学纲领」填空项
  const residents = parseResidentContext(parsed.resident_context);
  return residents.some((r) => /^(美学|aesthetics|presentation)$/i.test(r.id));
}

function inputProtocolFilled(parsed: ParsedWorkerSet): boolean {
  const p = parsed.input_protocol;
  if (!p || typeof p !== "object") return false;
  return Object.values(p).some((v) => typeof v === "string" && v.trim());
}

function corePremisesFilled(parsed: ParsedWorkerSet): boolean {
  return (parsed.core_premises?.length ?? 0) > 0;
}

function fixedFilled(flavor: FixedContextFlavor, parsed: ParsedWorkerSet): boolean {
  switch (flavor) {
    case "interaction":
      return interactionFilled(parsed);
    case "narrative_guide":
      return textFilled(parsed.narrative_guide);
    case "aesthetics":
      return aestheticsFilled(parsed);
    case "input_protocol":
      return inputProtocolFilled(parsed);
    case "core_premises":
      return corePremisesFilled(parsed);
    default:
      return false;
  }
}

function annotate(
  unit: CreationUnitView,
  accepted: Set<string>,
  current: string | null,
): CreationUnitView {
  const acceptedHit = [...accepted].some((id) => unitIdMatches(id, unit.id));
  const currentHit =
    current != null &&
    (unitIdMatches(current, unit.id) || current === unit.id);
  return {
    ...unit,
    accepted: acceptedHit,
    current: currentHit,
  };
}

export type ListCreationUnitsOptions = {
  acceptedUnitIds?: string[];
  currentUnitId?: string | null;
  /**
   * true：列出全部示例话题（调试用）。
   * 默认 false：只列草稿里**已有内容**的固定块 + workers + resident——避免当成填空表。
   */
  includeCatalogFixed?: boolean;
};

/**
 * 列出创作单位：已写出的固定上下文 + workers + resident（同级）。
 * 空的示例话题默认不出现在列表里。
 */
export function listCreationUnits(
  parsed: ParsedWorkerSet | null | undefined,
  options: ListCreationUnitsOptions = {},
): CreationUnitView[] {
  if (!parsed) return [];
  const accepted = new Set(
    (options.acceptedUnitIds ?? []).map(normalizeCreationUnitId),
  );
  const currentRaw = options.currentUnitId?.trim() || null;
  const current = currentRaw ? normalizeCreationUnitId(currentRaw) : null;
  const includeCatalog = options.includeCatalogFixed === true;
  const units: CreationUnitView[] = [];

  const coreFilled = corePhaseFilled(parsed);
  if (includeCatalog || coreFilled) {
    units.push(
      annotate(
        {
          id: "phase:core",
          kind: "phase",
          label: "A · 核心",
          filled: coreFilled,
          weighty: true,
          detail: "站位 / 系统扮演 / 体验骨架",
        },
        accepted,
        current,
      ),
    );
  }

  for (const cat of FIXED_CONTEXT_CATALOG) {
    // interaction 已并入 phase:core，避免重复列出
    if (cat.id === "fixed:interaction") continue;
    const filled = fixedFilled(cat.flavor, parsed);
    if (!includeCatalog && !filled) continue;
    units.push(
      annotate(
        {
          id: cat.id,
          kind: "fixed",
          flavor: cat.flavor,
          label: cat.label,
          filled,
          weighty: cat.weighty,
          detail: cat.hint,
        },
        accepted,
        current,
      ),
    );
  }

  for (let i = 0; i < parsed.workers.length; i++) {
    const w = parsed.workers[i]!;
    const ref = w.ref?.trim() || null;
    const id = ref ? `worker:${ref}` : `worker:#${i + 1}`;
    units.push(
      annotate(
        {
          id,
          kind: "worker",
          label: workerLabel(ref, w.name, w.role, w.duty),
          filled: workerFilled(w),
          weighty: true,
          detail: w.duty?.trim() || w.rationale?.trim(),
        },
        accepted,
        current,
      ),
    );
  }

  const residents = parseResidentContext(parsed.resident_context);
  for (const r of residents) {
    // 已由 aesthetics 启发式覆盖的 tone 类仍单独列出（挂载/正文可单独验收）
    const id = `resident:${r.id}`;
    units.push(
      annotate(
        {
          id,
          kind: "fixed",
          flavor: "resident",
          label: r.id,
          filled: Boolean(r.content.trim()),
          weighty: false,
          detail: r.content.trim().slice(0, 80),
        },
        accepted,
        current,
      ),
    );
  }

  const refineFilled = refinePhaseFilled(parsed);
  if (includeCatalog || refineFilled) {
    units.push(
      annotate(
        {
          id: "phase:refine",
          kind: "phase",
          label: "C · 细化",
          filled: refineFilled,
          weighty: true,
          detail: "表 / 副作用 / 数据拓扑",
        },
        accepted,
        current,
      ),
    );
  }

  return units;
}

/**
 * 下一个未验收单位（软启发，非硬闸）：
 * 核心 → 已开写的固定块 → 纲领类固定上下文 → worker → 其余 → 细化
 *
 * 固定上下文先于 worker：便于同一份风格/叙事/美学挂到多个 worker，
 * 避免「先写完 worker 再逐个填上下文」。
 * 已开写的 fixed/phase 仍优先续完（filled pending）。
 */
export function nextCreationUnitId(
  parsed: ParsedWorkerSet | null | undefined,
  acceptedUnitIds: string[] = [],
): string | null {
  if (!parsed) return "phase:core";
  const units = listCreationUnits(parsed, {
    acceptedUnitIds,
    includeCatalogFixed: true,
  });
  const core = units.find((u) => u.id === "phase:core");
  if (core && !core.accepted) return "phase:core";

  const filledFixedPending = units.find(
    (u) =>
      (u.kind === "fixed" || u.kind === "phase") &&
      u.id !== "phase:core" &&
      !u.accepted &&
      u.filled,
  );
  if (filledFixedPending) return filledFixedPending.id;

  const foundationFixed = units.find(
    (u) => u.kind === "fixed" && u.weighty && !u.accepted,
  );
  if (foundationFixed) return foundationFixed.id;

  const filledWorkerPending = units.find(
    (u) => u.kind === "worker" && !u.accepted && u.filled,
  );
  if (filledWorkerPending) return filledWorkerPending.id;

  const worker = units.find((u) => u.kind === "worker" && !u.accepted);
  if (worker) return worker.id;

  const otherFixed = units.find(
    (u) => u.kind === "fixed" && !u.weighty && !u.accepted,
  );
  if (otherFixed) return otherFixed.id;

  const refine = units.find((u) => u.id === "phase:refine");
  if (refine && !refine.accepted) return "phase:refine";

  return null;
}

export function parseAcceptedUnits(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean).map(normalizeCreationUnitId);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const doc = JSON.parse(raw) as unknown;
      if (Array.isArray(doc)) {
        return doc.map((x) => String(x).trim()).filter(Boolean).map(normalizeCreationUnitId);
      }
    } catch {
      return raw
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(normalizeCreationUnitId);
    }
  }
  return [];
}

/** 给人 / 编排 LLM 看的已验收步骤清单；去掉「flow」（那是计划本身，不是某一步）。 */
export function formatAcceptedUnitsForPrompt(raw: unknown): string {
  const ids = parseAcceptedUnits(raw).filter((id) => id && id !== "flow");
  if (ids.length === 0) return "（尚无已验收步骤）";
  return ids.map((id) => `- ${id}`).join("\n");
}

export function isFinalWorkerSetArtifact(artifact: {
  workerId: string;
  outputTags: string[];
}): boolean {
  return artifact.outputTags.includes(WORKER_SET_FINAL_TAG);
}

/** 创作磁盘 skill 产出但尚未写终稿 tag → 单位验收 */
export function isDesignUnitArtifact(artifact: {
  workerId: string;
  outputTags: string[];
}): boolean {
  return (
    isDesignDiskWorker(artifact.workerId) && !isFinalWorkerSetArtifact(artifact)
  );
}

/** 总管选 skill：有流程待执行 → design-step；否则 design-flow */
export function designWorkerForUnit(unitId: string | null | undefined): DesignDiskWorkerId {
  const id = (unitId ?? "").trim();
  if (id === "flow" || !id) return "design-flow";
  return "design-step";
}

export type AcceptedUnitContentEntry = {
  unitId: string;
  acceptedAt: string;
  summary?: string;
  /** 该单位验收时的内容切片 */
  content: unknown;
};

export type AcceptedContentStore = {
  version: 1;
  units: Record<string, AcceptedUnitContentEntry>;
};

export function parseAcceptedContentStore(raw: unknown): AcceptedContentStore {
  if (typeof raw === "string" && raw.trim()) {
    try {
      return parseAcceptedContentStore(JSON.parse(raw) as unknown);
    } catch {
      return { version: 1, units: {} };
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { version: 1, units: {} };
  }
  const row = raw as Record<string, unknown>;
  const unitsRaw = row.units;
  const units: Record<string, AcceptedUnitContentEntry> = {};
  if (unitsRaw && typeof unitsRaw === "object" && !Array.isArray(unitsRaw)) {
    for (const [k, v] of Object.entries(unitsRaw as Record<string, unknown>)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const e = v as Record<string, unknown>;
      const unitId = normalizeCreationUnitId(
        typeof e.unitId === "string" ? e.unitId : k,
      );
      units[unitId] = {
        unitId,
        acceptedAt:
          typeof e.acceptedAt === "string" ? e.acceptedAt : new Date().toISOString(),
        summary: typeof e.summary === "string" ? e.summary : undefined,
        content: e.content,
      };
    }
  }
  return { version: 1, units };
}

/** 从草稿抽出某一创作单位在验收时的内容 */
export function extractUnitContentFromDraft(
  parsed: ParsedWorkerSet | null | undefined,
  unitId: string,
): unknown | null {
  if (!parsed) return null;
  const id = normalizeCreationUnitId(unitId.trim());
  if (!id) return null;

  if (id === "phase:core") {
    const slice: Record<string, unknown> = {};
    if (parsed.interaction) slice.interaction = parsed.interaction;
    if (parsed.experience_check) slice.experience_check = parsed.experience_check;
    return Object.keys(slice).length ? slice : null;
  }
  if (id === "phase:refine") {
    return parsed.tables ? { tables: parsed.tables } : null;
  }
  if (id.startsWith("worker:")) {
    const ref = id.slice("worker:".length);
    const entry = parsed.workers.find((w) => (w.ref?.trim() || "") === ref);
    return entry ?? null;
  }
  if (id === "fixed:narrative_guide") {
    return textFilled(parsed.narrative_guide)
      ? { narrative_guide: parsed.narrative_guide }
      : null;
  }
  if (id === "fixed:input_protocol") {
    return parsed.input_protocol ? { input_protocol: parsed.input_protocol } : null;
  }
  if (id === "fixed:core_premises") {
    return (parsed.core_premises?.length ?? 0) > 0
      ? { core_premises: parsed.core_premises }
      : null;
  }
  if (id === "fixed:aesthetics") {
    const presentations = parsed.workers
      .filter((w) => w.presentation)
      .map((w) => ({ ref: w.ref, presentation: w.presentation }));
    return presentations.length ? { presentations } : null;
  }
  if (id === "fixed:interaction") {
    return parsed.interaction ? { interaction: parsed.interaction } : null;
  }
  if (id.startsWith("resident:")) {
    const rid = id.slice("resident:".length);
    const residents = parseResidentContext(parsed.resident_context);
    const hit = residents.find((r) => r.id === rid);
    return hit ?? null;
  }
  return null;
}

/** 写入/覆盖某一单位的最后验收内容 */
export function upsertAcceptedUnitContent(
  existingRaw: unknown,
  entry: {
    unitId: string;
    content: unknown;
    summary?: string;
    acceptedAt?: string;
  },
): string {
  const store = parseAcceptedContentStore(existingRaw);
  const unitId = normalizeCreationUnitId(entry.unitId);
  store.units[unitId] = {
    unitId,
    acceptedAt: entry.acceptedAt ?? new Date().toISOString(),
    summary: entry.summary,
    content: entry.content,
  };
  return JSON.stringify(store, null, 2);
}

/** 前情提要：把已验收单位内容格式化为只读 Markdown */
export function formatAcceptedContentForPrompt(raw: unknown): string {
  const store = parseAcceptedContentStore(raw);
  const entries = Object.values(store.units).sort((a, b) =>
    a.acceptedAt.localeCompare(b.acceptedAt),
  );
  if (entries.length === 0) {
    return "（尚无已验收单位）";
  }
  return entries
    .map((e) => {
      const head = `### ${e.unitId}${e.summary ? ` · ${e.summary}` : ""}`;
      const meta = `验收于 ${e.acceptedAt} · **只读，勿擅自改写**`;
      const body =
        typeof e.content === "string"
          ? e.content
          : JSON.stringify(e.content ?? null, null, 2);
      return `${head}\n${meta}\n\n\`\`\`json\n${body}\n\`\`\``;
    })
    .join("\n\n");
}

/**
 * 完整 Worker 集是否可交终稿。
 * 具名 weighty 固定单位：已填的必须已验收；至少 1 个 filled worker 已验收。
 */
export function isWorkerSetReadyForFinal(
  parsed: ParsedWorkerSet | null | undefined,
  acceptedUnitIds: string[],
): { ready: boolean; missing: string[] } {
  if (!parsed) return { ready: false, missing: ["（无草稿）"] };
  const accepted = acceptedUnitIds.map(normalizeCreationUnitId);
  const units = listCreationUnits(parsed, { acceptedUnitIds: accepted });
  const missing = units
    .filter((u) => u.weighty && u.filled && !u.accepted)
    .map((u) => u.id);
  const acceptedWorkers = units.filter(
    (u) => u.kind === "worker" && u.accepted && u.filled,
  );
  const interaction = units.find((u) => u.id === "fixed:interaction");
  const core = units.find((u) => u.id === "phase:core");
  if (core && core.filled && !core.accepted) {
    return { ready: false, missing: missing.length ? missing : [core.id] };
  }
  if (interaction && !interaction.accepted && interaction.filled) {
    return { ready: false, missing: missing.length ? missing : [interaction.id] };
  }
  if (acceptedWorkers.length === 0) {
    return {
      ready: false,
      missing: missing.length ? missing : ["（至少一个 worker 单位）"],
    };
  }
  if (missing.length) return { ready: false, missing };
  return { ready: true, missing: [] };
}
