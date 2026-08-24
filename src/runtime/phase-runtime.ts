/**
 * 阶段机运行层（有副作用的执行器）。
 *
 * 职责：
 * - 持有可变 session，统一 dispatch(event) 入口
 * - 调用纯函数 applyEvent，再 processEffects 执行 IO（消息、worker、验收）
 * - 启动时从 skills/ 加载 registry，驱动 skill 选择与 SKILL.md 启动询问
 *
 * 与 phase-machine.ts 的分工：前者「算状态」，本文件「跑状态」。
 */
import { randomUUID } from "node:crypto";
import {
  applyEvent,
  createArtifact,
  createSession,
  getAllowedEvents,
} from "./phase-machine.js";
import { Blackboard } from "../blackboard/blackboard.js";
import type { LlmProvider } from "../llm/client.js";
import { DEFAULT_WORKERS, MainAgent } from "../main-agent/main-agent.js";
import { listSkills, listWorkerSkills, loadSkill, resolveSkillId } from "../skills/loader.js";
import {
  buildInstanceWorkerDeclaration,
  formatUndeclaredWorkerError,
  inferLifecycleStage,
  mergeDeclaredWorkersForAgent,
  readWorkerSetYamlForDeclaration,
  shouldEnforceWorkerDeclaration,
} from "../skills/worker-declaration.js";
import { resolveDefaultOrchestratorId } from "../config/default-orchestrator.js";
import { toActiveSkillSnapshot } from "../skills/snapshot.js";
import { runWorkerSkill } from "../worker/executor.js";
import { resolveWorkerId } from "../worker/resolve-id.js";
import { resolveWorkerLlmProvider } from "../skills/worker-llm.js";
import {
  DIALOGUE_HISTORY_TAG,
  appendDialogueHistoryTurn,
} from "../skills/dialogue-history.js";
import { extractIntakeFromMessage } from "../intake/extract.js";
import { readIntakeValues } from "../intake/intake.js";
import { compressAfterWorkerAccept } from "./compress-after-worker.js";
import {
  CREATION_ACCEPTED_UNITS_TAG,
  CREATION_CURRENT_UNIT_TAG,
  CREATION_ACCEPTED_CONTENT_TAG,
  WORKER_SET_DRAFT_TAG,
  WORKER_SET_FINAL_TAG,
  SLOT_CREATION_ACCEPTED_UNITS,
  SLOT_CREATION_CURRENT_UNIT,
  SLOT_CREATION_UNIT_ANCHOR_AT,
  extractUnitContentFromDraft,
  isDesignDiskWorker,
  isDesignUnitArtifact,
  parseAcceptedUnits,
  upsertAcceptedUnitContent,
} from "../skills/creation-units.js";
import {
  CREATION_FLOW_TAG,
  CREATION_CURRENT_STEP_TAG,
  CREATION_PROPOSED_STEP_TAG,
  CREATION_MODULE_OPENING_TAG,
  CREATION_MODULE_OPENING_STATE_TAG,
  SLOT_CREATION_MODULE_OPENING_STATE,
  loadModuleCatalog,
  isReviseStep,
  mergeCreationFlowPreservingAccepted,
  nextPendingStep,
  parseCreationFlow,
  parseModuleOpeningState,
  patchCreationFlowStepParams,
  pickRecordedStepId,
  resolveDesignStepBinding,
  shouldSkipModuleOpening,
  isProgressPointerTag,
  missingRequiredStepParams,
  stepUnitId,
  stringifyCreationFlow,
  stringifyModuleOpeningState,
  type CreationFlowStepParams,
  type ModuleCatalogEntry,
  type ModuleParamSpec,
} from "../skills/creation-flow.js";
import {
  appendAskedQuestions,
  dropAlreadyAskedQuestions,
  MODULE_OPENING_QUESTION_ID,
  normalizeQuestions,
  parseAskedQuestions,
  SLOT_ASKED_QUESTIONS,
} from "../skills/question-protocol.js";
import { parseWorkerSetYaml } from "../skills/worker-set-parse.js";
import {
  closeCreationFlowRaw,
  CREATION_SEALED_WAITING_MESSAGE,
  mergeOpeningTablePatch,
  OPENING_CURRENT_VARS_TAG,
  OPENING_INITIAL_VARS_TAG,
  OPENING_OUTPUT_TAG,
  OPENING_SETUP_ARTIFACT_TAG,
  parseOpeningSealPayload,
  SLOT_CREATION_SEALED_BY_OPENING,
  SLOT_OPENING_SELECTED_INDEX,
} from "../skills/opening-seal.js";
import {
  readPlayTurnQueue,
  withPlayTurnQueue,
} from "../skills/play-turn.js";
import { debugLog, labelAction, logStateChange, sessionSnap } from "../log.js";
import {
  executeChance,
  executeChanceBatch,
  resolveChanceBatchRequest,
  resolveChanceRequest,
} from "../skills/chance-tools.js";
import {
  resolveAcceptanceModeForWorker,
  resolveRunnableWorker,
} from "../skills/declared-worker.js";
import {
  mergeTableCells,
  parseTableDoc,
  stringifyTableDoc,
  type TableDoc,
} from "../blackboard/table-cells.js";
import {
  SIDE_EFFECT_FIRED_TAG,
  applySideEffectTagActions,
  evaluateSideEffects,
  parseFiredRegistry,
  parseSideEffectRules,
  stringifyFiredRegistry,
} from "../blackboard/table-side-effects.js";
import {
  SETTLEMENT_TAG,
  parseSettlementPacket,
  settlementChangesToTablePatch,
} from "../skills/settlement-packet.js";
import {
  MAINTAIN_TAG,
  maintainOpsToTablePatch,
  parseMaintainPacket,
} from "../skills/maintain-packet.js";
import {
  MAINTAIN_GENERATE_TAG,
  runMaintainNeedGenerateSampling,
} from "../skills/maintain-need-generate.js";
import {
  mountResidentContextForWorker as writeResidentContextTags,
  parseResidentContext,
} from "../skills/resident-context.js";
import type {
  AcceptanceMode,
  ActiveSkillSnapshot,
  ApplyEventResult,
  MainAgentDecision,
  PhaseEffect,
  RuntimeEvent,
  RuntimeSession,
  SkillIndexEntry,
} from "../types/runtime.js";
import type { BlackboardItem } from "../types/blackboard.js";

/** 每轮开始前清掉的 transient tag（避免主世界层读到上一轮裁决/旁观包） */
const PLAY_ROUND_TRANSIENT_TAGS = [
  SETTLEMENT_TAG,
  MAINTAIN_TAG,
  MAINTAIN_GENERATE_TAG,
  "运行.本轮.机遇",
  "运行.本轮.变量变更",
] as const;

export type PhaseRuntimeOptions = {
  presetId?: string;
  flowId?: string;
  /** worker 完成后的默认验收模式，会写入 worker_started 事件 */
  acceptanceMode?: AcceptanceMode;
  /** true 时 run_worker 自动走占位 worker（演示 / 测试用） */
  autoStubWorker?: boolean;
  /** 传入后 invoke_main_agent 会自动调用总管 LLM */
  llm?: LlmProvider;
  /** 运行时黑板；worker 产出写入此处 */
  blackboard?: Blackboard;
  /** 副作用 emit_message 与用户提示的回调（Web / CLI 接入点） */
  onMessage?: (message: string) => void;
  /** 总管 reasoning 流式增量 */
  onAgentThinkingDelta?: (delta: string) => void;
  /** 一轮总管 LLM 思考完成 */
  onAgentThinkingDone?: (text: string) => void;
  /** worker 开始流式输出 */
  onWorkerStreamStart?: (workerId: string) => void;
  /** worker 思维链流式增量 */
  onWorkerThinkingDelta?: (workerId: string, delta: string) => void;
  /** worker 正文/JSON 流式增量 */
  onWorkerOutputDelta?: (workerId: string, delta: string) => void;
  /** worker 流式结束 */
  onWorkerStreamDone?: (workerId: string) => void;
  /** 从磁盘恢复时使用，跳过 createSession */
  initialSession?: RuntimeSession;
  /** 与 initialSession 一并恢复黑板 */
  initialBlackboardItems?: BlackboardItem[];
};

/**
 * 阶段机运行层：包装纯函数 phase-machine，处理副作用。
 * 启动时加载 skills/，先选 skill，再读 SKILL.md 启动询问。
 */
export class PhaseRuntime {
  private session: RuntimeSession;
  private readonly acceptanceMode: AcceptanceMode;
  private autoStubWorker: boolean;
  private readonly onMessage: (message: string) => void;
  private readonly onAgentThinkingDelta?: (delta: string) => void;
  private readonly onAgentThinkingDone?: (text: string) => void;
  private readonly onWorkerStreamStart?: (workerId: string) => void;
  private readonly onWorkerThinkingDelta?: (workerId: string, delta: string) => void;
  private readonly onWorkerOutputDelta?: (workerId: string, delta: string) => void;
  private readonly onWorkerStreamDone?: (workerId: string) => void;
  private blackboard: Blackboard;
  private llm?: LlmProvider;
  private mainAgent?: MainAgent;
  /** autoStubWorker=false 时，run_worker effect 暂存于此，等 startPendingWorker() */
  private pendingWorkerEffect: Extract<PhaseEffect, { type: "run_worker" }> | null =
    null;
  /** 最近一次 worker 启动前的快照，供 UI 重 roll 使用 */
  private lastWorkerRunSnapshot: {
    workerId: string;
    runtimeSession: RuntimeSession;
    blackboardItems: BlackboardItem[];
  } | null = null;
  /** start() 时从 registry 加载；legacy skill_selection 会话仍用编号解析 */
  private availableSkills: SkillIndexEntry[] = [];

  constructor(options: PhaseRuntimeOptions = {}) {
    this.session =
      options.initialSession ??
      createSession(options.presetId ?? "default", options.flowId);
    this.acceptanceMode = options.acceptanceMode ?? "user_confirmed";
    this.autoStubWorker = options.autoStubWorker ?? false;
    this.onMessage = options.onMessage ?? (() => {});
    this.onAgentThinkingDelta = options.onAgentThinkingDelta;
    this.onAgentThinkingDone = options.onAgentThinkingDone;
    this.onWorkerStreamStart = options.onWorkerStreamStart;
    this.onWorkerThinkingDelta = options.onWorkerThinkingDelta;
    this.onWorkerOutputDelta = options.onWorkerOutputDelta;
    this.onWorkerStreamDone = options.onWorkerStreamDone;
    this.blackboard = options.blackboard ?? new Blackboard();
    if (options.initialBlackboardItems?.length) {
      this.blackboard.seed(options.initialBlackboardItems);
    }
    if (options.llm) {
      this.llm = options.llm;
      this.mainAgent = new MainAgent(options.llm);
    }
  }

