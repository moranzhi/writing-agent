/**
 * 固定游玩槽位：世界模拟路径不再自由发明 workers[]，
 * 以勾选 auditor / gm / narrator / perspective 展开为声明条目。
 * `chance` 为按需程序槽：不进每轮管线，可被 run_worker / toolcall 调用。
 */
import type { WorkerAcceptance, WorkerSetEntry } from "./worker-set-parse.js";

export type PlaySlotId = "auditor" | "gm" | "narrator" | "perspective";
/** 按需槽（不进入 auditor→perspective→gm→narrator 管线） */
export type OnDemandSlotId = "chance";

export type PlaySlotsConfig = {
  /**
   * 旁观维护（副 LLM：表/规则检查，默认空操作）；默认 true。
   * 每轮可上场，但不等于每轮改表。缺省键视为开启。
   */
  auditor?: boolean;
  /** 主世界层（裁决）；默认 true */
  gm: boolean;
  /** 叙事转述；默认 true */
  narrator: boolean;
  /** 单角色知密视角；默认 false */
  perspective: boolean;
  /**
   * 机遇裁定（程序骰子/抽签/比点）；默认 false。
   * 启用后可按需 run_worker，不自动每轮上场。
   */
  chance?: boolean;
  /** 可选覆盖默认 ref */
  refs?: Partial<Record<PlaySlotId | OnDemandSlotId, string>>;
};

export const DEFAULT_PLAY_SLOT_REFS: Record<PlaySlotId, string> = {
  auditor: "auditor",
  gm: "world-simulator",
  narrator: "narrator",
  perspective: "role-decide",
};

export const DEFAULT_ON_DEMAND_REFS: Record<OnDemandSlotId, string> = {
  chance: "chance",
};

export const PLAY_SLOT_META: Record<
  PlaySlotId,
  { label: string; purpose: string; defaultAcceptance: WorkerAcceptance }
> = {
  auditor: {
    label: "旁观维护",
    purpose:
      "副 LLM：检查表与生成规则是否需补充；默认空操作；不写正文、不写真相权威。",
    defaultAcceptance: "continue",
  },
  gm: {
    label: "主世界层",
    purpose: "读真值与 Progressive 投影，输出结构化裁决包；可提议变量变更。",
    defaultAcceptance: "continue",
  },
  narrator: {
    label: "叙事转述",
    purpose: "只读裁决包 + 文风常驻，输出用户可见正文。",
    defaultAcceptance: "review",
  },
  perspective: {
    label: "角色视角",
    purpose: "强信息隔离时出反应建议；不写真值、不写终稿。",
    defaultAcceptance: "continue",
  },
};

export const ON_DEMAND_SLOT_META: Record<
  OnDemandSlotId,
  { label: string; purpose: string; defaultAcceptance: WorkerAcceptance }
> = {
  chance: {
    label: "机遇裁定",
    purpose:
      "程序工具：掷骰、比点、抽签/加权抽取；按需调用，禁止模型编造随机结果。",
    defaultAcceptance: "continue",
  },
};

/** 推荐回合顺序（启用的槽按此排序；不含按需槽） */
export const PLAY_SLOT_ORDER: PlaySlotId[] = [
  "auditor",
  "perspective",
  "gm",
  "narrator",
];

/** 这些槽的默认上下文不注入「对话.历史」长聊 */
export const PLAY_SLOTS_WITHOUT_DIALOGUE_HISTORY: ReadonlySet<PlaySlotId> =
  new Set(["auditor"]);

export function playSlotIdForRef(ref: string): PlaySlotId | undefined {
  const trimmed = ref.trim();
  for (const id of Object.keys(DEFAULT_PLAY_SLOT_REFS) as PlaySlotId[]) {
    if (DEFAULT_PLAY_SLOT_REFS[id] === trimmed) return id;
  }
  return undefined;
}

export function defaultPlaySlots(): PlaySlotsConfig {
  return {
    auditor: true,
    gm: true,
    narrator: true,
    perspective: false,
    chance: false,
  };
}

