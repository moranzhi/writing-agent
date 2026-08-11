/**
 * 用户可见中文标签（与 docs/ui-glossary.md 同步）。
 * 内部 id 不变；仅展示层映射。
 * 口径：配方 / 编排器 / 技能 / 工作流计划 / 运行规格 / 执行单元
 */

const STAGE_LABELS: Record<string, string> = {
  design: "创作",
  play: "游玩",
  done: "已完成",
  idle: "待命",
  running: "执行中",
  waiting_user: "等待你",
  error: "出错",
};

const WORKER_LABELS: Record<string, string> = {
  "design-core": "创作 · 核心",
  "design-worker": "创作 · 执行单元规格",
  "design-fixed": "创作 · 固定上下文",
  "design-refine": "创作 · 细化与终稿",
  "design-intake": "创作 · 综合收口",
  "design-flow": "创作 · 流程编排",
  "design-step": "创作 · 执行步骤",
  "opening-generator": "开局 · 开场白",
  orchestrator: "编排器",
  "agent-burst": "编排器调度",
  narrator: "叙事转述",
  "role-decide": "角色决策",
  "world-simulator": "主世界层",
  auditor: "旁观维护",
  chance: "机遇裁定",
  "round-present": "回合呈现",
  outline: "大纲 / 细纲",
  "chapter-writer": "章节正文",
};

const FIXED_TOPIC_LABELS: Record<string, string> = {
  "aesthetics-interaction": "美学纲领与交互范式",
  interaction: "交互范式",
  narrative_guide: "叙事指南与故事推进",
  input_protocol: "输入协议",
  core_premise: "核心前提",
  aesthetics: "美学纲领",
};

const PHASE_UNIT_LABELS: Record<string, string> = {
  core: "核心",
  refine: "细化",
};

const SKILL_PACK_LABELS: Record<string, string> = {
  "world-simulator": "世界模拟器",
  "expand-assistant": "扩写助手",
};

/** 生命周期 / 相位 */
export function displayStageLabel(id: string | undefined | null): string {
  if (!id) return "";
  return STAGE_LABELS[id] ?? id;
}

/** 配方选项 / skill pack 展示名 */
export function displaySkillPackLabel(id: string | undefined | null): string {
  if (!id) return "";
  return SKILL_PACK_LABELS[id] ?? id;
}

/**
 * 执行单元 / 单位 / 技能 id → 用户可见名（不含动作后缀）。
 */
export function displayWorkerLabel(id: string | undefined | null): string {
  if (!id) return "";
  const trimmed = id.trim();
  if (!trimmed) return "";
  if (WORKER_LABELS[trimmed]) return WORKER_LABELS[trimmed]!;

  if (trimmed.startsWith("phase:")) {
    const key = trimmed.slice("phase:".length);
    const name = PHASE_UNIT_LABELS[key] ?? key;
    return `单位 · ${name}`;
  }
  if (trimmed.startsWith("worker:")) {
    const ref = trimmed.slice("worker:".length);
    return `执行单元 · ${displayWorkerLabel(ref)}`;
  }
  if (trimmed.startsWith("fixed:")) {
    const topic = trimmed.slice("fixed:".length);
    return `技能 · ${FIXED_TOPIC_LABELS[topic] ?? topic}`;
  }
  if (trimmed.startsWith("resident:")) {
    return `常驻 · ${trimmed.slice("resident:".length)}`;
  }

  return trimmed;
}

export type WorkerTitleAction = "running" | "output" | "questions" | "stub" | null;

/** 气泡 / 流式标题：中文名 + 可选动作 */
export function formatWorkerDisplayTitle(
  workerId: string | undefined | null,
  action: WorkerTitleAction = null,
): string {
  const base = displayWorkerLabel(workerId) || "执行单元";
  switch (action) {
    case "output":
      return `${base} · 产出`;
    case "questions":
      return `${base} · 提问`;
    case "stub":
      return `${base} · 占位`;
    case "running":
      return `${base} · 执行中`;
    default:
      return base;
  }
}

/** 编排器（调度 Agent）相关标题 */
export function formatAgentDisplayTitle(detail?: string): string {
  if (detail?.trim()) return `编排器 · ${detail.trim()}`;
  return "编排器";
}