  getBlackboard(): Blackboard {
    return this.blackboard;
  }

  hasMainAgent(): boolean {
    return Boolean(this.mainAgent);
  }

  /** 设置变更后热更新 LLM（API profile / preset） */
  reloadLlm(llm: LlmProvider, autoStubWorker?: boolean): void {
    this.llm = llm;
    this.mainAgent = new MainAgent(llm);
    if (autoStubWorker !== undefined) {
      this.autoStubWorker = autoStubWorker;
    }
  }

  getLlm(): LlmProvider | undefined {
    return this.llm;
  }

  getSession(): RuntimeSession {
    return this.session;
  }

  getLastWorkerRunSnapshot(): {
    workerId: string;
    runtimeSession: RuntimeSession;
    blackboardItems: BlackboardItem[];
  } | null {
    return this.lastWorkerRunSnapshot
      ? {
          workerId: this.lastWorkerRunSnapshot.workerId,
          runtimeSession: structuredClone(this.lastWorkerRunSnapshot.runtimeSession),
          blackboardItems: structuredClone(this.lastWorkerRunSnapshot.blackboardItems),
        }
      : null;
  }

  /** 从 checkpoint 恢复 runtime + 黑板（编辑 / 切换分支） */
  restoreFromCheckpoint(
    session: RuntimeSession,
    blackboardItems: BlackboardItem[],
  ): void {
    this.session = structuredClone(session);
    this.blackboard = new Blackboard();
    if (blackboardItems.length) {
      this.blackboard.seed(structuredClone(blackboardItems));
    }
    this.pendingWorkerEffect = null;
    this.lastWorkerRunSnapshot = null;
  }

  /**
   * 执行中卡住：有进行中的 worker 则按开跑快照重跑；否则重跑总管。
   */
  async retryStuckRun(): Promise<RuntimeSession> {
    const workerId = this.session.currentWorkerId;
    const snap = this.lastWorkerRunSnapshot;
    if (workerId && snap && snap.workerId === workerId) {
      this.restoreFromCheckpoint(
        snap.runtimeSession,
        snap.blackboardItems,
      );
      return this.rerunWorker(workerId);
    }
    if (this.session.phase === "running" && !this.session.waitingReason) {
      await this.runMainAgent();
      return this.session;
    }
    throw new Error("当前没有可重试的执行");
  }

  /** 重 roll 指定 worker（刷新 Skill 回复） */
  async rerunWorker(workerId: string): Promise<RuntimeSession> {
    const effect: Extract<PhaseEffect, { type: "run_worker" }> = {
      type: "run_worker",
      workerId,
    };
    if (this.autoStubWorker) {
      await this.runStubWorker(effect);
    } else if (this.llm) {
      await this.runRealWorker(effect);
    } else {
      this.pendingWorkerEffect = effect;
      this.onMessage(`[阶段机] 重 roll worker: ${workerId}。输入 /worker-start`);
    }
    return this.session;
  }

  setLifecycleStage(stage: "design" | "play"): void {
    this.session = {
      ...this.session,
      slots: { ...this.session.slots, uiLifecycleStage: stage },
      updatedAt: new Date().toISOString(),
    };
  }

  getAvailableSkills(): SkillIndexEntry[] {
    return this.availableSkills;
  }

  /** 恢复会话或首次 start 前加载 skill 列表（供 UI 展示） */
  async ensureAvailableSkills(): Promise<void> {
    if (this.availableSkills.length === 0) {
      this.availableSkills = await listSkills();
    }
  }

  getActiveSkill(): ActiveSkillSnapshot | undefined {
    return this.session.slots.activeSkill as ActiveSkillSnapshot | undefined;
  }

  getAllowedEventTypes(): RuntimeEvent["type"][] {
    return getAllowedEvents(this.session);
  }

  /**
   * 是否处于「running 且无事可做，等总管决策」状态。
   * Web 层据此显示「生成大纲」等按钮。
   */
  needsMainAgentDecision(): boolean {
    return (
      this.session.phase === "running" &&
      !this.session.currentWorkerId &&
      !this.pendingWorkerEffect
    );
  }

  /** 加载 registry → 自动进入默认 orchestrator → intake（无选包阶段） */
  async start(): Promise<RuntimeSession> {
    this.availableSkills = await listSkills();
    if (this.availableSkills.length === 0) {
      throw new Error("skills/registry 中没有注册任何 orchestrator");
    }
    const defaultId = resolveDefaultOrchestratorId(this.availableSkills);
    const initialSkill = toActiveSkillSnapshot(await loadSkill(defaultId));
    await this.dispatch({
      type: "session_started",
      payload: {
        presetId: this.session.presetId,
        flowId: this.session.flowId,
        availableSkills: this.availableSkills,
        initialSkill,
      },
    });
    return this.session;
  }

  /** 启动并加载指定 orchestrator（legacy 包 / 测试用） */
  async startWithOrchestrator(orchestratorId: string): Promise<RuntimeSession> {
    this.availableSkills = await listSkills();
    if (this.availableSkills.length === 0) {
      throw new Error("skills/registry 中没有注册任何 orchestrator");
    }
    const initialSkill = toActiveSkillSnapshot(await loadSkill(orchestratorId));
    await this.dispatch({
      type: "session_started",
      payload: {
        presetId: this.session.presetId,
        flowId: this.session.flowId,
        availableSkills: this.availableSkills,
        initialSkill,
      },
    });
    return this.session;
  }

  /** 解析并加载 SKILL.md → 触发 skill_selected → waiting_user(input) */
  async selectSkill(skillIdOrName: string): Promise<RuntimeSession> {
    const dir = await resolveSkillId(skillIdOrName);
    if (!dir) {
      throw new Error(`未找到 skill: ${skillIdOrName}`);
    }
    const parsed = await loadSkill(dir);
    await this.dispatch({
      type: "skill_selected",
      payload: { skill: toActiveSkillSnapshot(parsed) },
    });
    return this.session;
  }

  /** applyEvent 并打状态日志（dispatch / 总管决策共用） */
  private commitEvent(event: RuntimeEvent): ApplyEventResult {
    const before = sessionSnap(this.session);
    const result = applyEvent(this.session, event);
    this.session = result.session;
    logStateChange(event, before, result);
    return result;
  }

  /** 统一事件入口：applyEvent + 更新 session + 处理 effects + 可选总管 LLM */
  async dispatch(event: RuntimeEvent): Promise<ApplyEventResult> {
    const result = this.commitEvent(event);

    if (
      event.type === "user_submitted_input" ||
      event.type === "user_confirmed_intake"
    ) {
      this.syncSlotsToBlackboard(this.session);
    }

    if (result.error && event.type !== "runtime_failed") {
      this.onMessage(result.error);
    }

    await this.processEffects(result.effects);
    await this.maybeRunMainAgent(result.effects);
    return result;
  }

  /** 将 slots 中的启动目标等同步为黑板 tag（迁移期 tag 名可与旧 key 相同） */
  private syncSlotsToBlackboard(session: RuntimeSession): void {
    const activeSkill = session.slots.activeSkill as ActiveSkillSnapshot | undefined;
    const demandTag = activeSkill?.startupTargetKey || "用户.需求";
    const demandContent = session.slots[demandTag];
    if (typeof demandContent === "string" && demandContent.trim()) {
      this.blackboard.write({
        tag: demandTag,
        content: demandContent.trim(),
        source: "user",
      });
    }
    const latestInput = session.slots["用户.最新输入"];
    if (typeof latestInput === "string" && latestInput.trim()) {
      this.blackboard.write({
        tag: "用户.最新输入",
        content: latestInput.trim(),
        source: "user",
      });
      // 游玩期把用户话追加进可投影的「对话.历史」标签
      if (inferLifecycleStage(session) === "play") {
        this.appendDialogueHistory("用户", latestInput.trim());
      }
    }
    const workerReply = session.slots["用户.worker答复"];
    if (typeof workerReply === "string" && workerReply.trim()) {
      this.blackboard.write({
        tag: "用户.worker答复",
        content: workerReply.trim(),
        source: "user",
      });
    }
    const revision =
      (typeof session.slots["用户.修订说明"] === "string" &&
        session.slots["用户.修订说明"]) ||
      (typeof session.slots.revisionInstruction === "string" &&
        session.slots.revisionInstruction);
    if (typeof revision === "string" && revision.trim()) {
      this.blackboard.write({
        tag: "用户.修订说明",
        content: revision.trim(),
        source: "user",
      });
    }
    const nextIntent = session.slots["用户.下一步意向"];
    if (typeof nextIntent === "string" && nextIntent.trim()) {
      this.blackboard.write({
        tag: "用户.下一步意向",
        content: nextIntent.trim(),
        source: "user",
      });
    }
  }

  /**
   * 用户文本输入的统一入口。
   * legacy skill_selection 阶段会先解析为 selectSkill，否则走 user_submitted_input。
   */
  async submitInput(text: string): Promise<RuntimeSession> {
    if (this.session.waitingReason?.kind === "skill_selection") {
      const picked = await this.resolveSkillFromUserInput(text);
      if (!picked) {
        throw new Error(
          `无法识别 skill: ${text}。旧版会话请用 skill id（如 world-simulator）或列表编号。`,
        );
      }
      return this.selectSkill(picked);
    }
    if (this.session.waitingReason?.kind === "intake") {
      const skill = this.getActiveSkill();
      const fields = skill?.intakeFields ?? [];
      const current = readIntakeValues(this.session.slots);
      const intakeValues = await extractIntakeFromMessage(
        text,
        fields,
        current,
        this.llm,
      );
      await this.dispatch({
        type: "user_submitted_input",
        payload: { text, intakeValues },
      });
      return this.session;
    }
    await this.dispatch({ type: "user_submitted_input", payload: { text } });
    return this.session;
  }

