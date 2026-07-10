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
import type { ActiveSkillSnapshot } from "../types/runtime.js";

export type ChatMessage = {
  id: string;
  role: "system" | "user";
  text: string;
  createdAt: string;
  kind?: AgentMessageKind;
  actor?: string;
  title?: string;
  body?: string;
  /** LLM 思维链 / reasoning_content */
  thinking?: string;
  tokenUsage?: MessageTokenUsage;
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
  | { type: "confirm_intake"; label: string }
  | { type: "approve"; label: string }
  | { type: "accept"; label: string }
  | { type: "reject"; label: string }
  | { type: "run_outline"; label: string }
  | { type: "finish"; label: string };

type ManagedSession = {
  runtime: PhaseRuntime;
  messages: ChatMessage[];
  bookId?: string;
  trackingRef: LlmTrackingRef;
};

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  /** bookId → 当前内存中的 sessionId */
  private readonly activeBookSessions = new Map<string, string>();

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
    };
    const onMessage = this.buildOnMessageHandler(() => managed);

    const llm = createDefaultMainAgentLlm(trackingRef);
    const runtime = new PhaseRuntime({
      autoStubWorker: !hasRealLlmConfig(),
      llm,
      onMessage,
      initialSession,
    });
    managed.runtime = runtime;

    if (preselectSkillId) {
      await runtime.startWithOrchestrator(preselectSkillId);
    } else {
      await runtime.start();
    }

    this.sessions.set(id, managed);
    if (bookId) {
      this.activeBookSessions.set(bookId, id);
      appendBookSession(bookId, id);
    }
    return this.toView(id);
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
      if (!runtimeSession.slots.startupCompleted) {
        throw new Error("实例尚未完成（需先完成启动与 setup 验收），无法保存实例快照");
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
    s.messages.push(this.msg("user", text));
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
    }
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
    await s.runtime.acceptArtifact();
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

    const runtime = new PhaseRuntime({
      autoStubWorker: !hasRealLlmConfig(),
      llm: createDefaultMainAgentLlm(trackingRef),
      onMessage,
      initialSession: params.runtimeSession,
      initialBlackboardItems: params.blackboardItems,
    });
    await runtime.ensureAvailableSkills();

    managedRef = {
      runtime,
      messages: params.messages,
      bookId: params.bookId,
      trackingRef,
    };
    this.sessions.set(params.sessionId, managedRef);
    this.activeBookSessions.set(params.bookId, params.sessionId);
    appendBookSession(params.bookId, params.sessionId);
    this.persist(managedRef);

    return this.toView(params.sessionId, true, params.resumeHint);
  }

  private buildOnMessageHandler(getManaged: () => ManagedSession | null) {
    return (text: string) => {
      const managed = getManaged();
      if (!managed) return;
      const usage = managed.trackingRef.current.pendingUsage;
      const thinking = managed.trackingRef.current.pendingReasoning;
      managed.trackingRef.current.pendingUsage = undefined;
      managed.trackingRef.current.pendingReasoning = undefined;
      managed.messages.push(this.msg("system", text, usage, thinking));
      if (managed.bookId) {
        this.syncBookPreview(managed.bookId, managed.messages);
        this.persist(managed);
      }
    };
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
  ): ChatMessage {
    const base = {
      id: randomUUID(),
      role,
      text,
      createdAt: new Date().toISOString(),
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(thinking ? { thinking } : {}),
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
          placeholder: "按上方说明补充信息，可一次说多项…",
        });
      }
    } else if (reason?.kind === "skill_selection") {
      hints.push("请选择创作类型（输入 skill 名称或编号）");
      actions.push({
        type: "send_message",
        label: "发送",
        placeholder: "例如：basic 或 1",
      });
    } else if (reason?.kind === "intake") {
      hints.push(reason.prompt?.trim() ?? "请按填空项补充创作信息");
      actions.push({
        type: "send_message",
        label: "发送",
        placeholder: "描述你想写什么…",
      });
    } else if (reason?.kind === "input") {
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
    } else if (reason?.kind === "worker_questions") {
      const qs = reason.questions.filter((q) => q?.trim());
      if (qs.length) {
        hints.push(`Worker · ${reason.workerId} 提问：${qs.join(" ")}`);
      } else {
        hints.push(`Worker · ${reason.workerId} 需要更多信息，请补充说明`);
      }
      const placeholder =
        qs[0]?.slice(0, 120) ?? "回答 Worker 的问题，或补充情境与参数…";
      actions.push({
        type: "send_message",
        label: "发送",
        placeholder,
      });
    } else if (reason?.kind === "approve_step") {
      actions.push({ type: "approve", label: "确认执行" });
      actions.push({ type: "reject", label: "暂不执行" });
    } else if (reason?.kind === "review_artifact") {
      actions.push({ type: "accept", label: "接受产物" });
      actions.push({ type: "reject", label: "不接受，重新来" });
    } else if (
      session.phase === "running" &&
      s.runtime.needsMainAgentDecision() &&
      !s.runtime.hasMainAgent()
    ) {
      hints.push("简报已就绪，可手动生成大纲（未配置 Agent LLM）");
      actions.push({ type: "run_outline", label: "生成大纲" });
      actions.push({
        type: "send_message",
        label: "发送",
        placeholder: "补充说明…",
      });
    } else if (session.phase === "running" && s.runtime.needsMainAgentDecision()) {
      hints.push("Agent 正在调度…");
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
    const skillCatalog = buildSkillCatalog(
      session,
      skillPackId,
      lifecycleStage,
    );

    return {
      id,
      bookId: s.bookId,
      bookTitle: book?.title,
      activeSkill: s.runtime.getActiveSkill()?.name ?? skillPackId,
      phase: session.phase,
      waitingReason: reason,
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
}

export const sessionManager = new SessionManager();

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
