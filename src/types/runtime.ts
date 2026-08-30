/**
 * 运行阶段机类型契约。
 *
 * 设计原则：
 * - 运行相位（RuntimePhase）只有 5 种，表示「系统在等什么」
 * - 业务细节不扩 phase，而用 waitingReason、slots、artifacts 承载
 * - LLM / 总管不能直接改 phase，只能通过 RuntimeEvent 驱动 applyEvent
 */

import type { IntakeFieldDef } from "./intake.js";
import type { QuestionItem } from "./questions.js";

/** 运行相位：系统当前在等什么。只有 5 种。 */
export type RuntimePhase =
  | "idle" // 会话已创建，尚未开始
  | "running" // 正在推进（总管决策、worker 执行、程序验收）
  | "waiting_user" // 等待用户介入
  | "done" // 流程正常结束
  | "error"; // 不可恢复错误

/**
 * waiting_user 时的具体原因。
 * 用单一 phase + reason 替代多个独立 status，避免「胖状态机」。
 */
export type WaitingReason =
  | { kind: "skill_selection"; availableSkills: SkillIndexEntry[] } // 启动：选 SKILL.md
  | { kind: "intake"; prompt: string } // 启动填空：必要/可选项收集
  | {
      kind: "input";
      message?: string;
      /** 总管 ask_user 结构化追问（有则走询问卡） */
      questions?: QuestionItem[];
      pageSize?: number;
    } // 总管 ask_user / 返工说明（启动完成后）
  | { kind: "approve_step"; decisionId: string } // 总管建议 run_worker，等用户确认
  | {
      kind: "review_artifact";
      artifactId: string;
      /**
       * 挂在产物下的可选追问（Cursor AskQuestion 心流）。
       * 有值时不阻断验收：用户可直接 Accept，也可先作答再 Accept。
       */
      questions?: QuestionItem[];
      /** 自评/导语，随追问展示在询问卡顶部 */
      assessment?: string;
      pageSize?: number;
    } // worker 产物待验收
  | {
      kind: "worker_questions";
      workerId: string;
      questions: QuestionItem[];
      pageSize?: number;
    } // worker 无产物时的阻塞提问
  | { kind: "revision"; instruction?: string } // 无意见打回时等补交；有意见则直接重跑
  | {
      /**
       * 旧路径：上一步验收后先问「下一步想写什么」。
       * 现已改为验收后直接提案；保留此 kind 以兼容未完成的旧会话。
       */
      kind: "next_intent";
      afterWorkerId?: string;
      afterUnitId?: string;
    }
  | {
      /**
       * DAG 已在：按依赖层级点选节点。依赖未齐的不能点；
       * 可反复能力以 role=prototype 槽位呈现；点原型增殖 instance 再进去。
       */
      kind: "pick_creation_step";
    };

/** 与 src/skills/types 对齐的最小 skill 索引字段，避免 runtime 强依赖 skills 模块 */
export type SkillIndexEntry = {
  name: string;
  description: string;
  category: string;
};

/**
 * Book 存储形态（由 SKILL.md 选定，选 skill 后不可变更）。
 * 第一版仅两种：小说线性结构 / 多轮多角色对话。
 */
export type BookKind = "novel" | "dialogue";

/** orchestrator 启动模式 */
export type SkillStartupMode = "intake" | "agent-first";

/** 选中的 skill 快照，写入 session.slots.activeSkill，供启动询问与后续流程使用 */
export type ActiveSkillSnapshot = {
  name: string;
  description: string;
  category: string;
  /** 选定 skill 时确定，对应 Book 最终产物结构 */
  bookKind?: BookKind;
  defaultFlowId?: string;
  suggestedWorkers: string[];
  /** intake：总管填空；agent-first：UI 固定引导 → 用户首句 → Agent 调 Skill */
  startupMode?: SkillStartupMode;
  /** agent-first 时首屏展示给用户的固定引导（纯 UI） */
  uiPrompt?: string;
  /** 来自 SKILL.md ## 启动询问 的展示文案 */
  startupPrompt: string;
  /** 用户首次输入写入的 slots 键，如 book.brief */
  startupTargetKey: string;
  /** 启动填空字段（必要 + 可选） */
  intakeFields: IntakeFieldDef[];
};

/** worker 产物验收方式 */
export type AcceptanceMode =
  | "user_confirmed" // 默认：产物完成后等用户验收
  | "no_confirmation" // 自动接受，直接回到总管
  | "programmatic_review"; // 走程序验收规则

