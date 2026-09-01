import { randomUUID } from "node:crypto";
import { appendBookSession, getBook, updateBook } from "../book/store.js";
import { loadBookSession, saveBookSession } from "../book/session-store.js";
import {
  deleteRunSnapshot as deleteRunSnapshotFile,
  listRunSnapshots,
  loadRunSnapshot as loadRunSnapshotFile,
  saveRunSnapshot as saveRunSnapshotFile,
} from "../book/run-snapshot-store.js";
import type { RunSnapshot, RunSnapshotMeta, SnapshotKind } from "../types/run-snapshot.js";
import { toRunSnapshotMeta } from "../types/run-snapshot.js";
import { materializeInstanceSnapshotPayload } from "../book/snapshot-filters.js";
import {
  INSTANCE_OPENING_SNAPSHOT_LABEL,
  OPENING_OUTPUT_TAG,
} from "../skills/opening-seal.js";
import {
  PLAY_WORKING_SNAPSHOT_ID,
  PLAY_WORKING_SNAPSHOT_LABEL,
  SLOT_PLAY_INSTANCE_ID,
  SLOT_PLAY_LAYER_ACTIVE,
  isPlayLayerActive,
} from "../skills/play-turn.js";
import {
  DIALOGUE_HISTORY_TAG,
  appendDialogueHistoryTurn,
} from "../skills/dialogue-history.js";
import { PhaseRuntime, createDecision } from "../runtime/phase-runtime.js";
import { createSession } from "../runtime/phase-machine.js";
import {
  createDefaultMainAgentLlm,
  hasRealLlmConfig,
  reloadDefaultMainAgentLlm,
  type LlmTrackingRef,
} from "../runtime/llm-factory.js";
import { isAbortError, runWithAbortSignal } from "../llm/run-abort.js";
import { getSessionTokenTotals, type MessageTokenUsage } from "../stats/token-store.js";
import type { PersistedBookSession } from "../types/book-session.js";
import type { RuntimeSession, WaitingReason } from "../types/runtime.js";
import type { IntakeProgress } from "../types/intake.js";
import {
  buildFocus,
  buildPipeline,
  buildToolTrace,
  buildBurstState,
  buildSkillCatalog,
  inferLifecycleStage,
  canEnterPlay,
  classifyAgentMessage,
  type AgentMessageKind,
  type SessionFocus,
  type StageStep,
  type LifecycleStage,
  type SkillCatalogEntry,
  type ToolTraceEntry,
  type BurstState,
} from "./agent-view.js";
import {
  buildIntakeProgress,
  readIntakeValues,
} from "../intake/intake.js";
import {
  bookSkillPackId,
  persistedSkillPackId,
  runSnapshotSkillPackId,
  sessionSkillPackId,
  skillPacksMatch,
} from "../book/skill-id.js";
import {
  loadAppSettings,
  normalizeContextTraceKeepLatest,
} from "../config/settings.js";
import {
  pruneContextTraces,
  type LlmContextTrace,
} from "../types/context-trace.js";
import type { ActiveSkillSnapshot } from "../types/runtime.js";
import type { BlackboardItem } from "../types/blackboard.js";
import { Blackboard } from "../blackboard/blackboard.js";
import { parseWorkerSetYaml } from "../skills/worker-set-parse.js";
import { parseShellAdaptationFromReplyFormat } from "../skills/present-packet.js";
import {
  CREATION_ACCEPTED_CONTENT_TAG,
  CREATION_ACCEPTED_UNITS_TAG,
  isDesignDiskWorker,
  parseAcceptedContentStore,
  parseAcceptedUnits,
  SLOT_CREATION_ACCEPTED_UNITS,
} from "../skills/creation-units.js";
import {
  formatWorkerSetForUser,
  type WorkerSetUserView,
} from "../skills/worker-set-view.js";
import {
  CONTEXT_ORDER_TAG,
  applyContextOrderEdit,
  mergeContextOrderIntoWorkerSetJson,
  parseContextOrder,
  serializeContextOrder,
  synthesizeContextOrderFromWorkers,
  type ContextOrderEdit,
} from "../skills/context-order.js";
import {
  CREATION_CURRENT_STEP_TAG,
  CREATION_FLOW_TAG,
  CREATION_PROPOSED_STEP_TAG,
  CREATION_SELECTED_RECIPE_TAG,
  DESIGN_FLOW_WORKER_ID,
  creationFlowFromRecipeSeed,
  findRecipeCatalogEntry,
  formatCreationFlowForUser,
  findModuleByName,
  findStepByRef,
  type FlowStepTitleHint,
  isProgressPointerTag,
  loadRecipeCatalog,
  loadRecipeDetail,
  loadModuleCatalog,
  parseCreationFlow,
  parseSelectedRecipeRef,
  resolveDesignStepBinding,
  stepUnitId,
  stringifyCreationFlow,
  stripReviseSteps,
  type CreationFlow,
  type CreationFlowUserView,
  type ModuleCatalog,
  type RecipeCatalogEntry,
} from "../skills/creation-flow.js";
import { loadSkill } from "../skills/loader.js";
import { effectiveStartupMode, DEFAULT_UI_PROMPT } from "../config/default-orchestrator.js";
import { buildBoardPanel } from "../runtime/compress-after-worker.js";
import {
  displayWorkerLabel,
  formatWorkerDisplayTitle,
  reviewComposerCopy,
} from "./display-labels.js";
import {
  buildCreationDialogueTranscript,
  foldRunProcessMessages,
} from "./prune-creation-messages.js";
import {
  formatQuestionAnswersForAi,
  formatQuestionAnswersForDisplay,
  isModuleOpeningQuestions,
  normalizeQuestions,
} from "../skills/question-protocol.js";
import type { QuestionAnswer } from "../types/questions.js";
import {
  appendBranchVariant,
  createMessageBranchState,
  createUserVariantMessage,
  ensureBranchForEdit,
  ensureBranchForRefresh,
  isRefreshableMessage,
  recordPreMessageCheckpoint,
  switchBranchVariant,
  updateActiveBranchVariant,
  type MessageBranchState,
  type SessionCheckpoint,
} from "./message-branch.js";

/** 这些消息种类挂载全量 LLM 上下文痕迹（右键可查看） */
const CONTEXT_TRACE_MESSAGE_KINDS = new Set<AgentMessageKind>([
  "worker_output",
  "orchestrator_decision",
  "orchestrator_assessment",
  "orchestrator_thinking",
]);

export type ChatMessage = {
  id: string;
  role: "system" | "user";
  text: string;
  createdAt: string;
  kind?: AgentMessageKind;
  actor?: string;
  title?: string;
  body?: string;
  /** 思维链 / reasoning_content */
  thinking?: string;
  /** 该次 LLM 请求实际携带的全量上下文（观察用；按设置只保留最新 N 条） */
  contextTrace?: LlmContextTrace;
  /** run 验收后过程讨论折叠（主 feed 隐藏）；创作 messages 不删不藏 */
  compressed?: boolean;
  tokenUsage?: MessageTokenUsage;
  /** 消息分支：同位多版本（编辑 / 重 roll） */
  branchGroupId?: string;
  branchIndex?: number;
  branchTotal?: number;
};

export type SessionView = {
  id: string;
  bookId?: string;
  bookTitle?: string;
  activeSkill?: string;
  phase: RuntimeSession["phase"];
  waitingReason?: WaitingReason;
  startupCompleted: boolean;
  skills: Array<{ name: string; description: string; category: string }>;
  messages: ChatMessage[];
  hints: string[];
  actions: SessionAction[];
  /** @deprecated 用 skillCatalog */
  pipeline: StageStep[];
  lifecycleStage: LifecycleStage;
  /** 已从定稿开出聊天层（不是只把顶栏标成游玩） */
  playLayerActive: boolean;
  playReady: boolean;
  /** 已落档至少一份产物（instance 快照） */
  hasProduct: boolean;
  /** 当前游玩所依据的产物 id */
  playInstanceId?: string;
  skillCatalog: SkillCatalogEntry[];
  toolTrace: ToolTraceEntry[];
  burst: BurstState;
  focus: SessionFocus;
  /** 启动填空进度（waitingReason.kind === intake 时有值） */
  intake?: IntakeProgress;
  intakePrompt?: string;
  /** agent-first 首屏固定引导（纯 UI，非消息流） */
  uiPrompt?: string;
  /** 待验收产物全文（review_artifact 时在右侧 Tab 展示） */
  reviewArtifact?: ReviewArtifactView;
  /** Worker 集用户视图（验收 / 设计进度共用） */
  workerSetView?: WorkerSetUserView;
  /** 创作流程用户视图（步骤顺序 + 依赖） */
  creationFlowView?: CreationFlowUserView;
  /** 确认开干：下一步提案（含可编辑编排参数） */
  proposedNextStep?: ProposedNextStepView;
  /** 能力包内可选初始配方（用户手动选） */
  recipes?: Array<{ id: string; name: string; declaration: string }>;
  /** 用户已选初始配方 */
  selectedRecipe?: { id: string; name: string; declaration: string } | null;
  /**
   * 开局引导：配方起点或当前能力默认问题的 opening（说话面主柱；对齐美学纲领）。
   */
  openingGuide?: { stepId: string; stepName: string; text: string } | null;
  /** 黑板与定稿上下文（强可读） */
  boardPanel?: BoardPanelView;
  /** 游玩呈现壳微调（来自设计.正文组成） */
  presentationTweaks?: {
    shell_id?: string;
    tone_chrome?: string;
    show_suggested_actions?: boolean;
    block_labels?: Record<string, string>;
    empty_states?: Record<string, string>;
  };
  /** 总管正在输出的思维链（流式，轮询用） */
  agentThinking?: string;
  /** Agent / Worker 流式输出（轮询用） */
  liveStream?: LiveStreamView;
  resumed?: boolean;
  tokenStats?: {
    sessionTotal: number;
    sessionCached?: number;
    sessionCacheMiss?: number;
    lastCaller?: string;
    lastTotal?: number;
    byCaller?: Record<
      string,
      { totalTokens: number; cachedTokens: number; cacheMissTokens: number; calls: number }
    >;
  };
};

export type SessionAction =
  | { type: "send_message"; label: string; placeholder: string }
  | { type: "answer_questions"; label: string }
  | { type: "skip_questions"; label: string }
  | { type: "confirm_intake"; label: string }
  | { type: "approve"; label: string }
  | { type: "accept"; label: string }
  | { type: "reject"; label: string }
  | { type: "replan"; label: string }
  | { type: "leave_step"; label: string }
  | { type: "run_outline"; label: string }
  | { type: "finish"; label: string };

export type LiveStreamView = {
  actor: "orchestrator" | "worker";
  actorId?: string;
  label: string;
  thinking?: string;
  output?: string;
};

export type BoardPanelView = {
  finals: Array<{ tag: string; source: string; preview: string; updatedAt: string }>;
  active: Array<{ tag: string; source: string; preview: string; updatedAt: string }>;
  archivedCount: number;
  brief?: string;
};

export type ProposedNextStepView = {
  stepId: string;
  name: string;
  declaration?: string;
  params: Record<string, unknown>;
  paramsMissing: string[];
  paramSpecs: Array<{
    key: string;
    label: string;
    required: boolean;
    hint?: string;
  }>;
  /** 节点特性：prior-artifact = 先验产物（不在确认开干时钉「写什么」） */
  kind?: string;
  /** 用户在「下一步想写什么」里写的意向（与步骤 mode 不同） */
  intent?: string;
  /** 步骤怎么跑：revise = 回头修改既有产物 */
  mode?: "fresh" | "revise";
  revises?: string;
  /** 收口节点（开场白）：确认开干前仍可改编排追加前序节点 */
  closer?: boolean;
};

export type ReviewArtifactView = {
  id: string;
  workerId: string;
  summary?: string;
  body: string;
  outputTags?: string[];
  /** 产出该产物的 worker_output 消息（验收态下 feed 会隐藏该消息） */
  sourceMessageId?: string;
  /** 与 sourceMessage 同源的全量 LLM 上下文，供待验收卡片右键查看 */
  contextTrace?: LlmContextTrace;
  /** 创作 design-* 验收时解析后的 Worker 集（供 UI 结构化展示） */
  workerSet?: import("../skills/worker-set-parse.js").ParsedWorkerSet;
  /** 中文卡片化用户视图 */
  workerSetView?: WorkerSetUserView;
  /** 创作流程（步骤 + 依赖） */
  creationFlowView?: CreationFlowUserView;
};