  /** 必要项已填完：确认进入实例化 / 下一阶段 */
  async confirmIntake(): Promise<RuntimeSession> {
    if (this.session.waitingReason?.kind !== "intake") {
      throw new Error("当前不在填空收集阶段");
    }
    await this.dispatch({ type: "user_confirmed_intake", payload: {} });
    this.syncSlotsToBlackboard(this.session);
    return this.session;
  }

  /** 支持按编号（1-based）或 skill name 解析 */
  private async resolveSkillFromUserInput(text: string): Promise<string | null> {
    const trimmed = text.trim();
    const num = Number(trimmed);
    if (Number.isInteger(num) && num >= 1 && num <= this.availableSkills.length) {
      const entry = this.availableSkills[num - 1];
      return resolveSkillId(entry.name);
    }
    return resolveSkillId(trimmed);
  }

  /** 提交总管决策（通常来自 Main Agent / 手动按钮） */
  async submitDecision(decision: MainAgentDecision): Promise<RuntimeSession> {
    await this.dispatch({
      type: "main_agent_decision_created",
      payload: { decision },
    });
    return this.session;
  }

  /** 用户确认 pendingDecision（approve_step）；可顺带钉死下一步 params */
  async approve(stepParams?: CreationFlowStepParams): Promise<RuntimeSession> {
    const id = this.session.pendingDecision?.id;
    if (!id) throw new Error("当前没有待确认的决策");
    if (stepParams && Object.keys(stepParams).length > 0) {
      this.applyProposedStepParams(stepParams);
    }
    const readyErr = this.assertProposedStepReady();
    if (readyErr) throw new Error(readyErr);
    await this.dispatch({ type: "user_approved_next_step", payload: { decisionId: id } });
    return this.session;
  }

  /** 用户拒绝 pendingDecision，回到总管 */
  async rejectStep(reason?: string): Promise<RuntimeSession> {
    const id = this.session.pendingDecision?.id;
    if (!id) throw new Error("当前没有待拒绝的决策");
    await this.dispatch({
      type: "user_rejected_next_step",
      payload: { decisionId: id, reason },
    });
    return this.session;
  }

  /** 将实例 Worker 声明写入 slots，便于 session 持久化与调试 */
  private persistInstanceWorkerDeclaration(): void {
    const active = this.getActiveSkill();
    if (!shouldEnforceWorkerDeclaration(active?.name)) return;

    const declaration = this.getInstanceWorkerDeclaration();
    this.session = {
      ...this.session,
      slots: {
        ...this.session.slots,
        instanceWorkerDeclaration: {
          sourceTag: declaration.sourceTag,
          accepted: declaration.accepted,
          playWorkerIds: declaration.playWorkerIds,
          onDemandWorkerIds: declaration.onDemandWorkerIds,
          designEndWorkerIds: declaration.designEndWorkerIds,
          activeWorkerIds: declaration.activeWorkerIds,
        },
      },
    };
  }

  /** 用户接受 pendingArtifact；创作单位验收 vs 终稿验收分流 */
  async acceptArtifact(
    artifactId?: string,
    opts?: { openingIndex?: number },
  ): Promise<RuntimeSession> {
    const id = artifactId ?? this.session.pendingArtifactId;
    if (!id) throw new Error("当前没有待验收的产物");
    const artifact = this.session.artifacts.find((a) => a.id === id);
    if (artifact && opts?.openingIndex != null && Number.isFinite(opts.openingIndex)) {
      this.session = {
        ...this.session,
        slots: {
          ...this.session.slots,
          [SLOT_OPENING_SELECTED_INDEX]: Math.trunc(opts.openingIndex),
        },
      };
    }
    const unitAccept = artifact ? isDesignUnitArtifact(artifact) : false;
    // 细化终稿写「设计.worker集」，不是单位草稿，但仍须记入已验收步骤，
    // 否则编排器会当成没做完再跑一遍。须在 dispatch 之前写入。
    const shouldRecordStep = Boolean(
      artifact && (unitAccept || artifact.workerId === "design-step"),
    );
    if (artifact && shouldRecordStep) {
      const slots = { ...this.session.slots };
      this.recordCreationUnitAccepted(slots, artifact);
      this.session = { ...this.session, slots };
    }

    await this.dispatch({ type: "user_accepted_artifact", payload: { artifactId: id } });
    this.persistInstanceWorkerDeclaration();

    if (artifact) {
      const result = compressAfterWorkerAccept({
        blackboard: this.blackboard,
        workerId: artifact.workerId,
        outputTags: artifact.outputTags,
        summary: artifact.summary,
        mode: unitAccept ? "unit" : "final",
      });

      const slots: Record<string, unknown> = {
        ...this.session.slots,
        lastCompressBrief: result.briefText,
        lastCompressedWorkerId: artifact.workerId,
      };

      if (shouldRecordStep) {
        const unitId = String(slots[SLOT_CREATION_CURRENT_UNIT] ?? "").trim();
        this.onMessage(
          `[创作单位已验收] ${unitId || artifact.workerId}：${
            artifact.summary?.trim() || "草稿单位"
          }；过程对话将折叠，草稿保留。`,
        );
        slots[SLOT_CREATION_CURRENT_UNIT] = undefined;
        slots[SLOT_CREATION_UNIT_ANCHOR_AT] = undefined;
      }
      if (!unitAccept) {
        this.onMessage(
          `[上下文已压缩] ${artifact.workerId}：保留 ${result.finals.map((f) => f.tag).join("、") || "（无终产物）"}；归档 ${result.archivedTags.length} 个过程 tag。下一阶段以定稿为准。`,
        );
      }

      this.session = { ...this.session, slots };
    }

    return this.session;
  }

  /** 用户拒绝 pendingArtifact：有意见则立刻按「用户.修订说明」在现有产物上改 */
  async rejectArtifact(reason?: string, artifactId?: string): Promise<RuntimeSession> {
    const id = artifactId ?? this.session.pendingArtifactId;
    if (!id) throw new Error("当前没有待拒绝的产物");
    await this.dispatch({
      type: "user_rejected_artifact",
      payload: { artifactId: id, reason },
    });
    return this.session;
  }

  /**
   * 按意见重跑却没写出新产物：退回**本次修订的那一份**产物验收，重试追问改挂为可选。
   * 只认 beginRevisionRerun 钉下的底稿；否则会把无关的旧产物（如上一轮流程编排）
   * 错误地挂回验收面。首跑无产物仍走阻塞追问。
   * @returns true = 已退回验收，调用方应 return
   */
  private async restoreRevisionTargetForReview(
    workerId: string,
    questions: import("../types/questions.js").QuestionItem[] | string[],
  ): Promise<boolean> {
    const targetId = this.session.slots.revisionTargetArtifactId;
    if (typeof targetId !== "string" || !targetId) return false;
    const target = this.session.artifacts.find(
      (a) =>
        a.id === targetId &&
        a.workerId === workerId &&
        a.status === "revision_requested",
    );
    if (!target) return false;
    await this.dispatch({
      type: "worker_revision_produced_nothing",
      payload: { artifactId: target.id, questions },
    });
    return true;
  }

  /** worker 调用 ask_user 能力时，由外层触发此事件（仅无产物时阻塞） */
  async workerAsk(
    questions: import("../types/questions.js").QuestionItem[] | string[],
  ): Promise<RuntimeSession> {
    const workerId = this.session.currentWorkerId;
    if (!workerId) throw new Error("当前没有运行中的 worker");
    this.rememberAskedQuestions(normalizeQuestions(questions));
    await this.dispatch({
      type: "worker_needs_input",
      payload: { workerId, stepId: this.session.currentStepId, questions },
    });
    return this.session;
  }

  private askedQuestionHistory() {
    return parseAskedQuestions(this.session.slots[SLOT_ASKED_QUESTIONS]);
  }

  private rememberAskedQuestions(
    questions: readonly import("../types/questions.js").QuestionItem[],
  ): void {
    if (!questions.length) return;
    const next = appendAskedQuestions(this.askedQuestionHistory(), questions);
    this.session = {
      ...this.session,
      slots: { ...this.session.slots, [SLOT_ASKED_QUESTIONS]: next },
    };
  }

  /**
   * 挂在验收态的可跳过追问：本局问过的不再问一次。
   * 编排层常把上一步已问过的体验题再抛一遍，用户会读成「又要重做那一步」。
   */
  private freshSidecarQuestions(
    questions: readonly import("../types/questions.js").QuestionItem[] | undefined,
  ): import("../types/questions.js").QuestionItem[] | undefined {
    if (!questions?.length) return undefined;
    const fresh = dropAlreadyAskedQuestions(questions, this.askedQuestionHistory());
    if (!fresh.length) return undefined;
    this.rememberAskedQuestions(fresh);
    return fresh;
  }

  /**
   * 验收态下作答或跳过挂载追问：不离开 review_artifact。
   * answersText 缺省 = 跳过。
   */
  async resolveSidecarQuestions(answersText?: string): Promise<RuntimeSession> {
    await this.dispatch({
      type: "user_resolved_sidecar_questions",
      payload: { answersText },
    });
    return this.session;
  }

  /** 写入创作过程对话摘要（design worker contextSegments 用） */
  writeCreationDialogue(transcript: string): void {
    const tag = "创作.对话";
    this.blackboard.write({
      tag,
      content: transcript,
      source: "system",
    });
    this.session = {
      ...this.session,
      slots: { ...this.session.slots, [tag]: transcript },
    };
  }

  /**
   * 手动标记 worker 完成：先创建 artifact 写入 session，再 dispatch worker_completed。
   * 真实 worker 集成时，产物内容应在此之前写入 slots / blackboard。
   */
  async workerComplete(summary?: string): Promise<RuntimeSession> {
    const workerId = this.session.currentWorkerId;
    if (!workerId) throw new Error("当前没有运行中的 worker");

    const artifact = createArtifact({
      workerId,
      stepId: this.session.currentStepId,
      outputTags: ["output.草稿"],
      summary: summary ?? `${workerId} 产物`,
    });
    this.session = { ...this.session, artifacts: [...this.session.artifacts, artifact] };

    await this.dispatch({
      type: "worker_completed",
      payload: { artifactId: artifact.id },
    });
    return this.session;
  }