export function parsePlaySlots(raw: unknown): PlaySlotsConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const base = defaultPlaySlots();
  if (typeof row.auditor === "boolean") base.auditor = row.auditor;
  // 兼容旧键名 / 别名
  if (typeof row.maintain === "boolean") base.auditor = row.maintain;
  if (typeof row.旁观 === "boolean") base.auditor = row.旁观;
  if (typeof row.gm === "boolean") base.gm = row.gm;
  if (typeof row.narrator === "boolean") base.narrator = row.narrator;
  if (typeof row.perspective === "boolean") base.perspective = row.perspective;
  if (typeof row.chance === "boolean") base.chance = row.chance;
  if (typeof row.world === "boolean") base.gm = row.world;
  if (typeof row.transcription === "boolean") base.narrator = row.transcription;
  if (typeof row.oracle === "boolean") base.chance = row.oracle;
  if (typeof row.rng === "boolean") base.chance = row.rng;

  const refsRaw = row.refs;
  if (refsRaw && typeof refsRaw === "object" && !Array.isArray(refsRaw)) {
    const refs: Partial<Record<PlaySlotId | OnDemandSlotId, string>> = {};
    for (const id of Object.keys(DEFAULT_PLAY_SLOT_REFS) as PlaySlotId[]) {
      const v = (refsRaw as Record<string, unknown>)[id];
      if (typeof v === "string" && v.trim()) refs[id] = v.trim();
    }
    for (const id of Object.keys(DEFAULT_ON_DEMAND_REFS) as OnDemandSlotId[]) {
      const v = (refsRaw as Record<string, unknown>)[id];
      if (typeof v === "string" && v.trim()) refs[id] = v.trim();
    }
    if (Object.keys(refs).length) base.refs = refs;
  }
  return base;
}

export function refForSlot(
  slots: PlaySlotsConfig,
  id: PlaySlotId | OnDemandSlotId,
): string {
  if (id === "chance") {
    return slots.refs?.chance?.trim() || DEFAULT_ON_DEMAND_REFS.chance;
  }
  return slots.refs?.[id]?.trim() || DEFAULT_PLAY_SLOT_REFS[id];
}

export function enabledPlaySlotIds(slots: PlaySlotsConfig): PlaySlotId[] {
  return PLAY_SLOT_ORDER.filter((id) => {
    if (id === "auditor") return slots.auditor !== false;
    return Boolean(slots[id]);
  });
}

export function enabledOnDemandSlotIds(slots: PlaySlotsConfig): OnDemandSlotId[] {
  return slots.chance ? ["chance"] : [];
}

/** 每轮管线 refs（不含按需槽） */
export function refsFromPlaySlots(slots: PlaySlotsConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of enabledPlaySlotIds(slots)) {
    const ref = refForSlot(slots, id);
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }
  return out;
}

/** 按需可调度 refs（可并入 activeWorkerIds，但不进自动回合序） */
export function onDemandRefsFromPlaySlots(slots: PlaySlotsConfig): string[] {
  return enabledOnDemandSlotIds(slots).map((id) => refForSlot(slots, id));
}

export function workerEntryForSlot(
  slots: PlaySlotsConfig,
  id: PlaySlotId,
): WorkerSetEntry {
  const meta = PLAY_SLOT_META[id];
  const ref = refForSlot(slots, id);
  return {
    ref,
    name: meta.label,
    role: id,
    duty: meta.purpose,
    when:
      id === "auditor"
        ? "每轮用户输入后、主世界层之前"
        : id === "perspective"
          ? "强信息隔离且本轮需要该角色独立反应时"
          : id === "gm"
            ? "每轮用户输入后（旁观维护与可选视角之后）"
            : "主世界层裁决包就绪后",
    rationale:
      id === "auditor"
        ? "表与规则补充与主裁决分槽，避免挤占对话历史上下文"
        : id === "perspective"
          ? "知密内容不能进主世界层上下文"
          : id === "gm"
            ? "裁决与真值变更需要独立推理槽"
            : "用户可见正文与裁决分离，避免文风与规则互相挤压",
    acceptance: meta.defaultAcceptance,
    invocation: "turn",
  };
}

export function workerEntryForOnDemandSlot(
  slots: PlaySlotsConfig,
  id: OnDemandSlotId,
): WorkerSetEntry {
  const meta = ON_DEMAND_SLOT_META[id];
  const ref = refForSlot(slots, id);
  return {
    ref,
    name: meta.label,
    role: id,
    duty: meta.purpose,
    when: "需要程序随机、骰子、比点或抽签时由编排器按需调用",
    rationale: "真随机必须由程序给出，不能靠模型编造",
    acceptance: meta.defaultAcceptance,
    invocation: "on_demand",
  };
}

/** 仅由 play_slots 展开 workers（含按需槽条目） */
export function expandPlaySlotsToWorkers(slots: PlaySlotsConfig): WorkerSetEntry[] {
  return [
    ...enabledPlaySlotIds(slots).map((id) => workerEntryForSlot(slots, id)),
    ...enabledOnDemandSlotIds(slots).map((id) =>
      workerEntryForOnDemandSlot(slots, id),
    ),
  ];
}

/**
 * 若声明了 play_slots：用槽位展开补齐/覆盖同 ref 的骨架；
 * 已有 workers 里同 ref 的 context/outputs/name 覆盖保留。
 */
