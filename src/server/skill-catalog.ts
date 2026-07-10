import type { RuntimeSession } from "../types/runtime.js";

export type LifecycleStage = "design" | "play";

export type SkillCatalogEntry = {
  id: string;
  stage: "design" | "run";
  label: string;
  /** 这一步要干嘛（占位说明，详细设计后续补充） */
  purpose: string;
  status: "pending" | "active" | "done" | "skipped";
};

type CatalogTemplate = {
  id: string;
  stage: "design" | "run";
  label: string;
  purpose: string;
};

const GENERIC_DESIGN: CatalogTemplate[] = [
  {
    id: "interaction-paradigm",
    stage: "design",
    label: "交互范式",
    purpose: "弄清用户要什么体验，产出 run skill 清单（要哪些能力）。",
  },
  {
    id: "intake",
    stage: "design",
    label: "启动收集",
    purpose: "收集最小需求，写入用户.需求 / book.brief。",
  },
  {
    id: "world-blueprint",
    stage: "design",
    label: "世界蓝图",
    purpose: "定背景板与核心冲突，供后续 skill 引用。",
  },
  {
    id: "narrative-guide",
    stage: "design",
    label: "叙事指南",
    purpose: "定 POV、时态、文风（static 上下文上半）。",
  },
  {
    id: "declare-ready",
    stage: "design",
    label: "实例就绪",
    purpose: "agent 确认设计够开跑，进入游玩阶段。",
  },
];

const GENERIC_RUN: CatalogTemplate[] = [
  {
    id: "agent-burst",
    stage: "run",
    label: "Agent 调度",
    purpose: "总管 tool loop：读黑板 → 选择 invoke 哪个 run skill。",
  },
  {
    id: "narrator",
    stage: "run",
    label: "转述 / 展示",
    purpose: "把世界状态编排成给用户看的叙事回复。",
  },
  {
    id: "world-simulator",
    stage: "run",
    label: "世界模拟",
    purpose: "裁决规则、更新事件流与可见信息。",
  },
];

const BY_SKILL_PACK: Record<string, CatalogTemplate[]> = {
  basic: [
    {
      id: "intake",
      stage: "design",
      label: "创作简报",
      purpose: "收集题材、篇幅、风格 → book.brief。",
    },
    {
      id: "declare-ready",
      stage: "design",
      label: "进入运行",
      purpose: "简报确认后 declare ready。",
    },
    {
      id: "outline",
      stage: "run",
      label: "生成大纲",
      purpose: "根据 brief 生成 outline 产物。",
    },
  ],
  "weird-rules-short": [
    {
      id: "intake",
      stage: "design",
      label: "创作简报",
      purpose: "收集规则怪谈情境与条数。",
    },
    {
      id: "write-rules",
      stage: "run",
      label: "写规则",
      purpose: "产出规则草稿与隐藏 core。",
    },
    {
      id: "review-infer",
      stage: "run",
      label: "读者验收",
      purpose: "盲读规则，不写 core。",
    },
    {
      id: "review-author",
      stage: "run",
      label: "作者验收",
      purpose: "对照 core 查一致性。",
    },
  ],
  "roleplay-game-theory": [
    {
      id: "intake",
      stage: "design",
      label: "博弈需求",
      purpose: "收集情境、角色、轮次 → 用户.博弈需求。",
    },
    {
      id: "setup-scenario",
      stage: "design",
      label: "结构化设定",
      purpose: "整理为情境、规则、角色设定 tag。",
    },
    {
      id: "declare-ready",
      stage: "design",
      label: "开始模拟",
      purpose: "setup 验收后进入 run。",
    },
    {
      id: "world-engine",
      stage: "run",
      label: "世界机",
      purpose: "发可见信息、收行动、裁决回合。",
    },
    {
      id: "role-decide",
      stage: "run",
      label: "角色决策",
      purpose: "各角色独立产出思考与行动。",
    },
    {
      id: "present-round",
      stage: "run",
      label: "回合展示",
      purpose: "编排给用户看的本轮摘要。",
    },
  ],
  "world-simulator": [
    {
      id: "interaction-paradigm",
      stage: "design",
      label: "交互范式",
      purpose: "定体验与 run skill 清单。",
    },
    {
      id: "world-blueprint",
      stage: "design",
      label: "世界蓝图",
      purpose: "背景板与核心设定。",
    },
    {
      id: "topology",
      stage: "design",
      label: "拓扑 / 关系",
      purpose: "地图、关系网或进阶路径（按需）。",
    },
    {
      id: "generation-rules",
      stage: "design",
      label: "生成规则",
      purpose: "元规则：如何生成实例内容。",
    },
    {
      id: "narrative-guide",
      stage: "design",
      label: "叙事指南",
      purpose: "正文气质与禁忌（static 上）。",
    },
    {
      id: "variable-catalog",
      stage: "design",
      label: "变量目录",
      purpose: "要跟踪的状态与更新格式。",
    },
    {
      id: "declare-ready",
      stage: "design",
      label: "实例就绪",
      purpose: "agent 声明可开跑。",
    },
    {
      id: "world-simulator",
      stage: "run",
      label: "世界模拟器",
      purpose: "每轮推进世界状态与事件流。",
    },
    {
      id: "narrator",
      stage: "run",
      label: "转述者",
      purpose: "把状态写成用户可见叙事。",
    },
  ],
};

function templatesFor(skillPackId?: string): CatalogTemplate[] {
  if (skillPackId && BY_SKILL_PACK[skillPackId]) {
    return BY_SKILL_PACK[skillPackId];
  }
  return [...GENERIC_DESIGN, ...GENERIC_RUN];
}

export function inferLifecycleStage(session: RuntimeSession): LifecycleStage {
  const override = session.slots.uiLifecycleStage;
  if (override === "design" || override === "play") {
    return override;
  }
  if (!session.slots.startupCompleted) return "design";
  if (session.phase === "done") return "play";
  return "play";
}

export function canEnterPlay(session: RuntimeSession): boolean {
  return Boolean(session.slots.startupCompleted);
}

export function buildSkillCatalog(
  session: RuntimeSession,
  skillPackId?: string,
  lifecycle: LifecycleStage = inferLifecycleStage(session),
): SkillCatalogEntry[] {
  const templates = templatesFor(skillPackId);
  const filtered = templates.filter((t) =>
    lifecycle === "design" ? t.stage === "design" : t.stage === "run",
  );

  const workerIds = new Set(
    session.artifacts.map((a) => a.workerId).filter(Boolean),
  );
  const acceptedWorkers = new Set(
    session.artifacts
      .filter((a) => a.status === "accepted")
      .map((a) => a.workerId),
  );

  return filtered.map((t) => {
    let status: SkillCatalogEntry["status"] = "pending";

    if (t.id === "intake") {
      if (session.slots.startupCompleted) status = "done";
      else if (
        session.waitingReason?.kind === "intake" ||
        session.waitingReason?.kind === "input"
      ) {
        status = "active";
      }
    } else if (t.id === "declare-ready") {
      if (session.slots.startupCompleted) status = "done";
    } else if (t.id === "agent-burst") {
      if (session.phase === "running" && !session.currentWorkerId) {
        status = "active";
      }
    } else if (workerIds.has(t.id)) {
      status = acceptedWorkers.has(t.id) ? "done" : "active";
    } else if (session.currentWorkerId === t.id) {
      status = "active";
    }

    return { ...t, status };
  });
}

export const TOOL_LOOP_BURST_MAX = 12;
