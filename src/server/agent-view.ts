import type { RuntimeSession, WaitingReason } from "../types/runtime.js";
import type { IntakeProgress } from "../types/intake.js";
import {
  buildSkillCatalog,
  inferLifecycleStage,
  canEnterPlay,
  TOOL_LOOP_BURST_MAX,
  type LifecycleStage,
  type SkillCatalogEntry,
} from "./skill-catalog.js";
import {
  displayWorkerLabel,
  formatAgentDisplayTitle,
  formatWorkerDisplayTitle,
} from "./display-labels.js";

export type AgentMessageKind =
  | "user_input"
  | "orchestrator_decision"
  | "orchestrator_thinking"
  | "orchestrator_prompt"
  | "orchestrator_assessment"
  | "agent_tool"
  | "worker_running"
  | "worker_output"
  | "worker_questions"
  | "worker_stub"
  | "system_info"
  | "error";

export type SessionFocus = {
  actorType: "orchestrator" | "worker" | "user" | "idle";
  actorId?: string;
  actorLabel: string;
  action: string;
  detail?: string;
};

export type EnrichedMessage = {
  kind: AgentMessageKind;
  actor?: string;
  title: string;
  body: string;
  text: string;
};

export type ToolTraceEntry = {
  at: string;
  name: string;
  summary: string;
};

export type BurstState = {
  count: number;
  max: number;
};

/** @deprecated 用 skillCatalog + lifecycleStage */
export type StageStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "done";
};

const WORKER_QUESTION_FALLBACK =
  "请补充当前步骤所需的信息（情境、参数或你的具体设想）。";

function formatWorkerQuestionBody(raw: string | undefined): string {
  const lines = (raw ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^askUser$/i.test(line));
  if (lines.length === 0) return WORKER_QUESTION_FALLBACK;
  return lines.map((line) => `- ${line}`).join("\n");
}