type ManagedSession = {
  runtime: PhaseRuntime;
  messages: ChatMessage[];
  bookId?: string;
  trackingRef: LlmTrackingRef;
  branchState: MessageBranchState;
  /** 当前能力包可选初始配方（用户手动选） */
  recipeOptions?: RecipeCatalogEntry[];
  /** 模块目录（分层图 / 可反复增殖） */
  moduleCatalog?: ModuleCatalog | null;
  /** 开局模块 opening，缓存给意图页 */
  openingGuide?: { stepId: string; stepName: string; text: string } | null;
  /** 当前 LLM 请求的取消器（停止并重试） */
  runAbort?: AbortController;
  /** 递增世代：后一次请求作废前一次 */
  runGen?: number;
  /** 本轮开始时的消息条数，取消时裁掉执行中产生的调度句 */
  runMessageCutoff?: number;
};

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  /** bookId → 当前内存中的 sessionId */
  private readonly activeBookSessions = new Map<string, string>();
  /** sessionId → 流式 thinking 缓冲（思考结束后仍保留，直到本轮结束） */
  private readonly agentThinkingLive = new Map<string, string>();
  /** 本轮思维链已收束；下一次 delta 起新一轮 */
  private readonly agentThinkingClosed = new Set<string>();
  /** sessionId → worker 流式缓冲 */
  private readonly workerLive = new Map<
    string,
    { workerId: string; thinking: string; output: string }
  >();

  async create(): Promise<SessionView> {
    return this.createForBook();
  }

  setLifecycleStage(sessionId: string, stage: LifecycleStage): SessionView {
    const s = this.require(sessionId);
    if (stage === "play") {
      s.runtime.prepareEnterPlay();
      if (!canEnterPlay(s.runtime.getSession())) {
        throw new Error("实例尚未就绪，无法进入游玩");
      }
      this.enterPlayLayer(s, { resume: true });
    } else {
      this.enterDesignLayer(s);
    }
    if (s.bookId) this.persist(s);
    return this.toView(sessionId);
  }

  /** 用户手改黑板 tag（创作期改设定/表；尊重后续 worker 的表 rev 合并） */
  writeUserBoardTag(
    sessionId: string,
    tag: string,
    content: string,
  ): SessionView {
    const s = this.require(sessionId);
    const trimmedTag = tag.trim();
    if (!trimmedTag) throw new Error("tag 不能为空");
    s.runtime.getBlackboard().write({
      tag: trimmedTag,
      content: content ?? "",
      source: "user",
    });
    if (s.bookId) this.persist(s);
    return this.toView(sessionId);
  }

  /**
   * 编排上下文投影排序：写入 设计.worker集.context_order（若有规格），
   * 并同步 设计.上下文投影排序。下次声明驱动拼装即按新序。
   */
  patchContextOrder(sessionId: string, edit: ContextOrderEdit): SessionView {
    const s = this.require(sessionId);
    const bb = s.runtime.getBlackboard();
    const workerSetRaw =
      bb.getContentByTag("设计.worker集")?.trim() ||
      bb.getContentByTag("设计.worker集.草稿")?.trim() ||
      "";
    const orderTagRaw = bb.getContentByTag(CONTEXT_ORDER_TAG)?.trim() || "";

    let current = parseContextOrder(
      workerSetRaw
        ? parseWorkerSetYaml(workerSetRaw).context_order
        : undefined,
    );
    if (!current) current = parseContextOrder(orderTagRaw);
    if (!current && workerSetRaw) {
      const parsed = parseWorkerSetYaml(workerSetRaw);
      // 与检查器合成逻辑一致：缺 context 时用包内默认契约（视图侧也会合成）
      current = synthesizeContextOrderFromWorkers(
        parsed.workers.map((w) => ({
          ref: w.ref,
          name: w.name,
          context: w.context,
        })),
        parsed.play_slots,
      );
    }
    if (!current && edit.action !== "replace") {
      throw new Error("尚无上下文投影排序可编辑；请先完成游玩拓扑/细化终稿，或提交完整 replace");
    }
    if (!current && edit.action === "replace") {
      current = parseContextOrder(edit.context_order);
      if (!current) throw new Error("context_order 无法解析");
    }

    const next = applyContextOrderEdit(current!, edit);
    const serialized = serializeContextOrder(next);

    bb.write({
      tag: CONTEXT_ORDER_TAG,
      content: serialized,
      source: "user",
    });

    if (workerSetRaw) {
      const targetTag = bb.getContentByTag("设计.worker集")?.trim()
        ? "设计.worker集"
        : bb.getContentByTag("设计.worker集.草稿")?.trim()
          ? "设计.worker集.草稿"
          : null;
      if (targetTag) {
        bb.write({
          tag: targetTag,
          content: mergeContextOrderIntoWorkerSetJson(workerSetRaw, next),
          source: "user",
        });
      }
    } else {
      // 尚无规格：至少落下排序表，供细化终稿合并
      bb.write({
        tag: CONTEXT_ORDER_TAG,
        content: serialized,
        source: "user",
      });
    }

    if (s.bookId) this.persist(s);
    return this.toView(sessionId);
  }

  /**
   * 打开 Book：优先恢复磁盘快照；无快照则新建 Session。
   * 若该 Book 已在内存中，直接返回当前视图。
   */
  async openBook(bookId: string): Promise<SessionView> {
    const book = getBook(bookId);
    if (!book) throw new Error("Book 不存在");

    const inMemory = this.getActiveSessionForBook(bookId);
    if (inMemory) return inMemory;

    const snapshot = loadBookSession(bookId);
    if (snapshot && skillPacksMatch(book, persistedSkillPackId(snapshot))) {
      return this.restoreFromSnapshot(snapshot);
    }

    const legacyPreselect = bookSkillPackId(book);
    return this.createForBook(bookId, legacyPreselect);
  }

  async createForBook(
    bookId?: string,
    preselectSkillId?: string,
    selectedRecipeId?: string,
  ): Promise<SessionView> {
    const id = randomUUID();
    const messages: ChatMessage[] = [];
    const book = bookId ? getBook(bookId) : null;
    const initialSession = createSession("default");
    initialSession.id = id;
    const trackingRef: LlmTrackingRef = {
      current: {
        sessionId: id,
        bookId,
        bookTitle: book?.title,
        orchestratorId: preselectSkillId ?? (book ? bookSkillPackId(book) : undefined),
      },
    };

    const managed: ManagedSession = {
      runtime: null as unknown as PhaseRuntime,
      messages,
      bookId,
      trackingRef,
      branchState: createMessageBranchState(),
    };
    const onMessage = this.buildOnMessageHandler(() => managed);
    const thinkingHandlers = this.buildStreamHandlers(id, () => managed);

    const llm = createDefaultMainAgentLlm(trackingRef);
    const runtime = new PhaseRuntime({
      autoStubWorker: !hasRealLlmConfig(),
      llm,
      onMessage,
      ...thinkingHandlers,
      initialSession,
    });
    managed.runtime = runtime;

    if (preselectSkillId) {
      await runtime.startWithOrchestrator(preselectSkillId);
    } else {
      await runtime.start();
    }
    await this.refreshRecipeOptions(managed);
    if (selectedRecipeId?.trim()) {
      await this.applySelectedRecipe(managed, selectedRecipeId.trim());
    }
    await this.maybeKickAgentAfterDemand(runtime);

    recordPreMessageCheckpoint(
      managed.branchState,
      0,
      this.captureCheckpoint(managed),
    );

    this.sessions.set(id, managed);
    if (bookId) {
      this.activeBookSessions.set(bookId, id);
      appendBookSession(bookId, id);
      this.persist(managed);
    }
    return this.toView(id);
  }

  /** 用户手动选定 / 更换初始配方 */
  async setSelectedRecipe(
    sessionId: string,
    recipeId: string,
  ): Promise<SessionView> {
    const s = this.require(sessionId);
    await this.refreshRecipeOptions(s);
    await this.applySelectedRecipe(s, recipeId);
    if (s.bookId) this.persist(s);
    return this.toView(sessionId);
  }

  get(id: string): SessionView | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.runtime.recoverOrphanedRun()) this.persist(s);
    return this.toView(id);
  }

  getActiveSessionForBook(bookId: string): SessionView | null {
    const sessionId = this.activeBookSessions.get(bookId);
    if (!sessionId) return null;
    return this.get(sessionId);
  }

  /**
   * 保存快照。
   * - instance：实例化后的对象（情境/规则/角色设定等），不含 run 轮次状态
   * - run：运行存档，完整进度
   */
  saveGameSnapshot(
    sessionId: string,
    label: string,
    kind: SnapshotKind = "run",
    note?: string,
  ): RunSnapshotMeta {
    const s = this.require(sessionId);
    if (!s.bookId) throw new Error("仅绑定作品时可存档");
    const book = getBook(s.bookId);
    if (!book) throw new Error("Book 不存在");

    const trimmed = label.trim();
    if (!trimmed) throw new Error("请输入存档名称");

    let runtimeSession = structuredClone(s.runtime.getSession());
    let blackboardItems = s.runtime.getBlackboard().exportItems();

    if (kind === "instance") {
      s.runtime.prepareEnterPlay();
      runtimeSession = structuredClone(s.runtime.getSession());
      blackboardItems = s.runtime.getBlackboard().exportItems();
      if (!canEnterPlay(runtimeSession)) {
        throw new Error("须先完成收口或验收 Worker 集，才能保存产物");
      }
      ({ runtimeSession, blackboardItems } = materializeInstanceSnapshotPayload({
        runtimeSession,
        blackboardItems,
      }));
    }

    const skillPackId =
      sessionSkillPackId(runtimeSession) ?? bookSkillPackId(book) ?? "";
    const snapshot: RunSnapshot = {
      version: 1,
      id: randomUUID(),
      bookId: s.bookId,
      label: trimmed,
      kind,
      instanceId:
        kind === "run" ? this.currentPlayInstanceId(s) : undefined,
      orchestratorId: skillPackId,
      runtimeSession,
      blackboardItems,
      messages: s.messages.map((m) => ({ ...m })),
      createdAt: new Date().toISOString(),
      note: note?.trim() || undefined,
    };
    saveRunSnapshotFile(snapshot);
    return toRunSnapshotMeta(snapshot);
  }

  /** 列出某 Book 的全部存档（不含内部「当前游玩」工作副本） */
  listGameSnapshots(bookId: string): RunSnapshotMeta[] {
    if (!getBook(bookId)) throw new Error("Book 不存在");
    return listRunSnapshots(bookId).filter((s) => s.id !== PLAY_WORKING_SNAPSHOT_ID);
  }

  /** 仅游玩 run 存档（UI 抽屉用） */
  listPlaySnapshots(bookId: string): RunSnapshotMeta[] {
    return this.listGameSnapshots(bookId).filter((s) => s.kind === "run");
  }

  /** 保存游玩进度（创作靠 session.json 自动续作，不手动存 instance） */
  savePlaySnapshot(
    sessionId: string,
    label: string,
    note?: string,
  ): RunSnapshotMeta {
    const s = this.require(sessionId);
    const session = s.runtime.getSession();
    if (!canEnterPlay(session)) {
      throw new Error("须先验收 Worker 集，才能保存游玩存档");
    }
    if (inferLifecycleStage(session) !== "play" || !isPlayLayerActive(session.slots)) {
      throw new Error("请先切换到「游玩」再保存游玩存档");
    }
    return this.saveGameSnapshot(sessionId, label, "run", note);
  }

  /** 从已落档产物开一条新的游玩线（清空 run 层状态） */
  async startNewPlayRun(
    sessionId: string,
    instanceId?: string,
  ): Promise<SessionView> {
    const s = this.require(sessionId);
    if (!s.bookId) throw new Error("仅绑定作品时可新建游玩");
    this.persistCreationIfDesign(s);
    s.runtime.prepareEnterPlay();
    if (!canEnterPlay(s.runtime.getSession())) {
      throw new Error("须先验收 Worker 集或完成收口，才能开始游玩");
    }
    this.archivePlayWorking(s.bookId);
    this.enterPlayLayer(s, { resume: false, instanceId });
    return this.toView(sessionId);
  }

  /** 进入游玩层：resume 时恢复「当前游玩」，否则从产物新开一条聊天 */
  private enterPlayLayer(
    s: ManagedSession,
    opts: { resume: boolean; instanceId?: string },
  ): void {
    this.persistCreationIfDesign(s);
    s.runtime.prepareEnterPlay();
    const session = s.runtime.getSession();
    if (!canEnterPlay(session)) {
      throw new Error("实例尚未就绪，无法进入游玩");
    }
    if (
      opts.resume &&
      isPlayLayerActive(session.slots) &&
      inferLifecycleStage(session) === "play"
    ) {
      this.sanitizePlayHitl(s);
      return;
    }
    if (s.bookId) this.ensureInstanceSnapshot(s);
    if (opts.resume && s.bookId) {
      const working = loadRunSnapshotFile(s.bookId, PLAY_WORKING_SNAPSHOT_ID);
      if (working?.kind === "run") {
        this.restoreSnapshotInPlace(s, working, "play");
        return;
      }
    }
    this.beginNewPlayFromInstance(s, opts.instanceId);
    if (s.bookId) this.savePlayWorking(s);
  }

  /** 回到创作层：先把当前聊天写入「当前游玩」，再恢复创作过程 */
  private enterDesignLayer(s: ManagedSession): void {
    const session = s.runtime.getSession();
    if (
      inferLifecycleStage(session) === "design" &&
      !isPlayLayerActive(session.slots)
    ) {
      s.runtime.setLifecycleStage("design");
      return;
    }
    if (s.bookId && isPlayLayerActive(session.slots)) {
      this.savePlayWorking(s);
    }
    this.restoreCreationFromDisk(s);
  }

  private beginNewPlayFromInstance(s: ManagedSession, instanceId?: string): void {
    const keepId = s.runtime.getSession().id;
    let runtimeSession: RuntimeSession;
    let blackboardItems: import("../types/blackboard.js").BlackboardItem[];
    const instance = s.bookId
      ? instanceId
        ? this.loadInstanceSnapshot(s.bookId, instanceId)
        : this.latestInstanceSnapshot(s.bookId)
      : null;
    if (instance) {
      runtimeSession = structuredClone(instance.runtimeSession);
      blackboardItems = structuredClone(instance.blackboardItems);
    } else {
      runtimeSession = structuredClone(s.runtime.getSession());
      blackboardItems = s.runtime.getBlackboard().exportItems();
    }
    ({ runtimeSession, blackboardItems } = materializeInstanceSnapshotPayload({
      runtimeSession,
      blackboardItems,
    }));
    runtimeSession.id = keepId;
    runtimeSession.slots = {
      ...runtimeSession.slots,
      uiLifecycleStage: "play",
      [SLOT_PLAY_LAYER_ACTIVE]: true,
      [SLOT_PLAY_INSTANCE_ID]: instance?.id,
      startupCompleted: true,
    };
    runtimeSession.phase = "waiting_user";
    runtimeSession.waitingReason = { kind: "input" };
    runtimeSession.pendingArtifactId = undefined;
    runtimeSession.pendingDecision = undefined;
    runtimeSession.currentWorkerId = undefined;
    runtimeSession.resumeContext = undefined;
    s.runtime.restoreFromCheckpoint(runtimeSession, blackboardItems);
    const opening =
      s.runtime.getBlackboard().getContentByTag(OPENING_OUTPUT_TAG)?.trim() ?? "";
    if (opening) {
      s.runtime.getBlackboard().write({
        tag: DIALOGUE_HISTORY_TAG,
        content: appendDialogueHistoryTurn("", { role: "助手", text: opening }),
        source: "runtime",
      });
      s.messages = [this.playOpeningMessage(opening)];
    } else {
      s.messages = [];
    }
    s.branchState = createMessageBranchState();
  }

  private restoreSnapshotInPlace(
    s: ManagedSession,
    snapshot: RunSnapshot,
    layer: LifecycleStage,
  ): void {
    const keepId = s.runtime.getSession().id;
    let runtimeSession = structuredClone(snapshot.runtimeSession);
    let blackboardItems = structuredClone(snapshot.blackboardItems);
    if (snapshot.kind === "instance" || layer === "design") {
      ({ runtimeSession, blackboardItems } = materializeInstanceSnapshotPayload({
        runtimeSession,
        blackboardItems,
      }));
    }
    runtimeSession.id = keepId;
    runtimeSession.slots = {
      ...runtimeSession.slots,
      uiLifecycleStage: layer,
      [SLOT_PLAY_LAYER_ACTIVE]: layer === "play" ? true : undefined,
      [SLOT_PLAY_INSTANCE_ID]:
        layer === "play"
          ? snapshot.instanceId ||
            (typeof runtimeSession.slots[SLOT_PLAY_INSTANCE_ID] === "string"
              ? runtimeSession.slots[SLOT_PLAY_INSTANCE_ID]
              : undefined)
          : undefined,
      startupCompleted: true,
    };
    if (layer === "play") {
      runtimeSession.phase = runtimeSession.phase === "done"
        ? "waiting_user"
        : runtimeSession.phase;
      if (!runtimeSession.waitingReason) {
        runtimeSession.waitingReason = { kind: "input" };
      }
    } else {
      if (runtimeSession.phase === "done") {
        runtimeSession.phase = "waiting_user";
      }
      if (!runtimeSession.waitingReason) {
        runtimeSession.waitingReason = { kind: "input" };
      }
      runtimeSession.pendingArtifactId = undefined;
      runtimeSession.pendingDecision = undefined;
      runtimeSession.currentWorkerId = undefined;
    }
    s.runtime.restoreFromCheckpoint(runtimeSession, blackboardItems);
    s.messages = snapshot.messages.map((m) => ({ ...m })) as ChatMessage[];
    s.branchState = createMessageBranchState();
    if (layer === "play") this.sanitizePlayHitl(s);
  }

  /** 游玩层不保留创作 HITL（验收 / 确认下一步 / 修订） */
  private sanitizePlayHitl(s: ManagedSession): void {
    const session = s.runtime.getSession();
    const play =
      isPlayLayerActive(session.slots) || inferLifecycleStage(session) === "play";
    if (!play) return;
    const kind = session.waitingReason?.kind;
    if (
      kind !== "review_artifact" &&
      kind !== "approve_step" &&
      kind !== "revision" &&
      kind !== "next_intent" &&
      kind !== "pick_creation_step" &&
      kind !== "worker_questions"
    ) {
      return;
    }
    session.phase = "waiting_user";
    session.waitingReason = { kind: "input" };
    session.pendingArtifactId = undefined;
    session.pendingDecision = undefined;
    session.currentWorkerId = undefined;
    session.resumeContext = undefined;
    session.updatedAt = new Date().toISOString();
  }

  private savePlayWorking(s: ManagedSession): void {
    if (!s.bookId) return;
    const book = getBook(s.bookId);
    const runtimeSession = structuredClone(s.runtime.getSession());
    const snapshot: RunSnapshot = {
      version: 1,
      id: PLAY_WORKING_SNAPSHOT_ID,
      bookId: s.bookId,
      label: PLAY_WORKING_SNAPSHOT_LABEL,
      kind: "run",
      instanceId: this.currentPlayInstanceId(s),
      orchestratorId:
        sessionSkillPackId(runtimeSession) ??
        (book ? bookSkillPackId(book) : "") ??
        "",
      runtimeSession,
      blackboardItems: s.runtime.getBlackboard().exportItems(),
      messages: s.messages.map((m) => ({ ...m })),
      createdAt: new Date().toISOString(),
      note: "切换创作/游玩时自动保存的当前聊天",
    };
    saveRunSnapshotFile(snapshot);
  }

  private archivePlayWorking(bookId: string): void {
    const working = loadRunSnapshotFile(bookId, PLAY_WORKING_SNAPSHOT_ID);
    if (!working) return;
    if (!working.messages.some((m) => m.role === "user")) return;
    const stamped: RunSnapshot = {
      ...working,
      id: randomUUID(),
      label: `游玩 ${new Date().toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`,
      createdAt: new Date().toISOString(),
      note: "新建游玩前自动保存",
    };
    saveRunSnapshotFile(stamped);
  }

  private ensureInstanceSnapshot(s: ManagedSession): void {
    if (!s.bookId) return;
    if (this.latestInstanceSnapshot(s.bookId)) return;
    if (!canEnterPlay(s.runtime.getSession())) return;
    try {
      this.saveGameSnapshot(
        s.runtime.getSession().id,
        INSTANCE_OPENING_SNAPSHOT_LABEL,
        "instance",
        "开玩前自动保存产物",
      );
    } catch (err) {
      console.warn("[会话] 开玩前保存产物失败", err);
    }
  }

  private currentPlayInstanceId(s: ManagedSession): string | undefined {
    const raw = s.runtime.getSession().slots[SLOT_PLAY_INSTANCE_ID];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (!s.bookId) return undefined;
    return this.latestInstanceSnapshot(s.bookId)?.id;
  }

  playWorkingInstanceId(bookId: string): string | undefined {
    const working = loadRunSnapshotFile(bookId, PLAY_WORKING_SNAPSHOT_ID);
    if (!working || working.kind !== "run") return undefined;
    return working.instanceId;
  }

  renameGameSnapshot(
    bookId: string,
    snapshotId: string,
    label: string,
  ): RunSnapshotMeta {
    if (!getBook(bookId)) throw new Error("Book 不存在");
    const trimmed = label.trim();
    if (!trimmed) throw new Error("名称不能为空");
    const snapshot = loadRunSnapshotFile(bookId, snapshotId);
    if (!snapshot) throw new Error("存档不存在");
    const next: RunSnapshot = { ...snapshot, label: trimmed };
    saveRunSnapshotFile(next);
    return toRunSnapshotMeta(next);
  }

  private latestInstanceSnapshot(bookId: string): RunSnapshot | null {
    const meta = this.listGameSnapshots(bookId).find((s) => s.kind === "instance");
    if (!meta) return null;
    return loadRunSnapshotFile(bookId, meta.id);
  }

  private loadInstanceSnapshot(bookId: string, snapshotId: string): RunSnapshot {
    const snapshot = loadRunSnapshotFile(bookId, snapshotId);
    if (!snapshot) throw new Error("产物不存在");
    if (snapshot.kind !== "instance") throw new Error("该存档不是产物定稿");
    return snapshot;
  }

  private restoreCreationFromDisk(s: ManagedSession): void {
    const keepId = s.runtime.getSession().id;
    if (!s.bookId) {
      this.clearPlayLayerOnSession(s, keepId);
      return;
    }
    const snap = loadBookSession(s.bookId);
    if (!snap?.runtimeSession) {
      this.clearPlayLayerOnSession(s, keepId);
      return;
    }
    const runtimeSession = structuredClone(snap.runtimeSession);
    runtimeSession.id = keepId;
    runtimeSession.slots = {
      ...runtimeSession.slots,
      uiLifecycleStage: "design",
      [SLOT_PLAY_LAYER_ACTIVE]: undefined,
    };
    s.runtime.restoreFromCheckpoint(runtimeSession, snap.blackboardItems);
    s.messages = snap.messages.map((m) => ({ ...m })) as ChatMessage[];
    s.branchState = this.deserializeBranchState(snap.messageBranchState);
  }

  private clearPlayLayerOnSession(s: ManagedSession, keepId: string): void {
    const runtimeSession = structuredClone(s.runtime.getSession());
    runtimeSession.id = keepId;
    runtimeSession.slots = {
      ...runtimeSession.slots,
      uiLifecycleStage: "design",
      [SLOT_PLAY_LAYER_ACTIVE]: undefined,
    };
    s.runtime.restoreFromCheckpoint(
      runtimeSession,
      s.runtime.getBlackboard().exportItems(),
    );
  }

  private playOpeningMessage(text: string): ChatMessage {
    return {
      id: randomUUID(),
      role: "system",
      text,
      createdAt: new Date().toISOString(),
      kind: "system_info",
      actor: "narrator",
      title: "开场白",
      body: text,
    };
  }

  /** 读档：产物开玩，游玩存档续玩。不覆盖创作过程。 */
  async loadGameSnapshot(bookId: string, snapshotId: string): Promise<SessionView> {
    const snapshot = loadRunSnapshotFile(bookId, snapshotId);
    if (!snapshot) throw new Error("存档不存在");

    const book = getBook(bookId);
    if (!book) throw new Error("Book 不存在");
    if (!skillPacksMatch(book, runSnapshotSkillPackId(snapshot))) {
      throw new Error("存档与当前作品 skill 包不匹配，无法读档");
    }

    let sessionId = this.activeBookSessions.get(bookId);
    if (!sessionId) {
      await this.openBook(bookId);
      sessionId = this.activeBookSessions.get(bookId);
    }
    if (!sessionId) throw new Error("无法打开作品");
    const s = this.require(sessionId);

    if (snapshot.kind === "instance") {
      this.persistCreationIfDesign(s);
      if (isPlayLayerActive(s.runtime.getSession().slots)) {
        this.archivePlayWorking(bookId);
      }
      this.beginNewPlayFromInstance(s, snapshot.id);
      this.savePlayWorking(s);
      return this.toView(
        sessionId,
        true,
        `已用产物「${snapshot.label}」开玩。创作流程仍在「创作」里。`,
      );
    }

    this.persistCreationIfDesign(s);
    this.restoreSnapshotInPlace(s, snapshot, "play");
    this.savePlayWorking(s);
    return this.toView(
      sessionId,
      true,
      `已从存档「${snapshot.label}」继续游玩。`,
    );
  }

  /** 删除单个存档 */
  deleteGameSnapshot(bookId: string, snapshotId: string): void {
    if (!getBook(bookId)) throw new Error("Book 不存在");
    if (!deleteRunSnapshotFile(bookId, snapshotId)) {
      throw new Error("存档不存在");
    }
  }

  /** 删除 Book 时清理内存中的会话 */
  dropBookSessions(bookId: string): void {
    for (const [sessionId, managed] of this.sessions) {
      if (managed.bookId === bookId) {
        this.sessions.delete(sessionId);
      }
    }
    this.activeBookSessions.delete(bookId);
  }

  /** 将当前 API / 预设设置应用到所有活跃会话 */
  reloadAllLlms(): number {
    let count = 0;
    for (const s of this.sessions.values()) {
      const llm = reloadDefaultMainAgentLlm(s.trackingRef);
      s.runtime.reloadLlm(llm, !hasRealLlmConfig());
      count += 1;
    }
    return count;
  }

  async sendMessage(
    id: string,
    text: string,
    opts?: { answers?: QuestionAnswer[] },
  ): Promise<SessionView> {
    const s = this.require(id);
    this.sanitizePlayHitl(s);
    const waitingBefore = s.runtime.getSession().waitingReason;
    if (
      inferLifecycleStage(s.runtime.getSession()) === "play" &&
      !isPlayLayerActive(s.runtime.getSession().slots) &&
      waitingBefore?.kind === "input"
    ) {
      this.enterPlayLayer(s, { resume: true });
      if (s.bookId) this.persist(s);
    }
    this.clearAgentThinking(id);
    recordPreMessageCheckpoint(
      s.branchState,
      s.messages.length,
      this.captureCheckpoint(s),
    );
    const reason = s.runtime.getSession().waitingReason;
    const trimmed = text.trim();
    const sidecarAnswers =
      reason?.kind === "review_artifact" &&
      reason.questions?.length &&
      opts?.answers?.length
        ? opts.answers.filter((a) => a.text?.trim() && a.text !== "（未答）")
        : [];

    // next_intent 允许留空：不塞空白气泡
    if (trimmed || reason?.kind !== "next_intent" || sidecarAnswers.length) {
      let recordText = trimmed || text;
      let displayBody: string | undefined;
      if (sidecarAnswers.length && reason?.kind === "review_artifact") {
        const qs = normalizeQuestions(reason.questions ?? []);
        recordText = formatQuestionAnswersForAi(
          qs,
          sidecarAnswers,
          trimmed || undefined,
        );
        displayBody = formatQuestionAnswersForDisplay(
          qs,
          sidecarAnswers,
          trimmed || undefined,
        );
      }
      const userMsg = this.msg("user", recordText);
      if (displayBody) userMsg.body = displayBody;
      s.messages.push(userMsg);
      this.syncCreationDialogue(s);
      if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    }
    try {
      const owned = await this.runExclusive(id, s, async () => {
        if (reason?.kind === "approve_step") {
          await s.runtime.rejectStep(trimmed || text);
        } else if (reason?.kind === "review_artifact") {
          // 先把卡上追问（问+选项+补充）写入「用户.worker答复」，再按意见改产物
          if (sidecarAnswers.length && reason.questions?.length) {
            const qaText = formatQuestionAnswersForAi(
              normalizeQuestions(reason.questions),
              sidecarAnswers,
              trimmed || undefined,
            );
            await s.runtime.resolveSidecarQuestions(qaText);
          }
          if (trimmed || sidecarAnswers.length) {
            await s.runtime.rejectArtifact(
              trimmed || "按追问作答更新产物",
            );
          }
        } else {
          await s.runtime.submitInput(trimmed || text);
        }
      });
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[会话] 发送消息失败", detail);
      await this.recoverFailedRun(s, detail);
    }
    this.syncCreationDialogue(s);
    this.persist(s);
    return this.toView(id);
  }

  /**
   * 结构化追问作答：UI 可省略结构，发给 AI 必须含问+答。
   * displayText 进气泡；aiText 进 runtime / 黑板。
   * review_artifact 挂载题：作答后仍停留在验收态（可再 Accept）。
   */
  async answerQuestions(
    id: string,
    answers: QuestionAnswer[],
    note?: string,
  ): Promise<SessionView> {
    const s = this.require(id);
    const reason = s.runtime.getSession().waitingReason;
    const isSidecar =
      reason?.kind === "review_artifact" && Boolean(reason.questions?.length);
    const questions =
      reason?.kind === "worker_questions"
        ? reason.questions
        : reason?.kind === "input"
          ? (reason.questions ?? [])
          : reason?.kind === "review_artifact"
            ? (reason.questions ?? [])
            : [];
    if (!questions.length) {
      throw new Error("当前没有待回答的结构化追问");
    }
    const aiText = formatQuestionAnswersForAi(questions, answers, note);
    const displayText = formatQuestionAnswersForDisplay(questions, answers, note);

    this.clearAgentThinking(id);
    recordPreMessageCheckpoint(
      s.branchState,
      s.messages.length,
      this.captureCheckpoint(s),
    );
    const userMsg = this.msg("user", aiText);
    userMsg.body = displayText;
    s.messages.push(userMsg);
    this.syncCreationDialogue(s);
    if (s.bookId) this.syncBookPreview(s.bookId, s.messages);

    try {
      const owned = await this.runExclusive(id, s, async () => {
        if (isSidecar) {
          await s.runtime.resolveSidecarQuestions(aiText);
          // 作答必须写回产物，否则验收后进度空转、追问在美学/交互间打转
          await s.runtime.rejectArtifact("按追问作答更新产物");
        } else {
          await s.runtime.submitInput(aiText);
        }
      });
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[会话] 回答追问失败", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
      if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    }
    this.syncCreationDialogue(s);
    this.persist(s);
    return this.toView(id);
  }

  /**
   * 跳过追问：
   * - review_artifact 挂载题：只收起题，留在验收
   * - input / worker_questions：提交跳过句并继续
   */
  async skipQuestions(id: string): Promise<SessionView> {
    const s = this.require(id);
    const reason = s.runtime.getSession().waitingReason;
    const skipText = "（用户跳过追问）请基于已有信息继续。";

    if (reason?.kind === "review_artifact" && reason.questions?.length) {
      this.clearAgentThinking(id);
      s.messages.push(this.msg("user", "跳过可选追问"));
      try {
        const owned = await this.runExclusive(id, s, () =>
          s.runtime.resolveSidecarQuestions(),
        );
        if (!owned) return this.toView(id);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        s.messages.push(this.msg("system", formatRuntimeError(detail)));
      }
      this.syncCreationDialogue(s);
      this.persist(s);
      return this.toView(id);
    }

    if (
      (reason?.kind === "input" && reason.questions?.length) ||
      reason?.kind === "worker_questions"
    ) {
      return this.sendMessage(id, skipText);
    }

    throw new Error("当前没有可跳过的追问");
  }

  /** 编辑用户消息 → 新分支 + 从该点重跑 */
  async editMessage(id: string, messageId: string, newText: string): Promise<SessionView> {
    const s = this.require(id);
    const trimmed = newText.trim();
    if (!trimmed) throw new Error("内容不能为空");

    const idx = s.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) throw new Error("消息不存在");
    const target = s.messages[idx];
    if (target.role !== "user") throw new Error("只能编辑用户消息");

    const checkpoint =
      s.branchState.preMessageCheckpoints[idx] ?? this.captureCheckpoint(s);
    const branch = ensureBranchForEdit(s.branchState, s.messages, idx, checkpoint);

    s.runtime.restoreFromCheckpoint(checkpoint.runtimeSession, checkpoint.blackboardItems);
    s.messages = s.messages.slice(0, idx);

    const variantIndex = branch.variants.length;
    const userMsg = createUserVariantMessage(trimmed, branch.groupId, variantIndex) as ChatMessage;
    appendBranchVariant(branch, userMsg, checkpoint);
    s.messages.push(userMsg);
    this.syncCreationDialogue(s);
    if (s.bookId) this.syncBookPreview(s.bookId, s.messages);

    try {
      const owned = await this.runExclusive(id, s, () =>
        s.runtime.submitInput(trimmed),
      );
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
    }

    updateActiveBranchVariant(
      branch,
      s.messages.slice(branch.anchorIndex),
      this.captureCheckpoint(s),
    );
    for (const m of s.messages.slice(branch.anchorIndex)) {
      m.branchGroupId = branch.groupId;
      m.branchIndex = branch.activeIndex;
      m.branchTotal = branch.variants.length;
    }

    this.syncCreationDialogue(s);
    this.persist(s);
    return this.toView(id);
  }

  /** 刷新 Worker / Skill 回复 → 重 roll */
  async refreshMessage(id: string, messageId: string): Promise<SessionView> {
    const s = this.require(id);
    const idx = s.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) throw new Error("消息不存在");
    const target = s.messages[idx];
    if (!isRefreshableMessage(target)) {
      throw new Error("此消息不支持刷新");
    }

    const workerSnap = s.runtime.getLastWorkerRunSnapshot();
    const workerId = target.actor ?? workerSnap?.workerId;
    if (!workerId) throw new Error("无法识别要刷新的 Worker");

    const checkpoint = workerSnap ?? s.branchState.preMessageCheckpoints[idx];
    if (!checkpoint) {
      throw new Error("缺少重 roll 快照，请尝试编辑上一条用户消息");
    }

    const branch = ensureBranchForRefresh(
      s.branchState,
      s.messages,
      idx,
      {
        runtimeSession: checkpoint.runtimeSession,
        blackboardItems: checkpoint.blackboardItems,
      },
    );

    s.runtime.restoreFromCheckpoint(checkpoint.runtimeSession, checkpoint.blackboardItems);
    s.messages = s.messages.slice(0, idx);
    if (s.bookId) this.syncBookPreview(s.bookId, s.messages);

    try {
      const owned = await this.runExclusive(id, s, () =>
        s.runtime.rerunWorker(workerId),
      );
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
    }

    const newIndex = branch.variants.length;
    branch.variants.push({
      messages: structuredClone(s.messages.slice(idx)),
      checkpoint: this.captureCheckpoint(s),
    });
    branch.activeIndex = newIndex;

    for (const m of s.messages.slice(branch.anchorIndex)) {
      m.branchGroupId = branch.groupId;
      m.branchIndex = branch.activeIndex;
      m.branchTotal = branch.variants.length;
    }

    this.persist(s);
    return this.toView(id);
  }

  /** 中止当前生成并重跑卡住的 worker / 总管 */
  async abortAndRetry(id: string): Promise<SessionView> {
    const s = this.require(id);
    const session = s.runtime.getSession();
    if (session.phase !== "running" || session.waitingReason) {
      throw new Error("当前没有正在执行的任务");
    }
    const cutoff = s.runMessageCutoff ?? s.messages.length;
    s.messages = s.messages.slice(0, cutoff);
    if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    try {
      const owned = await this.runExclusive(id, s, async () => {
        await s.runtime.retryStuckRun();
      });
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[会话] 停止并重试失败", detail);
      await this.recoverFailedRun(s, detail);
    }
    this.syncCreationDialogue(s);
    this.persist(s);
    return this.toView(id);
  }

  /** 删除消息及其后的对话 */
  async deleteMessage(id: string, messageId: string): Promise<SessionView> {
    const s = this.require(id);
    const idx = s.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) throw new Error("消息不存在");

    const checkpoint = s.branchState.preMessageCheckpoints[idx];
    if (!checkpoint && idx > 0) throw new Error("无法删除此消息");

    if (checkpoint) {
      s.runtime.restoreFromCheckpoint(
        checkpoint.runtimeSession,
        checkpoint.blackboardItems,
      );
    }
    s.messages = s.messages.slice(0, idx);
    for (const key of Object.keys(s.branchState.preMessageCheckpoints)) {
      const n = Number(key);
      if (n >= idx) delete s.branchState.preMessageCheckpoints[n];
    }
    if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    this.persist(s);
    return this.toView(id);
  }

  /** 左右切换同位消息版本（swipe / branch） */
  async switchMessageVariant(
    id: string,
    messageId: string,
    direction: "prev" | "next",
  ): Promise<SessionView> {
    const s = this.require(id);
    const idx = s.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) throw new Error("消息不存在");
    const target = s.messages[idx];
    const groupId = target.branchGroupId ?? target.id;
    const delta = direction === "prev" ? -1 : 1;
    const switched = switchBranchVariant(s.branchState, s.messages, groupId, delta);
    if (!switched) throw new Error("没有更多版本");

    s.messages = switched.messages as ChatMessage[];
    s.runtime.restoreFromCheckpoint(
      switched.checkpoint.runtimeSession,
      switched.checkpoint.blackboardItems,
    );
    if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    this.persist(s);
    return this.toView(id);
  }

  async approve(
    id: string,
    stepParams?: Record<string, unknown>,
  ): Promise<SessionView> {
    const s = this.require(id);
    try {
      const owned = await this.runExclusive(id, s, () =>
        s.runtime.approve(stepParams),
      );
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[会话] 确认开干失败", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
    }
    return this.toView(id);
  }

  async confirmIntake(id: string): Promise<SessionView> {
    const s = this.require(id);
    try {
      const owned = await this.runExclusive(id, s, () =>
        s.runtime.confirmIntake(),
      );
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[会话] 确认需求失败", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
      if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    }
    return this.toView(id);
  }

  async accept(
    id: string,
    opts?: { openingIndex?: number },
  ): Promise<SessionView> {
    const s = this.require(id);
    const pendingId = s.runtime.getSession().pendingArtifactId;
    const waiting = s.runtime.getSession().waitingReason;
    const hadSidecarQuestions =
      waiting?.kind === "review_artifact" && Boolean(waiting.questions?.length);
    const artifact = pendingId
      ? s.runtime.getSession().artifacts.find((a) => a.id === pendingId)
      : undefined;
    const stageBefore = inferLifecycleStage(s.runtime.getSession());
    try {
      const owned = await this.runExclusive(id, s, () =>
        s.runtime.acceptArtifact(undefined, opts),
      );
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[会话] 接受产物失败", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
      this.persist(s);
      return this.toView(id);
    }
    // 接受产物 = 不再用追问完善；询问模块随 waitingReason 清除而收起
    if (hadSidecarQuestions) {
      s.messages.push(
        this.msg("system", "[验收] 已接受产物，可选追问已收起（无需再完善）。"),
      );
    }
    if (artifact) {
      if (stageBefore === "design") {
        // 创作验收：messages 全量保留供用户浏览；仅同步拼给 AI 的「创作.对话」
        this.syncCreationDialogue(s);
      } else {
        foldRunProcessMessages(s.messages, artifact.workerId);
      }
    }
    this.persist(s);
    return this.toView(id);
  }

  /** 拒绝当前待确认步骤或待验收产物（无说明时触发重新来 / 回到总管） */
  async reject(id: string, reason?: string): Promise<SessionView> {
    const s = this.require(id);
    const waiting = s.runtime.getSession().waitingReason;
    try {
      const owned = await this.runExclusive(id, s, async () => {
        if (waiting?.kind === "approve_step") {
          await s.runtime.leaveCreationStep();
        } else if (waiting?.kind === "review_artifact") {
          await s.runtime.rejectArtifact(reason ?? "用户要求重新来");
        } else {
          throw new Error("当前没有可拒绝的确认或验收");
        }
      });
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[会话] 打回失败", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
      if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    }
    this.syncCreationDialogue(s);
    this.persist(s);
    return this.toView(id);
  }

  /** 离开当前技能步，回到分层图点选 */
  async leaveStep(id: string): Promise<SessionView> {
    const s = this.require(id);
    try {
      const owned = await this.runExclusive(id, s, () =>
        s.runtime.leaveCreationStep(),
      );
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[会话] 返回节点失败", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
      if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    }
    this.syncCreationDialogue(s);
    this.persist(s);
    return this.toView(id);
  }

  /** 开场白等步骤上发现漏了前序节点：再进流程编排，不整局重开 */
  async replan(id: string, reason?: string): Promise<SessionView> {
    const s = this.require(id);
    const note = reason?.trim() || "回到流程编排，追加或改排节点。";
    this.clearAgentThinking(id);
    recordPreMessageCheckpoint(
      s.branchState,
      s.messages.length,
      this.captureCheckpoint(s),
    );
    s.messages.push(this.msg("user", note));
    this.syncCreationDialogue(s);
    if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    try {
      const owned = await this.runExclusive(id, s, () =>
        s.runtime.replanCreationFlow(note),
      );
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[会话] 再编排失败", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
      if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    }
    this.syncCreationDialogue(s);
    this.persist(s);
    return this.toView(id);
  }

  async pickStep(
    id: string,
    stepId: string,
    stepParams?: Record<string, unknown>,
    reenter?: boolean,
  ): Promise<SessionView> {
    const s = this.require(id);
    try {
      const owned = await this.runExclusive(id, s, async () => {
        await this.confirmPendingFlowPlan(s);
        const waiting = s.runtime.getSession().waitingReason?.kind;
        if (waiting !== "pick_creation_step") {
          throw new Error("当前不是点选节点的时机");
        }
        await s.runtime.pickCreationStep(stepId, stepParams, {
          reenter: reenter === true,
        });
      });
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[会话] 点选节点失败", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
    }
    this.persist(s);
    return this.toView(id);
  }

  async getStepArtifact(
    id: string,
    stepId: string,
  ): Promise<{
    stepId: string;
    name: string;
    tag: string | null;
    content: string;
  }> {
    const s = this.require(id);
    const catalog = s.moduleCatalog;
    const flow = parseCreationFlow(
      s.runtime.getBlackboard().getContentByTag(CREATION_FLOW_TAG),
    );
    if (!flow) throw new Error("还没有工作流计划");
    const cleaned = stripReviseSteps(flow);
    const step = findStepByRef(cleaned, stepId.trim());
    if (!step) throw new Error(`找不到节点：${stepId}`);
    const mod = findModuleByName(catalog, step.name);
    const tag = mod?.artifact?.trim() || null;
    const content = tag
      ? s.runtime.getBlackboard().getContentByTag(tag)?.trim() || ""
      : "";
    return { stepId: step.id, name: step.name, tag, content };
  }

  async spawnStep(id: string, moduleName: string): Promise<SessionView> {
    const s = this.require(id);
    try {
      const owned = await this.runExclusive(id, s, async () => {
        await this.confirmPendingFlowPlan(s);
        const waiting = s.runtime.getSession().waitingReason?.kind;
        if (waiting !== "pick_creation_step") {
          throw new Error("当前不是追加节点的时机");
        }
        await s.runtime.spawnCreationStep(moduleName);
      });
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[会话] 追加节点失败", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
    }
    this.persist(s);
    return this.toView(id);
  }

  /** 已点进技能步、尚未验收：可退回分层图（误点可增殖节点时用） */
  private canOfferLeaveCreationStep(
    s: ManagedSession,
    reason: WaitingReason | undefined,
  ): boolean {
    const session = s.runtime.getSession();
    if (
      isPlayLayerActive(session.slots) ||
      inferLifecycleStage(session) === "play"
    ) {
      return false;
    }
    const kind = reason?.kind;
    if (
      kind !== "worker_questions" &&
      kind !== "input" &&
      kind !== "revision"
    ) {
      return false;
    }
    const stepId =
      s.runtime.getBlackboard().getContentByTag(CREATION_CURRENT_STEP_TAG)?.trim() ||
      session.currentStepId?.trim() ||
      "";
    return Boolean(stepId);
  }

  /** 流程编排还停在核对态时，点节点先收下计划再进入 */
  private async confirmPendingFlowPlan(s: ManagedSession): Promise<void> {
    const session = s.runtime.getSession();
    if (session.waitingReason?.kind !== "review_artifact") return;
    const art = session.pendingArtifactId
      ? session.artifacts.find((a) => a.id === session.pendingArtifactId)
      : undefined;
    if (art?.workerId !== DESIGN_FLOW_WORKER_ID) {
      throw new Error("当前不是点选节点的时机");
    }
    await s.runtime.acceptArtifact();
  }

  async runOutline(id: string): Promise<SessionView> {
    const s = this.require(id);
    try {
      const owned = await this.runExclusive(id, s, () =>
        s.runtime.submitDecision(
          createDecision({
            action: "run_worker",
            reason: "根据创作简报生成大纲",
            workerId: "outline",
            requiresApproval: true,
          }),
        ),
      );
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
    }
    return this.toView(id);
  }

  async finish(id: string): Promise<SessionView> {
    const s = this.require(id);
    try {
      const owned = await this.runExclusive(id, s, () =>
        s.runtime.submitDecision(
          createDecision({
            action: "finish",
            reason: "创作流程结束",
            requiresApproval: false,
          }),
        ),
      );
      if (!owned) return this.toView(id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
    }
    return this.toView(id);
  }

  private async restoreFromSnapshot(
    snapshot: PersistedBookSession,
  ): Promise<SessionView> {
    return this.mountRestoredSession({
      sessionId: snapshot.sessionId,
      bookId: snapshot.bookId,
      skillPackId: persistedSkillPackId(snapshot) ?? "",
      runtimeSession: snapshot.runtimeSession,
      blackboardItems: snapshot.blackboardItems,
      messages: snapshot.messages.map((m) => ({ ...m })) as ChatMessage[],
      messageBranchState: snapshot.messageBranchState,
      resumeHint: "已从上次进度恢复，可继续创作。",
    });
  }

  private async mountRestoredSession(params: {
    sessionId: string;
    bookId: string;
    skillPackId: string;
    runtimeSession: RuntimeSession;
    blackboardItems: import("../types/blackboard.js").BlackboardItem[];
    messages: ChatMessage[];
    messageBranchState?: import("../types/book-session.js").PersistedMessageBranchState;
    resumeHint: string;
  }): Promise<SessionView> {
    const book = getBook(params.bookId);
    const trackingRef: LlmTrackingRef = {
      current: {
        sessionId: params.sessionId,
        bookId: params.bookId,
        bookTitle: book?.title,
        orchestratorId: params.skillPackId || undefined,
      },
    };

    let managedRef: ManagedSession | null = null;
    const onMessage = this.buildOnMessageHandler(() => managedRef);
    const thinkingHandlers = this.buildStreamHandlers(
      params.sessionId,
      () => managedRef,
    );

    const runtime = new PhaseRuntime({
      autoStubWorker: !hasRealLlmConfig(),
      llm: createDefaultMainAgentLlm(trackingRef),
      onMessage,
      ...thinkingHandlers,
      initialSession: params.runtimeSession,
      initialBlackboardItems: params.blackboardItems,
    });
    await runtime.ensureAvailableSkills();

    const keep = normalizeContextTraceKeepLatest(
      loadAppSettings().contextTraceKeepLatest,
    );
    managedRef = {
      runtime,
      messages: pruneContextTraces(params.messages, keep),
      bookId: params.bookId,
      trackingRef,
      branchState: this.deserializeBranchState(params.messageBranchState),
    };
    this.sessions.set(params.sessionId, managedRef);
    this.activeBookSessions.set(params.bookId, params.sessionId);
    appendBookSession(params.bookId, params.sessionId);
    await this.refreshRecipeOptions(managedRef);
    runtime.recoverOrphanedRun();
    this.persist(managedRef);
    await this.maybeKickAgentAfterDemand(runtime);

    return this.toView(params.sessionId, true, params.resumeHint);
  }

  /** 旧会话：用户已写需求但 Agent 未跑过 → 补 invoke 总管 */
  private async maybeKickAgentAfterDemand(runtime: PhaseRuntime): Promise<void> {
    const session = runtime.getSession();
    const active = session.slots.activeSkill as ActiveSkillSnapshot | undefined;
    if (!active || effectiveStartupMode(active) !== "agent-first") return;
    if (session.slots.startupCompleted) return;

    const demandKey = active.startupTargetKey || "用户.需求";
    const text = String(
      session.slots[demandKey] ?? session.slots.lastUserInput ?? "",
    ).trim();
    if (!text) return;

    const reason = session.waitingReason?.kind;
    if (reason !== "input" && reason !== "intake") return;

    try {
      await runtime.dispatch({
        type: "user_submitted_input",
        payload: { text },
      });
    } catch (err) {
      console.error("[会话] 需求后唤醒总管失败", err);
    }
  }

  private buildOnMessageHandler(getManaged: () => ManagedSession | null) {
    return (text: string) => {
      const managed = getManaged();
      if (!managed) return;
      recordPreMessageCheckpoint(
        managed.branchState,
        managed.messages.length,
        this.captureCheckpoint(managed),
      );
      const usage = managed.trackingRef.current.pendingUsage;
      const sessionId = managed.trackingRef.current.sessionId;
      const liveThinking = sessionId
        ? this.workerLive.get(sessionId)?.thinking?.trim()
        : "";
      managed.trackingRef.current.pendingUsage = undefined;
      const pendingReasoning = managed.trackingRef.current.pendingReasoning;
      managed.trackingRef.current.pendingReasoning = undefined;

      const classified =
        text.trim().length > 0 ? classifyAgentMessage(text) : null;
      const thinking =
        pendingReasoning ||
        (classified?.kind === "worker_output" ||
        classified?.kind === "worker_questions"
          ? liveThinking
          : "") ||
        undefined;
      const pendingTrace = managed.trackingRef.current.pendingContextTrace;
      let contextTrace: LlmContextTrace | undefined;
      if (
        pendingTrace &&
        classified &&
        CONTEXT_TRACE_MESSAGE_KINDS.has(classified.kind)
      ) {
        const keep = normalizeContextTraceKeepLatest(
          loadAppSettings().contextTraceKeepLatest,
        );
        if (keep > 0) {
          contextTrace = pendingTrace;
        }
        managed.trackingRef.current.pendingContextTrace = undefined;
      }

      managed.messages.push(
        this.msg("system", text, usage, thinking, contextTrace),
      );
      managed.messages = pruneContextTraces(
        managed.messages,
        normalizeContextTraceKeepLatest(
          loadAppSettings().contextTraceKeepLatest,
        ),
      );
      this.syncCreationDialogue(managed);
      if (managed.bookId) {
        this.syncBookPreview(managed.bookId, managed.messages);
        this.persist(managed);
      }
    };
  }

  /** 创作模式：从全量 messages 拼「创作.对话」（AI 只留最后一次），不改用户可见消息 */
  private syncCreationDialogue(s: ManagedSession): void {
    try {
      if (inferLifecycleStage(s.runtime.getSession()) !== "design") return;
      const transcript = buildCreationDialogueTranscript(s.messages);
      s.runtime.writeCreationDialogue(transcript);
    } catch (err) {
      console.warn("[会话] 同步创作对话失败", err);
    }
  }

  /** 游玩中只更新工作副本，不覆盖创作过程 */
  private persist(s: ManagedSession): void {
    if (!s.bookId) return;
    const book = getBook(s.bookId);
    if (!book) return;
    const session = s.runtime.getSession();
    if (
      isPlayLayerActive(session.slots) ||
      inferLifecycleStage(session) === "play"
    ) {
      this.savePlayWorking(s);
      this.syncBookSkill(s.bookId, session);
      updateBook(s.bookId, { activeSessionId: session.id });
      return;
    }
    this.writeBookSession(s);
  }

  /** 切到游玩前把当前创作过程写入 session.json */
  private persistCreationIfDesign(s: ManagedSession): void {
    if (!s.bookId) return;
    if (isPlayLayerActive(s.runtime.getSession().slots)) return;
    this.writeBookSession(s);
  }

  private writeBookSession(s: ManagedSession): void {
    if (!s.bookId) return;
    const book = getBook(s.bookId);
    if (!book) return;

    const session = s.runtime.getSession();
    const skillPackId =
      sessionSkillPackId(session) ?? (book ? bookSkillPackId(book) : undefined) ?? "";
    const snapshot: PersistedBookSession = {
      version: 1,
      sessionId: session.id,
      bookId: s.bookId,
      orchestratorId: skillPackId || undefined,
      runtimeSession: session,
      blackboardItems: s.runtime.getBlackboard().exportItems(),
      messages: s.messages,
      messageBranchState: this.serializeBranchState(s.branchState),
      savedAt: new Date().toISOString(),
    };
    saveBookSession(snapshot);
    this.syncBookSkill(s.bookId, session);
    updateBook(s.bookId, { activeSessionId: session.id });
  }

  private syncBookSkill(bookId: string, session: RuntimeSession): void {
    const snap = session.slots.activeSkill as ActiveSkillSnapshot | undefined;
    if (!snap?.name) return;
    try {
      updateBook(bookId, {
        activeSkillId: snap.name,
        activeSkillName: snap.name,
      });
    } catch {
      /* book may have been deleted */
    }
  }

  private syncBookPreview(bookId: string, messages: ChatMessage[]): void {
    const preview = this.previewFromMessages(messages);
    try {
      updateBook(bookId, { preview });
    } catch {
      /* book may have been deleted */
    }
  }

  private previewFromMessages(messages: ChatMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const t = messages[i].text?.trim();
      if (t) return t.slice(0, 80);
    }
    return "等待开始…";
  }

  private clearAgentThinking(sessionId: string): void {
    this.agentThinkingLive.delete(sessionId);
    this.agentThinkingClosed.delete(sessionId);
    this.workerLive.delete(sessionId);
  }

  private buildStreamHandlers(
    sessionId: string,
    _getManaged: () => ManagedSession | null,
  ): Pick<
    import("../runtime/phase-runtime.js").PhaseRuntimeOptions,
    | "onAgentThinkingDelta"
    | "onAgentThinkingDone"
    | "onWorkerStreamStart"
    | "onWorkerThinkingDelta"
    | "onWorkerOutputDelta"
  > {
    return {
      onAgentThinkingDelta: (delta) => {
        const prev = this.agentThinkingClosed.has(sessionId)
          ? ""
          : (this.agentThinkingLive.get(sessionId) ?? "");
        this.agentThinkingClosed.delete(sessionId);
        this.agentThinkingLive.set(sessionId, prev + delta);
      },
      onAgentThinkingDone: (text) => {
        // 正文仍等完整后再渲染；思考收束后继续挂在 liveStream，避免中间只剩「…」
        this.agentThinkingClosed.add(sessionId);
        const done = text.trim();
        if (done) this.agentThinkingLive.set(sessionId, done);
      },
      onWorkerStreamStart: (workerId) => {
        this.workerLive.set(sessionId, { workerId, thinking: "", output: "" });
      },
      onWorkerThinkingDelta: (workerId, delta) => {
        const prev =
          this.workerLive.get(sessionId) ?? {
            workerId,
            thinking: "",
            output: "",
          };
        prev.workerId = workerId;
        prev.thinking += delta;
        this.workerLive.set(sessionId, prev);
      },
      onWorkerOutputDelta: (workerId, delta) => {
        const prev =
          this.workerLive.get(sessionId) ?? {
            workerId,
            thinking: "",
            output: "",
          };
        prev.workerId = workerId;
        prev.output += delta;
        this.workerLive.set(sessionId, prev);
      },
    };
  }

  private buildLiveStreamView(sessionId: string): LiveStreamView | undefined {
    const worker = this.workerLive.get(sessionId);
    if (worker) {
      return {
        actor: "worker",
        actorId: worker.workerId,
        label: formatWorkerDisplayTitle(worker.workerId, "running"),
        thinking: worker.thinking || undefined,
        output: worker.output || undefined,
      };
    }
    const agentThinking = this.agentThinkingLive.get(sessionId);
    if (agentThinking) {
      return {
        actor: "orchestrator",
        label: "总管 · 思考",
        thinking: agentThinking,
      };
    }
    return undefined;
  }

  private require(id: string): ManagedSession {
    const s = this.sessions.get(id);
    if (!s) throw new Error("会话不存在");
    return s;
  }

  private beginRun(s: ManagedSession, sessionId: string): number {
    s.runAbort?.abort();
    s.runAbort = new AbortController();
    s.runGen = (s.runGen ?? 0) + 1;
    s.runMessageCutoff = s.messages.length;
    this.clearAgentThinking(sessionId);
    return s.runGen;
  }

  private isCurrentRun(s: ManagedSession, gen: number): boolean {
    return s.runGen === gen;
  }

  /** true = 本轮仍有效；false = 已被停止并重试取代 */
  private async runExclusive(
    id: string,
    s: ManagedSession,
    fn: () => Promise<unknown>,
  ): Promise<boolean> {
    const gen = this.beginRun(s, id);
    try {
      await runWithAbortSignal(s.runAbort!.signal, fn);
      return this.isCurrentRun(s, gen);
    } catch (err) {
      if (isAbortError(err) && !this.isCurrentRun(s, gen)) {
        return false;
      }
      throw err;
    } finally {
      if (this.isCurrentRun(s, gen)) {
        this.clearAgentThinking(id);
        s.runAbort = undefined;
      }
    }
  }

  /** 执行失败后离开 running，避免界面一直转圈。 */
  private async recoverFailedRun(
    s: ManagedSession,
    detail: string,
  ): Promise<void> {
    const formatted = formatRuntimeError(detail);
    if (s.runtime.getSession().phase === "running") {
      await s.runtime.failRun(formatted);
    } else {
      s.messages.push(this.msg("system", formatted));
    }
    if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
  }

  private enrichDisplayMessages(
    session: RuntimeSession,
    messages: ChatMessage[],
  ): ChatMessage[] {
    const reason = session.waitingReason;
    const activeSkill = session.slots.activeSkill as ActiveSkillSnapshot | undefined;
    if (
      !session.slots.startupCompleted &&
      activeSkill &&
      effectiveStartupMode(activeSkill) === "agent-first" &&
      (reason?.kind === "input" || reason?.kind === "intake")
    ) {
      return messages;
    }
    if (reason?.kind === "intake" && !session.slots.startupCompleted) {
      const prompt = reason.prompt?.trim();
      if (!prompt) return messages;
      const needle = prompt.slice(0, 48);
      const hasStartup = messages.some(
        (m) =>
          m.kind === "orchestrator_prompt" ||
          (typeof m.text === "string" && m.text.includes(needle)),
      );
      if (hasStartup) return messages;
      return [...messages, this.msg("system", prompt)];
    }
    if (reason?.kind !== "input" || session.slots.startupCompleted) {
      return messages;
    }
    const prompt = reason.message?.trim();
    if (!prompt) return messages;
    const needle = prompt.slice(0, 48);
    const hasStartup = messages.some(
      (m) =>
        m.kind === "orchestrator_prompt" ||
        (typeof m.text === "string" && m.text.includes(needle)),
    );
    if (hasStartup) return messages;
    return [...messages, this.msg("system", prompt)];
  }

  private msg(
    role: ChatMessage["role"],
    text: string,
    tokenUsage?: MessageTokenUsage,
    thinking?: string,
    contextTrace?: LlmContextTrace,
  ): ChatMessage {
    const base = {
      id: randomUUID(),
      role,
      text,
      createdAt: new Date().toISOString(),
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(thinking ? { thinking } : {}),
      ...(contextTrace ? { contextTrace } : {}),
    };
    if (role === "user") {
      return {
        ...base,
        kind: "user_input",
        title: "你的输入",
        body: text,
      };
    }
    const classified = classifyAgentMessage(text);
    return { ...base, ...classified };
  }

  /** 按设置修剪本会话上下文痕迹；返回仍保留痕迹的条数 */
  pruneSessionContextTraces(sessionId: string): { kept: number; cleared: number } {
    const s = this.require(sessionId);
    const before = s.messages.filter((m) => m.contextTrace).length;
    const keep = normalizeContextTraceKeepLatest(
      loadAppSettings().contextTraceKeepLatest,
    );
    s.messages = pruneContextTraces(s.messages, keep);
    const after = s.messages.filter((m) => m.contextTrace).length;
    if (s.bookId) this.persist(s);
    return { kept: after, cleared: Math.max(0, before - after) };
  }

  /** 清空本会话全部上下文痕迹 */
  clearSessionContextTraces(sessionId: string): { cleared: number } {
    const s = this.require(sessionId);
    const before = s.messages.filter((m) => m.contextTrace).length;
    s.messages = pruneContextTraces(s.messages, 0);
    if (s.bookId) this.persist(s);
    return { cleared: before };
  }

  /** 按当前设置修剪所有内存中的会话 */
  pruneAllOpenContextTraces(): {
    sessions: number;
    kept: number;
    cleared: number;
  } {
    let sessions = 0;
    let kept = 0;
    let cleared = 0;
    for (const id of this.sessions.keys()) {
      const r = this.pruneSessionContextTraces(id);
      sessions += 1;
      kept += r.kept;
      cleared += r.cleared;
    }
    return { sessions, kept, cleared };
  }

  /** 清空所有内存会话的上下文痕迹 */
  clearAllOpenContextTraces(): { sessions: number; cleared: number } {
    let sessions = 0;
    let cleared = 0;
    for (const id of this.sessions.keys()) {
      const r = this.clearSessionContextTraces(id);
      sessions += 1;
      cleared += r.cleared;
    }
    return { sessions, cleared };
  }

  /** 兼容旧会话 string[] questions → QuestionItem[] */
  private normalizeWaitingReasonForView(
    reason: WaitingReason | undefined,
  ): WaitingReason | undefined {
    if (!reason) return reason;
    if (reason.kind === "worker_questions") {
      return { ...reason, questions: normalizeQuestions(reason.questions) };
    }
    if (reason.kind === "input" && reason.questions?.length) {
      return { ...reason, questions: normalizeQuestions(reason.questions) };
    }
    if (reason.kind === "review_artifact" && reason.questions?.length) {
      return {
        ...reason,
        questions: normalizeQuestions(reason.questions).map((q) => ({
          ...q,
          required: false,
        })),
      };
    }
    return reason;
  }

  private toView(id: string, resumed = false, resumeHint?: string): SessionView {
    const s = this.require(id);
    this.sanitizePlayHitl(s);
    const session = s.runtime.getSession();
    const reason = session.waitingReason;
    const book = s.bookId ? getBook(s.bookId) : null;
    const hints: string[] = [];
    const actions: SessionAction[] = [];
    let intake: IntakeProgress | undefined;
    let intakePrompt: string | undefined;

    const activeSnap = session.slots.activeSkill as ActiveSkillSnapshot | undefined;

    if (resumeHint) {
      hints.push(resumeHint);
    } else if (resumed) {
      hints.push("已从上次进度恢复，可继续创作。");
    }

    if (reason?.kind === "intake" && activeSnap?.intakeFields?.length) {
      intake = buildIntakeProgress(
        activeSnap.intakeFields,
        readIntakeValues(session.slots),
      );
      intakePrompt = reason.prompt;
      if (intake.ready) {
        hints.push("必要项已齐，可确认进入实例化；也可继续补充可选项。");
        actions.push({
          type: "confirm_intake",
          label: "确认，进入实例化",
        });
        actions.push({
          type: "send_message",
          label: "继续补充",
          placeholder: "补充可选项或修正已填内容…",
        });
      } else {
        hints.push(
          `填写必要项（${intake.requiredFilled}/${intake.requiredTotal}）后可确认进入实例化`,
        );
        actions.push({
          type: "send_message",
          label: "发送",
          placeholder: "描述你想创作什么…",
        });
      }
    } else if (reason?.kind === "skill_selection") {
      hints.push("旧版会话处于选包阶段；建议新建作品直接描述需求");
      actions.push({
        type: "send_message",
        label: "发送",
        placeholder: "skill id（如 world-simulator）或列表编号",
      });
    } else if (reason?.kind === "input" && !session.slots.startupCompleted) {
      actions.push({
        type: "send_message",
        label: "发送",
        placeholder: "描述你想做的作品与体验…",
      });
    } else if (reason?.kind === "intake") {
      const isAgentFirst =
        activeSnap && effectiveStartupMode(activeSnap) === "agent-first";
      hints.push(
        isAgentFirst
          ? "描述你想做的体验；发送后总管将开始：创作 · 核心"
          : (reason.prompt?.trim() ?? "请按填空项补充创作信息"),
      );
      actions.push({
        type: "send_message",
        label: "发送",
        placeholder: isAgentFirst
          ? "例如：网恋对象对话、西幻升级交互、规则怪谈……"
          : "描述你想写什么…",
      });
    } else if (reason?.kind === "input") {
      const playNow =
        inferLifecycleStage(session) === "play" || isPlayLayerActive(session.slots);
      if (playNow) {
        actions.push({
          type: "send_message",
          label: "发送",
          placeholder: "说你要做什么…",
        });
      } else if (reason.questions?.length) {
        const qs = normalizeQuestions(reason.questions);
        const hasAssessment = Boolean(reason.message?.trim());
        hints.push(
          hasAssessment
            ? "请阅读内容评价；下方追问可选，也可跳过并直接回复继续"
            : `总管追问（可跳过）：${qs.map((q) => q.prompt).join(" ")}`,
        );
        actions.push({ type: "answer_questions", label: "提交作答" });
        actions.push({ type: "skip_questions", label: "跳过追问" });
        actions.push({
          type: "send_message",
          label: "自由补充",
          placeholder: "也可在此自由补充…",
        });
      } else {
        if (reason.message?.trim()) {
          hints.push(reason.message.trim());
        } else {
          hints.push("请回答启动问题，或补充创作目标");
        }
        actions.push({
          type: "send_message",
          label: "发送",
          placeholder: "描述你想写什么…",
        });
      }
    } else if (reason?.kind === "worker_questions") {
      const qs = normalizeQuestions(reason.questions);
      if (isModuleOpeningQuestions(qs)) {
        // 能力默认问题：对齐美学纲领 → 自由书写，不是可跳过追问卡
        hints.push("按主栏引导先说几句（想到什么写什么，不必整齐）");
        actions.push({
          type: "send_message",
          label: "发送",
          placeholder: "想到什么写什么…",
        });
      } else if (qs.length) {
        hints.push(
          `${displayWorkerLabel(reason.workerId)} · 提问（请在询问卡作答）：${qs.map((q) => q.prompt).join(" ")}`,
        );
        actions.push({ type: "answer_questions", label: "提交作答" });
        actions.push({ type: "skip_questions", label: "跳过追问" });
        actions.push({
          type: "send_message",
          label: "自由补充",
          placeholder: "也可在此自由补充…",
        });
      } else {
        hints.push(
          `${displayWorkerLabel(reason.workerId)} 需要更多信息，请补充说明`,
        );
        actions.push({
          type: "send_message",
          label: "发送",
          placeholder: "补充说明…",
        });
      }
    } else if (reason?.kind === "approve_step") {
      const proposed = readProposedNextStep(
        s.runtime.getSession().slots,
        s.runtime.getBlackboard(),
      );
      if (proposed) {
        hints.push(
          proposed.mode === "revise"
            ? `回头修改「${proposed.name}」${
                proposed.paramsMissing.length
                  ? `（请先补齐：${proposed.paramsMissing.join("、")}）`
                  : "（继承既有产物继续改，不是从零再生成）"
              }`
            : `确认开始「${proposed.name}」${
                proposed.paramsMissing.length
                  ? `（请先补齐：${proposed.paramsMissing.join("、")}）`
                  : ""
              }`,
        );
        actions.push({
          type: "approve",
          label: proposed.paramsMissing.length ? "补参后开始" : "同意并开始",
        });
      } else {
        actions.push({ type: "approve", label: "确认执行" });
      }
      actions.push({ type: "reject", label: "返回节点" });
      actions.push({
        type: "send_message",
        label: "说明意见",
        placeholder: "改排、补节点（如 NPC）、回头改某步，或说明不要这一步…",
      });
    } else if (reason?.kind === "pick_creation_step") {
      hints.push(
        "点可进入的节点即确认并开始。虚线原型点一下会增殖一条实例再进去。要改排在底栏写意见再发。",
      );
      actions.push({ type: "replan", label: "发送" });
      actions.push({
        type: "send_message",
        label: "发送",
        placeholder: "例如：补舞台骨架、把某步改到开场白之前…",
      });
    } else if (reason?.kind === "next_intent") {
      hints.push("下一步想写什么？可留空；也可说回头改某步。发送后会展示下一节点供你确认。");
      actions.push({
        type: "send_message",
        label: "继续",
        placeholder: "下一步想写什么？（可留空）…",
      });
    } else if (reason?.kind === "review_artifact") {
      const art = session.artifacts.find((a) => a.id === session.pendingArtifactId);
      const copy = reviewComposerCopy(art?.workerId, {
        hasQuestions: Boolean(reason.questions?.length),
      });
      if (art?.workerId === DESIGN_FLOW_WORKER_ID) {
        hints.push(
          "点可进入的节点即确认并开始。虚线原型点一下会增殖一条实例再进去。要改排在底栏写意见再发。",
        );
        actions.push({
          type: "send_message",
          label: "发送",
          placeholder: "例如：补舞台骨架、把某步改到开场白之前…",
        });
      } else {
        actions.push({ type: "accept", label: copy.acceptLabel });
        actions.push({ type: "reject", label: "不接受" });
        actions.push({
          type: "send_message",
          label: copy.submitLabel,
          placeholder: `${copy.placeholder}；在现有产物上改，不整份重做…`,
        });
      }
      if (reason.questions?.length) {
        hints.push(
          art?.workerId === DESIGN_FLOW_WORKER_ID
            ? "下方追问可选；点节点进入即收起"
            : `下方追问可选；${copy.acceptLabel}即收起（表示无需再完善）`,
        );
        actions.push({ type: "answer_questions", label: "提交作答" });
        actions.push({ type: "skip_questions", label: "跳过追问" });
      }
    } else if (reason?.kind === "revision") {
      hints.push(
        reason.instruction?.trim() ||
          "请说明要改哪里；发送后在现有产物上修改",
      );
      actions.push({
        type: "send_message",
        label: "按意见修改",
        placeholder: "说明要改哪里…",
      });
    } else if (session.phase === "error") {
      hints.push("上一轮执行出错。可直接发消息让总管重试，或刷新作品后继续。");
      actions.push({
        type: "send_message",
        label: "重试 / 继续",
        placeholder: "例如：重试上一步，或补充说明…",
      });
    } else if (
      session.phase === "running" &&
      s.runtime.needsMainAgentDecision() &&
      !s.runtime.hasMainAgent()
    ) {
      hints.push("简报已就绪，可手动生成大纲（未配置总管模型）");
      actions.push({ type: "run_outline", label: "生成大纲" });
      actions.push({
        type: "send_message",
        label: "发送",
        placeholder: "补充说明…",
      });
    } else if (session.phase === "running" && s.runtime.needsMainAgentDecision()) {
      hints.push("总管正在调度…");
    } else if (session.phase === "running" && session.pendingArtifactId) {
      /* worker 运行中 */
    } else if (
      session.phase === "running" &&
      session.slots.startupCompleted &&
      !session.pendingDecision
    ) {
      actions.push({ type: "finish", label: "结束流程" });
    } else if (session.phase === "done") {
      hints.push("流程已完成");
    } else {
      actions.push({
        type: "send_message",
        label: "发送",
        placeholder: "输入消息…",
      });
    }

    if (this.canOfferLeaveCreationStep(s, reason)) {
      actions.push({ type: "leave_step", label: "返回节点" });
    }

    if (s.bookId) {
      this.persist(s);
    }

    const tokens = getSessionTokenTotals(id);
    const messages = this.enrichDisplayMessages(session, [...s.messages]);
    const lifecycleStage = inferLifecycleStage(session);
    const skillPackId =
      sessionSkillPackId(session) ?? (book ? bookSkillPackId(book) : undefined);
    const workerSetYaml = readWorkerSetYaml(s.runtime.getBlackboard());
    const skillCatalog = buildSkillCatalog(
      session,
      skillPackId,
      lifecycleStage,
      { workerSetYaml },
    );
    const shellAdapt = parseShellAdaptationFromReplyFormat(
      s.runtime.getBlackboard().getContentByTag("设计.正文组成") ??
        s.runtime.getBlackboard().getContentByTag("设计.回复格式"),
    );

    return {
      id,
      bookId: s.bookId,
      bookTitle: book?.title,
      activeSkill: s.runtime.getActiveSkill()?.name ?? skillPackId,
      phase: session.phase,
      waitingReason: this.normalizeWaitingReasonForView(reason),
      startupCompleted: Boolean(session.slots.startupCompleted),
      skills: s.runtime.getAvailableSkills(),
      messages,
      hints,
      actions,
      pipeline: buildPipeline(session),
      lifecycleStage,
      playLayerActive: isPlayLayerActive(session.slots),
      playReady: canEnterPlay(session),
      hasProduct: Boolean(
        s.bookId &&
          this.listGameSnapshots(s.bookId).some((item) => item.kind === "instance"),
      ),
      playInstanceId: isPlayLayerActive(session.slots)
        ? this.currentPlayInstanceId(s)
        : undefined,
      skillCatalog,
      toolTrace: buildToolTrace(messages),
      burst: buildBurstState(messages, session),
      focus: buildFocus(session, reason, intake, lifecycleStage),
      intake,
      intakePrompt,
      uiPrompt:
        !session.slots.startupCompleted &&
        activeSnap &&
        effectiveStartupMode(activeSnap) === "agent-first"
          ? activeSnap.uiPrompt?.trim() || DEFAULT_UI_PROMPT
          : undefined,
      reviewArtifact: buildReviewArtifactView(
        session,
        messages,
        s.runtime.getBlackboard(),
        s.moduleCatalog,
      ),
      workerSetView: buildWorkerSetUserView(
        s.runtime.getBlackboard(),
        s.runtime.getSession(),
      ),
      creationFlowView: buildCreationFlowUserView(
        s.runtime.getBlackboard(),
        session.slots[SLOT_CREATION_ACCEPTED_UNITS],
        s.moduleCatalog,
      ),
      proposedNextStep:
        reason?.kind === "approve_step"
          ? readProposedNextStep(
              session.slots,
              s.runtime.getBlackboard(),
            )
          : undefined,
      recipes: s.recipeOptions?.map((r) => ({
        id: r.id,
        name: r.name,
        declaration: r.declaration,
      })),
      selectedRecipe: resolveSelectedRecipeView(
        s.runtime.getBlackboard(),
        s.recipeOptions,
      ),
      openingGuide: this.resolveOpeningGuideForView(s, reason),
      boardPanel: buildBoardPanelFromRuntime(s.runtime.getBlackboard()),
      presentationTweaks: shellAdapt
        ? {
            shell_id: shellAdapt.shell_id,
            ...shellAdapt.tweaks,
          }
        : undefined,
      liveStream: this.buildLiveStreamView(id),
      agentThinking: this.agentThinkingLive.get(id),
      resumed: resumed || undefined,
      tokenStats: {
        sessionTotal: tokens.totalTokens,
        sessionCached: tokens.totalCached || undefined,
        sessionCacheMiss: tokens.totalCacheMiss || undefined,
        lastCaller: tokens.last?.caller,
        lastTotal: tokens.last?.totalTokens,
        byCaller: tokens.byCaller,
      },
    };
  }

  private captureCheckpoint(s: ManagedSession): SessionCheckpoint {
    return {
      runtimeSession: structuredClone(s.runtime.getSession()),
      blackboardItems: s.runtime.getBlackboard().exportItems(),
    };
  }

  private serializeBranchState(
    state: MessageBranchState,
  ): import("../types/book-session.js").PersistedMessageBranchState {
    const preMessageCheckpoints: Record<
      string,
      { runtimeSession: RuntimeSession; blackboardItems: BlackboardItem[] }
    > = {};
    for (const [key, cp] of Object.entries(state.preMessageCheckpoints)) {
      preMessageCheckpoints[key] = {
        runtimeSession: structuredClone(cp.runtimeSession),
        blackboardItems: structuredClone(cp.blackboardItems),
      };
    }
    const branches: import("../types/book-session.js").PersistedMessageBranchState["branches"] =
      {};
    for (const [groupId, branch] of Object.entries(state.branches)) {
      branches[groupId] = {
        anchorIndex: branch.anchorIndex,
        groupId: branch.groupId,
        activeIndex: branch.activeIndex,
        variants: branch.variants.map((v) => ({
          messages: v.messages.map((m) => ({ ...m })),
          checkpoint: {
            runtimeSession: structuredClone(v.checkpoint.runtimeSession),
            blackboardItems: structuredClone(v.checkpoint.blackboardItems),
          },
        })),
      };
    }
    return { branches, preMessageCheckpoints };
  }

  private deserializeBranchState(
    raw?: import("../types/book-session.js").PersistedMessageBranchState,
  ): MessageBranchState {
    const state = createMessageBranchState();
    if (!raw) return state;
    for (const [key, cp] of Object.entries(raw.preMessageCheckpoints ?? {})) {
      state.preMessageCheckpoints[Number(key)] = {
        runtimeSession: structuredClone(cp.runtimeSession),
        blackboardItems: structuredClone(cp.blackboardItems),
      };
    }
    for (const [groupId, branch] of Object.entries(raw.branches ?? {})) {
      state.branches[groupId] = {
        anchorIndex: branch.anchorIndex,
        groupId: branch.groupId,
        activeIndex: branch.activeIndex,
        variants: branch.variants.map((v) => ({
          messages: v.messages.map((m) => ({ ...m })),
          checkpoint: {
            runtimeSession: structuredClone(v.checkpoint.runtimeSession),
            blackboardItems: structuredClone(v.checkpoint.blackboardItems),
          },
        })),
      };
    }
    return state;
  }

  private async refreshRecipeOptions(s: ManagedSession): Promise<void> {
    const skillName = s.runtime.getActiveSkill()?.name;
    if (!skillName) {
      s.recipeOptions = [];
      s.moduleCatalog = null;
      s.openingGuide = null;
      return;
    }
    try {
      const skill = await loadSkill(skillName);
      if (!skill.skillPackRoot) {
        s.recipeOptions = [];
        s.moduleCatalog = null;
        s.openingGuide = null;
        return;
      }
      const [catalog, modules] = await Promise.all([
        loadRecipeCatalog(skill.skillPackRoot),
        loadModuleCatalog(skill.skillPackRoot),
      ]);
      s.recipeOptions = catalog?.recipes ?? [];
      s.moduleCatalog = modules;
    } catch {
      s.recipeOptions = [];
      s.moduleCatalog = null;
    }
    await this.ensureRecipeSeededFlow(s);
    await this.refreshOpeningGuide(s);
  }

  /** 已选配方但尚无流程 → 写入配方近期起点（兼容旧会话） */
  private async ensureRecipeSeededFlow(s: ManagedSession): Promise<void> {
    const board = s.runtime.getBlackboard();
    if (board.getContentByTag(CREATION_FLOW_TAG)?.trim()) return;
    const ref = parseSelectedRecipeRef(
      board.getContentByTag(CREATION_SELECTED_RECIPE_TAG),
    );
    if (!ref) return;
    const entry = findRecipeCatalogEntry(
      s.recipeOptions?.length ? { recipes: s.recipeOptions } : null,
      ref,
    );
    if (!entry) return;
    const skillName = s.runtime.getActiveSkill()?.name;
    if (!skillName) return;
    try {
      const skill = await loadSkill(skillName);
      const packRoot = skill.skillPackRoot?.trim();
      if (!packRoot) return;
      const detail = await loadRecipeDetail(packRoot, entry);
      const seeded = creationFlowFromRecipeSeed(detail);
      if (!seeded) return;
      await this.commitSeededCreationFlow(s, seeded);
    } catch (err) {
      console.error("[会话] 配方预置失败", err);
    }
  }

  /**
   * 下一待做开局步（无 depends_on）的 opening → 意图页引导。
   * 有起点模块就展示；无则 null（再走 design-flow 生成）。
   * 中段步骤的默认问题改由 resolveOpeningGuideForView 在 waiting 时覆盖。
   */
  private async refreshOpeningGuide(s: ManagedSession): Promise<void> {
    const skillName = s.runtime.getActiveSkill()?.name;
    if (!skillName) {
      s.openingGuide = null;
      return;
    }
    try {
      const skill = await loadSkill(skillName);
      const packRoot = skill.skillPackRoot?.trim();
      if (!packRoot) {
        s.openingGuide = null;
        return;
      }
      const board = s.runtime.getBlackboard();
      const session = s.runtime.getSession();
      const accepted = parseAcceptedUnits(
        session.slots[SLOT_CREATION_ACCEPTED_UNITS] ??
          board.getContentByTag(CREATION_ACCEPTED_UNITS_TAG),
      );
      const binding = await resolveDesignStepBinding({
        skillPackRoot: packRoot,
        flowRaw: board.getContentByTag(CREATION_FLOW_TAG),
        acceptedStepNames: accepted,
      });
      if (
        !binding?.opening?.trim() ||
        (binding.step.depends_on?.length ?? 0) > 0
      ) {
        s.openingGuide = null;
        return;
      }
      s.openingGuide = {
        stepId: binding.step.id,
        stepName: binding.module.name || binding.step.name,
        text: binding.opening.trim(),
      };
    } catch {
      s.openingGuide = null;
    }
  }

  /**
   * 视图用开场引导：等待能力默认问题时用题干（对齐美学纲领说话面）；
   * 中段步骤（有 depends_on）也会覆盖，避免只剩空答题壳。
   */
  private resolveOpeningGuideForView(
    s: ManagedSession,
    reason: WaitingReason | undefined,
  ): { stepId: string; stepName: string; text: string } | null {
    if (reason?.kind === "pick_creation_step") return null;
    if (reason?.kind === "worker_questions") {
      const qs = normalizeQuestions(reason.questions);
      if (isModuleOpeningQuestions(qs)) {
        const text = qs[0]?.prompt?.trim() ?? "";
        if (text) {
          const board = s.runtime.getBlackboard();
          const stepKey =
            board.getContentByTag(CREATION_CURRENT_STEP_TAG)?.trim() || "";
          const flow = parseCreationFlow(board.getContentByTag(CREATION_FLOW_TAG));
          const step = flow?.steps?.find(
            (st) =>
              stepUnitId(st) === stepKey ||
              st.id === stepKey ||
              st.name === stepKey,
          );
          const stepName =
            step?.name?.trim() ||
            s.openingGuide?.stepName?.trim() ||
            stepKey ||
            "按引导先说几句";
          return {
            stepId: qs[0]!.id,
            stepName,
            text,
          };
        }
      }
    }
    return s.openingGuide ?? null;
  }

  /** 写入剧本 seed，并立刻进入点选图（开局节点跟配方走）。 */
  private async commitSeededCreationFlow(
    s: ManagedSession,
    seeded: CreationFlow,
  ): Promise<void> {
    this.writeSeededCreationFlow(s, seeded);
    await s.runtime.enterSeededCreationPick();
  }

  /** 配方预置 DAG：写入黑板并留下可回退的编排检查点（不必先跑 LLM） */
  private writeSeededCreationFlow(s: ManagedSession, seeded: CreationFlow): void {
    s.runtime.getBlackboard().write({
      tag: CREATION_FLOW_TAG,
      content: stringifyCreationFlow(seeded),
      source: "runtime",
    });
    const alreadyRecorded = s.messages.some(
      (m) =>
        m.kind === "worker_output" &&
        m.actor === "design-flow" &&
        (m.text ?? "").includes("配方预置近期起点"),
    );
    if (alreadyRecorded) return;
    const names = seeded.steps.map((step) => step.name).join(" → ");
    recordPreMessageCheckpoint(
      s.branchState,
      s.messages.length,
      this.captureCheckpoint(s),
    );
    s.messages.push(
      this.msg(
        "system",
        `[Worker] design-flow 已完成\n\n配方预置近期起点${names ? `：${names}` : ""}。\n这是可回退的编排检查点；之后可再编排追加节点（如生成规则 / 具体实例）。`,
      ),
    );
    this.syncCreationDialogue(s);
  }

  private async applySelectedRecipe(
    s: ManagedSession,
    recipeId: string,
  ): Promise<void> {
    const options = s.recipeOptions ?? [];
    const entry = findRecipeCatalogEntry(
      options.length ? { recipes: options } : null,
      recipeId,
    );
    if (!entry) {
      throw new Error(`未知初始配方：${recipeId}`);
    }
    const board = s.runtime.getBlackboard();
    board.write({
      tag: CREATION_SELECTED_RECIPE_TAG,
      content: JSON.stringify({
        id: entry.id,
        name: entry.name,
      }),
      source: "user",
    });

    // 开局节点跟剧本 seed：写入近期起点并进入点选图（不必先跑 design-flow / 先描述需求）
    const existingFlow = board.getContentByTag(CREATION_FLOW_TAG)?.trim();
    if (!existingFlow) {
      const skillName = s.runtime.getActiveSkill()?.name;
      if (skillName) {
        try {
          const skill = await loadSkill(skillName);
          const packRoot = skill.skillPackRoot?.trim();
          if (packRoot) {
            const detail = await loadRecipeDetail(packRoot, entry);
            const seeded = creationFlowFromRecipeSeed(detail);
            if (seeded) {
              await this.commitSeededCreationFlow(s, seeded);
            }
          }
        } catch (err) {
          console.error("[会话] 从配方写入创作流程失败", err);
        }
      }
    }

    await this.refreshOpeningGuide(s);
  }
}

