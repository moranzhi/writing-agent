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
import { listSkills, listWorkerSkills, loadSkill, loadWorkerSkill, resolveSkillId } from "../skills/loader.js";
import { toActiveSkillSnapshot } from "../skills/snapshot.js";
import { runWorkerSkill } from "../worker/executor.js";
import { resolveWorkerId } from "../worker/resolve-id.js";
import { resolveWorkerLlmProvider } from "../skills/worker-llm.js";
import { extractIntakeFromMessage } from "../intake/extract.js";
import { readIntakeValues } from "../intake/intake.js";
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
  private readonly blackboard: Blackboard;
  private llm?: LlmProvider;
  private mainAgent?: MainAgent;
  /** autoStubWorker=false 时，run_worker effect 暂存于此，等 startPendingWorker() */
  private pendingWorkerEffect: Extract<PhaseEffect, { type: "run_worker" }> | null =
    null;
  /** start() 时从 registry 加载，供 skill_selection 展示与编号解析 */
  private availableSkills: SkillIndexEntry[] = [];

  constructor(options: PhaseRuntimeOptions = {}) {
    this.session =
      options.initialSession ??
      createSession(options.presetId ?? "default", options.flowId);
    this.acceptanceMode = options.acceptanceMode ?? "user_confirmed";
    this.autoStubWorker = options.autoStubWorker ?? false;
    this.onMessage = options.onMessage ?? (() => {});
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

  /** 加载 skills/registry → 触发 session_started → waiting_user(skill_selection) */
  async start(): Promise<RuntimeSession> {
    this.availableSkills = await listSkills();
    if (this.availableSkills.length === 0) {
      throw new Error("skills/ 下没有找到任何 skill 文件（novel/*.md 或 dialogue/*.md）");
    }
    await this.dispatch({
      type: "session_started",
      payload: {
        presetId: this.session.presetId,
        flowId: this.session.flowId,
        availableSkills: this.availableSkills,
      },
    });
    return this.session;
  }

  /** 启动并预选总管，跳过 skill_selection */
  async startWithOrchestrator(orchestratorId: string): Promise<RuntimeSession> {
    await this.start();
    if (this.session.waitingReason?.kind === "skill_selection") {
      await this.selectSkill(orchestratorId);
    }
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
    if (activeSkill?.startupTargetKey) {
      const tag = activeSkill.startupTargetKey;
      const content = session.slots[tag];
      if (typeof content === "string" && content.trim()) {
        this.blackboard.write({
          tag,
          content: content.trim(),
          source: "user",
        });
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
   * skill_selection 阶段会先解析为 selectSkill，否则走 user_submitted_input。
   */
  async submitInput(text: string): Promise<RuntimeSession> {
    if (this.session.waitingReason?.kind === "skill_selection") {
      const picked = await this.resolveSkillFromUserInput(text);
      if (!picked) {
        throw new Error(`无法识别 skill: ${text}。请输入 name 或列表编号。`);
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

  /** 用户接受 pendingArtifact */
  async acceptArtifact(artifactId?: string): Promise<RuntimeSession> {
    const id = artifactId ?? this.session.pendingArtifactId;
    if (!id) throw new Error("当前没有待验收的产物");
    await this.dispatch({ type: "user_accepted_artifact", payload: { artifactId: id } });
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

  /** worker 调用 ask_user 能力时，由外层触发此事件 */
  async workerAsk(questions: string[]): Promise<RuntimeSession> {
    const workerId = this.session.currentWorkerId;
    if (!workerId) throw new Error("当前没有运行中的 worker");
    await this.dispatch({
      type: "worker_needs_input",
      payload: { workerId, stepId: this.session.currentStepId, questions },
    });
    return this.session;
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

  private async runRealWorker(
    effect: Extract<PhaseEffect, { type: "run_worker" }>,
  ): Promise<void> {
    const activeSkill = this.getActiveSkill();
    if (!activeSkill?.name) {
      throw new Error("当前没有 active skill，无法运行 worker");
    }
    if (!this.llm) {
      throw new Error("未配置 LLM，无法运行 worker");
    }

    const workerId = resolveWorkerId(effect.workerId);
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

    this.session = (
      await this.dispatch({
        type: "worker_started",
        payload: {
          workerId: effect.workerId,
          stepId: this.session.currentStepId,
          acceptanceMode: this.session.resumeContext?.acceptanceMode ?? this.acceptanceMode,
        },
      })
    ).session;

    const skill = await loadSkill(activeSkill.name);
    const worker = await loadWorkerSkill(activeSkill.name, effect.workerId);
    const workerLlm = resolveWorkerLlmProvider({
      worker,
      bindings: skill.workerLlmBindings,
      slots,
      fallbackLlm: this.llm,
    });

    this.onMessage(`[Worker] ${workerId} 执行中…`);

    const result = await runWorkerSkill({
      skillName: activeSkill.name,
      workerId: effect.workerId,
      slots,
      blackboard: this.blackboard,
      llm: workerLlm,
    });

    if (result.askUser?.length) {
      await this.workerAsk(result.askUser);
      return;
    }

    slots = { ...this.session.slots };
    for (const [tag, content] of Object.entries(result.outputs)) {
      this.blackboard.write({
        tag,
        content,
        source: workerId,
      });
      slots[tag] = content;
    }
    this.session = { ...this.session, slots };

    const artifact = createArtifact({
      workerId: effect.workerId,
      stepId: this.session.currentStepId,
      outputTags: Object.keys(result.outputs),
      summary: result.summary,
    });
    this.session = { ...this.session, artifacts: [...this.session.artifacts, artifact] };

    this.onMessage(
      `[Worker] ${workerId} 已完成\n\n${result.preview}${result.preview.length >= 4000 ? "\n\n…" : ""}`,
    );

    await this.dispatch({
      type: "worker_completed",
      payload: { artifactId: artifact.id },
    });
  }

  /**
   * 占位 worker：worker_started → 可选自动 worker_completed。
   * 演示与单测用，真实环境应替换为真实 worker 调度。
   */
  private async runStubWorker(
    effect: Extract<PhaseEffect, { type: "run_worker" }>,
    autoComplete = true,
  ): Promise<void> {
    this.session = (
      await this.dispatch({
        type: "worker_started",
        payload: {
          workerId: effect.workerId,
          stepId: this.session.currentStepId,
          acceptanceMode: this.session.resumeContext?.acceptanceMode ?? this.acceptanceMode,
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
  }

  private async resolveWorkerOutputTags(workerId: string): Promise<string[]> {
    const active = this.getActiveSkill();
    if (!active?.name) return [];
    try {
      const worker = await loadWorkerSkill(active.name, workerId);
      return worker.outputTags;
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
      if (workers.length === 0) return [...DEFAULT_WORKERS];
      return workers.map((w) => ({ id: w.id, description: w.description }));
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
  await runtime.start();
  await runtime.selectSkill("basic");
  await runtime.submitInput("科幻长篇，第三人称，约 20 万字");
  await runtime.confirmIntake();

  const decision = createDecision({
    action: "run_worker",
    reason: "生成大纲",
    workerId: "outline-worker",
    requiresApproval: true,
  });
  await runtime.submitDecision(decision);
  await runtime.approve();

  if (runtime.getSession().currentWorkerId) {
    await runtime.workerComplete();
  }

  await runtime.acceptArtifact();
  await runtime.submitDecision(
    createDecision({ action: "finish", reason: "完成", requiresApproval: false }),
  );

  return runtime.getSession();
}
