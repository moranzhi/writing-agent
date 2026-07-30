/**
 * 与 docs/ui-glossary.md、src/server/display-labels.ts 保持同步。
 * 用户侧口径：配方 / 编排器 / 技能 / 工作流计划 / 运行规格 / 执行单元。
 */

const STAGE_LABELS = {
  design: "创作",
  play: "游玩",
  done: "已完成",
  idle: "待命",
  running: "执行中",
  waiting_user: "等待你",
  error: "出错",
};

const WORKER_LABELS = {
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
  "world-simulator": "世界推演",
  "round-present": "回合呈现",
  outline: "大纲 / 细纲",
  "chapter-writer": "章节正文",
};

const FIXED_TOPIC_LABELS = {
  "aesthetics-interaction": "美学纲领与交互范式",
  interaction: "交互范式",
  narrative_guide: "叙事指南",
  input_protocol: "输入协议",
  core_premise: "核心前提",
  aesthetics: "美学纲领",
};

const PHASE_UNIT_LABELS = {
  core: "核心",
  refine: "细化",
};

export function displayStageLabel(id) {
  if (!id) return "";
  return STAGE_LABELS[id] ?? id;
}

export function displaySkillPackLabel(id) {
  if (!id) return "";
  const map = {
    "world-simulator": "世界模拟器",
    "expand-assistant": "扩写助手",
  };
  return map[id] ?? id;
}

export function displayWorkerLabel(id) {
  if (!id) return "";
  const trimmed = String(id).trim();
  if (!trimmed) return "";
  if (WORKER_LABELS[trimmed]) return WORKER_LABELS[trimmed];

  if (trimmed.startsWith("phase:")) {
    const key = trimmed.slice("phase:".length);
    return `单位 · ${PHASE_UNIT_LABELS[key] ?? key}`;
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

export function formatWorkerDisplayTitle(workerId, action = null) {
  const base = displayWorkerLabel(workerId) || "执行单元";
  if (action === "output") return `${base} · 产出`;
  if (action === "questions") return `${base} · 提问`;
  if (action === "stub") return `${base} · 占位`;
  if (action === "running") return `${base} · 执行中`;
  return base;
}
