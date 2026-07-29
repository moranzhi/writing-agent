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
  CREATION_MODULE_OPENING_TAG,
  CREATION_MODULE_OPENING_STATE_TAG,
  SLOT_CREATION_MODULE_OPENING_STATE,
  nextPendingStep,
  parseCreationFlow,
  parseModuleOpeningState,
  resolveDesignStepBinding,
  stepUnitId,
  stringifyModuleOpeningState,
} from "../skills/creation-flow.js";
import { normalizeQuestions } from "../skills/question-protocol.js";
import { parseWorkerSetYaml } from "../skills/worker-set-parse.js";
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

  /** 统一事件入口：applyEvent + 更新 session + 处理 effects + 可选总管 LLM */
  async dispatch(event: RuntimeEvent): Promise<ApplyEventResult> {
    const result = applyEvent(this.session, event);
    this.session = result.session;

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
    }
    const workerReply = session.slots["用户.worker答复"];
    if (typeof workerReply === "string" && workerReply.trim()) {
      this.blackboard.write({
        tag: "用户.worker答复",
        content: workerReply.trim(),
        source: "user",
      });
    }
    const revision = session.slots.revisionInstruction;
    if (typeof revision === "string" && revision.trim()) {
      this.blackboard.write({
        tag: "用户.修改说明",
        content: revision.trim(),
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

  /** 用户确认 pendingDecision（approve_step） */
  async approve(): Promise<RuntimeSession> {
    const id = this.session.pendingDecision?.id;
    if (!id) throw new Error("当前没有待确认的决策");
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
          designEndWorkerIds: declaration.designEndWorkerIds,
          activeWorkerIds: declaration.activeWorkerIds,
        },
      },
    };
  }

  /** 用户接受 pendingArtifact；创作单位验收 vs 终稿验收分流 */
  async acceptArtifact(artifactId?: string): Promise<RuntimeSession> {
    const id = artifactId ?? this.session.pendingArtifactId;
    if (!id) throw new Error("当前没有待验收的产物");
    const artifact = this.session.artifacts.find((a) => a.id === id);
    await this.dispatch({ type: "user_accepted_artifact", payload: { artifactId: id } });
    this.persistInstanceWorkerDeclaration();

    if (artifact) {
      const unitAccept = isDesignUnitArtifact(artifact);
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

      if (unitAccept) {
        this.recordCreationUnitAccepted(slots, artifact);
        const unitId = String(slots[SLOT_CREATION_CURRENT_UNIT] ?? "").trim();
        this.onMessage(
          `[创作单位已验收] ${unitId || artifact.workerId}：${
            artifact.summary?.trim() || "草稿单位"
          }；过程对话将折叠，草稿保留。`,
        );
        slots[SLOT_CREATION_CURRENT_UNIT] = undefined;
        slots[SLOT_CREATION_UNIT_ANCHOR_AT] = undefined;
      } else {
        this.onMessage(
          `[上下文已压缩] ${artifact.workerId}：保留 ${result.finals.map((f) => f.tag).join("、") || "（无终产物）"}；归档 ${result.archivedTags.length} 个过程 tag。下一阶段以定稿为准。`,
        );
      }

      this.session = { ...this.session, slots };
    }

    return this.session;
  }

  /** 用户拒绝 pendingArtifact，进入 revision */
  async rejectArtifact(reason?: string, artifactId?: string): Promise<RuntimeSession> {
    const id = artifactId ?? this.session.pendingArtifactId;
    if (!id) throw new Error("当前没有待拒绝的产物");
    await this.dispatch({
      type: "user_rejected_artifact",
      payload: { artifactId: id, reason },
    });
    return this.session;
  }

  /** worker 调用 ask_user 能力时，由外层触发此事件（仅无产物时阻塞） */
  async workerAsk(
    questions: import("../types/questions.js").QuestionItem[] | string[],
  ): Promise<RuntimeSession> {
    const workerId = this.session.currentWorkerId;
    if (!workerId) throw new Error("当前没有运行中的 worker");
    await this.dispatch({
      type: "worker_needs_input",
      payload: { workerId, stepId: this.session.currentStepId, questions },
    });
    return this.session;
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
      }
    }
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
    if (!this.llm) {
      throw new Error("未配置 LLM，无法运行 worker");
    }

    const workerId = resolveWorkerId(effect.workerId);
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
    this.onWorkerStreamStart?.(workerId);

    try {
      const result = await runWorkerSkill({
        skillName: activeSkill.name,
        workerId: effect.workerId,
        slots,
        blackboard: this.blackboard,
        llm: workerLlm,
        declared:
          resolved.source === "declaration"
            ? { worker: resolved.worker, promptBody: resolved.promptBody }
            : undefined,
        stream: {
          onThinkingDelta: (delta) =>
            this.onWorkerThinkingDelta?.(workerId, delta),
          onOutputDelta: (delta) =>
            this.onWorkerOutputDelta?.(workerId, delta),
        },
      });

    if (result.askUser?.length && Object.keys(result.outputs).length === 0) {
      // 无产物：阻塞追问（信息不足，必须补）
      await this.workerAsk(result.askUser);
      return;
    }

    slots = { ...this.session.slots };
    for (const [tag, content] of Object.entries(result.outputs)) {
      const written = this.writeWorkerTagContent(tag, content, workerId);
      slots[tag] = written;
    }
    this.session = { ...this.session, slots };

    const artifact = createArtifact({
      workerId: effect.workerId,
      stepId: this.session.currentStepId,
      outputTags:
        Object.keys(result.outputs).length > 0
          ? Object.keys(result.outputs)
          : worker.outputTags,
      summary: result.summary,
    });
    this.session = { ...this.session, artifacts: [...this.session.artifacts, artifact] };

    this.onMessage(
      `[Worker] ${workerId} 已完成\n\n${result.preview}${result.preview.length >= 4000 ? "\n\n…" : ""}`,
    );

    await this.dispatch({
      type: "worker_completed",
      payload: {
        artifactId: artifact.id,
        // 有产物时 askUser 挂到验收态，不阻断 Accept
        questions: result.askUser?.length ? result.askUser : undefined,
      },
    });
    this.maybeCompressAcceptedArtifact(artifact.id);
    } finally {
      this.onWorkerStreamDone?.(workerId);
    }
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
    this.blackboard.write({
      tag,
      content: toWrite,
      source: workerId,
    });
    if (nextDoc) {
      this.applyTableSideEffects(prevDoc, nextDoc, workerId);
    }
    return toWrite;
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
        id: "module-opening",
        prompt: binding.opening.trim(),
        allowOther: true,
        required: true,
      },
    ]);
    this.onMessage(
      `[Worker] ${binding.module.name} · 默认问题（程序）：\n${binding.opening.trim()}`,
    );
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
    const unitId =
      (artifact.workerId === "design-step" ? fromStep : "") ||
      fromBoard ||
      fromSlot ||
      fromSummary ||
      "";
    const prev = parseAcceptedUnits(
      slots[SLOT_CREATION_ACCEPTED_UNITS] ??
        this.blackboard.getContentByTag(CREATION_ACCEPTED_UNITS_TAG),
    );
    const next = unitId && !prev.includes(unitId) ? [...prev, unitId] : prev;
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

  /** invoke_main_agent 副作用：running 时调用总管 LLM，链式推进直到需用户介入 */
  private async maybeRunMainAgent(effects: PhaseEffect[]): Promise<void> {
    if (this.mainAgent && effects.some((e) => e.type === "invoke_main_agent")) {
      await this.runMainAgent();
    }
  }

  private async runMainAgent(): Promise<void> {
    if (!this.mainAgent || this.session.phase !== "running") {
      return;
    }

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

    this.onMessage(`[总管] ${decision.action}: ${decision.reason}`);

    const result = applyEvent(this.session, {
      type: "main_agent_decision_created",
      payload: { decision },
    });
    this.session = result.session;

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