/**
 * Worker 链推进模式（预留）。
 *
 * - manual：默认。每次 run_worker 可要求 approve_step；产物默认 user_confirmed。
 * - semi_auto：半自动串联 worker；仅在 skill 声明的 pauseCheckpoint 处强制暂停。
 *
 * 第一版 Runtime 仅实现 manual；semi_auto 由 orchestrator 文档化，待后续接入。
 * 见 docs/runtime-state-machine.md §10、docs/orchestrator-skill-format.md §10。
 */
export type WorkerAdvanceMode = "manual" | "semi_auto";

/**
 * semi_auto 下的暂停检查点（由各 skill 在 orchestrator 中声明）。
 *
 * `when` 为 skill 自定义的暂停条件描述或未来可解析的表达式；
 * 具体变量（轮次、token 预算、阶段界等）不由全局 enum 限定。
 */
export type AdvancePauseCheckpoint = {
  id: string;
  description: string;
  /** 文档化条件；未来可绑定 slot / tag / 计数器，现阶段 Runtime 不解析 */
  when?: string;
};

/**
 * 会话级 worker 推进策略（预留）。
 * 未设置或未解析时等价 `{ mode: "manual" }`。
 */
export type AdvancePolicy = {
  mode: WorkerAdvanceMode;
  pauseCheckpoints?: AdvancePauseCheckpoint[];
};

/** 总管（Main Agent）可执行的意图，对应 tool call 的 action 字段 */
export type MainAgentAction =
  | "ask_user" // 向用户提问
  | "run_worker" // 调度已有 worker
  | "create_temp_worker" // 临时 worker（与 run_worker 共用阶段机分支）
  | "review_blackboard" // 查看黑板后向用户说明
  | "finish"; // 结束流程

/**
 * 总管的一次决策。
 * statePatchAllowed 必须为 false，禁止 LLM 直接 patch 会话状态。
 */
export type MainAgentDecision = {
  id: string;
  action: MainAgentAction;
  reason: string;
  workerId?: string;
  /**
   * 调度附加上下文：
   * - roleId：role-decide 等
   * - chance：机遇裁定请求（op=roll|compare|draw|pick）
   */
  workerContext?: {
    roleId?: string;
    chance?: Record<string, unknown>;
  };
  /** ask_user：给用户看的内容完备度评价（写入 waitingReason.message） */
  assessment?: string;
  /** ask_user 结构化追问（有则前端询问卡） */
  questions?: QuestionItem[];
  /** true 时进入 waiting_user(approve_step)，等用户确认后才 run_worker */
  requiresApproval: boolean;
  statePatchAllowed: false;
};

/** worker 产物的生命周期状态 */
export type ArtifactStatus =
  | "drafted"
  | "under_review"
  | "accepted"
  | "rejected"
  | "revision_requested"
  | "superseded";