export const sessionManager = new SessionManager();

function readWorkerSetYaml(blackboard: Blackboard): string | undefined {
  for (const tag of ["设计.worker集", "设计.worker集.草稿"]) {
    const content = blackboard.getContentByTag(tag)?.trim();
    if (content) return content;
  }
  return undefined;
}

function collectFilledTags(blackboard: Blackboard): string[] {
  return blackboard.listTagIndex().map((item) => item.tag);
}

function buildCreationFlowUserView(
  blackboard: Blackboard,
  acceptedRaw?: unknown,
  catalog?: ModuleCatalog | null,
): CreationFlowUserView | undefined {
  const raw = blackboard.getContentByTag(CREATION_FLOW_TAG)?.trim();
  if (!raw) return undefined;
  const flow = parseCreationFlow(raw);
  if (!flow) {
    return { steps: [], parseError: "创作流程无法解析为 JSON（需要 steps 数组）" };
  }
  const accepted = parseAcceptedUnits(
    acceptedRaw ?? blackboard.getContentByTag(CREATION_ACCEPTED_UNITS_TAG),
  );
  const titleHints: Record<string, FlowStepTitleHint> = {};
  const store = parseAcceptedContentStore(
    blackboard.getContentByTag(CREATION_ACCEPTED_CONTENT_TAG),
  );
  for (const [id, entry] of Object.entries(store.units)) {
    if (!entry.summary && entry.content == null) continue;
    titleHints[id] = {
      ...(entry.summary ? { summary: entry.summary } : {}),
      ...(entry.content != null ? { content: entry.content } : {}),
    };
  }
  return formatCreationFlowForUser(
    flow,
    catalog,
    accepted,
    collectFilledTags(blackboard),
    titleHints,
  );
}