export function classifyAgentMessage(text: string): EnrichedMessage {
  const trimmed = text.trim();

  const agentTool = trimmed.match(/^\[总管 tool\]\s*([^\s:]+)(?::\s*([\s\S]*))?$/);
  if (agentTool) {
    const name = agentTool[1];
    const detail = agentTool[2]?.trim() ?? "";
    return {
      kind: "agent_tool",
      actor: "orchestrator",
      title: `工具 · ${name}`,
      body: detail || "（无输出）",
      text: trimmed,
    };
  }

  const agentThink = trimmed.match(/^\[总管 思考\]\s*\n?\n?([\s\S]*)$/);
  if (agentThink) {
    return {
      kind: "orchestrator_thinking",
      actor: "orchestrator",
      title: formatAgentDisplayTitle("思考"),
      body: agentThink[1]?.trim() || "（无内容）",
      text: trimmed,
    };
  }

  const orchestrator = trimmed.match(/^\[总管\]\s*(\w+):\s*([\s\S]+)$/);
  if (orchestrator) {
    return {
      kind: "orchestrator_decision",
      actor: "orchestrator",
      title: formatAgentDisplayTitle(orchestrator[1]),
      body: orchestrator[2].trim(),
      text: trimmed,
    };
  }

  const workerRunning = trimmed.match(/^\[Worker\]\s*(\S+)\s*执行中/);
  if (workerRunning) {
    return {
      kind: "worker_running",
      actor: workerRunning[1],
      title: formatWorkerDisplayTitle(workerRunning[1], "running"),
      body: "正在调用模型执行…",
      text: trimmed,
    };
  }

  const compressed = trimmed.match(/^\[上下文已压缩\]\s*([\s\S]+)$/);
  if (compressed) {
    return {
      kind: "system_info",
      actor: "system",
      title: "上下文已压缩",
      body: compressed[1].trim(),
      text: trimmed,
    };
  }

  const unitAccepted = trimmed.match(/^\[创作单位已验收\]\s*([\s\S]+)$/);
  if (unitAccepted) {
    return {
      kind: "system_info",
      actor: "system",
      title: "创作单位已验收",
      body: unitAccepted[1].trim(),
      text: trimmed,
    };
  }

  const workerDone = trimmed.match(/^\[Worker\]\s*(\S+)\s*已完成\s*\n?\n?([\s\S]*)$/);
  if (workerDone) {
    return {
      kind: "worker_output",
      actor: workerDone[1],
      title: formatWorkerDisplayTitle(workerDone[1], "output"),
      body: workerDone[2]?.trim() || "（无正文）",
      text: trimmed,
    };
  }

  if (trimmed.startsWith("[Worker 占位]")) {
    const stub = trimmed.match(/^\[Worker 占位\]\s*(\S+)/);
    return {
      kind: "worker_stub",
      actor: stub?.[1],
      title: formatWorkerDisplayTitle(stub?.[1], "stub"),
      body: trimmed,
      text: trimmed,
    };
  }

  const workerAskTagged = trimmed.match(
    /^\[Worker\]\s*(\S+)\s*提问[：:]\s*\n?([\s\S]*)$/,
  );
  if (workerAskTagged) {
    const body = formatWorkerQuestionBody(workerAskTagged[2]);
    return {
      kind: "worker_questions",
      actor: workerAskTagged[1],
      title: formatWorkerDisplayTitle(workerAskTagged[1], "questions"),
      body,
      text: trimmed,
    };
  }

  const workerQuestions = trimmed.match(/^Worker 提问[：:]\s*\n?([\s\S]*)$/);
  if (workerQuestions) {
    const body = formatWorkerQuestionBody(workerQuestions[1]);
    return {
      kind: "worker_questions",
      title: "Worker 需要你补充",
      body,
      text: trimmed,
    };
  }

  if (trimmed.startsWith("[请求失败]")) {
    return {
      kind: "error",
      title: "请求失败",
      body: trimmed.replace(/^\[请求失败\]\s*/, ""),
      text: trimmed,
    };
  }

  if (trimmed.startsWith("[阶段机]")) {
    return {
      kind: "system_info",
      title: "阶段机",
      body: trimmed.replace(/^\[阶段机\]\s*/, ""),
      text: trimmed,
    };
  }

  if (trimmed.startsWith("[Agent] 内容评价")) {
    return {
      kind: "orchestrator_assessment",
      actor: "orchestrator",
      title: "总管 · 内容评价",
      body: trimmed.replace(/^\[Agent\]\s*内容评价[：:]\s*/, "").trim() || trimmed,
      text: trimmed,
    };
  }

  if (trimmed.startsWith("[Agent] 提问") || trimmed.startsWith("[Agent] 可选追问")) {
    return {
      kind: "worker_questions",
      actor: "orchestrator",
      title: "总管 · 可选追问",
      body: formatWorkerQuestionBody(
        trimmed
          .replace(/^\[Agent\]\s*可选追问（可跳过）[：:]\s*/, "")
          .replace(/^\[Agent\]\s*提问[：:]\s*/, ""),
      ),
      text: trimmed,
    };
  }

  if (trimmed.match(/^\[Worker\]\s*可选追问/)) {
    return {
      kind: "worker_questions",
      title: "可选追问",
      body: formatWorkerQuestionBody(
        trimmed.replace(
          /^\[Worker\]\s*可选追问（可跳过，直接接受(?:目前)?产物）[：:]\s*/,
          "",
        ),
      ),
      text: trimmed,
    };
  }

  if (
    trimmed.includes("请告诉我") ||
    trimmed.includes("启动询问") ||
    /^你选择了/.test(trimmed)
  ) {
    return {
      kind: "orchestrator_prompt",
      actor: "orchestrator",
      title: "总管 · 启动询问",
      body: trimmed,
      text: trimmed,
    };
  }

  return {
    kind: "system_info",
    title: "系统",
    body: trimmed,
    text: trimmed,
  };
}

/** @deprecated 保留兼容；返回空数组 */
export function buildPipeline(_session: RuntimeSession): StageStep[] {
  return [];
}

export function buildToolTrace(
  messages: Array<{ kind?: AgentMessageKind; text: string; createdAt: string }>,
): ToolTraceEntry[] {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === "user_input") {
      lastUserIdx = i;
      break;
    }
  }
  const slice = lastUserIdx >= 0 ? messages.slice(lastUserIdx + 1) : messages;
  return slice
    .filter((m) => m.kind === "agent_tool")
    .map((m) => {
      const match = m.text.match(/^\[总管 tool\]\s*([^\s:]+)/);
      return {
        at: m.createdAt,
        name: match?.[1] ?? "tool",
        summary: m.text.replace(/^\[总管 tool\]\s*\S+:?\s*/, "").slice(0, 200),
      };
    });
}