  /** 非 autoStub 模式下，手动启动 pendingWorkerEffect */
  async startPendingWorker(): Promise<RuntimeSession> {
    const effect = this.pendingWorkerEffect;
    if (!effect) throw new Error("没有待启动的 worker");
    this.pendingWorkerEffect = null;
    await this.runStubWorker(effect, false);
    return this.session;
  }

  /** 消费 applyEvent 返回的 PhaseEffect 列表 */
  private async processEffects(effects: PhaseEffect[]): Promise<void> {
    for (const effect of effects) {
      if (effect.type === "run_worker") {
        debugLog("step", `启动执行单元 ${effect.workerId}`);
      } else if (effect.type === "propose_next_creation_step") {
        debugLog("step", "提案下一步");
      } else if (effect.type === "resume_worker") {
        debugLog("step", `恢复执行单元 ${this.session.resumeContext?.workerId ?? "未知"}`);
      }
      switch (effect.type) {
        case "emit_message":
          this.onMessage(effect.message);
          break;
        case "invoke_main_agent":
          if (!this.mainAgent) {
            this.onMessage(
              "[阶段机] running：等待总管决策。请用 /decide 提交 run_worker 或 finish。",
            );
          }
          break;
        case "run_worker":
          if (this.autoStubWorker) {
            await this.runStubWorker(effect);
          } else if (this.llm) {
            await this.runRealWorker(effect);
          } else {
            this.pendingWorkerEffect = effect;
            this.onMessage(
              `[阶段机] 待启动 worker: ${effect.workerId}。输入 /worker-start`,
            );
          }
          break;
        case "resume_worker": {
          const ctx = this.session.resumeContext;
          if (!ctx) break;
          const workerEffect: Extract<PhaseEffect, { type: "run_worker" }> = {
            type: "run_worker",
            workerId: ctx.workerId,
          };
          if (this.autoStubWorker) {
            await this.runStubWorker(workerEffect);
          } else if (this.llm) {
            await this.runRealWorker(workerEffect);
          } else {
            this.pendingWorkerEffect = workerEffect;
            this.onMessage(`[阶段机] 恢复 worker: ${ctx.workerId}。输入 /worker-start`);
          }
          break;
        }
        case "run_programmatic_review":
          await this.runProgrammaticReview(effect.artifactId);
          break;
        case "propose_next_creation_step":
          await this.proposeNextCreationStep();
          break;
        case "seal_creation_opening":
          this.sealCreationOpening();
          break;
        case "run_play_turn":
          await this.startPlayTurn();
          break;
        case "continue_play_turn":
          await this.continuePlayTurn();
          break;
      }
    }
  }

  /**
   * 用户填完「下一步想写什么」后：有待执行步则提案并进入确认；否则交总管扩步/收口。
   */
  private async proposeNextCreationStep(): Promise<void> {
    if (this.session.slots[SLOT_CREATION_SEALED_BY_OPENING]) {
      this.onMessage(CREATION_SEALED_WAITING_MESSAGE);
      return;
    }
    this.syncSlotsToBlackboard(this.session);
    const flow = parseCreationFlow(
      this.blackboard.getContentByTag(CREATION_FLOW_TAG),
    );
    const accepted = parseAcceptedUnits(
      this.session.slots[SLOT_CREATION_ACCEPTED_UNITS] ??
        this.blackboard.getContentByTag(CREATION_ACCEPTED_UNITS_TAG),
    );
    const pending = nextPendingStep(flow, accepted);
    if (!pending || !flow) {
      debugLog("step", "暂无下一步，交给总管");
      this.session = {
        ...this.session,
        slots: {
          ...this.session.slots,
          [CREATION_PROPOSED_STEP_TAG]: undefined,
        },
      };
      if (this.mainAgent) {
        await this.runMainAgent();
      } else {
        this.onMessage(
          "[阶段机] 暂无下一节点，等待总管编排或补充意向。",
        );
      }
      return;
    }

    const active = this.getActiveSkill();
    let paramSpecs: ModuleParamSpec[] = [];
    let declaration = "";
    let auto = false;
    let kind: ModuleCatalogEntry["kind"];
    let pendingModule: ModuleCatalogEntry | null = null;
    if (active?.name) {
      try {
        const skill = await loadSkill(active.name);
        if (skill.skillPackRoot) {
          const catalog = await loadModuleCatalog(skill.skillPackRoot);
          const mod = catalog?.modules.find((m) => m.name === pending.name);
          paramSpecs = mod?.params ?? [];
          declaration = mod?.declaration?.trim() || "";
          auto = mod?.auto === true;
          kind = mod?.kind;
          pendingModule = mod ?? null;
        }
      } catch {
        /* catalog optional */
      }
    }

    debugLog("step", `提案下一步 ${pending.id}（${pending.name}）`);

    const params = pending.params ? { ...pending.params } : {};
    const paramsMissing = missingRequiredStepParams(pending, pendingModule);

    const intent =
      typeof this.session.slots["用户.下一步意向"] === "string"
        ? String(this.session.slots["用户.下一步意向"]).trim()
        : "";
    const paramHint =
      Object.keys(params).length > 0
        ? `；参数 ${Object.entries(params)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ")}`
        : paramsMissing.length
          ? `；待钉参数：${paramsMissing.join("、")}`
          : "";
    const revise = isReviseStep(pending);
    const reason = [
      revise ? `下一步：回头修改 · ${pending.name}` : `下一步：${pending.name}`,
      declaration ? `—— ${declaration}` : "",
      paramHint,
      intent ? `（你的意向：${intent}）` : "",
    ]
      .filter(Boolean)
      .join("");

    const snapshot = {
      stepId: pending.id,
      name: pending.name,
      declaration: declaration || undefined,
      params,
      paramsMissing,
      paramSpecs: paramSpecs.map((p) => ({
        key: p.key,
        label: p.label,
        required: Boolean(p.required),
        hint: p.hint,
      })),
      intent: intent || undefined,
      ...(kind ? { kind } : {}),
      ...(revise ? { mode: "revise" as const } : {}),
      ...(pending.revises ? { revises: pending.revises } : {}),
    };
    this.blackboard.write({
      tag: CREATION_PROPOSED_STEP_TAG,
      content: JSON.stringify(snapshot),
      source: "runtime",
    });
    this.session = {
      ...this.session,
      slots: {
        ...this.session.slots,
        [CREATION_PROPOSED_STEP_TAG]: JSON.stringify(snapshot),
      },
    };

    const decision = createDecision({
      action: "run_worker",
      workerId: "design-step",
      reason,
      // 程序步（如投影排序）且参数已齐：跳过「同意并开始」，直接执行。
      requiresApproval: !(auto && paramsMissing.length === 0),
    });
    await this.dispatch({
      type: "main_agent_decision_created",
      payload: { decision },
    });
  }

  /**
   * 选定开场白后：把候选落成 输出.开场白 / 初值表，关闭 DAG。
   */
  private sealCreationOpening(): void {
    const selectedRaw = this.session.slots[SLOT_OPENING_SELECTED_INDEX];
    const selectedIndex =
      typeof selectedRaw === "number"
        ? selectedRaw
        : typeof selectedRaw === "string" && selectedRaw.trim()
          ? Number(selectedRaw)
          : 0;

    const fragmentRaw =
      this.blackboard.getContentByTag(OPENING_SETUP_ARTIFACT_TAG) ?? "";
    const payload = parseOpeningSealPayload(fragmentRaw, selectedIndex);
    const existingOpening = this.blackboard.getContentByTag(OPENING_OUTPUT_TAG)?.trim();
    const openingText = payload?.selectedText?.trim() || existingOpening || "";

    if (openingText) {
      this.writeWorkerTagContent(OPENING_OUTPUT_TAG, openingText, "opening-setup");
    }

    if (payload?.variables.length) {
      const source = "worker:opening-setup";
      const initialPatch = mergeOpeningTablePatch(
        this.blackboard.getContentByTag(OPENING_INITIAL_VARS_TAG),
        payload.variables,
        source,
      );
      if (initialPatch) {
        this.writeWorkerTagContent(OPENING_INITIAL_VARS_TAG, initialPatch, "opening-setup");
      }
      const currentPatch = mergeOpeningTablePatch(
        this.blackboard.getContentByTag(OPENING_CURRENT_VARS_TAG),
        payload.variables,
        source,
      );
      if (currentPatch) {
        this.writeWorkerTagContent(OPENING_CURRENT_VARS_TAG, currentPatch, "opening-setup");
      }
    }

    const closed = closeCreationFlowRaw(
      this.blackboard.getContentByTag(CREATION_FLOW_TAG),
    );
    if (closed) {
      this.blackboard.write({
        tag: CREATION_FLOW_TAG,
        content: closed,
        source: "runtime",
      });
    }

    const n = payload?.candidates.length ?? (openingText ? 1 : 0);
    const which =
      n > 1 && payload
        ? `第 ${payload.selectedIndex + 1}/${n} 条`
        : n
          ? "开场白"
          : "开场";
    this.onMessage(
      `[创作收口] 已选定${which}，工作流计划已关闭。可切换到「游玩」。`,
    );

    this.session = {
      ...this.session,
      slots: {
        ...this.session.slots,
        [SLOT_CREATION_SEALED_BY_OPENING]: true,
        [CREATION_FLOW_TAG]: closed ?? this.session.slots[CREATION_FLOW_TAG],
        [OPENING_OUTPUT_TAG]: openingText || this.session.slots[OPENING_OUTPUT_TAG],
      },
    };
  }

  private applyProposedStepParams(params: CreationFlowStepParams): void {
    const raw =
      (typeof this.session.slots[CREATION_PROPOSED_STEP_TAG] === "string"
        ? String(this.session.slots[CREATION_PROPOSED_STEP_TAG])
        : null) ||
      this.blackboard.getContentByTag(CREATION_PROPOSED_STEP_TAG);
    if (!raw?.trim()) return;
    let snap: {
      stepId?: string;
      kind?: string;
      paramSpecs?: Array<{ key: string; required?: boolean }>;
    };
    try {
      snap = JSON.parse(raw) as typeof snap;
    } catch {
      return;
    }
    const stepId = typeof snap.stepId === "string" ? snap.stepId.trim() : "";
    if (!stepId) return;
    const flow = parseCreationFlow(
      this.blackboard.getContentByTag(CREATION_FLOW_TAG),
    );
    if (!flow) return;
    const next = patchCreationFlowStepParams(flow, stepId, params);
    const content = stringifyCreationFlow(next);
    this.blackboard.write({
      tag: CREATION_FLOW_TAG,
      content,
      source: "user",
    });
    const paramsMissing =
      snap.kind === "prior-artifact"
        ? []
        : (snap.paramSpecs ?? [])
            .filter((p) => p.required)
            .map((p) => p.key)
            .filter((key) => {
              const v = params[key];
              return v == null || (typeof v === "string" && !v.trim());
            });
    const snapshot = {
      ...snap,
      params,
      paramsMissing,
    };
    this.blackboard.write({
      tag: CREATION_PROPOSED_STEP_TAG,
      content: JSON.stringify(snapshot),
      source: "runtime",
    });
    this.session = {
      ...this.session,
      slots: {
        ...this.session.slots,
        [CREATION_FLOW_TAG]: content,
        [CREATION_PROPOSED_STEP_TAG]: JSON.stringify(snapshot),
      },
    };
  }