function readProposedNextStep(
  slots: Record<string, unknown>,
  blackboard: Blackboard,
): ProposedNextStepView | undefined {
  const raw =
    (typeof slots[CREATION_PROPOSED_STEP_TAG] === "string"
      ? String(slots[CREATION_PROPOSED_STEP_TAG])
      : null) || blackboard.getContentByTag(CREATION_PROPOSED_STEP_TAG);
  if (!raw?.trim()) return undefined;
  try {
    const doc = JSON.parse(raw) as Partial<ProposedNextStepView>;
    if (typeof doc.stepId !== "string" || typeof doc.name !== "string") {
      return undefined;
    }
    return {
      stepId: doc.stepId,
      name: doc.name,
      declaration:
        typeof doc.declaration === "string" ? doc.declaration : undefined,
      params:
        doc.params && typeof doc.params === "object" && !Array.isArray(doc.params)
          ? (doc.params as Record<string, unknown>)
          : {},
      paramsMissing: Array.isArray(doc.paramsMissing)
        ? doc.paramsMissing.map(String)
        : [],
      paramSpecs: Array.isArray(doc.paramSpecs)
        ? doc.paramSpecs
            .map((p) => ({
              key: String((p as { key?: string }).key ?? ""),
              label: String((p as { label?: string }).label ?? ""),
              required: Boolean((p as { required?: boolean }).required),
              hint:
                typeof (p as { hint?: string }).hint === "string"
                  ? (p as { hint: string }).hint
                  : undefined,
            }))
            .filter((p) => p.key)
        : [],
      kind: typeof doc.kind === "string" ? doc.kind : undefined,
      intent: typeof doc.intent === "string" ? doc.intent : undefined,
      mode: doc.mode === "revise" ? "revise" : undefined,
      revises: typeof doc.revises === "string" ? doc.revises : undefined,
      closer: doc.closer === true ? true : undefined,
    };
  } catch {
    return undefined;
  }
}

