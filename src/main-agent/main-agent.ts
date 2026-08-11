import { randomUUID } from "node:crypto";
import type { LlmProvider } from "../llm/client.js";
import { normalizeQuestions } from "../skills/question-protocol.js";
import type { BlackboardTagIndex } from "../types/blackboard.js";
import type { MainAgentDecision, RuntimeSession } from "../types/runtime.js";
import { runMainAgentToolLoop, type ToolLoopHandlers } from "./tool-loop.js";

export type MainAgentContext = {
  session: RuntimeSession;
  blackboardIndex: BlackboardTagIndex[];
  availableWorkers: Array<{ id: string; description: string }>;
};

export type MainAgentRunOptions = {
  handlers: ToolLoopHandlers;
};

function buildMainAgentSystemPrompt(
  workers: Array<{ id: string; description: string }>,
): string {
  const workerLines =
    workers.length > 0
      ? workers.map((w) => `- ${w.id}：${w.description}`).join("\n")
      : "- （当前 skill 未加载 worker 列表）";

  return `你是写作系统的编排器（Main Agent）。你的职责是调度执行单元（worker），而不是直接创作正文。

规则：
1. 你不能直接生成小说/文章正文。
2. 你不能修改运行状态；statePatchAllowed 必须始终为 false。
3. 你只能建议下一步动作：ask_user、run_worker、create_temp_worker、review_blackboard、finish。
4. 当信息不足时，使用 ask_user：assessment 是主内容（完备度评价）；questions 挂在其下且用户可跳过；一次 1～2 题。
5. 当需要执行任务时，使用 run_worker，只指定 workerId。不要指定 inputTags 或 outputTags——Runtime 从 Worker Skill 读取。
6. requiresApproval 表示运行 worker 前是否需要用户确认。代笔模式通常为 true。
7. run_worker 可选 workerContext：{ "roleId": "A" } 或 { "chance": { "op":"roll", "expression":"2d6" } }（机遇裁定走程序，勿让模型编随机）。
8. 你不能把未验收内容当作事实。
9. 向用户提问是 worker 的技能（ask_user tool），不是独立 worker。编排器只在调度层提问。
10. blackboardIndex 只有 tag 索引，不含正文 content。

## 调度思维
用需求正推：「用户需要 [具体体验/技能] → 调用 [worker/skill] 来 [生成/补充/调整] [什么]，以便更好满足用户。」
禁止否定式路由：「某模式 / 背景形态 → 不需要某步骤 / 跳过某 worker」。

反例（禁止）：「背景为单一角色，无需世界构建」「不是规则怪谈，跳过 write-rules」「默认上世界模拟套件」
正例：「用户已选世界模拟器配方且要网恋对话 → design-flow 排出近期增量步骤（可调味、可后补；有编排参数的步骤须钉 params）→ 用户认可后反复 design-step；需要再补规则/实例 → 再 design-flow 追加同技能并写齐 params → 收成后若需开局 → opening-generator；用户手动进 play」

当前 skill 可用 worker（workerId 必须与下列 id 完全一致）：
${workerLines}

## design 优先顺序
- 尚无「设计.创作流程」→ **design-flow**（近期 horizon；status=open；未选配方则先请用户选）
- 流程已验收且还有未完成步骤 → **design-step**（一次一步；技能由程序注入）
- 已列步骤都验收但流程仍 **status=open** → 再 **design-flow**（追加反复步或 closed）
- 禁止调度已废弃的 design-core / design-fixed / design-worker / design-refine
- 终稿已 accept 且可用 opening-generator、尚无开场产物 → opening-generator
- 进 play 由用户手动决定
- **禁止**替用户猜测或改选配方
- **禁止**一次编排排死全程固定 DAG

## play 优先顺序（lifecycleStage=play）
- 严格按声明管线顺序调度（play_slots 展开序）：**auditor（旁观维护）→ perspective? → gm（主世界层）→ narrator（转述）**
- auditor / gm / perspective 的 acceptance 多为 continue：跑完立刻调度下一槽，不要中途 ask_user
- 仅 narrator（或规格标明 review 的终稿槽）停下来等人看
- chance 仅在需要真随机时按需 run_worker，不插入每轮固定序
- slots.pendingSideEffectWorkers 非空时优先调度其中 workerId
- **禁止**发明未声明的 play ref；**禁止**把旁观维护当成正文作者

输出必须是 JSON 对象，字段：
{
  "action": "ask_user" | "run_worker" | "create_temp_worker" | "review_blackboard" | "finish",
  "reason": "string",
  "assessment": "string | null",
  "questions": [{ "id": "q1", "prompt": "…", "options": [{ "label": "建议示范…" }] }] | null,
  "workerId": "string | null",
  "requiresApproval": boolean,
  "workerContext": { "roleId": "string" } | null
}`;
}

export class MainAgent {
  constructor(private readonly llm: LlmProvider) {}

