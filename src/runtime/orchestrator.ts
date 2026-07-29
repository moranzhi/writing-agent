/**
 * @deprecated 请使用 PhaseRuntime（已含 Skill 流程 + 总管 LLM 循环）。
 * 本文件保留供对照测试，新入口见 phase-demo / web / run.ts。
 */
import { randomUUID } from "node:crypto";
import { Blackboard } from "../blackboard/blackboard.js";
import type { LlmProvider } from "../llm/client.js";
import {
  DEFAULT_WORKERS,
  MainAgent,
} from "../main-agent/main-agent.js";
import {
  applyEvent,
  createArtifact,
  createSession,
} from "../runtime/phase-machine.js";
import type {
  AcceptanceMode,
  MainAgentDecision,
  PhaseEffect,
  RuntimeEvent,
  RuntimeSession,
} from "../types/runtime.js";

export type RuntimeOrchestratorOptions = {
  presetId?: string;
  flowId?: string;
  llm: LlmProvider;
  blackboard?: Blackboard;
  acceptanceMode?: AcceptanceMode;
  onMessage?: (message: string) => void;
};

export class RuntimeOrchestrator {
  private session: RuntimeSession;
  private readonly blackboard: Blackboard;
  private readonly mainAgent: MainAgent;
  private readonly acceptanceMode: AcceptanceMode;
  private readonly onMessage: (message: string) => void;

  constructor(options: RuntimeOrchestratorOptions) {
    this.session = createSession(options.presetId ?? "default", options.flowId);
    this.blackboard = options.blackboard ?? new Blackboard();
    this.mainAgent = new MainAgent(options.llm);
    this.acceptanceMode = options.acceptanceMode ?? "user_confirmed";
    this.onMessage = options.onMessage ?? (() => {});
  }

  getSession(): RuntimeSession {
    return this.session;
  }

  getBlackboard(): Blackboard {
    return this.blackboard;
  }

  async start(): Promise<RuntimeSession> {
    await this.dispatch({
      type: "session_started",
      payload: {
        presetId: this.session.presetId,
        flowId: this.session.flowId,
        availableSkills: [{ name: "world-simulator", description: "fallback", category: "dialogue" }],
      },
    });
    return this.session;
  }

  async submitUserInput(text: string): Promise<RuntimeSession> {
    await this.dispatch({
      type: "user_submitted_input",
      payload: { text },
    });
    return this.session;
  }

  async approveNextStep(): Promise<RuntimeSession> {
    const decisionId = this.session.pendingDecision?.id;
    if (!decisionId) {
      throw new Error("No pending decision to approve");
    }
    await this.dispatch({
      type: "user_approved_next_step",
      payload: { decisionId },
    });
    return this.session;
  }

  async rejectNextStep(reason?: string): Promise<RuntimeSession> {
    const decisionId = this.session.pendingDecision?.id;
    if (!decisionId) {
      throw new Error("No pending decision to reject");
    }
    await this.dispatch({
      type: "user_rejected_next_step",
      payload: { decisionId, reason },
    });
    return this.session;
  }

  async acceptArtifact(artifactId?: string): Promise<RuntimeSession> {
    const id = artifactId ?? this.session.pendingArtifactId;
    if (!id) {
      throw new Error("No pending artifact to accept");
    }
    await this.dispatch({
      type: "user_accepted_artifact",
      payload: { artifactId: id },
    });
    return this.session;
  }

  async rejectArtifact(reason?: string, artifactId?: string): Promise<RuntimeSession> {
    const id = artifactId ?? this.session.pendingArtifactId;
    if (!id) {
      throw new Error("No pending artifact to reject");
    }
    await this.dispatch({
      type: "user_rejected_artifact",
      payload: { artifactId: id, reason },
    });
    return this.session;
  }

  async completeFlow(): Promise<RuntimeSession> {
    await this.dispatch({ type: "flow_completed", payload: {} });
    return this.session;
  }