function resolveSelectedRecipeView(
  blackboard: Blackboard,
  options?: RecipeCatalogEntry[],
): { id: string; name: string; declaration: string } | null {
  const ref = parseSelectedRecipeRef(
    blackboard.getContentByTag(CREATION_SELECTED_RECIPE_TAG),
  );
  if (!ref) return null;
  const entry = findRecipeCatalogEntry(
    options?.length ? { recipes: options } : null,
    ref,
  );
  if (entry) {
    return {
      id: entry.id,
      name: entry.name,
      declaration: entry.declaration,
    };
  }
  return { id: ref, name: ref, declaration: "" };
}

function buildWorkerSetUserView(
  blackboard: Blackboard,
  session?: RuntimeSession,
): WorkerSetUserView | undefined {
  const yaml = readWorkerSetYaml(blackboard);
  if (!yaml) return undefined;
  const parsed = parseWorkerSetYaml(yaml);
  if (!parsed) return undefined;
  const acceptedUnitIds = parseAcceptedUnits(
    session?.slots?.creationAcceptedUnits ??
      blackboard.getContentByTag("创作.已验收单位"),
  );
  const currentUnitId =
    (typeof session?.slots?.creationCurrentUnitId === "string"
      ? session.slots.creationCurrentUnitId
      : null) ||
    blackboard.getContentByTag("创作.当前单位")?.trim() ||
    null;
  return (
    formatWorkerSetForUser(parsed, {
      filledTags: collectFilledTags(blackboard),
      acceptedUnitIds,
      currentUnitId,
    }) ?? undefined
  );
}