/** worker 产出的一条产物记录 */
export type ArtifactRecord = {
  id: string;
  workerId: string;
  stepId?: string;
  outputTags: string[];
  status: ArtifactStatus;
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

/** worker 因 ask_user 中途暂停时保存的上下文，用户回复后用于 resume_worker */
export type ResumeContext = {
  workerId: string;
  stepId?: string;
  acceptanceMode: AcceptanceMode;
  questions: QuestionItem[];
};

/**
 * 阶段机唯一合法的状态变更入口。
 * 所有 phase 转移都必须通过 dispatch → applyEvent 处理某种 RuntimeEvent。
 */
export type RuntimeEvent =
  | {
      type: "session_started";
      payload: {
        presetId: string;
        flowId?: string;
        availableSkills: SkillIndexEntry[];
        /** 提供时跳过 skill_selection，直接进入 intake（新建作品默认路径） */
        initialSkill?: ActiveSkillSnapshot;
      };
    }
  | { type: "skill_selected"; payload: { skill: ActiveSkillSnapshot } }
  | {
      type: "user_submitted_input";
      payload: { text: string; intakeValues?: Record<string, string> };
    }
  | { type: "user_confirmed_intake"; payload: Record<string, never> }
  | {
      type: "main_agent_decision_created";
      payload: { decision: MainAgentDecision };
    }
  | { type: "user_approved_next_step"; payload: { decisionId: string } }
  | {
      type: "user_rejected_next_step";
      payload: { decisionId: string; reason?: string };
    }
  | {
      /** 回到流程编排：在已验收步骤上追加/改排节点（不整局重开） */
      type: "user_requested_flow_replan";
      payload: { reason?: string };
    }
  | {
      /** DAG 图上点选一条已就绪的步骤，进入 design-step */
      type: "user_picked_creation_step";
      payload: { stepId: string };
    }
  | {
      /** 验收后 / 总管误调 design-step：停在分层图上等用户点选 */
      type: "creation_step_pick_awaited";
      payload?: Record<string, never>;
    }
  | {
      /** 离开当前技能步，回到分层图点选（误点增殖节点时用） */
      type: "user_left_creation_step";
      payload?: Record<string, never>;
    }
  | {
      type: "worker_started";
      payload: {
        workerId: string;
        stepId?: string;
        acceptanceMode: AcceptanceMode;
      };
    }
  | {
      type: "worker_completed";
      payload: {
        artifactId: string;
        /** 有产物时的可选追问，挂到 review_artifact */
        questions?: QuestionItem[] | string[];
        /** 自评摘要，挂到询问卡 */
        assessment?: string;
      };
    }
  | {
      type: "worker_needs_input";
      payload: {
        workerId: string;
        stepId?: string;
        questions: QuestionItem[] | string[];
      };
    }
  | {
      /** 按意见重跑没写出新产物：退回上一版产物验收，重试追问改挂为可选 */
      type: "worker_revision_produced_nothing";
      payload: { artifactId: string; questions?: QuestionItem[] | string[] };
    }
  | {
      /** 验收态下作答/跳过挂载追问：不离开 review_artifact */
      type: "user_resolved_sidecar_questions";
      payload: { answersText?: string };
    }
  | { type: "user_accepted_artifact"; payload: { artifactId: string } }
  | {
      type: "user_rejected_artifact";
      payload: { artifactId: string; reason?: string };
    }
  | {
      type: "user_requested_revision";
      payload: { artifactId?: string; instruction: string };
    }
  | { type: "programmatic_review_started"; payload: { artifactId: string } }
  | { type: "programmatic_review_passed"; payload: { artifactId: string } }
  | {
      type: "programmatic_review_failed";
      payload: { artifactId: string; reason: string };
    }
  | { type: "flow_completed"; payload: Record<string, never> }
  | { type: "runtime_failed"; payload: { reason: string } };

/** 一次会话的完整运行时快照 */
export type RuntimeSession = {
  id: string;
  phase: RuntimePhase;
  waitingReason?: WaitingReason;
  presetId: string;
  flowId?: string;
  /** 业务 flow 当前步骤（execution flow 层，与 phase 正交） */
  currentStepId?: string;
  currentWorkerId?: string;
  acceptanceMode?: AcceptanceMode;
  /** 推进策略（预留）。缺省 = manual，见 WorkerAdvanceMode */
  advancePolicy?: AdvancePolicy;
  reviewRequirements?: string[];
  resumeContext?: ResumeContext;
  /** 轻量槽位：activeSkill、book.brief、startupCompleted 等 */
  slots: Record<string, unknown>;
  artifacts: ArtifactRecord[];
  /** 待用户确认的总管决策（approve_step 时有效） */
  pendingDecision?: MainAgentDecision;
  /** 待验收的产物 id（review_artifact 时有效） */
  pendingArtifactId?: string;
  /** 已应用的 RuntimeEvent 日志，便于调试与回放 */
  history: RuntimeEvent[];
  createdAt: string;
  updatedAt: string;
};

/**
 * applyEvent 返回的副作用清单。
 * 纯函数 phase-machine 不执行 IO，由 phase-runtime 的 processEffects 消费。
 */
export type PhaseEffect =
  | { type: "invoke_main_agent" }
  | {
      type: "run_worker";
      workerId: string;
      workerContext?: {
        roleId?: string;
        chance?: Record<string, unknown>;
      };
    }
  | { type: "resume_worker" }
  | { type: "run_programmatic_review"; artifactId: string }
  | { type: "emit_message"; message: string }
  /** 根据流程与用户下一步意向，提案下一节点或停在分层图上等点选 */
  | { type: "propose_next_creation_step" }
  /** 选定开场白：落库、关 DAG、标记创作收口 */
  | { type: "seal_creation_opening" }
  /** 再编排：解开开场收口、把 DAG 改回 open */
  | { type: "unseal_creation_opening" }
  /** 游玩：按运行规格开一轮（旁观 → 主世界层 → 转述） */
  | { type: "run_play_turn" }
  /** 游玩：跑管线里的下一个执行单元；队空则等下一条用户输入 */
  | { type: "continue_play_turn" };

/** applyEvent 的返回值：新会话快照 + 待处理副作用 + 可选错误 */
export type ApplyEventResult = {
  session: RuntimeSession;
  effects: PhaseEffect[];
  error?: string;
};

/** @deprecated 使用 RuntimePhase */
export type RuntimeStatus = RuntimePhase;
