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
import { PhaseRuntime, createDecision } from "../runtime/phase-runtime.js";
import { createSession } from "../runtime/phase-machine.js";
import {
  createDefaultMainAgentLlm,
  hasRealLlmConfig,
  reloadDefaultMainAgentLlm,
  type LlmTrackingRef,
} from "../runtime/llm-factory.js";
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
import { parseAcceptedUnits, isDesignDiskWorker } from "../skills/creation-units.js";
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
  CREATION_FLOW_TAG,
  CREATION_SELECTED_RECIPE_TAG,
  findRecipeCatalogEntry,
  formatCreationFlowForUser,
  loadRecipeCatalog,
  parseCreationFlow,
  parseSelectedRecipeRef,
  type CreationFlowUserView,
  type RecipeCatalogEntry,
} from "../skills/creation-flow.js";
import { loadSkill } from "../skills/loader.js";
import { effectiveStartupMode, DEFAULT_UI_PROMPT } from "../config/default-orchestrator.js";
import { buildBoardPanel } from "../runtime/compress-after-worker.js";
import {
  displayWorkerLabel,
  formatWorkerDisplayTitle,
} from "./display-labels.js";
import {
  buildCreationDialogueTranscript,
  foldRunProcessMessages,
} from "./prune-creation-messages.js";
import {
  formatQuestionAnswersForAi,
  formatQuestionAnswersForDisplay,
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
  playReady: boolean;
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
  /** 能力包内可选初始配方（用户手动选） */
  recipes?: Array<{ id: string; name: string; declaration: string }>;
  /** 用户已选初始配方 */
  selectedRecipe?: { id: string; name: string; declaration: string } | null;
  /** 黑板与定稿上下文（强可读） */
  boardPanel?: BoardPanelView;
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

export type ReviewArtifactView = {
  id: string;
  workerId: string;
  summary?: string;
  body: string;
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
};

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  /** bookId → 当前内存中的 sessionId */
  private readonly activeBookSessions = new Map<string, string>();
  /** sessionId → 流式 thinking 缓冲 */
  private readonly agentThinkingLive = new Map<string, string>();
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
    const session = s.runtime.getSession();
    if (stage === "play" && !canEnterPlay(session)) {
      throw new Error("实例尚未就绪，无法进入游玩");
    }
    s.runtime.setLifecycleStage(stage);
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
    if (!this.sessions.has(id)) return null;
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
      if (!canEnterPlay(runtimeSession) && !runtimeSession.slots.startupCompleted) {
        throw new Error("须先验收 Worker 集，才能保存创作定稿");
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

  /** 列出某 Book 的全部存档 */
  listGameSnapshots(bookId: string): RunSnapshotMeta[] {
    if (!getBook(bookId)) throw new Error("Book 不存在");
    return listRunSnapshots(bookId);
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
    if (inferLifecycleStage(session) !== "play") {
      throw new Error("请先切换到「游玩」再保存游玩存档");
    }
    return this.saveGameSnapshot(sessionId, label, "run", note);
  }

  /** 从已验收实例开一条新的游玩线（清空 run 层状态） */
  async startNewPlayRun(sessionId: string): Promise<SessionView> {
    const s = this.require(sessionId);
    if (!s.bookId) throw new Error("仅绑定作品时可新建游玩");
    const session = s.runtime.getSession();
    if (!canEnterPlay(session)) {
      throw new Error("须先验收 Worker 集，才能开始游玩");
    }

    let runtimeSession = structuredClone(session);
    let blackboardItems = s.runtime.getBlackboard().exportItems();
    ({ runtimeSession, blackboardItems } = materializeInstanceSnapshotPayload({
      runtimeSession,
      blackboardItems,
    }));
    runtimeSession.slots = {
      ...runtimeSession.slots,
      uiLifecycleStage: "play",
      startupCompleted: true,
    };
    runtimeSession.phase = "waiting_user";
    runtimeSession.waitingReason = { kind: "input" };
    runtimeSession.pendingArtifactId = undefined;
    runtimeSession.pendingDecision = undefined;
    runtimeSession.currentWorkerId = undefined;
    runtimeSession.resumeContext = undefined;

    s.runtime.restoreFromCheckpoint(runtimeSession, blackboardItems);
    this.persist(s);
    return this.toView(sessionId);
  }

  /** 从存档读档：替换当前作品进度，可继续创作 */
  async loadGameSnapshot(bookId: string, snapshotId: string): Promise<SessionView> {
    const snapshot = loadRunSnapshotFile(bookId, snapshotId);
    if (!snapshot) throw new Error("存档不存在");

    const book = getBook(bookId);
    if (!book) throw new Error("Book 不存在");
    if (!skillPacksMatch(book, runSnapshotSkillPackId(snapshot))) {
      throw new Error("存档与当前作品 skill 包不匹配，无法读档");
    }

    this.dropBookSessions(bookId);

    const newSessionId = randomUUID();
    const messages: ChatMessage[] = snapshot.messages.map((m) => ({ ...m })) as ChatMessage[];
    let runtimeSession = structuredClone(snapshot.runtimeSession);
    let blackboardItems = snapshot.blackboardItems;

    if (snapshot.kind === "instance") {
      ({ runtimeSession, blackboardItems } = materializeInstanceSnapshotPayload({
        runtimeSession,
        blackboardItems,
      }));
    } else {
      runtimeSession.slots = {
        ...runtimeSession.slots,
        uiLifecycleStage: "play",
      };
    }

    runtimeSession.id = newSessionId;

    const resumeHint =
      snapshot.kind === "instance"
        ? `已加载实例「${snapshot.label}」。可开始运行，或调整角色设定后再模拟。`
        : `已从存档「${snapshot.label}」读档，可继续创作。`;

    return this.mountRestoredSession({
      sessionId: newSessionId,
      bookId,
      skillPackId: runSnapshotSkillPackId(snapshot) ?? "",
      runtimeSession,
      blackboardItems,
      messages,
      resumeHint,
    });
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

  async sendMessage(id: string, text: string): Promise<SessionView> {
    const s = this.require(id);
    this.clearAgentThinking(id);
    recordPreMessageCheckpoint(
      s.branchState,
      s.messages.length,
      this.captureCheckpoint(s),
    );
    s.messages.push(this.msg("user", text));
    this.syncCreationDialogue(s);
    if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    const reason = s.runtime.getSession().waitingReason;
    try {
      if (reason?.kind === "approve_step") {
        await s.runtime.rejectStep(text);
      } else if (reason?.kind === "review_artifact") {
        await s.runtime.rejectArtifact(text);
      } else {
        await s.runtime.submitInput(text);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[session] sendMessage failed:", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
      if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    } finally {
      this.clearAgentThinking(id);
      this.syncCreationDialogue(s);
    }
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
      if (isSidecar) {
        await s.runtime.resolveSidecarQuestions(aiText);
      } else {
        await s.runtime.submitInput(aiText);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[session] answerQuestions failed:", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
      if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    } finally {
      this.clearAgentThinking(id);
      this.syncCreationDialogue(s);
    }
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
        await s.runtime.resolveSidecarQuestions();
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
      await s.runtime.submitInput(trimmed);
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
      await s.runtime.rerunWorker(workerId);
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

  async approve(id: string): Promise<SessionView> {
    const s = this.require(id);
    try {
      await s.runtime.approve();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[session] approve failed:", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
    }
    return this.toView(id);
  }

  async confirmIntake(id: string): Promise<SessionView> {
    const s = this.require(id);
    try {
      await s.runtime.confirmIntake();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[session] confirmIntake failed:", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
      if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    }
    return this.toView(id);
  }

  async accept(id: string): Promise<SessionView> {
    const s = this.require(id);
    const pendingId = s.runtime.getSession().pendingArtifactId;
    const waiting = s.runtime.getSession().waitingReason;
    const hadSidecarQuestions =
      waiting?.kind === "review_artifact" && Boolean(waiting.questions?.length);
    const artifact = pendingId
      ? s.runtime.getSession().artifacts.find((a) => a.id === pendingId)
      : undefined;
    const stageBefore = inferLifecycleStage(s.runtime.getSession());
    await s.runtime.acceptArtifact();
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
      if (waiting?.kind === "approve_step") {
        await s.runtime.rejectStep(reason ?? "用户暂不执行");
      } else if (waiting?.kind === "review_artifact") {
        await s.runtime.rejectArtifact(reason ?? "用户要求重新来");
      } else {
        throw new Error("当前没有可拒绝的确认或验收");
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[session] reject failed:", detail);
      s.messages.push(this.msg("system", formatRuntimeError(detail)));
      if (s.bookId) this.syncBookPreview(s.bookId, s.messages);
    }
    return this.toView(id);
  }

  async runOutline(id: string): Promise<SessionView> {
    const s = this.require(id);
    await s.runtime.submitDecision(
      createDecision({
        action: "run_worker",
        reason: "根据创作简报生成大纲",
        workerId: "outline",
        requiresApproval: true,
      }),
    );
    return this.toView(id);
  }

  async finish(id: string): Promise<SessionView> {
    const s = this.require(id);
    await s.runtime.submitDecision(
      createDecision({
        action: "finish",
        reason: "创作流程结束",
        requiresApproval: false,
      }),
    );
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
      console.error("[session] maybeKickAgentAfterDemand failed:", err);
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
      const thinking = managed.trackingRef.current.pendingReasoning;
      managed.trackingRef.current.pendingUsage = undefined;
      managed.trackingRef.current.pendingReasoning = undefined;

      const classified =
        text.trim().length > 0 ? classifyAgentMessage(text) : null;
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
      console.warn("[session] syncCreationDialogue:", err);
    }
  }

  private persist(s: ManagedSession): void {
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
    | "onWorkerStreamDone"
  > {
    return {
      onAgentThinkingDelta: (delta) => {
        const prev = this.agentThinkingLive.get(sessionId) ?? "";
        this.agentThinkingLive.set(sessionId, prev + delta);
      },
      onAgentThinkingDone: () => {
        this.agentThinkingLive.delete(sessionId);
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
      onWorkerStreamDone: () => {
        this.workerLive.delete(sessionId);
      },
    };
  }

  private buildLiveStreamView(sessionId: string): LiveStreamView | undefined {
    const worker = this.workerLive.get(sessionId);
    if (worker && (worker.thinking || worker.output)) {
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
      if (reason.questions?.length) {
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
      if (qs.length) {
        hints.push(
          `${displayWorkerLabel(reason.workerId)} · 提问（请在询问卡作答）：${qs.map((q) => q.prompt).join(" ")}`,
        );
      } else {
        hints.push(
          `${displayWorkerLabel(reason.workerId)} 需要更多信息，请补充说明`,
        );
      }
      actions.push({ type: "answer_questions", label: "提交作答" });
      actions.push({ type: "skip_questions", label: "跳过追问" });
      actions.push({
        type: "send_message",
        label: "自由补充",
        placeholder: "也可在此自由补充…",
      });
    } else if (reason?.kind === "approve_step") {
      actions.push({ type: "approve", label: "确认执行" });
      actions.push({ type: "reject", label: "暂不执行" });
    } else if (reason?.kind === "review_artifact") {
      actions.push({ type: "accept", label: "接受目前产物" });
      actions.push({ type: "reject", label: "不接受，重新来" });
      actions.push({
        type: "send_message",
        label: "发送修改意见",
        placeholder: "输入修改意见后发送…",
      });
      if (reason.questions?.length) {
        hints.push("下方追问可选；接受产物即收起（表示无需再完善）");
        actions.push({ type: "answer_questions", label: "提交作答" });
        actions.push({ type: "skip_questions", label: "跳过追问" });
      }
    } else if (reason?.kind === "revision") {
      hints.push(
        reason.instruction?.trim() ||
          "需要按反馈修改后继续；请在下方说明或直接发送继续",
      );
      actions.push({
        type: "send_message",
        label: "发送",
        placeholder: "说明修改意见，或直接发送让总管继续…",
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
      playReady: canEnterPlay(session),
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
      reviewArtifact: buildReviewArtifactView(session, messages, s.runtime.getBlackboard()),
      workerSetView: buildWorkerSetUserView(
        s.runtime.getBlackboard(),
        s.runtime.getSession(),
      ),
      creationFlowView: buildCreationFlowUserView(s.runtime.getBlackboard()),
      recipes: s.recipeOptions?.map((r) => ({
        id: r.id,
        name: r.name,
        declaration: r.declaration,
      })),
      selectedRecipe: resolveSelectedRecipeView(
        s.runtime.getBlackboard(),
        s.recipeOptions,
      ),
      boardPanel: buildBoardPanelFromRuntime(s.runtime.getBlackboard()),
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
      return;
    }
    try {
      const skill = await loadSkill(skillName);
      if (!skill.skillPackRoot) {
        s.recipeOptions = [];
        return;
      }
      const catalog = await loadRecipeCatalog(skill.skillPackRoot);
      s.recipeOptions = catalog?.recipes ?? [];
    } catch {
      s.recipeOptions = [];
    }
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
    s.runtime.getBlackboard().write({
      tag: CREATION_SELECTED_RECIPE_TAG,
      content: JSON.stringify({
        id: entry.id,
        name: entry.name,
      }),
      source: "user",
    });
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
): CreationFlowUserView | undefined {
  const raw = blackboard.getContentByTag(CREATION_FLOW_TAG)?.trim();
  if (!raw) return undefined;
  const flow = parseCreationFlow(raw);
  if (!flow) {
    return { steps: [], parseError: "创作流程无法解析为 JSON（需要 steps 数组）" };
  }
  return formatCreationFlowForUser(flow);
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
    const content = blackboard.getContentByTag(tag);
    if (content?.trim()) {
      tagBodies.push(`## ${tag}\n\n${content.trim()}`);
    }
  }

  const outputMsg = [...messages]
    .reverse()
    .find((m) => m.kind === "worker_output" && m.actor === art.workerId);

  const body =
    tagBodies.join("\n\n") ||
    (outputMsg?.body ?? outputMsg?.text ?? "").trim() ||
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
    ? buildCreationFlowUserView(blackboard)
    : undefined;

  return {
    id: art.id,
    workerId: art.workerId,
    summary,
    body,
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
      "或点击「测试连接」验证。"
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
