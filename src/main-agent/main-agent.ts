import { randomUUID } from "node:crypto";
import type { LlmProvider } from "../llm/client.js";
import { createLocalLlmDriver, type AgentDriver } from "../runtime/driver.js";
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

  return `你是创作节点路由器。当前没有「设计.创作流程」。本轮调用 run_worker：workerId 为 design-flow，排出近期起点。

当前 skill 可用 worker（workerId 必须与下列 id 完全一致）：
${workerLines}

结束本轮必须调用 run_worker(design-flow)。reason 用一句话说明根据用户需求开始编排；requiresApproval 为 false。`;
}

/** 总管把推理写成正文、未给出可用工具/JSON 时，运行时改走点选或 design-flow。 */
export function isUnusableMainAgentOutput(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /invalid JSON/i.test(msg) ||
    /no tool calls and no content/i.test(msg) ||
    /Invalid action/i.test(msg) ||
    /must be an object/i.test(msg) ||
    /requires reason/i.test(msg) ||
    /multiple terminal tools/i.test(msg) ||
    /Not a terminal tool/i.test(msg)
  );
}

export class MainAgent {
  private readonly driver: AgentDriver;

  constructor(
    private readonly llm: LlmProvider,
    driver?: AgentDriver,
  ) {
    this.driver = driver ?? createLocalLlmDriver(llm);
  }

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
      this.driver,
    );
    return decision;
  }
}

export function buildMainAgentUserPrompt(context: MainAgentContext): string {
  const { session, blackboardIndex, availableWorkers } = context;
  const creationTags = new Set([
    "设计.创作流程",
    "创作.当前步骤",
    "创作.当前单位",
    "创作.已验收单位",
    "用户.下一步意向",
  ]);
  return JSON.stringify(
    {
      currentStepId: session.currentStepId,
      creationDagTags: blackboardIndex.filter((entry) =>
        creationTags.has(entry.tag),
      ),
      availableWorkers,
      instruction: "读取创作 DAG，选择下一个创作节点。",
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
