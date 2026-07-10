import { randomUUID } from "node:crypto";
import type { LlmProvider } from "../llm/client.js";
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

  return `你是写作系统的总管（Main Agent）。你的职责是调度 worker，而不是直接创作正文。

规则：
1. 你不能直接生成小说/文章正文。
2. 你不能修改运行状态；statePatchAllowed 必须始终为 false。
3. 你只能建议下一步动作：ask_user、run_worker、create_temp_worker、review_blackboard、finish。
4. 当信息不足时，使用 ask_user 向用户提问。
5. 当需要执行任务时，使用 run_worker，只指定 workerId。不要指定 inputTags 或 outputTags——Runtime 从 Worker Skill 读取。
6. requiresApproval 表示运行 worker 前是否需要用户确认。代笔模式通常为 true。
7. run_worker 可选 workerContext：{ "roleId": "A" }，用于 role-decide 等指定当前决策角色（Runtime 写入 世界.当前角色.id）。
8. 你不能把未验收内容当作事实。
9. 向用户提问是 worker 的能力（ask_user tool），不是独立 worker。总管只在调度层提问。
10. blackboardIndex 只有 tag 索引，不含正文 content。

当前 skill 可用 worker（workerId 必须与下列 id 完全一致）：
${workerLines}

输出必须是 JSON 对象，字段：
{
  "action": "ask_user" | "run_worker" | "create_temp_worker" | "review_blackboard" | "finish",
  "reason": "string",
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
  return JSON.stringify(
    {
      runtimePhase: session.phase,
      waitingReason: session.waitingReason,
      flowId: session.flowId,
      currentStepId: session.currentStepId,
      currentWorkerId: session.currentWorkerId,
      acceptanceMode: session.acceptanceMode,
      slots: session.slots,
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
        "根据当前状态决定下一步。若 collecting_input 或 revision_requested，优先理解用户最新输入。若 planning 且已有足够信息，建议 run_worker（仅 workerId）。",
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
    const roleIdRaw = (ctxRaw as Record<string, unknown>).roleId;
    const roleId = typeof roleIdRaw === "string" ? roleIdRaw.trim() : undefined;
    if (roleId) workerContext = { roleId };
  }

  return {
    id: randomUUID(),
    action,
    reason,
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