export function mergeWorkersWithPlaySlots(
  existing: WorkerSetEntry[],
  slots: PlaySlotsConfig | undefined,
): WorkerSetEntry[] {
  if (!slots) return existing;
  const expanded = expandPlaySlotsToWorkers(slots);
  if (!existing.length) return expanded;

  const byRef = new Map<string, WorkerSetEntry>();
  for (const w of existing) {
    const ref = w.ref?.trim();
    if (ref) byRef.set(ref, w);
  }

  const merged: WorkerSetEntry[] = expanded.map((slotEntry) => {
    const ref = slotEntry.ref!.trim();
    const prev = byRef.get(ref);
    if (!prev) return slotEntry;
    return {
      ...slotEntry,
      name: prev.name ?? slotEntry.name,
      duty: prev.duty ?? slotEntry.duty,
      when: prev.when ?? slotEntry.when,
      rationale: prev.rationale ?? slotEntry.rationale,
      acceptance: prev.acceptance ?? slotEntry.acceptance,
      invocation: prev.invocation ?? slotEntry.invocation,
      context: prev.context ?? slotEntry.context,
      outputs: prev.outputs ?? slotEntry.outputs,
      presentation: prev.presentation ?? slotEntry.presentation,
      merge_considered: prev.merge_considered ?? slotEntry.merge_considered,
    };
  });

  // 保留不在固定槽内的额外 worker（兼容旧规格 / 扩写路径）
  const slotRefs = new Set(expanded.map((e) => e.ref!.trim()));
  for (const w of existing) {
    const ref = w.ref?.trim();
    if (!ref || slotRefs.has(ref)) continue;
    merged.push(w);
  }
  return merged;
}

export function inferPlaySlotsFromWorkers(
  workers: WorkerSetEntry[],
): PlaySlotsConfig | undefined {
  if (!workers.length) return undefined;
  const refs = new Set(
    workers.map((w) => w.ref?.trim()).filter((r): r is string => Boolean(r)),
  );
  const hasAuditor = refs.has(DEFAULT_PLAY_SLOT_REFS.auditor);
  const hasGm = refs.has(DEFAULT_PLAY_SLOT_REFS.gm);
  const hasNarrator = refs.has(DEFAULT_PLAY_SLOT_REFS.narrator);
  const hasPerspective = refs.has(DEFAULT_PLAY_SLOT_REFS.perspective);
  const hasChance = refs.has(DEFAULT_ON_DEMAND_REFS.chance);
  if (
    !hasAuditor &&
    !hasGm &&
    !hasNarrator &&
    !hasPerspective &&
    !hasChance
  ) {
    return undefined;
  }
  return {
    // 旧规格无 auditor ref → 视为关，避免强行插入
    auditor: hasAuditor,
    gm: hasGm,
    narrator: hasNarrator,
    perspective: hasPerspective,
    chance: hasChance,
  };
}

const AGENT_ID_ALIASES: Record<string, PlaySlotId | OnDemandSlotId> = {
  auditor: "auditor",
  旁观维护: "auditor",
  表格管理: "auditor",
  gm: "gm",
  "world-simulator": "gm",
  主世界层: "gm",
  narrator: "narrator",
  叙事转述: "narrator",
  转述: "narrator",
  perspective: "perspective",
  "role-decide": "perspective",
  角色视角: "perspective",
  chance: "chance",
  机遇裁定: "chance",
};

/** 把模型写的 id / 中文名 / worker ref 收成槽键 */
export function resolvePlayAgentId(
  raw: string,
): PlaySlotId | OnDemandSlotId | undefined {
  const t = raw.trim();
  return AGENT_ID_ALIASES[t] ?? AGENT_ID_ALIASES[t.toLowerCase()];
}

/** 注入投影排序等晚段步骤：名册由程序钉死，模型只抄不发明。 */
export function formatPlayAgentRosterForPrompt(): string {
  const lines = [
    "## 【本局固定执行单元 · 程序钉死】",
    "",
    "禁止增删改名，禁止发明未入白名单的槽（如画图）。先抄名册，再给每个已启用者分配上下文 inserts。",
    "",
    "每轮管线（顺序固定）：",
  ];
  for (const id of PLAY_SLOT_ORDER) {
    const meta = PLAY_SLOT_META[id];
    const def = id === "perspective" ? "默认关" : "默认开";
    lines.push(
      `- \`${id}\` → ref=\`${DEFAULT_PLAY_SLOT_REFS[id]}\` **${meta.label}**（${def}）：${meta.purpose}`,
    );
  }
  lines.push("", "按需（不进每轮；enabled 时可空 inserts）：");
  for (const id of Object.keys(DEFAULT_ON_DEMAND_REFS) as OnDemandSlotId[]) {
    const meta = ON_DEMAND_SLOT_META[id];
    lines.push(
      `- \`${id}\` → ref=\`${DEFAULT_ON_DEMAND_REFS[id]}\` **${meta.label}**（默认关）：${meta.purpose}`,
    );
  }
  return lines.join("\n");
}
