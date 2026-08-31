/**
 * 纯函数运行阶段机。
 *
 * - 无副作用：不读写文件、不调用 LLM、不启动 worker
 * - 输入 (session, event)，输出 { session, effects }
 * - phase 只能由 applyEvent 改变；非法事件返回 error 并进入 phase=error
 *
 * 上层调用方：PhaseRuntime.dispatch() → applyEvent → processEffects()
 */
import { randomUUID } from "node:crypto";
import type {
  ApplyEventResult,
  ArtifactRecord,
  PhaseEffect,
  ResumeContext,
  RuntimeEvent,
  RuntimePhase,
  RuntimeSession,
  WaitingReason,
} from "../types/runtime.js";
import type { ActiveSkillSnapshot } from "../types/runtime.js";
import { effectiveStartupMode } from "../config/default-orchestrator.js";
import {
  buildIntakeProgress,
  buildIntakeFollowUpMessage,
  readIntakeValues,
  synthesizeDemandText,
} from "../intake/intake.js";
import {
  isModuleOpeningQuestions,
  normalizeQuestions,
} from "../skills/question-protocol.js";
import {
  SLOT_CREATION_SEALED_BY_OPENING,
  isOpeningSealArtifact,
} from "../skills/opening-seal.js";
import {
  CREATION_PROPOSED_STEP_TAG,
  DESIGN_FLOW_WORKER_ID,
  DESIGN_STEP_WORKER_ID,
} from "../skills/creation-flow.js";
import { inferLifecycleStage } from "../skills/worker-declaration.js";
import type { QuestionItem } from "../types/questions.js";

function nowIso(): string {
  return new Date().toISOString();
}

/** 挂在产物下的追问一律可选（required=false），用户可直接 Accept */
function asOptionalSidecarQuestions(
  raw: QuestionItem[] | string[] | undefined,
): QuestionItem[] | undefined {
  const normalized = normalizeQuestions(raw ?? []);
  if (!normalized.length) return undefined;
  return normalized.map((q) => ({ ...q, required: false }));
}

/** 更新 updatedAt 时间戳 */
function touch(session: RuntimeSession): RuntimeSession {
  return { ...session, updatedAt: nowIso() };
}

/** 用户每条输入写入 用户.最新输入；首句同时写入需求 tag */
function applyUserTextToSlots(
  slots: Record<string, unknown>,
  text: string,
  demandKey: string,
  opts: { initial?: boolean },
): void {
  if (!text) return;
  slots["用户.最新输入"] = text;
  if (opts.initial) {
    slots[demandKey] = text;
    slots.startupCompleted = true;
    return;
  }
  if (!slots.startupCompleted) {
    slots[demandKey] = text;
    slots.startupCompleted = true;
    return;
  }
  mergeSlotText(slots, demandKey, text);
}

/** 将用户补充文本追加到 slot（用于合并多轮 ask_user / worker 答复到需求 tag） */
function mergeSlotText(
  slots: Record<string, unknown>,
  key: string,
  text: string,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const prev = String(slots[key] ?? "").trim();
  if (!prev) {
    slots[key] = trimmed;
    return;
  }
  if (
    prev === trimmed ||
    prev.includes(`\n\n${trimmed}`) ||
    prev.startsWith(`${trimmed}\n\n`)
  ) {
    return;
  }
  slots[key] = `${prev}\n\n${trimmed}`;
}

/** 同一步内多次「按意见修改」叠意见；较新的写在后面 */
function accumulateRevisionInstruction(prev: unknown, next: string): string {
  const trimmed = next.trim();
  const old = typeof prev === "string" ? prev.trim() : "";
  if (!old || old === trimmed) return trimmed;
  if (old.includes(trimmed)) return old;
  return `${old}\n\n——\n\n${trimmed}`;
}

/** 验收后把本步意见并入「用户.需求」按时间保留，再清掉本步槽位以免下一步误进修订 */
function archiveStepNotesIntoDemand(slots: Record<string, unknown>): void {
  const reply =
    typeof slots["用户.worker答复"] === "string"
      ? slots["用户.worker答复"].trim()
      : "";
  const note =
    typeof slots["用户.修订说明"] === "string"
      ? slots["用户.修订说明"].trim()
      : "";
  if (reply) mergeSlotText(slots, "用户.需求", reply);
  if (note) mergeSlotText(slots, "用户.需求", note);
  delete slots["用户.修订说明"];
  delete slots.revisionInstruction;
  delete slots.revisionTargetArtifactId;
  delete slots["用户.worker答复"];
}

/** 追加事件到 history 并 touch */
function appendHistory(
  session: RuntimeSession,
  event: RuntimeEvent,
): RuntimeSession {
  return touch({ ...session, history: [...session.history, event] });
}

/** 进入 waiting_user，并设置 waitingReason */
function waiting(session: RuntimeSession, reason: WaitingReason): RuntimeSession {
  return touch({ ...session, phase: "waiting_user", waitingReason: reason });
}

/** 进入 running，清除 waitingReason */
function running(session: RuntimeSession): RuntimeSession {
  return touch({ ...session, phase: "running", waitingReason: undefined });
}