  private assertProposedStepReady(): string | null {
    const decision = this.session.pendingDecision;
    if (decision?.workerId !== "design-step") return null;
    const raw =
      (typeof this.session.slots[CREATION_PROPOSED_STEP_TAG] === "string"
        ? String(this.session.slots[CREATION_PROPOSED_STEP_TAG])
        : null) ||
      this.blackboard.getContentByTag(CREATION_PROPOSED_STEP_TAG);
    if (!raw?.trim()) return null;
    try {
      const snap = JSON.parse(raw) as { paramsMissing?: string[] };
      if (snap.paramsMissing?.length) {
        return `请先补齐必填参数：${snap.paramsMissing.join("、")}`;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private getInstanceWorkerDeclaration() {
    return buildInstanceWorkerDeclaration(
      this.session,
      this.blackboard,
      inferLifecycleStage(this.session),
    );
  }

  /** world-simulator：run_worker 必须在 设计.worker集 声明的 activeWorkerIds 内 */
  private assertWorkerDeclared(workerId: string): void {
    const active = this.getActiveSkill();
    if (!shouldEnforceWorkerDeclaration(active?.name)) return;

    const declaration = this.getInstanceWorkerDeclaration();
    const resolved = resolveWorkerId(workerId);
    if (!declaration.activeWorkerIds.includes(resolved)) {
      throw new Error(formatUndeclaredWorkerError(resolved, declaration));
    }
  }

  private async runRealWorker(
    effect: Extract<PhaseEffect, { type: "run_worker" }>,
  ): Promise<void> {
    this.assertWorkerDeclared(effect.workerId);

    const activeSkill = this.getActiveSkill();
    if (!activeSkill?.name) {
      throw new Error("当前没有 active skill，无法运行 worker");
    }

    const workerId = resolveWorkerId(effect.workerId);

    // 机遇裁定：纯程序，不走 LLM
    if (workerId === "chance") {
      await this.runChanceWorker(effect);
      return;
    }

    if (!this.llm) {
      throw new Error("未配置 LLM，无法运行 worker");
    }
    this.lastWorkerRunSnapshot = {
      workerId,
      runtimeSession: structuredClone(this.session),
      blackboardItems: this.blackboard.exportItems(),
    };

    let slots = { ...this.session.slots };

    this.syncSlotsToBlackboard(this.session);

    if (effect.workerContext?.roleId?.trim()) {
      const roleId = effect.workerContext.roleId.trim();
      slots["世界.当前角色.id"] = roleId;
      this.blackboard.write({
        tag: "世界.当前角色.id",
        content: roleId,
        source: "runtime",
      });
      this.session = { ...this.session, slots };
    }

    const acceptanceMode = resolveAcceptanceModeForWorker({
      session: this.session,
      blackboard: this.blackboard,
      workerId: effect.workerId,
    });

    this.session = (
      await this.dispatch({
        type: "worker_started",
        payload: {
          workerId: effect.workerId,
          stepId: this.session.currentStepId,
          acceptanceMode:
            this.session.resumeContext?.acceptanceMode ?? acceptanceMode,
        },
      })
    ).session;

    if (isDesignDiskWorker(workerId)) {
      this.beginCreationUnitRun(workerId);
    }

    // design-step：能力「默认问题」由程序先发出，等用户首答后再调 LLM
    if (workerId === "design-step") {
      const delivered = await this.maybeDeliverModuleOpening(activeSkill.name);
      if (delivered) return;
    }

    const resolved = await resolveRunnableWorker({
      skillPackName: activeSkill.name,
      workerId: effect.workerId,
      session: this.session,
      blackboard: this.blackboard,
    });
    const worker = resolved.worker;
    this.ensureResidentContextMounted(workerId);
    const workerLlm = resolveWorkerLlmProvider({
      worker,
      bindings: (await loadSkill(activeSkill.name)).workerLlmBindings,
      slots,
      fallbackLlm: this.llm,
    });

    this.onMessage(
      `[Worker] ${workerId} 执行中…${resolved.source === "declaration" ? "（声明驱动）" : ""}`,
    );
    debugLog("step", `调用模型 ${workerId}`);
    this.onWorkerStreamStart?.(workerId);

    try {
      const result = await runWorkerSkill({
        skillName: activeSkill.name,
        workerId: effect.workerId,
        slots,
        blackboard: this.blackboard,
        llm: workerLlm,
        declared: { worker: resolved.worker, promptBody: resolved.promptBody },
        stream: {
          onThinkingDelta: (delta) =>
            this.onWorkerThinkingDelta?.(workerId, delta),
          onOutputDelta: (delta) =>
            this.onWorkerOutputDelta?.(workerId, delta),
        },
      });

    if (result.askUser?.length && Object.keys(result.outputs).length === 0) {
      // 无产物：阻塞追问（信息不足，必须补）
      if (await this.restoreRevisionTargetForReview(workerId, result.askUser)) {
        return;
      }
      await this.workerAsk(result.askUser);
      return;
    }
    if (
      workerId === "design-step" &&
      Object.keys(result.outputs).length === 0
    ) {
      const retryQuestions = result.askUser?.length
        ? result.askUser
        : [
            {
              id: "design-step-retry",
              prompt:
                "这一步还没写出可验收的产物。请再补一点你最在意的体验或参与方式；也可以说「按已有描述先出一版」。",
              allowOther: true,
              required: true,
            },
          ];
      if (await this.restoreRevisionTargetForReview(workerId, retryQuestions)) {
        return;
      }
      await this.workerAsk(retryQuestions);
      return;
    }

    slots = { ...this.session.slots };
    const writtenTags: string[] = [];
    for (const [tag, content] of Object.entries(result.outputs)) {
      if (isProgressPointerTag(tag)) continue;
      const written = this.writeWorkerTagContent(tag, content, workerId);
      slots[tag] = written;
      writtenTags.push(tag);
    }
    this.session = { ...this.session, slots };

    const artifact = createArtifact({
      workerId: effect.workerId,
      stepId: this.session.currentStepId,
      outputTags: (writtenTags.length > 0 ? writtenTags : worker.outputTags).filter(
        (t) => !isProgressPointerTag(t),
      ),
      summary: result.summary,
    });
    this.session = { ...this.session, artifacts: [...this.session.artifacts, artifact] };

    const hasPlayVisible = Object.keys(result.outputs).some(
      (t) => t === "输出.用户展示" || t === "输出.开场白",
    );
    this.onMessage(
      `[Worker] ${workerId} 已完成\n\n${result.preview}${
        !hasPlayVisible && result.preview.length >= 4000 ? "\n\n…" : ""
      }`,
    );

    await this.dispatch({
      type: "worker_completed",
      payload: {
        artifactId: artifact.id,
        // 有产物时 askUser 挂到验收态，不阻断 Accept
        questions: this.freshSidecarQuestions(result.askUser),
        assessment: result.askAssessment?.trim() || undefined,
      },
    });
    this.maybeCompressAcceptedArtifact(artifact.id);
    } finally {
      this.onWorkerStreamDone?.(workerId);
    }
  }

  /** 机遇裁定：程序掷骰/比点/抽签，写入 运行.本轮.机遇 */
  private async runChanceWorker(
    effect: Extract<PhaseEffect, { type: "run_worker" }>,
  ): Promise<void> {
    const workerId = "chance";
    this.lastWorkerRunSnapshot = {
      workerId,
      runtimeSession: structuredClone(this.session),
      blackboardItems: this.blackboard.exportItems(),
    };

    const acceptanceMode = resolveAcceptanceModeForWorker({
      session: this.session,
      blackboard: this.blackboard,
      workerId: effect.workerId,
    });

    this.session = (
      await this.dispatch({
        type: "worker_started",
        payload: {
          workerId: effect.workerId,
          stepId: this.session.currentStepId,
          acceptanceMode:
            this.session.resumeContext?.acceptanceMode ?? acceptanceMode,
        },
      })
    ).session;

    const boardRaw = this.blackboard.getContentByTag("运行.机会请求");
    const batch = resolveChanceBatchRequest({
      workerContext: effect.workerContext ?? null,
      blackboardRequestJson: boardRaw,
    });

    const result = batch?.length
      ? batch.length === 1
        ? executeChance(batch[0]!)
        : executeChanceBatch(batch)
      : (() => {
          const single = resolveChanceRequest({
            workerContext: effect.workerContext ?? null,
            blackboardRequestJson: boardRaw,
          });
          if (single) return executeChance(single);
          return {
            schema: "chance.v1" as const,
            op: "roll" as const,
            ok: false,
            summary:
              "机遇失败：缺少请求（workerContext.chance.requests 或 运行.机会请求）",
            detail: {},
            error: "missing_request",
          };
        })();

    const content = JSON.stringify(result, null, 2);
    const written = this.writeWorkerTagContent(
      "运行.本轮.机遇",
      content,
      workerId,
    );
    this.session = {
      ...this.session,
      slots: { ...this.session.slots, "运行.本轮.机遇": written },
    };

    const artifact = createArtifact({
      workerId: effect.workerId,
      stepId: this.session.currentStepId,
      outputTags: ["运行.本轮.机遇"],
      summary: result.summary,
    });
    this.session = {
      ...this.session,
      artifacts: [...this.session.artifacts, artifact],
    };

    this.onMessage(`[机遇裁定] ${result.summary}\n\n${content}`);

    await this.dispatch({
      type: "worker_completed",
      payload: { artifactId: artifact.id },
    });
    this.maybeCompressAcceptedArtifact(artifact.id);
  }

  /**
   * 占位 worker：worker_started → 可选自动 worker_completed。
   * 演示与单测用，真实环境应替换为真实 worker 调度。
   */
  private async runStubWorker(
    effect: Extract<PhaseEffect, { type: "run_worker" }>,
    autoComplete = true,
  ): Promise<void> {
    this.assertWorkerDeclared(effect.workerId);

    const workerId = resolveWorkerId(effect.workerId);
    this.lastWorkerRunSnapshot = {
      workerId,
      runtimeSession: structuredClone(this.session),
      blackboardItems: this.blackboard.exportItems(),
    };

    const acceptanceMode = resolveAcceptanceModeForWorker({
      session: this.session,
      blackboard: this.blackboard,
      workerId: effect.workerId,
    });

    this.session = (
      await this.dispatch({
        type: "worker_started",
        payload: {
          workerId: effect.workerId,
          stepId: this.session.currentStepId,
          acceptanceMode:
            this.session.resumeContext?.acceptanceMode ?? acceptanceMode,
        },
      })
    ).session;

    this.onMessage(`[Worker 占位] ${effect.workerId} 已开始。`);

    if (!autoComplete) return;

    const lastInput = String(this.session.slots.lastUserInput ?? "");
    const value = `[${effect.workerId} 占位输出]\n${lastInput ? `输入: ${lastInput}\n` : ""}说明: stub worker，后续替换为真实 LLM worker。`;

    const outputTags = await this.resolveWorkerOutputTags(effect.workerId);
    const tagsToWrite = outputTags.length > 0 ? outputTags : ["output.草稿"];

    for (const tag of tagsToWrite) {
      this.blackboard.write({
        tag,
        content: value,
        source: effect.workerId,
      });
    }

    const artifact = createArtifact({
      workerId: effect.workerId,
      stepId: this.session.currentStepId,
      outputTags: tagsToWrite,
      summary: `${effect.workerId} 占位产物`,
    });
    this.session = { ...this.session, artifacts: [...this.session.artifacts, artifact] };

    await this.dispatch({
      type: "worker_completed",
      payload: { artifactId: artifact.id },
    });
    this.maybeCompressAcceptedArtifact(artifact.id);
  }

  /** 表类 tag 走字段格合并，尊重 user 手改与 rev；合并后算边沿副作用 */
  private writeWorkerTagContent(
    tag: string,
    content: string,
    workerId: string,
  ): string {
    const tableTags = new Set(["运行.初始变量", "变量.当前"]);
    let toWrite = content;
    let prevDoc: TableDoc | null = null;
    let nextDoc: TableDoc | null = null;
    if (tableTags.has(tag)) {
      const patch = parseTableDoc(content);
      if (patch) {
        prevDoc = parseTableDoc(this.blackboard.getContentByTag(tag));
        const { doc, skipped } = mergeTableCells({
          current: prevDoc,
          patch,
          actor: `worker:${workerId}`,
        });
        nextDoc = doc;
        toWrite = stringifyTableDoc(doc);
        if (skipped.length) {
          this.onMessage(
            `[表合并] ${tag}：跳过 ${skipped.map((s) => `${s.key}(${s.reason})`).join("、")}`,
          );
        }
      }
    }
    if (tag === CREATION_FLOW_TAG) {
      const merged = mergeCreationFlowPreservingAccepted({
        prevRaw: this.blackboard.getContentByTag(tag),
        nextRaw: toWrite,
        acceptedStepIds: parseAcceptedUnits(
          this.session.slots[SLOT_CREATION_ACCEPTED_UNITS] ??
            this.blackboard.getContentByTag(CREATION_ACCEPTED_UNITS_TAG),
        ),
      });
      toWrite = merged.raw;
      if (merged.restored.length) {
        this.onMessage(
          `[流程编排] 已验收步骤按原样保留：${merged.restored.join("、")}`,
        );
      }
    }
    this.blackboard.write({
      tag,
      content: toWrite,
      source: workerId,
    });
    if (
      inferLifecycleStage(this.session) === "play" &&
      (tag === "输出.用户展示" || tag === "输出.开场白")
    ) {
      this.appendDialogueHistory("助手", toWrite);
    }
    if (nextDoc) {
      this.applyTableSideEffects(prevDoc, nextDoc, workerId);
    }
    // 裁决包 / 旁观维护包 → 合并进变量.当前（可触发 side_effects）
    if (tag === SETTLEMENT_TAG) {
      this.applySettlementVariableChanges(toWrite, workerId);
    } else if (tag === MAINTAIN_TAG) {
      this.applyMaintainTableOps(toWrite, workerId);
    }
    return toWrite;
  }

  /** settlement.v1.variable_changes → 变量.当前 */
  private applySettlementVariableChanges(
    settlementRaw: string,
    workerId: string,
  ): void {
    const view = parseSettlementPacket(settlementRaw);
    const changes = view.packet?.variable_changes;
    if (!view.ok || !changes?.length) return;
    const current = parseTableDoc(
      this.blackboard.getContentByTag("变量.当前"),
    );
    const patch = settlementChangesToTablePatch(changes, current);
    if (!patch) return;
    this.writeWorkerTagContent(
      "变量.当前",
      stringifyTableDoc(patch),
      workerId,
    );
    this.onMessage(
      `[裁决合并] 变量.当前 ← ${changes.map((c) => c.key).join("、")}`,
    );
  }

  /** maintain.v1.table_ops → 变量.当前（及其他已支持表） */
  private applyMaintainTableOps(maintainRaw: string, workerId: string): void {
    const view = parseMaintainPacket(maintainRaw);
    const ops = view.packet?.table_ops;
    if (!view.ok || !ops?.length) {
      if (view.ok && view.packet?.need_generate) {
        this.applyMaintainNeedGenerateSampling(view.packet.need_generate, workerId);
      }
      return;
    }
    const current = parseTableDoc(
      this.blackboard.getContentByTag("变量.当前"),
    );
    const patch = maintainOpsToTablePatch(ops, current, "变量.当前");
    if (!patch) return;
    this.writeWorkerTagContent(
      "变量.当前",
      stringifyTableDoc(patch),
      workerId,
    );
    const keys = ops
      .filter((o) => (o.tag?.trim() || "变量.当前") === "变量.当前")
      .map((o) => o.key);
    if (keys.length) {
      this.onMessage(`[旁观维护] 变量.当前 ← ${keys.join("、")}`);
    }
    if (view.packet?.need_generate) {
      this.applyMaintainNeedGenerateSampling(view.packet.need_generate, workerId);
    }
  }

  /** need_generate：按生成规则合同程序批量抽样，写入 运行.本轮.旁观.生成抽样 */
  private applyMaintainNeedGenerateSampling(
    need: { rule_id: string; reason: string },
    workerId: string,
  ): void {
    const rulesRaw = this.blackboard.getContentByTag("设计.生成规则");
    const result = runMaintainNeedGenerateSampling({
      need,
      generationRulesRaw: rulesRaw,
    });
    if (!result) {
      this.onMessage(
        `[旁观维护] need_generate=${need.rule_id}：未找到可抽样的池（请检查设计.生成规则）`,
      );
      return;
    }
    const content = JSON.stringify(
      { rule_id: need.rule_id, reason: need.reason, chance: result },
      null,
      2,
    );
    this.writeWorkerTagContent(MAINTAIN_GENERATE_TAG, content, workerId);
    this.onMessage(`[旁观维护] 生成抽样 ${need.rule_id}：${result.summary}`);
  }

  /** 避免 syncSlots 重复把同一句用户输入追加进历史 */
  private lastAppendedUserHistory = "";

  /** 追加一轮到黑板「对话.历史」（排序表可投影裁剪） */
  private appendDialogueHistory(role: "用户" | "助手" | "系统", text: string): void {
    const body = text.trim();
    if (!body) return;
    if (role === "用户") {
      if (this.lastAppendedUserHistory === body) return;
      this.lastAppendedUserHistory = body;
    }
    const prev = this.blackboard.getContentByTag(DIALOGUE_HISTORY_TAG) ?? "";
    const next = appendDialogueHistoryTurn(prev, { role, text: body });
    if (next === prev.trim()) return;
    this.blackboard.write({
      tag: DIALOGUE_HISTORY_TAG,
      content: next,
      source: "runtime",
    });
    this.session = {
      ...this.session,
      slots: { ...this.session.slots, [DIALOGUE_HISTORY_TAG]: next },
    };
  }

  /** 从 Worker 集 tables.side_effects 算边沿触发并写 tag / 记 fired */
  private applyTableSideEffects(
    prev: TableDoc | null,
    next: TableDoc,
    workerId: string,
  ): void {
    const raw = readWorkerSetYamlForDeclaration(this.blackboard, this.session);
    const parsed = raw ? parseWorkerSetYaml(raw.yaml) : null;
    const rules = parseSideEffectRules(parsed?.tables);
    if (rules.length === 0) return;

    const fired = parseFiredRegistry(
      this.blackboard.getContentByTag(SIDE_EFFECT_FIRED_TAG),
    );
    const { triggers, nextFired, queuedWorkers } = evaluateSideEffects({
      prev,
      next,
      rules,
      fired,
    });
    if (triggers.length === 0) return;

    const { writtenTags } = applySideEffectTagActions({
      blackboard: this.blackboard,
      triggers,
      source: `side-effect:${workerId}`,
    });
    this.blackboard.write({
      tag: SIDE_EFFECT_FIRED_TAG,
      content: stringifyFiredRegistry(nextFired),
      source: "system:table-side-effect",
    });

    const ruleIds = triggers.map((t) => t.rule.id).join("、");
    this.onMessage(
      `[表副作用] 边沿触发 ${ruleIds}` +
        (writtenTags.length ? ` → 写入 ${writtenTags.join("、")}` : "") +
        (queuedWorkers.length
          ? `；建议调度 ${queuedWorkers.map((q) => q.workerId).join("、")}`
          : ""),
    );

    if (queuedWorkers.length) {
      this.session = {
        ...this.session,
        slots: {
          ...this.session.slots,
          pendingSideEffectWorkers: JSON.stringify(queuedWorkers),
        },
      };
    }
  }

  /** 按规格把常驻上下文写入黑板，供本 worker inputTags 读取 */
  private ensureResidentContextMounted(workerId: string): void {
    const raw = readWorkerSetYamlForDeclaration(this.blackboard, this.session);
    const parsed = raw ? parseWorkerSetYaml(raw.yaml) : null;
    const entries = parseResidentContext(parsed?.resident_context);
    if (entries.length === 0) return;
    writeResidentContextTags({
      blackboard: this.blackboard,
      entries,
      workerId,
      source: "system:resident-context",
    });
  }

  /**
   * 若本步能力声明了默认问题且尚未收过首答：写开场白、workerAsk，不调 LLM。
   * @returns true = 已进入等待用户，调用方应 return
   */
  private async maybeDeliverModuleOpening(
    skillPackName: string,
  ): Promise<boolean> {
    const skill = await loadSkill(skillPackName);
    const packRoot = skill.skillPackRoot;
    if (!packRoot) return false;

    const flowRaw = this.blackboard.getContentByTag(CREATION_FLOW_TAG);
    const currentStepName =
      this.blackboard.getContentByTag(CREATION_CURRENT_STEP_TAG)?.trim() ||
      String(this.session.slots[SLOT_CREATION_CURRENT_UNIT] ?? "").trim();
    const accepted = parseAcceptedUnits(
      this.session.slots[SLOT_CREATION_ACCEPTED_UNITS] ??
        this.blackboard.getContentByTag(CREATION_ACCEPTED_UNITS_TAG),
    );

    const binding = await resolveDesignStepBinding({
      skillPackRoot: packRoot,
      flowRaw,
      currentStepName,
      acceptedStepNames: accepted,
    });
    if (!binding?.opening?.trim()) return false;

    const stepKey = stepUnitId(binding.step);
    const state = parseModuleOpeningState(
      this.session.slots[SLOT_CREATION_MODULE_OPENING_STATE] ??
        this.blackboard.getContentByTag(CREATION_MODULE_OPENING_STATE_TAG),
    );
    const phase = state[stepKey];

    if (phase === "answered") return false;

    // 配方开局模块 + 用户首句已在「用户.需求」→ 默认视为 opening 已做完，直接进 LLM
    const demand = (
      this.blackboard.getContentByTag("用户.需求") ??
      this.session.slots["用户.需求"] ??
      ""
    )
      .toString()
      .trim();
    if (
      shouldSkipModuleOpening({
        demand,
        dependsOn: binding.step.depends_on,
        phase,
      })
    ) {
      state[stepKey] = "answered";
      const raw = stringifyModuleOpeningState(state);
      this.blackboard.write({
        tag: CREATION_MODULE_OPENING_STATE_TAG,
        content: raw,
        source: "runtime",
      });
      this.blackboard.write({
        tag: CREATION_MODULE_OPENING_TAG,
        content: "（已跳过默认问题：用户首句见「用户.需求」）",
        source: "runtime",
      });
      this.session = {
        ...this.session,
        slots: {
          ...this.session.slots,
          [SLOT_CREATION_MODULE_OPENING_STATE]: raw,
          [CREATION_MODULE_OPENING_TAG]:
            "（已跳过默认问题：用户首句见「用户.需求」）",
        },
      };
      this.onMessage(
        `[系统] ${binding.module.name} · 已坐在配方开局步，首句见「用户.需求」，跳过默认问题`,
      );
      return false;
    }

    if (phase === "shown" && this.session.resumeContext) {
      // 用户刚答完默认问题 → 标记已答，继续走 LLM
      state[stepKey] = "answered";
      const raw = stringifyModuleOpeningState(state);
      this.blackboard.write({
        tag: CREATION_MODULE_OPENING_STATE_TAG,
        content: raw,
        source: "runtime",
      });
      this.session = {
        ...this.session,
        slots: {
          ...this.session.slots,
          [SLOT_CREATION_MODULE_OPENING_STATE]: raw,
        },
        resumeContext: undefined,
      };
      return false;
    }

    if (phase === "shown" && !this.session.resumeContext) {
      // 异常重入：开场已发过但未走 resume；避免死循环，直接进 LLM
      state[stepKey] = "answered";
      const raw = stringifyModuleOpeningState(state);
      this.blackboard.write({
        tag: CREATION_MODULE_OPENING_STATE_TAG,
        content: raw,
        source: "runtime",
      });
      this.session = {
        ...this.session,
        slots: {
          ...this.session.slots,
          [SLOT_CREATION_MODULE_OPENING_STATE]: raw,
        },
      };
      return false;
    }

    // 首次：发出默认问题
    state[stepKey] = "shown";
    const raw = stringifyModuleOpeningState(state);
    this.blackboard.write({
      tag: CREATION_MODULE_OPENING_TAG,
      content: binding.opening.trim(),
      source: "runtime",
    });
    this.blackboard.write({
      tag: CREATION_MODULE_OPENING_STATE_TAG,
      content: raw,
      source: "runtime",
    });
    this.session = {
      ...this.session,
      slots: {
        ...this.session.slots,
        [CREATION_MODULE_OPENING_TAG]: binding.opening.trim(),
        [SLOT_CREATION_MODULE_OPENING_STATE]: raw,
      },
    };

    const questions = normalizeQuestions([
      {
        id: MODULE_OPENING_QUESTION_ID,
        prompt: binding.opening.trim(),
        allowOther: true,
        required: true,
      },
    ]);
    // 正文由说话面 openingGuide 展示（对齐美学纲领）；workerAsk 只发短调度句
    await this.workerAsk(questions);
    return true;
  }

  /** design-flow / design-step：钉当前步骤 */
  private beginCreationUnitRun(workerId: string): void {
    const accepted = parseAcceptedUnits(
      this.session.slots[SLOT_CREATION_ACCEPTED_UNITS] ??
        this.blackboard.getContentByTag(CREATION_ACCEPTED_UNITS_TAG),
    );

    let current =
      this.blackboard.getContentByTag(CREATION_CURRENT_UNIT_TAG)?.trim() ||
      String(this.session.slots[SLOT_CREATION_CURRENT_UNIT] ?? "").trim();

    if (workerId === "design-flow") {
      current = "flow";
    } else if (workerId === "design-step") {
      const flow = parseCreationFlow(
        this.blackboard.getContentByTag(CREATION_FLOW_TAG),
      );
      const pending = nextPendingStep(flow, accepted);
      current = pending ? stepUnitId(pending) : current || "（无待执行步骤）";
      this.blackboard.write({
        tag: CREATION_CURRENT_STEP_TAG,
        content: current,
        source: "runtime",
      });
    }

    if (!current) current = "flow";

    debugLog("step", `钉住当前步骤 ${workerId} → ${current}`);

    const anchorAt = new Date().toISOString();
    this.blackboard.write({
      tag: CREATION_CURRENT_UNIT_TAG,
      content: current,
      source: "runtime",
    });
    this.blackboard.write({
      tag: CREATION_ACCEPTED_UNITS_TAG,
      content: JSON.stringify(accepted),
      source: "runtime",
    });
    this.session = {
      ...this.session,
      slots: {
        ...this.session.slots,
        [SLOT_CREATION_CURRENT_UNIT]: current,
        [SLOT_CREATION_ACCEPTED_UNITS]: accepted,
        [SLOT_CREATION_UNIT_ANCHOR_AT]: anchorAt,
      },
    };
  }

  private recordCreationUnitAccepted(
    slots: Record<string, unknown>,
    artifact: { summary?: string; outputTags: string[]; workerId?: string },
  ): void {
    const fromBoard = this.blackboard.getContentByTag(CREATION_CURRENT_UNIT_TAG)?.trim();
    const fromSlot = String(slots[SLOT_CREATION_CURRENT_UNIT] ?? "").trim();
    const fromStep = this.blackboard.getContentByTag(CREATION_CURRENT_STEP_TAG)?.trim();
    const fromSummary = artifact.summary?.match(/单位\s+([^\s·]+)/)?.[1]?.trim();
    // 接受工作流计划 ≠ 某一步做完；「flow」不得写入已验收步骤
    if (artifact.workerId === "design-flow") return;
    const prev = parseAcceptedUnits(
      slots[SLOT_CREATION_ACCEPTED_UNITS] ??
        this.blackboard.getContentByTag(CREATION_ACCEPTED_UNITS_TAG),
    );
    const unitId =
      artifact.workerId === "design-step"
        ? pickRecordedStepId({
            flow: parseCreationFlow(
              this.blackboard.getContentByTag(CREATION_FLOW_TAG),
            ),
            alreadyAccepted: prev,
            pinnedUnitId: fromSlot || fromBoard,
            writtenCurrentStep: fromStep,
            summaryHint: fromSummary,
          }) ?? ""
        : fromBoard || fromSlot || fromSummary || "";
    if (!unitId || unitId === "flow") return;
    const next = unitId && !prev.includes(unitId) ? [...prev, unitId] : prev;
    if (next !== prev) {
      debugLog("step", `验收步骤 ${unitId}  已验收 ${next.join("、")}`);
    }
    slots[SLOT_CREATION_ACCEPTED_UNITS] = next;
    slots[SLOT_CREATION_CURRENT_UNIT] = unitId || undefined;
    this.blackboard.write({
      tag: CREATION_ACCEPTED_UNITS_TAG,
      content: JSON.stringify(next),
      source: "runtime",
    });

    // 前情提要：写入该单位「最后一次验收」的内容切片
    if (unitId) {
      let slice: unknown = null;
      if (artifact.workerId === "design-step" || artifact.workerId === "design-flow") {
        const pack = this.getActiveSkill()?.skillPackRoot;
        // skillPackRoot may not be on snapshot — resolve via artifact tags
        const contentTag =
          artifact.outputTags.find(
            (t) => t !== CREATION_CURRENT_STEP_TAG && t !== CREATION_CURRENT_UNIT_TAG,
          ) || artifact.outputTags[0];
        if (contentTag) {
          const raw = this.blackboard.getContentByTag(contentTag)?.trim();
          if (raw) {
            try {
              slice = JSON.parse(raw);
            } catch {
              slice = raw;
            }
          }
        }
        void pack;
      } else {
        const draftRaw =
          this.blackboard.getContentByTag(WORKER_SET_DRAFT_TAG)?.trim() ||
          this.blackboard.getContentByTag(WORKER_SET_FINAL_TAG)?.trim() ||
          "";
        const parsed = draftRaw ? parseWorkerSetYaml(draftRaw) : null;
        slice = extractUnitContentFromDraft(parsed, unitId);
      }
      if (slice != null) {
        const existing = this.blackboard.getContentByTag(CREATION_ACCEPTED_CONTENT_TAG);
        const updated = upsertAcceptedUnitContent(existing, {
          unitId,
          content: slice,
          summary: artifact.summary,
        });
        this.blackboard.write({
          tag: CREATION_ACCEPTED_CONTENT_TAG,
          content: updated,
          source: "runtime",
        });
        slots[CREATION_ACCEPTED_CONTENT_TAG] = updated;
      }
    }
  }

  private maybeCompressAcceptedArtifact(artifactId: string): void {
    const artifact = this.session.artifacts.find((a) => a.id === artifactId);
    if (!artifact || artifact.status !== "accepted") return;
    const result = compressAfterWorkerAccept({
      blackboard: this.blackboard,
      workerId: artifact.workerId,
      outputTags: artifact.outputTags,
      summary: artifact.summary,
    });
    this.session = {
      ...this.session,
      slots: {
        ...this.session.slots,
        lastCompressBrief: result.briefText,
        lastCompressedWorkerId: artifact.workerId,
      },
    };
    this.onMessage(
      `[上下文已压缩] ${artifact.workerId}：保留 ${result.finals.map((f) => f.tag).join("、") || "（无终产物）"}；归档 ${result.archivedTags.length} 个过程 tag。下一阶段以定稿为准。`,
    );
  }

  private async resolveWorkerOutputTags(workerId: string): Promise<string[]> {
    const active = this.getActiveSkill();
    if (!active?.name) return [];
    try {
      const resolved = await resolveRunnableWorker({
        skillPackName: active.name,
        workerId,
        session: this.session,
        blackboard: this.blackboard,
      });
      return resolved.worker.outputTags;
    } catch {
      return [];
    }
  }

  /** 简易程序验收：summary 非空则通过，否则 revision */
  private async runProgrammaticReview(artifactId: string): Promise<void> {
    await this.dispatch({ type: "programmatic_review_started", payload: { artifactId } });

    const artifact = this.session.artifacts.find((a) => a.id === artifactId);
    const passed = Boolean(artifact?.summary && artifact.summary.length > 0);

    await this.dispatch(
      passed
        ? { type: "programmatic_review_passed", payload: { artifactId } }
        : {
            type: "programmatic_review_failed",
            payload: { artifactId, reason: "产物 summary 为空" },
          },
    );
  }

  /** 游玩：按 playWorkerIds 开一轮 */
  private async startPlayTurn(): Promise<void> {
    this.syncSlotsToBlackboard(this.session);
    this.clearPlayRoundTransientTags();
    const ids = this.getInstanceWorkerDeclaration().playWorkerIds;
    if (!ids.length) {
      this.onMessage(
        "[游玩] 运行规格里没有可上场的执行单元，无法推进回合。",
      );
      this.waitForPlayInput();
      return;
    }
    const [first, ...rest] = ids;
    this.session = {
      ...this.session,
      slots: withPlayTurnQueue(this.session.slots, rest),
    };
    await this.processEffects([{ type: "run_worker", workerId: first }]);
  }

  /** 游玩：跑管线下一个；队空则等用户 */
  private async continuePlayTurn(): Promise<void> {
    if (this.session.phase === "waiting_user") return;
    const queue = readPlayTurnQueue(this.session.slots);
    if (!queue.length) {
      this.waitForPlayInput();
      return;
    }
    const [next, ...rest] = queue;
    this.session = {
      ...this.session,
      slots: withPlayTurnQueue(this.session.slots, rest),
    };
    await this.processEffects([{ type: "run_worker", workerId: next }]);
  }

  private waitForPlayInput(): void {
    this.session = {
      ...this.session,
      phase: "waiting_user",
      waitingReason: { kind: "input" },
      currentWorkerId: undefined,
      pendingArtifactId: undefined,
      pendingDecision: undefined,
      resumeContext: undefined,
      slots: withPlayTurnQueue(this.session.slots, undefined),
      updatedAt: new Date().toISOString(),
    };
  }

  /** 新回合开始前归档上一轮 transient 产物（表合并结果保留在 变量.当前） */
  private clearPlayRoundTransientTags(): void {
    const slots = { ...this.session.slots };
    const archivedAt = new Date().toISOString();
    for (const tag of PLAY_ROUND_TRANSIENT_TAGS) {
      const hadBoard = this.blackboard.getLatestByTag(tag) != null;
      const hadSlot = tag in slots;
      if (!hadBoard && !hadSlot) continue;
      this.blackboard.write({
        tag,
        content: "",
        source: "runtime",
        metadata: {
          role: "archived",
          archivedAt,
          reason: "play_round_reset",
        },
      });
      delete slots[tag];
    }
    this.session = { ...this.session, slots };
  }

  /** invoke_main_agent 副作用：running 时调用总管 LLM，链式推进直到需用户介入 */
  private async maybeRunMainAgent(effects: PhaseEffect[]): Promise<void> {
    if (inferLifecycleStage(this.session) === "play") return;
    if (this.session.slots[SLOT_CREATION_SEALED_BY_OPENING]) return;
    if (this.mainAgent && effects.some((e) => e.type === "invoke_main_agent")) {
      await this.runMainAgent();
    }
  }

  private async runMainAgent(): Promise<void> {
    if (!this.mainAgent || this.session.phase !== "running") {
      return;
    }

    debugLog("step", "总管开始");
    const availableWorkers = await this.resolveAvailableWorkers();

    const decision = await this.mainAgent.runToolLoop(
      {
        session: this.session,
        blackboardIndex: this.blackboard.listTagIndex(),
        availableWorkers,
      },
      {
        handlers: {
          readBlackboard: (tags) => this.readBlackboardForAgent(tags),
          listWorkers: () => availableWorkers,
          listArtifacts: () =>
            this.session.artifacts.map((a) => ({
              id: a.id,
              workerId: a.workerId,
              status: a.status,
              summary: a.summary,
              outputTags: a.outputTags,
            })),
          onToolCall: (name, detail) => {
            const preview =
              detail.length > 120 ? `${detail.slice(0, 120)}…` : detail;
            this.onMessage(`[总管 tool] ${name}${preview ? `: ${preview}` : ""}`);
          },
          onThinkingDelta: (delta) => {
            this.onAgentThinkingDelta?.(delta);
          },
          onThinkingDone: (text) => {
            this.onAgentThinkingDone?.(text);
            this.onMessage(`[总管 思考]\n\n${text}`);
          },
        },
      },
    );

    debugLog(
      "step",
      `总管决策 ${labelAction(decision.action)}${decision.workerId ? ` ${decision.workerId}` : ""}`,
    );
    this.onMessage(`[总管] ${decision.action}: ${decision.reason}`);

    const result = this.commitEvent({
      type: "main_agent_decision_created",
      payload: { decision },
    });

    if (result.error) {
      this.onMessage(result.error);
    }

    await this.processEffects(result.effects);
    await this.maybeRunMainAgent(result.effects);
  }

  /** 总管 read_blackboard tool：按 tag 或模式读取正文 */
  private readBlackboardForAgent(tags: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const pattern of tags) {
      const items = this.blackboard.queryByPatterns([pattern], "latest");
      if (items.length === 0) {
        const slotVal = this.session.slots[pattern];
        if (typeof slotVal === "string" && slotVal.trim()) {
          out[pattern] = slotVal.trim();
        } else {
          out[pattern] = "";
        }
        continue;
      }
      for (const item of items) {
        out[item.tag] = item.content;
      }
    }
    return out;
  }

  private async resolveAvailableWorkers(): Promise<
    Array<{ id: string; description: string }>
  > {
    const active = this.getActiveSkill();
    if (!active?.name) return [...DEFAULT_WORKERS];
    try {
      const workers = await listWorkerSkills(active.name);
      const installed = workers.map((w) => ({ id: w.id, description: w.description }));

      if (!shouldEnforceWorkerDeclaration(active.name)) {
        return installed.length > 0 ? installed : [...DEFAULT_WORKERS];
      }

      const declaration = this.getInstanceWorkerDeclaration();
      const merged = mergeDeclaredWorkersForAgent(installed, declaration);
      return merged.length > 0 ? merged : installed;
    } catch {
      return [...DEFAULT_WORKERS];
    }
  }
}

/** 构造总管决策，强制 statePatchAllowed=false */
export function createDecision(
  partial: Omit<MainAgentDecision, "id" | "statePatchAllowed"> &
    Partial<Pick<MainAgentDecision, "id">>,
): MainAgentDecision {
  return {
    id: partial.id ?? randomUUID(),
    statePatchAllowed: false,
    ...partial,
  };
}

/** CLI 调试：单行摘要当前会话状态 */
export function formatSession(session: RuntimeSession): string {
  const active = session.slots.activeSkill as ActiveSkillSnapshot | undefined;
  const lines = [
    `phase: ${session.phase}`,
    session.waitingReason ? `waitingReason: ${session.waitingReason.kind}` : null,
    active ? `skill: ${active.name}` : null,
    session.slots.startupCompleted ? "startup: done" : null,
    session.slots["book.brief"] ? "book.brief: yes" : null,
    session.currentWorkerId ? `worker: ${session.currentWorkerId}` : null,
    `artifacts: ${session.artifacts.length}`,
    `events: ${session.history.length}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** 集成测试用：从 start 到 finish 的最小闭环脚本 */
export async function runMinimalClosedLoop(
  runtime: PhaseRuntime,
): Promise<RuntimeSession> {
  await runtime.startWithOrchestrator("world-simulator");
  await runtime.submitInput("科幻长篇，带世界运转，约 20 万字交互");
  const decision = createDecision({
    action: "run_worker",
    reason: "根据用户需求产出 Worker 集",
    workerId: "design-flow",
    requiresApproval: false,
  });
  await runtime.submitDecision(decision);

  if (runtime.getSession().currentWorkerId) {
    await runtime.workerComplete();
  }

  if (runtime.getSession().pendingArtifactId) {
    await runtime.acceptArtifact();
  }

  await runtime.submitDecision(
    createDecision({ action: "finish", reason: "演示结束", requiresApproval: false }),
  );

  return runtime.getSession();
}