function buildReviewArtifactView(
  session: RuntimeSession,
  messages: ChatMessage[],
  blackboard: Blackboard,
  catalog?: ModuleCatalog | null,
): ReviewArtifactView | undefined {
  if (session.waitingReason?.kind !== "review_artifact") return undefined;
  const art = session.artifacts.find((a) => a.id === session.pendingArtifactId);
  if (!art) return undefined;

  const workerSetTags = ["设计.worker集", "设计.worker集.草稿"];
  const tagBodies: string[] = [];
  for (const tag of workerSetTags) {
    const content = blackboard.getContentByTag(tag);
    if (content?.trim()) {
      tagBodies.push(`## ${tag}\n\n${content.trim()}`);
    }
  }

  for (const tag of art.outputTags) {
    if (workerSetTags.includes(tag)) continue;
    if (isProgressPointerTag(tag)) continue;
    const content = blackboard.getContentByTag(tag);
    if (content?.trim()) {
      tagBodies.push(`## ${tag}\n\n${content.trim()}`);
    }
  }

  // 回退消息里也可能夹带「创作.当前步骤」段落，验收正文里去掉
  const stripPointerSections = (text: string): string => {
    const trimmed = text.trim();
    if (!trimmed) return "";
    const re = /^##\s+(.+?)\s*$/gm;
    const hits: Array<{ title: string; index: number; headerEnd: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(trimmed))) {
      hits.push({
        title: m[1]!.trim(),
        index: m.index,
        headerEnd: m.index + m[0].length,
      });
    }
    if (!hits.length) return trimmed;
    return hits
      .filter((h) => !isProgressPointerTag(h.title) && !/当前步骤|当前单位/.test(h.title))
      .map((h, i) => {
        const end = i + 1 < hits.length ? hits[i + 1]!.index : trimmed.length;
        const chunk = trimmed.slice(h.headerEnd, end).trim();
        return chunk ? `## ${h.title}\n\n${chunk}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  };

  const outputMsg = [...messages]
    .reverse()
    .find((m) => m.kind === "worker_output" && m.actor === art.workerId);

  const body =
    tagBodies.join("\n\n") ||
    stripPointerSections((outputMsg?.body ?? outputMsg?.text ?? "").trim()) ||
    art.summary?.trim() ||
    "（Worker 未写入可读正文，请检查黑板 tag 或重试创作 skill）";

  const isFinalSet = art.outputTags.includes("设计.worker集");
  const isFlowArt =
    art.workerId === "design-flow" || art.outputTags.includes(CREATION_FLOW_TAG);
  const currentUnit =
    blackboard.getContentByTag("创作.当前单位")?.trim() ||
    (typeof session.slots.creationCurrentUnitId === "string"
      ? session.slots.creationCurrentUnitId
      : "");
  const isDesignArt = isDesignDiskWorker(art.workerId);
  const summary =
    art.summary?.trim() ||
    (isFlowArt
      ? "创作流程（步骤与依赖）"
      : isDesignArt
        ? isFinalSet
          ? "完整 Worker 集（终稿）"
          : currentUnit
            ? `创作单位 · ${currentUnit}`
            : "创作单位草稿"
        : `${art.workerId} 产物`);

  const workerSetYaml = readWorkerSetYaml(blackboard);
  const workerSet =
    isDesignArt && !isFlowArt && workerSetYaml
      ? parseWorkerSetYaml(workerSetYaml) ?? undefined
      : undefined;
  const acceptedUnitIds = parseAcceptedUnits(
    session.slots.creationAcceptedUnits ??
      blackboard.getContentByTag("创作.已验收单位"),
  );
  const workerSetView =
    isDesignArt && workerSet
      ? formatWorkerSetForUser(workerSet, {
          filledTags: collectFilledTags(blackboard),
          acceptedUnitIds,
          currentUnitId: currentUnit || null,
        }) ?? undefined
      : undefined;

  const creationFlowView = isFlowArt
    ? buildCreationFlowUserView(
        blackboard,
        session.slots[SLOT_CREATION_ACCEPTED_UNITS],
        catalog,
      )
    : undefined;

  return {
    id: art.id,
    workerId: art.workerId,
    summary,
    body,
    outputTags: art.outputTags,
    sourceMessageId: outputMsg?.id,
    contextTrace: outputMsg?.contextTrace,
    workerSet,
    workerSetView,
    creationFlowView,
  };
}

function buildBoardPanelFromRuntime(
  blackboard: import("../blackboard/blackboard.js").Blackboard,
): BoardPanelView {
  return buildBoardPanel(blackboard);
}

function formatRuntimeError(detail: string): string {
  if (detail.includes("401") || detail.toLowerCase().includes("authentication")) {
    return (
      "[请求失败] API Key 无效或未授权。请到「设置 → API 配置」检查 Key 与 Base URL，" +
      "或点击「探测」验证。"
    );
  }
  if (detail.startsWith("LLM request failed")) {
    return `[请求失败] ${detail.replace(/^LLM request failed \(\d+\): /, "").slice(0, 300)}`;
  }
  if (detail.startsWith("Main Agent returned invalid JSON")) {
    return "[请求失败] 总管返回了无效 JSON，请检查模型是否支持 json 输出，或暂时关闭预设后重试。";
  }
  return `[请求失败] ${detail.slice(0, 300)}`;
}