/** 回到流程编排：保留已验收步骤，让 design-flow 追加/改排节点 */
function applyFlowReplan(
  session: RuntimeSession,
  event: RuntimeEvent,
  reason?: string,
): ApplyEventResult {
  const slots = { ...session.slots };
  const note = reason?.trim() ?? "";
  if (note) {
    slots["用户.下一步意向"] = note;
    slots["用户.修订说明"] = note;
  }
  delete slots[CREATION_PROPOSED_STEP_TAG];
  delete slots[SLOT_CREATION_SEALED_BY_OPENING];

  let artifacts = session.artifacts;
  if (session.pendingArtifactId) {
    artifacts = session.artifacts.map((a) =>
      a.id === session.pendingArtifactId
        ? { ...a, status: "rejected" as const, updatedAt: nowIso() }
        : a,
    );
  }

  return {
    session: touch(
      running(
        appendHistory(
          {
            ...session,
            slots,
            artifacts,
            pendingDecision: undefined,
            pendingArtifactId: undefined,
            currentWorkerId: undefined,
            resumeContext: undefined,
          },
          event,
        ),
      ),
    ),
    effects: [
      { type: "unseal_creation_opening" },
      { type: "run_worker", workerId: DESIGN_FLOW_WORKER_ID },
    ],
  };
}

/** 游玩连跑下一执行单元；创作则交总管 */
function afterPlayOrMainAgent(
  session: RuntimeSession,
  next: RuntimeSession,
): ApplyEventResult {
  const cleared = {
    ...next,
    pendingArtifactId: undefined,
    currentWorkerId: undefined,
    pendingDecision: undefined,
    resumeContext: undefined,
  };
  if (inferLifecycleStage(session) === "play") {
    return {
      session: touch(running(cleared)),
      effects: [{ type: "continue_play_turn" }],
    };
  }
  return {
    session: touch(running(cleared)),
    effects: [{ type: "invoke_main_agent" }],
  };
}

function findArtifact(
  session: RuntimeSession,
  artifactId: string,
): ArtifactRecord | undefined {
  return session.artifacts.find((a) => a.id === artifactId);
}

function updateArtifact(
  session: RuntimeSession,
  artifactId: string,
  patch: Partial<ArtifactRecord>,
): RuntimeSession {
  return {
    ...session,
    artifacts: session.artifacts.map((a) =>
      a.id === artifactId ? { ...a, ...patch, updatedAt: nowIso() } : a,
    ),
  };
}

/** 最近一次被拒 / 待修订的产物（用于 revision 等待态补交意见后重跑） */
function findRevisionTargetArtifact(
  session: RuntimeSession,
): ArtifactRecord | undefined {
  if (session.pendingArtifactId) {
    const pending = findArtifact(session, session.pendingArtifactId);
    if (pending) return pending;
  }
  for (let i = session.artifacts.length - 1; i >= 0; i -= 1) {
    const a = session.artifacts[i];
    if (a.status === "revision_requested" || a.status === "rejected") {
      return a;
    }
  }
  return undefined;
}

/**
 * 已有修改意见 → 写入「用户.修订说明」并立刻重跑同一 worker。
 * 语义：在已有产物上按意见改（上下文会注入待改底稿），不是推倒重做。
 * 对应验收底栏：看产物 → 输入意见 →「按意见修改」。
 */
function beginRevisionRerun(
  session: RuntimeSession,
  event: RuntimeEvent,
  artifact: ArtifactRecord,
  instruction: string,
): ApplyEventResult {
  const trimmed = accumulateRevisionInstruction(
    session.slots["用户.修订说明"] ?? session.slots.revisionInstruction,
    instruction,
  );
  const slots: Record<string, unknown> = {
    ...session.slots,
    "用户.修订说明": trimmed,
    "用户.最新输入": instruction.trim(),
    revisionInstruction: trimmed,
    // 本次重跑的底稿；重跑写不出新版时只许退回这一份
    revisionTargetArtifactId: artifact.id,
  };
  const next = appendHistory(
    updateArtifact(session, artifact.id, { status: "revision_requested" }),
    event,
  );
  return {
    session: touch(
      running({
        ...next,
        slots,
        pendingArtifactId: undefined,
        pendingDecision: undefined,
        currentWorkerId: artifact.workerId,
        currentStepId: artifact.stepId ?? session.currentStepId,
      }),
    ),
    effects: [
      {
        type: "run_worker",
        workerId: artifact.workerId,
      },
    ],
  };
}