export function buildBurstState(
  messages: Array<{ kind?: AgentMessageKind }>,
  session: RuntimeSession,
): BurstState {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === "user_input") {
      lastUserIdx = i;
      break;
    }
  }
  const slice = lastUserIdx >= 0 ? messages.slice(lastUserIdx + 1) : messages;
  const toolCount = slice.filter(
    (m) =>
      m.kind === "agent_tool" ||
      m.kind === "orchestrator_decision",
  ).length;
  const stored =
    typeof session.slots.toolLoopBurstCount === "number"
      ? session.slots.toolLoopBurstCount
      : toolCount;
  return {
    count: Math.max(stored, toolCount),
    max: TOOL_LOOP_BURST_MAX,
  };
}

export function buildFocus(
  session: RuntimeSession,
  reason?: WaitingReason,
  intake?: IntakeProgress,
  lifecycle?: LifecycleStage,
): SessionFocus {
  const stage = lifecycle ?? inferLifecycleStage(session);

  if (session.phase === "done") {
    return {
      actorType: "idle",
      actorLabel: "流程",
      action: "已完成",
      detail: stage === "design" ? "设计阶段结束" : "游玩会话结束",
    };
  }

  if (reason?.kind === "intake") {
    const detail =
      intake && intake.requiredTotal > 0
        ? `必要项 ${intake.requiredFilled}/${intake.requiredTotal}`
        : "总管将根据描述推理 Worker 集";
    return {
      actorType: "user",
      actorLabel: "你",
      action: "描述创作需求",
      detail,
    };
  }

  if (reason?.kind === "input" && !session.slots.startupCompleted) {
    return {
      actorType: "user",
      actorLabel: "你",
      action: "描述创作需求",
      detail: "发送后总管将开始：创作 · 核心",
    };
  }

  if (reason?.kind === "input") {
    if (reason.questions?.length) {
      const q = reason.questions
        .map((item) => item.prompt)
        .filter((s) => s?.trim())
        .join("；");
      return {
        actorType: "user",
        actorLabel: "你",
        action: "回答追问",
        detail: q.slice(0, 200) || reason.message,
      };
    }
    return {
      actorType: "user",
      actorLabel: "你",
      action: "补充说明",
      detail: reason.message?.slice(0, 120),
    };
  }

  if (reason?.kind === "approve_step") {
    const worker = session.pendingDecision?.workerId ?? "skill";
    return {
      actorType: "orchestrator",
      actorId: "orchestrator",
      actorLabel: "总管",
      action: `建议调用 ${displayWorkerLabel(worker)}`,
      detail: session.pendingDecision?.reason,
    };
  }

  if (reason?.kind === "worker_questions") {
    const q =
      reason.questions
        ?.map((item) => item.prompt)
        .filter((s) => s?.trim())
        .join("；") ?? "";
    return {
      actorType: "user",
      actorId: reason.workerId,
      actorLabel: "你",
      action: `回答 · ${displayWorkerLabel(reason.workerId)}`,
      detail: q.slice(0, 200) || "请在询问卡作答",
    };
  }

  if (reason?.kind === "review_artifact") {
    const art = session.artifacts.find((a) => a.id === session.pendingArtifactId);
    const optionalQs = reason.questions?.length
      ? `；另有 ${reason.questions.length} 道可选追问`
      : "";
    return {
      actorType: "user",
      actorLabel: "你",
      action: "验收产物",
      detail: `${art?.summary ?? displayWorkerLabel(art?.workerId) ?? ""}${optionalQs}`,
    };
  }

  if (session.currentWorkerId) {
    return {
      actorType: "worker",
      actorId: session.currentWorkerId,
      actorLabel: displayWorkerLabel(session.currentWorkerId),
      action: "执行中",
      detail: "模型正在产出…",
    };
  }

  if (session.phase === "running" && !reason) {
    return {
      actorType: "orchestrator",
      actorId: "orchestrator",
      actorLabel: "总管",
      action: stage === "design" ? "创作调度" : "游玩调度",
      detail: "读黑板 → 选下一步",
    };
  }

  if (reason?.kind === "skill_selection") {
    return {
      actorType: "user",
      actorLabel: "你",
      action: "恢复中的旧会话",
      detail: "请发送任意消息继续，或联系维护者",
    };
  }

  return {
    actorType: "idle",
    actorLabel: "系统",
    action: "待命",
  };
}

export {
  inferLifecycleStage,
  canEnterPlay,
  buildSkillCatalog,
  type LifecycleStage,
  type SkillCatalogEntry,
};