  private async dispatch(event: RuntimeEvent): Promise<void> {
    let result = applyEvent(this.session, event);
    this.session = result.session;

    if (result.error && event.type !== "runtime_failed") {
      this.onMessage(result.error);
    }

    await this.processEffects(result.effects);

    if (result.effects.some((e) => e.type === "invoke_main_agent")) {
      await this.runMainAgent();
    }
  }

  private async processEffects(effects: PhaseEffect[]): Promise<void> {
    for (const effect of effects) {
      switch (effect.type) {
        case "emit_message":
          this.onMessage(effect.message);
          break;
        case "run_worker":
          await this.runStubWorker(effect);
          break;
        case "resume_worker":
          await this.resumeStubWorker();
          break;
        case "run_programmatic_review":
          await this.runProgrammaticReview(effect.artifactId);
          break;
        case "invoke_main_agent":
          break;
      }
    }
  }

  private async runMainAgent(): Promise<void> {
    if (this.session.phase !== "running") {
      return;
    }

    const decision = await this.mainAgent.decide({
      session: this.session,
      blackboardIndex: this.blackboard.listTagIndex(),
      availableWorkers: [...DEFAULT_WORKERS],
    });

    this.onMessage(`[总管] ${decision.action}: ${decision.reason}`);

    const result = applyEvent(this.session, {
      type: "main_agent_decision_created",
      payload: { decision },
    });
    this.session = result.session;
    await this.processEffects(result.effects);

    if (result.effects.some((e) => e.type === "invoke_main_agent")) {
      await this.runMainAgent();
    }
  }

  private async runStubWorker(
    effect: Extract<PhaseEffect, { type: "run_worker" }>,
  ): Promise<void> {
    await this.executeStubWorker(effect.workerId);
  }

  private async resumeStubWorker(): Promise<void> {
    const ctx = this.session.resumeContext;
    if (!ctx) {
      throw new Error("No resume context");
    }
    await this.executeStubWorker(ctx.workerId);
  }

  private async executeStubWorker(workerId: string): Promise<void> {
    const stepId = this.session.currentStepId;

    this.session = applyEvent(this.session, {
      type: "worker_started",
      payload: {
        workerId,
        stepId,
        acceptanceMode: this.session.resumeContext?.acceptanceMode ?? this.acceptanceMode,
      },
    }).session;

    this.onMessage(`[Worker 占位] 正在执行 ${workerId} ...`);

    const lastInput = String(this.session.slots.lastUserInput ?? "");
    const summary = `${workerId} 针对用户输入生成的占位产物`;
    const value = `[${workerId} 占位输出]\n用户输入: ${lastInput}\n说明: 这是第一版 stub worker，后续会替换为真实 LLM worker。`;

    const outputTags = ["output.草稿"];

    for (const tag of outputTags) {
      this.blackboard.write({
        tag,
        content: value,
        source: workerId,
      });
    }

    const artifact = createArtifact({
      workerId,
      stepId,
      outputTags,
      summary,
    });
    this.session = {
      ...this.session,
      artifacts: [...this.session.artifacts, artifact],
    };

    const completed = applyEvent(this.session, {
      type: "worker_completed",
      payload: { artifactId: artifact.id },
    });
    this.session = completed.session;
    await this.processEffects(completed.effects);

    if (completed.effects.some((e) => e.type === "invoke_main_agent")) {
      await this.runMainAgent();
    }
  }

  private async runProgrammaticReview(artifactId: string): Promise<void> {
    this.session = applyEvent(this.session, {
      type: "programmatic_review_started",
      payload: { artifactId },
    }).session;

    const artifact = this.session.artifacts.find((a) => a.id === artifactId);
    const passed = Boolean(artifact?.summary && artifact.summary.length > 0);

    const reviewEvent: RuntimeEvent = passed
      ? { type: "programmatic_review_passed", payload: { artifactId } }
      : {
          type: "programmatic_review_failed",
          payload: { artifactId, reason: "产物 summary 为空" },
        };

    const result = applyEvent(this.session, reviewEvent);
    this.session = result.session;
    await this.processEffects(result.effects);

    if (result.effects.some((e) => e.type === "invoke_main_agent")) {
      await this.runMainAgent();
    }
  }
}

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