/** 创建 idle 状态的新会话 */
export function createSession(
  presetId: string,
  flowId?: string,
): RuntimeSession {
  const ts = nowIso();
  return {
    id: randomUUID(),
    phase: "idle",
    presetId,
    flowId,
    slots: {},
    artifacts: [],
    history: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * 按当前 phase 返回允许的事件类型列表（第一层校验）。
 * waitingReason 的细粒度匹配见 canApplyEvent。
 */
export function getAllowedEvents(
  session: RuntimeSession,
): RuntimeEvent["type"][] {
  switch (session.phase) {
    case "idle":
      return ["session_started", "runtime_failed"];
    case "running":
      return [
        "main_agent_decision_created",
        "creation_step_pick_awaited",
        "worker_started",
        "worker_completed",
        "worker_needs_input",
        "worker_revision_produced_nothing",
        "programmatic_review_started",
        "programmatic_review_passed",
        "programmatic_review_failed",
        "flow_completed",
        "runtime_failed",
      ];
    case "waiting_user":
      return [
        "skill_selected",
        "user_submitted_input",
        "user_confirmed_intake",
        "user_approved_next_step",
        "user_rejected_next_step",
        "user_requested_flow_replan",
        "user_picked_creation_step",
        "user_left_creation_step",
        "user_accepted_artifact",
        "user_rejected_artifact",
        "user_requested_revision",
        "user_resolved_sidecar_questions",
        "main_agent_decision_created",
        "runtime_failed",
      ];
    case "done":
    case "error":
      return [];
    default:
      return [];
  }
}

/**
 * 判断事件是否可在当前会话状态下应用。
 * 除 phase 白名单外，waiting_user 还需 waitingReason 与事件类型匹配。
 */
export function canApplyEvent(
  session: RuntimeSession,
  event: RuntimeEvent,
): boolean {
  if (!getAllowedEvents(session).includes(event.type)) {
    return false;
  }

  const reason = session.waitingReason;

  switch (event.type) {
    case "skill_selected":
      return reason?.kind === "skill_selection";
    case "user_submitted_input":
      return (
        reason?.kind === "intake" ||
        reason?.kind === "input" ||
        reason?.kind === "worker_questions" ||
        reason?.kind === "revision" ||
        reason?.kind === "next_intent" ||
        reason?.kind === "pick_creation_step"
      );
    case "user_confirmed_intake":
      return reason?.kind === "intake";
    case "user_approved_next_step":
    case "user_rejected_next_step":
      return reason?.kind === "approve_step";
    case "user_requested_flow_replan":
      return (
        reason?.kind === "approve_step" ||
        reason?.kind === "review_artifact" ||
        reason?.kind === "input" ||
        reason?.kind === "worker_questions" ||
        reason?.kind === "revision" ||
        reason?.kind === "pick_creation_step"
      );
    case "user_picked_creation_step":
      return reason?.kind === "pick_creation_step";
    case "user_left_creation_step":
      return (
        reason?.kind === "approve_step" ||
        reason?.kind === "worker_questions" ||
        reason?.kind === "input" ||
        reason?.kind === "revision"
      );
    case "creation_step_pick_awaited":
      return session.phase === "running";
    case "user_accepted_artifact":
    case "user_rejected_artifact":
      return reason?.kind === "review_artifact";
    case "user_resolved_sidecar_questions":
      return (
        reason?.kind === "review_artifact" &&
        Boolean(reason.questions?.length)
      );
    case "user_requested_revision":
      return (
        reason?.kind === "review_artifact" || reason?.kind === "approve_step"
      );
    case "main_agent_decision_created":
      // running 时可决策；waiting_user(input/pick) 时允许总管在启动阶段插话或点选后补参确认
      return (
        session.phase === "running" ||
        reason?.kind === "input" ||
        reason?.kind === "pick_creation_step"
      );
    default:
      return true;
  }
}

/** 校验失败或 runtime_failed：进入 error phase 并 emit_message */
function fail(session: RuntimeSession, reason: string): ApplyEventResult {
  return {
    session: touch({ ...session, phase: "error", waitingReason: undefined }),
    effects: [{ type: "emit_message", message: reason }],
    error: reason,
  };
}

/**
 * worker_completed 的核心分支：按 acceptanceMode 决定下一步。
 * user_confirmed 时 caller 需再包一层 waiting(review_artifact)。
 */
function handleWorkerCompleted(
  session: RuntimeSession,
  event: RuntimeEvent & { type: "worker_completed" },
): ApplyEventResult {
  const artifact = findArtifact(session, event.payload.artifactId);
  if (!artifact) {
    return fail(session, `Artifact not found: ${event.payload.artifactId}`);
  }

  const mode =
    inferLifecycleStage(session) === "play"
      ? "no_confirmation"
      : (session.acceptanceMode ?? "user_confirmed");
  let next = appendHistory(session, event);

  if (next.slots.revisionTargetArtifactId) {
    // 已写出新版，旧底稿不再是退回目标
    next = {
      ...next,
      slots: { ...next.slots, revisionTargetArtifactId: undefined },
    };
  }

  if (mode === "user_confirmed") {
    next = updateArtifact(next, artifact.id, { status: "under_review" });
    return {
      session: touch({
        ...next,
        pendingArtifactId: artifact.id,
        currentWorkerId: undefined,
        resumeContext: undefined,
      }),
      effects: [],
      // worker_completed case 外层会补 waiting(review_artifact)
    };
  }

  if (mode === "no_confirmation") {
    next = updateArtifact(next, artifact.id, { status: "accepted" });
    const cleared = {
      ...next,
      pendingArtifactId: undefined,
      currentWorkerId: undefined,
      pendingDecision: undefined,
      resumeContext: undefined,
    };
    if (artifact.workerId === DESIGN_FLOW_WORKER_ID) {
      return {
        session: touch(running(cleared)),
        effects: [{ type: "propose_next_creation_step" }],
      };
    }
    return afterPlayOrMainAgent(session, cleared);
  }

  // programmatic_review
  next = updateArtifact(next, artifact.id, { status: "under_review" });
  return {
    session: touch({
      ...running(next),
      pendingArtifactId: artifact.id,
      currentWorkerId: undefined,
    }),
    effects: [{ type: "run_programmatic_review", artifactId: artifact.id }],
  };
}

/**
 * 应用单个 RuntimeEvent，返回新会话与副作用列表。
 * 不合法的事件不会抛异常，而是返回 error 并将 phase 置为 error。
 */
export function applyEvent(
  session: RuntimeSession,
  event: RuntimeEvent,
): ApplyEventResult {
  if (!canApplyEvent(session, event)) {
    return fail(
      session,
      `Event ${event.type} is not allowed in phase ${session.phase}`,
    );
  }

  switch (event.type) {
    // ── 启动：默认 orchestrator 或 legacy 选包 ──
    case "session_started": {
      const next = appendHistory(
        {
          ...session,
          presetId: event.payload.presetId,
          flowId: event.payload.flowId,
        },
        event,
      );
      const skills = event.payload.availableSkills;
      const initialSkill = event.payload.initialSkill;
      if (initialSkill) {
        return applySkillBinding(next, initialSkill, event);
      }
      return {
        session: waiting(next, {
          kind: "skill_selection",
          availableSkills: skills,
        }),
        effects: [{ type: "emit_message", message: formatSkillSelectionPrompt(skills) }],
      };
    }

    case "skill_selected": {
      const { skill } = event.payload;
      return applySkillBinding(session, skill, event);
    }

    case "user_confirmed_intake": {
      if (session.waitingReason?.kind !== "intake") {
        return fail(session, "user_confirmed_intake requires intake waiting");
      }
      const activeSkill = session.slots.activeSkill as ActiveSkillSnapshot | undefined;
      if (!activeSkill?.startupTargetKey || !activeSkill.intakeFields?.length) {
        return fail(session, "No intake fields on active skill");
      }
      const values = readIntakeValues(session.slots);
      const progress = buildIntakeProgress(activeSkill.intakeFields, values);
      if (!progress.ready) {
        return fail(session, "必要项尚未填完，无法确认");
      }
      const demandText = synthesizeDemandText(activeSkill.intakeFields, values);
      const slots: Record<string, unknown> = {
        ...session.slots,
        intakeValues: values,
        startupCompleted: true,
        [activeSkill.startupTargetKey]: demandText,
        lastUserInput: demandText,
      };
      const next = appendHistory({ ...session, slots, resumeContext: undefined }, event);
      return {
        session: touch(running(next)),
        effects: [{ type: "invoke_main_agent" }],
      };
    }

    // ── 用户输入 ──
    case "user_submitted_input": {
      const hadResume = Boolean(session.resumeContext);
      const activeSkill = session.slots.activeSkill as
        | { startupTargetKey?: string }
        | undefined;
      const slots: Record<string, unknown> = {
        ...session.slots,
        lastUserInput: event.payload.text,
        userInputs: [
          ...((session.slots.userInputs as string[] | undefined) ?? []),
          event.payload.text,
        ],
      };
      const demandKey = activeSkill?.startupTargetKey;
      const text = event.payload.text.trim();

      if (session.waitingReason?.kind === "intake") {
        const skill = activeSkill as ActiveSkillSnapshot | undefined;

        if (skill && effectiveStartupMode(skill) === "agent-first" && text) {
          const key = skill.startupTargetKey || "用户.需求";
          applyUserTextToSlots(slots, text, key, { initial: true });
          slots.lastUserInput = text;
          const next = appendHistory(
            { ...session, slots, resumeContext: undefined },
            event,
          );
          return {
            session: touch(running(next)),
            effects: [{ type: "invoke_main_agent" }],
          };
        }

        const intakeValues =
          event.payload.intakeValues ??
          readIntakeValues(session.slots);
        slots.intakeValues = intakeValues;
        slots.intakeSubmitCount =
          ((session.slots.intakeSubmitCount as number) ?? 0) + 1;
        if (skill?.intakeFields?.length) {
          const preview = synthesizeDemandText(skill.intakeFields, intakeValues);
          if (preview.trim()) {
            slots[demandKey ?? "intake.preview"] = preview;
          } else if (text) {
            mergeSlotText(slots, demandKey ?? "intake.preview", text);
          }
        } else if (text && demandKey) {
          mergeSlotText(slots, demandKey, text);
        }

        const progress = skill?.intakeFields?.length
          ? buildIntakeProgress(skill.intakeFields, intakeValues)
          : null;
        const followUpSent = Boolean(session.slots.intakeFollowUpSent);
        const effects: PhaseEffect[] = [];
        if (
          progress &&
          !progress.ready &&
          !followUpSent &&
          (slots.intakeSubmitCount as number) >= 1
        ) {
          const msg = buildIntakeFollowUpMessage(progress);
          if (msg) {
            slots.intakeFollowUpSent = true;
            effects.push({ type: "emit_message", message: msg });
          }
        }

        const next = appendHistory(
          {
            ...session,
            slots,
            resumeContext: hadResume ? session.resumeContext : undefined,
          },
          event,
        );
        const prompt =
          session.waitingReason.prompt ?? skill?.startupPrompt ?? "";
        return {
          session: waiting(touch(next), { kind: "intake", prompt }),
          effects,
        };
      }

      if (session.waitingReason?.kind === "next_intent") {
        if (text) {
          slots["用户.下一步意向"] = text;
          slots["用户.最新输入"] = text;
        }
        const next = appendHistory(
          {
            ...session,
            slots,
            resumeContext: undefined,
          },
          event,
        );
        return {
          session: touch(running(next)),
          effects: [{ type: "propose_next_creation_step" }],
        };
      }

      if (session.waitingReason?.kind === "pick_creation_step") {
        return applyFlowReplan(session, event, text);
      }

      if (session.waitingReason?.kind === "revision") {
        const instruction =
          text.trim() || session.waitingReason.instruction?.trim() || "";
        if (!instruction) {
          return {
            session: waiting(touch(appendHistory({ ...session, slots }, event)), {
              kind: "revision",
              instruction: session.waitingReason.instruction,
            }),
            effects: [
              {
                type: "emit_message",
                message: "请说明要改哪里，再发送。",
              },
            ],
          };
        }
        const target = findRevisionTargetArtifact(session);
        if (target) {
          return beginRevisionRerun(session, event, target, instruction);
        }
        slots["用户.修订说明"] = instruction;
        slots["用户.最新输入"] = instruction;
        slots.revisionInstruction = instruction;
        return {
          session: touch(
            running(
              appendHistory(
                { ...session, slots, pendingArtifactId: undefined },
                event,
              ),
            ),
          ),
          effects: [{ type: "invoke_main_agent" }],
        };
      }

      if (session.waitingReason?.kind === "worker_questions") {
        slots["用户.worker答复"] = text;
        if (text) slots["用户.最新输入"] = text;
        // 开场/追问答复只进「用户.worker答复」，不追加进「用户.需求」
        // （否则后续步骤的用户表述会把各步答复叠成一份长转录，修订意见被淹没）
      } else if (session.waitingReason?.kind === "input" && text) {
        const key = demandKey || "用户.需求";
        applyUserTextToSlots(slots, text, key, {
          initial: !session.slots.startupCompleted,
        });
      } else if (text) {
        slots["用户.最新输入"] = text;
      }
      const next = appendHistory(
        {
          ...session,
          slots,
          resumeContext: hadResume ? session.resumeContext : undefined,
        },
        event,
      );

      if (hadResume) {
        // worker 提问后的回复 → 恢复 worker
        return {
          session: touch(running({ ...next, resumeContext: session.resumeContext })),
          effects: [{ type: "resume_worker" }],
        };
      }

      if (inferLifecycleStage(session) === "play") {
        return {
          session: touch(running({ ...next, resumeContext: undefined })),
          effects: [{ type: "run_play_turn" }],
        };
      }

      // 常规定稿用户输入 → 等总管下一步
      return {
        session: touch(running({ ...next, resumeContext: undefined })),
        effects: [{ type: "invoke_main_agent" }],
      };
    }

    // ── 总管决策 ──
    case "main_agent_decision_created": {
      const { decision } = event.payload;
      if (decision.statePatchAllowed !== false) {
        return fail(session, "Main Agent decision must set statePatchAllowed to false");
      }

      const next = appendHistory({ ...session, pendingDecision: decision }, event);

      switch (decision.action) {
        case "ask_user":
        case "review_blackboard": {
          const questions = decision.questions?.length
            ? decision.questions.map((q) => ({ ...q, required: false }))
            : undefined;
          const assessment =
            decision.action === "ask_user"
              ? decision.assessment?.trim() || undefined
              : undefined;
          const effects: PhaseEffect[] = [];
          if (assessment) {
            effects.push({
              type: "emit_message",
              message: `[Agent] 内容评价：\n${assessment}`,
            });
          }
          if (questions?.length) {
            effects.push({
              type: "emit_message",
              message: `[Agent] 可选追问（可跳过）：\n${questions.map((q) => `- ${q.prompt}`).join("\n")}`,
            });
          }
          const inputMessage = assessment
            ? assessment
            : decision.action === "review_blackboard" || !questions?.length
              ? decision.reason
              : undefined;
          return {
            session: waiting(
              { ...next, pendingDecision: undefined },
              {
                kind: "input",
                message: inputMessage,
                questions,
              },
            ),
            effects,
          };
        }
        case "finish":
          return {
            session: touch({
              ...next,
              phase: "done",
              waitingReason: undefined,
              pendingDecision: undefined,
            }),
            effects: [
              { type: "emit_message", message: decision.reason || "流程已完成。" },
            ],
          };
        case "create_temp_worker":
        case "run_worker": {
          if (!decision.workerId) {
            return fail(session, "run_worker requires workerId");
          }
          if (decision.requiresApproval) {
            // 需用户确认后才真正 run_worker
            return {
              session: waiting(next, {
                kind: "approve_step",
                decisionId: decision.id,
              }),
              effects: [
                { type: "emit_message", message: `等待确认：${decision.reason}` },
              ],
            };
          }
          return {
            session: touch(running({ ...next, currentWorkerId: decision.workerId })),
            effects: [
              {
                type: "run_worker",
                workerId: decision.workerId,
                workerContext: decision.workerContext,
              },
            ],
          };
        }
        default:
          return fail(session, "Unknown decision action");
      }
    }

    case "user_approved_next_step": {
      const decision = session.pendingDecision;
      if (!decision || decision.id !== event.payload.decisionId) {
        return fail(session, "No matching pending decision to approve");
      }
      if (!decision.workerId) {
        return fail(session, "Approved decision has no workerId");
      }
      return {
        session: touch(
          running(
            appendHistory(
              { ...session, currentWorkerId: decision.workerId },
              event,
            ),
          ),
        ),
        effects: [
          {
            type: "run_worker",
            workerId: decision.workerId,
            workerContext: decision.workerContext,
          },
        ],
      };
    }

    case "user_rejected_next_step": {
      return applyFlowReplan(session, event, event.payload.reason);
    }

    case "user_requested_flow_replan": {
      return applyFlowReplan(session, event, event.payload.reason);
    }

    case "creation_step_pick_awaited": {
      return {
        session: waiting(
          touch(
            appendHistory(
              {
                ...session,
                currentWorkerId: undefined,
                pendingDecision: undefined,
              },
              event,
            ),
          ),
          { kind: "pick_creation_step" },
        ),
        effects: [],
      };
    }

    case "user_left_creation_step": {
      const slots = { ...session.slots };
      delete slots[CREATION_PROPOSED_STEP_TAG];
      return {
        session: waiting(
          touch(
            appendHistory(
              {
                ...session,
                slots,
                pendingDecision: undefined,
                pendingArtifactId: undefined,
                currentWorkerId: undefined,
                currentStepId: undefined,
                resumeContext: undefined,
              },
              event,
            ),
          ),
          { kind: "pick_creation_step" },
        ),
        effects: [],
      };
    }

    case "user_picked_creation_step": {
      const stepId = event.payload.stepId.trim();
      if (!stepId) {
        return fail(session, "pick_creation_step requires stepId");
      }
      return {
        session: touch(
          running(
            appendHistory(
              {
                ...session,
                currentWorkerId: DESIGN_STEP_WORKER_ID,
                pendingDecision: undefined,
              },
              event,
            ),
          ),
        ),
        effects: [
          {
            type: "run_worker",
            workerId: DESIGN_STEP_WORKER_ID,
          },
        ],
      };
    }

    // ── Worker 生命周期 ──
    case "worker_started": {
      return {
        session: touch(
          running(
            appendHistory(
              {
                ...session,
                currentWorkerId: event.payload.workerId,
                currentStepId: event.payload.stepId,
                acceptanceMode: event.payload.acceptanceMode,
              },
              event,
            ),
          ),
        ),
        effects: [],
      };
    }

    case "worker_needs_input": {
      let normalized = normalizeQuestions(event.payload.questions);
      if (normalized.length === 0) {
        normalized = normalizeQuestions([
          "请补充当前步骤所需的信息（情境、参数或你的具体设想）。",
        ]);
      }
      const ctx: ResumeContext = {
        workerId: event.payload.workerId,
        stepId: event.payload.stepId ?? session.currentStepId,
        acceptanceMode: session.acceptanceMode ?? "user_confirmed",
        questions: normalized,
      };
      const openingAsk = isModuleOpeningQuestions(normalized);
      return {
        session: waiting(
          appendHistory(
            { ...session, resumeContext: ctx, currentWorkerId: event.payload.workerId },
            event,
          ),
          {
            kind: "worker_questions",
            workerId: event.payload.workerId,
            questions: normalized,
          },
        ),
        effects: [
          {
            type: "emit_message",
            // 默认问题正文由说话面 openingGuide 展示，勿再整段塞进调度消息
            message: openingAsk
              ? `[Worker] ${event.payload.workerId} · 默认问题（请在主栏按引导作答）`
              : `[Worker] ${event.payload.workerId} 提问：\n${normalized.map((q) => `- ${q.prompt}`).join("\n")}`,
          },
        ],
      };
    }

    case "worker_completed": {
      const result = handleWorkerCompleted(session, event);
      const mode =
        inferLifecycleStage(session) === "play"
          ? "no_confirmation"
          : (session.acceptanceMode ?? "user_confirmed");
      if (mode === "user_confirmed" && result.session.pendingArtifactId) {
        const sidecar = asOptionalSidecarQuestions(event.payload.questions);
        const assessment =
          typeof event.payload.assessment === "string"
            ? event.payload.assessment.trim()
            : "";
        // 追问与产物同一次产出：只挂 review_artifact，勿再 emit 独立「可选追问」消息
        //（否则历史里会拆成 worker_output + worker_questions 两段）
        return {
          ...result,
          session: waiting(result.session, {
            kind: "review_artifact",
            artifactId: result.session.pendingArtifactId,
            questions: sidecar,
            assessment: assessment || undefined,
          }),
        };
      }
      return result;
    }

    case "worker_revision_produced_nothing": {
      const artifact = findArtifact(session, event.payload.artifactId);
      if (!artifact) {
        return fail(session, `Artifact not found: ${event.payload.artifactId}`);
      }
      const retryQuestions = normalizeQuestions(event.payload.questions).map(
        (q) => ({ ...q, required: false }),
      );
      const next = appendHistory(
        updateArtifact(session, artifact.id, { status: "under_review" }),
        event,
      );
      return {
        session: waiting(
          {
            ...next,
            slots: { ...next.slots, revisionTargetArtifactId: undefined },
            pendingArtifactId: artifact.id,
            currentWorkerId: undefined,
          },
          {
            kind: "review_artifact",
            artifactId: artifact.id,
            questions: retryQuestions.length ? retryQuestions : undefined,
          },
        ),
        effects: [
          {
            type: "emit_message",
            message:
              "[系统] 这次按意见重写没能产出可验收的新版本，已退回上一版产物：可补充说明再改，或直接接受上一版。",
          },
        ],
      };
    }

    case "user_resolved_sidecar_questions": {
      const reason = session.waitingReason;
      if (reason?.kind !== "review_artifact") {
        return fail(session, "sidecar questions require review_artifact");
      }
      const answersText = event.payload.answersText?.trim();
      const slots: Record<string, unknown> = { ...session.slots };
      const effects: PhaseEffect[] = [];
      if (answersText) {
        slots["用户.worker答复"] = answersText;
        slots["用户.最新输入"] = answersText;
        effects.push({
          type: "emit_message",
          message: `[用户] 已补充可选追问（产物仍待验收）`,
        });
      }
      const next = appendHistory({ ...session, slots }, event);
      return {
        session: waiting(touch(next), {
          kind: "review_artifact",
          artifactId: reason.artifactId,
        }),
        effects,
      };
    }

    // ── 产物验收 ──
    case "user_accepted_artifact": {
      const artifact = findArtifact(session, event.payload.artifactId);
      if (!artifact) {
        return fail(session, `Artifact not found: ${event.payload.artifactId}`);
      }
      const slots: Record<string, unknown> = { ...session.slots };
      archiveStepNotesIntoDemand(slots);
      // 仅终稿 tag「设计.worker集」表示完整 Worker 集验收；草稿单位验收不得开 play
      const isFinalSet = artifact.outputTags.some((tag) => tag === "设计.worker集");
      if (isFinalSet) {
        slots.designInstanceReady = true;
      }
      const next = appendHistory(
        updateArtifact(session, artifact.id, { status: "accepted" }),
        event,
      );
      const cleared = {
        ...next,
        slots,
        pendingArtifactId: undefined,
        pendingDecision: undefined,
        currentWorkerId: undefined,
      };
      // 开场白终节点：落库开场，再回到分层图。创作流程保留，产物靠「保存」拆出。
      if (isOpeningSealArtifact(artifact)) {
        return {
          session: touch(running(cleared)),
          effects: [
            { type: "seal_creation_opening" },
            { type: "propose_next_creation_step" },
          ],
        };
      }
      if (inferLifecycleStage(session) === "play") {
        return afterPlayOrMainAgent(session, cleared);
      }
      // 创作步验收后停在分层图上等点选（可反复能力可当场新开一条）。
      // 仅当没有任何可点节点时，propose 才会把控制权交回总管扩步。
      const proposeNext =
        artifact.workerId === "design-step" ||
        artifact.workerId === "design-flow";
      if (proposeNext) {
        return {
          session: touch(running(cleared)),
          effects: [{ type: "propose_next_creation_step" }],
        };
      }
      return {
        session: touch(running(cleared)),
        effects: [{ type: "invoke_main_agent" }],
      };
    }

    case "user_rejected_artifact": {
      const artifact = findArtifact(session, event.payload.artifactId);
      if (!artifact) {
        return fail(session, `Artifact not found: ${event.payload.artifactId}`);
      }
      const reason = event.payload.reason?.trim() ?? "";
      // 验收态已写意见 → 在现有产物上按意见改；无意见才进入 revision 等待补交
      if (reason) {
        return beginRevisionRerun(session, event, artifact, reason);
      }
      const next = appendHistory(
        updateArtifact(session, artifact.id, { status: "rejected" }),
        event,
      );
      return {
        session: waiting(next, { kind: "revision" }),
        effects: [
          {
            type: "emit_message",
            message: "已保留当前产物，请说明要改哪里。",
          },
        ],
      };
    }

    case "user_requested_revision": {
      if (session.waitingReason?.kind === "approve_step") {
        // 在确认步骤时发修改意见，等同拒绝并回到总管
        return {
          session: touch(
            running(
              appendHistory({ ...session, pendingDecision: undefined }, event),
            ),
          ),
          effects: [{ type: "invoke_main_agent" }],
        };
      }
      const instruction = event.payload.instruction?.trim() ?? "";
      const artifactId =
        event.payload.artifactId ?? session.pendingArtifactId;
      const artifact = artifactId
        ? findArtifact(session, artifactId)
        : findRevisionTargetArtifact(session);
      if (instruction && artifact) {
        return beginRevisionRerun(session, event, artifact, instruction);
      }
      return {
        session: waiting(
          appendHistory(session, event),
          { kind: "revision", instruction: instruction || undefined },
        ),
        effects: [
          {
            type: "emit_message",
            message: instruction
              ? `修改意见：${instruction}`
              : "请说明要改哪里（在现有产物上改）。",
          },
        ],
      };
    }

    // ── 程序验收 ──
    case "programmatic_review_started":
      return { session: appendHistory(running(session), event), effects: [] };

    case "programmatic_review_passed": {
      const artifact = findArtifact(session, event.payload.artifactId);
      if (!artifact) {
        return fail(session, `Artifact not found: ${event.payload.artifactId}`);
      }
      const next = appendHistory(
        updateArtifact(session, artifact.id, { status: "accepted" }),
        event,
      );
      return {
        session: touch(
          running({ ...next, pendingArtifactId: undefined }),
        ),
        effects:
          inferLifecycleStage(session) === "play"
            ? [{ type: "continue_play_turn" }]
            : [{ type: "invoke_main_agent" }],
      };
    }

    case "programmatic_review_failed": {
      const artifact = findArtifact(session, event.payload.artifactId);
      if (!artifact) {
        return fail(session, `Artifact not found: ${event.payload.artifactId}`);
      }
      const reason = event.payload.reason?.trim() || "程序验收失败";
      const result = beginRevisionRerun(session, event, artifact, reason);
      return {
        ...result,
        effects: [
          {
            type: "emit_message",
            message: `程序验收未过，按意见在现有产物上改：${reason}`,
          },
          ...result.effects,
        ],
      };
    }

    // ── 终止 ──
    case "flow_completed":
      return {
        session: touch({
          ...appendHistory(session, event),
          phase: "done",
          waitingReason: undefined,
        }),
        effects: [],
      };

    case "runtime_failed":
      return fail(appendHistory(session, event), event.payload.reason);

    default:
      return fail(session, "Unhandled event type");
  }
}

/** 创建 worker 产物记录（drafted 状态），由 runtime 层在 worker_complete 前写入 session.artifacts */
export function createArtifact(params: {
  workerId: string;
  stepId?: string;
  outputTags: string[];
  summary?: string;
}): ArtifactRecord {
  const ts = nowIso();
  return {
    id: randomUUID(),
    workerId: params.workerId,
    stepId: params.stepId,
    outputTags: params.outputTags,
    status: "drafted",
    summary: params.summary,
    createdAt: ts,
    updatedAt: ts,
  };
}

export { type RuntimePhase, type WaitingReason };

function formatSkillSelectionPrompt(
  skills: Array<{ name: string; description: string }>,
): string {
  const lines = skills.map((s, i) => `  ${i + 1}. ${s.name} — ${s.description}`);
  return ["请选择创作 skill（输入 name 或编号）：", ...lines].join("\n");
}

/** agent-first：仅 UI 引导，等用户首句后再 invoke 总管 */
function enterAwaitFirstInput(
  session: RuntimeSession,
  skill: ActiveSkillSnapshot,
  event: RuntimeEvent,
): ApplyEventResult {
  const next = appendHistory(
    {
      ...session,
      flowId: skill.defaultFlowId ?? session.flowId,
      slots: {
        ...session.slots,
        activeSkill: skill,
      },
    },
    event,
  );
  return {
    session: waiting(next, { kind: "input" }),
    effects: [],
  };
}

function enterIntakeWaiting(
  session: RuntimeSession,
  skill: ActiveSkillSnapshot,
  event: RuntimeEvent,
): ApplyEventResult {
  const next = appendHistory(
    {
      ...session,
      flowId: skill.defaultFlowId ?? session.flowId,
      slots: {
        ...session.slots,
        activeSkill: skill,
      },
    },
    event,
  );
  return {
    session: waiting(next, {
      kind: "intake",
      prompt: skill.startupPrompt,
    }),
    effects: [{ type: "emit_message", message: skill.startupPrompt }],
  };
}

function applySkillBinding(
  session: RuntimeSession,
  skill: ActiveSkillSnapshot,
  event: RuntimeEvent,
): ApplyEventResult {
  if (effectiveStartupMode(skill) === "agent-first") {
    return enterAwaitFirstInput(session, skill, event);
  }
  return enterIntakeWaiting(session, skill, event);
}