  /** @deprecated 单次 JSON 决策；请用 runToolLoop */
  async decide(context: MainAgentContext): Promise<MainAgentDecision> {
    const userPrompt = buildMainAgentUserPrompt(context);
    const systemPrompt = buildMainAgentSystemPrompt(context.availableWorkers);
    const result = await this.llm.complete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { responseFormat: "json_object", caller: "main_agent" },
    );
    return parseMainAgentDecision(result.content);
  }

  /** running 相位：tool loop 直到终止 tool */
  async runToolLoop(
    context: MainAgentContext,
    options: MainAgentRunOptions,
  ): Promise<MainAgentDecision> {
    const { decision } = await runMainAgentToolLoop(
      this.llm,
      context,
      options.handlers,
    );
    return decision;
  }
}

export function buildMainAgentUserPrompt(context: MainAgentContext): string {
  const { session, blackboardIndex, availableWorkers } = context;
  const stage = String(session.slots?.uiLifecycleStage ?? "design");
  const pendingSide = session.slots?.pendingSideEffectWorkers;
  return JSON.stringify(
    {
      runtimePhase: session.phase,
      waitingReason: session.waitingReason,
      lifecycleStage: stage,
      flowId: session.flowId,
      currentStepId: session.currentStepId,
      currentWorkerId: session.currentWorkerId,
      acceptanceMode: session.acceptanceMode,
      slots: session.slots,
      pendingSideEffectWorkers: pendingSide ?? null,
      pendingDecision: session.pendingDecision
        ? {
            id: session.pendingDecision.id,
            action: session.pendingDecision.action,
            reason: session.pendingDecision.reason,
          }
        : null,
      pendingArtifactId: session.pendingArtifactId,
      artifacts: session.artifacts.map((a) => ({
        id: a.id,
        workerId: a.workerId,
        status: a.status,
        summary: a.summary,
        outputTags: a.outputTags,
      })),
      blackboardIndex,
      availableWorkers,
      instruction:
        stage === "play"
          ? "play：按声明序 auditor→perspective?→gm→narrator；continue 槽连跑；仅终稿 review 停；pendingSideEffectWorkers 优先；禁止未声明 ref。"
          : "根据当前状态决定下一步。尚无设计.创作流程 → design-flow；有未完成步骤 → design-step；steps 做完但 status=open → 再 design-flow；禁止旧 design-core/fixed/worker/refine。已 accept 且需开局 → opening-generator。进 play 由用户手动。",
    },
    null,
    2,
  );
}

export function parseMainAgentDecision(raw: string): MainAgentDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Main Agent returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Main Agent decision must be an object");
  }

  const obj = parsed as Record<string, unknown>;
  const action = obj.action;
  if (
    action !== "ask_user" &&
    action !== "run_worker" &&
    action !== "create_temp_worker" &&
    action !== "review_blackboard" &&
    action !== "finish"
  ) {
    throw new Error(`Invalid action: ${String(action)}`);
  }

  const reason = typeof obj.reason === "string" ? obj.reason : "";
  if (!reason) {
    throw new Error("Main Agent decision requires reason");
  }

  const workerId =
    typeof obj.workerId === "string"
      ? obj.workerId
      : obj.workerId === null || obj.workerId === undefined
        ? undefined
        : undefined;

  let workerContext: MainAgentDecision["workerContext"];
  const ctxRaw = obj.workerContext;
  if (ctxRaw && typeof ctxRaw === "object" && !Array.isArray(ctxRaw)) {
    const ctx = ctxRaw as Record<string, unknown>;
    const roleIdRaw = ctx.roleId;
    const roleId = typeof roleIdRaw === "string" ? roleIdRaw.trim() : undefined;
    const chanceRaw = ctx.chance;
    const chance =
      chanceRaw && typeof chanceRaw === "object" && !Array.isArray(chanceRaw)
        ? (chanceRaw as Record<string, unknown>)
        : undefined;
    if (roleId || chance) {
      workerContext = {
        ...(roleId ? { roleId } : {}),
        ...(chance ? { chance } : {}),
      };
    }
  }
  // 兼容 tool 扁平参数 chance（与 workerContext.chance 等价）
  if (!workerContext?.chance && obj.chance && typeof obj.chance === "object") {
    workerContext = {
      ...(workerContext ?? {}),
      chance: obj.chance as Record<string, unknown>,
    };
  }

  const assessmentRaw =
    typeof obj.assessment === "string"
      ? obj.assessment.trim()
      : typeof obj.message === "string"
        ? obj.message.trim()
        : "";
  const questions = normalizeQuestions(obj.questions);

  return {
    id: randomUUID(),
    action,
    reason,
    assessment: assessmentRaw || undefined,
    questions: questions.length ? questions : undefined,
    workerId,
    workerContext,
    requiresApproval: Boolean(obj.requiresApproval),
    statePatchAllowed: false,
  };
}

export const DEFAULT_WORKERS = [
  {
    id: "write-rules",
    description: "规则怪谈：内部 core.danger + 护命规则 rules.draft + 解析",
  },
  {
    id: "outline",
    description: "根据 book.brief 生成 outline.draft",
  },
  {
    id: "review-infer",
    description: "读者视角验收 rules（不含 core.danger）",
  },
  {
    id: "review-author",
    description: "作者视角验收 rules 与 core 一致性",
  },
] as const;
