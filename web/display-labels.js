/**
 * 与 docs/ui-glossary.md、src/server/display-labels.ts 保持同步。
 * 用户侧口径：进料方式 / 配方 / 编排器 / 技能 / 工作流计划 / 运行规格 / 执行单元。
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
  "world-simulator": "主世界层",
  chance: "机遇裁定",
  "round-present": "回合呈现",
  outline: "大纲 / 细纲",
  "chapter-writer": "章节正文",
};

const FIXED_TOPIC_LABELS = {
  "aesthetics-interaction": "美学纲领与交互范式",
  interaction: "交互范式",
  narrative_guide: "叙事指南与故事推进",
  "narrative-guide": "叙事指南",
  "story-progression": "故事推进",
  input_protocol: "输入协议",
  core_premise: "核心前提",
  aesthetics: "美学纲领",
  protagonist: "主角设定",
};

const PHASE_UNIT_LABELS = {
  core: "核心",
  refine: "细化",
};

export function displayStageLabel(id) {
  if (!id) return "";
  return STAGE_LABELS[id] ?? id;
}

export function displayCreationModeLabel(id) {
  if (!id) return "";
  const map = {
    recipe: "工序编排",
    dictate: "对话落盘",
  };
  return map[id] ?? id;
}

export function displaySkillPackLabel(id) {
  if (!id) return "";
  const map = {
    "world-simulator": "回合推演",
    "expand-assistant": "扩写助手",
    快穿短局: "快穿短局",
    文本生成器: "文本生成器",
    "text-generator": "文本生成器",
    交互式长文生成器: "交互式长文生成器",
    数据化跑团体验: "数据化跑团体验",
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

/** 流程编排产物待确认：图上点节点即确认，不走验收双按钮 */
export function isFlowPlanReview(view) {
  return (
    view?.waitingReason?.kind === "review_artifact" &&
    view?.reviewArtifact?.workerId === "design-flow"
  );
}

/**
 * `review_artifact` 底栏 / 工作面文案。流程编排核对工作流计划，不是「验收通过」。
 * 须与 src/server/display-labels.ts `reviewComposerCopy` 保持一致。
 */
export function reviewComposerCopy(workerId, opts = {}) {
  const hasQuestions = Boolean(opts.hasQuestions);
  const id = String(workerId ?? "").trim();
  const openingReview =
    id === "opening-generator" ||
    (Array.isArray(opts.outputTags) &&
      opts.outputTags.includes("设计.开场白与开场变量"));

  if (id === "design-flow") {
    return {
      chip: "编排",
      kicker: "核对编排",
      taskLabel: "编排",
      taskTitle: "核对工作流计划",
      hint: hasQuestions
        ? "同意就按这个排；要改就写意见，在现有计划上改。下方追问可选答。"
        : "同意就按这个排；要改就写意见，在现有计划上改。",
      submitLabel: "按意见改编排",
      acceptLabel: "确认编排",
      placeholder: "改编排意见…",
      emptyEnterHint: "空 Enter＝确认编排",
      tone: "plan",
      kind: "flow",
    };
  }

  if (id === "opening-generator" || openingReview) {
    return {
      chip: "开场",
      kicker: "待选定",
      taskLabel: "开场",
      taskTitle: "选定开场白",
      hint: hasQuestions
        ? "同意就选定此开场；要改开场白就写意见。下方追问可选答。"
        : "同意就选定此开场；要改开场白就写意见。",
      submitLabel: "按意见修改",
      acceptLabel: "选定此开场",
      placeholder: "修改意见…",
      emptyEnterHint: "空 Enter＝选定此开场",
      tone: "plan",
      kind: "opening",
    };
  }

  return {
    chip: "验收",
    kicker: "待验收",
    taskLabel: "验收",
    taskTitle: "验收产物",
    hint: hasQuestions
      ? "同意就接受；要改就写意见，在现有产物上改。下方追问可选答。"
      : "同意就接受；要改就写意见，在现有产物上改。",
    submitLabel: "按意见修改",
    acceptLabel: "接受",
    placeholder: "修改意见…",
    emptyEnterHint: "空 Enter＝接受",
    tone: "accept",
    kind: "accept",
  };
}
