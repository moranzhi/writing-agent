import type { ChatMessage, LlmProvider, ParsedToolCall, StreamCallbacks } from "../llm/client.js";
import { supportsToolStream } from "../llm/stream-complete.js";
import { toolCallToDecision, validateLoopToolCall } from "../runtime/tool-registry.js";
import type { MainAgentDecision } from "../types/runtime.js";
import { isMainAgentTerminalTool } from "../types/tools.js";
import { MAIN_AGENT_TOOL_DEFINITIONS } from "./tools.js";
import { buildMainAgentUserPrompt, parseMainAgentDecision } from "./main-agent.js";
import type { MainAgentContext } from "./main-agent.js";

export type ToolLoopHandlers = {
  readBlackboard: (tags: string[]) => Record<string, string>;
  listWorkers: () => Array<{ id: string; description: string }>;
  listArtifacts: () => Array<{
    id: string;
    workerId: string;
    status: string;
    summary?: string;
    outputTags: string[];
  }>;
  onToolCall?: (name: string, detail: string) => void;
  /** 思维链 / reasoning 流式增量（供 UI 实时展示） */
  onThinkingDelta?: (delta: string) => void;
  /** 一轮 LLM 调用结束后的完整思考文本 */
  onThinkingDone?: (text: string) => void;
};

export type ToolLoopResult = {
  decision: MainAgentDecision;
  iterations: number;
  toolTrace: string[];
};

const MAX_TOOL_LOOP_ITERATIONS = 12;

function buildToolLoopSystemPrompt(
  workers: Array<{ id: string; description: string }>,
): string {
  const workerLines =
    workers.length > 0
      ? workers.map((w) => `- ${w.id}：${w.description}`).join("\n")
      : "- （当前 skill 未加载 worker 列表）";

  return `你是写作系统的总管（Main Agent）。你在 running 相位通过 **tool call** 推进流程。

## 能力边界
1. 你不能直接生成小说/文章正文。
2. 你不能修改运行状态。
3. 先用 read_blackboard / list_workers / list_artifacts 收集信息，再决定下一步。
4. 终止动作只能用 tool：ask_user、run_worker、review_blackboard、finish。
   - ask_user：**主内容是 assessment（内容完备度评价）**；questions 挂在其下且可被用户跳过。
     · assessment（必填）：给用户看的评价正文。以【核心体验】为首；按需列维度（内容/人物关系/感官/背景规则/意义主题…），不必凑齐。每维写完备度%、已知、待探；待探用【】标互斥或可组合方向。
     · questions（必填数组，语义可选）：只针对 assessment「待探」里想确认的点；一次 1～2 题。用户可不答、直接让你基于现有信息继续。prompt=明确题干；options=2～4 条**建议示范**；required 默认 false。
     · reason：调度短句，正推，勿塞长文。
     · 能推断就别问；已写在 用户.需求 里的不要重复问。
5. run_worker 只传 workerId；inputTags/outputTags 由 Runtime 从 Worker Skill 读取。
6. requiresApproval=true 时 run_worker 需用户确认后再执行。
7. 不能把未验收产物当作已定事实。

## 调度思维（必须遵守）
用 **需求正推**，禁止 **模式否定式** 表述。

**要这样思考（正推）：**
「用户需要 [具体体验/能力/产物] → 因此调用 [worker/skill] 来 [生成/补充/调整] [什么]，以便更好满足用户。」

**不要这样思考（反例）：**
「这是 xxx 模式 / 形态 → 不需要 xxx 步骤 / 跳过 xxx。」
「背景为单一角色，无需世界构建。」
「不是规则怪谈，跳过 write-rules。」

示例（好）：
- 「用户已选配方且要 1v1 网恋 → design-flow 排出近期增量步骤（可调味）→ 认可后反复 design-step；不够再追加。」
- 「尚无设计.创作流程 → run_worker(design-flow)；有未完成步骤 → design-step；steps 完但 status=open → 再 design-flow。」
- 「运行规格已 accept 且声明需要开局 → 调用 opening-generator 写开场白。」

示例（坏）：
- 「调度 design-core / design-fixed（已废弃）。」
- 「一次 design-flow 排死全程固定 DAG。」
- 「跳过流程编排直接写满运行规格。」
- 「默认先上世界模拟全套再问用户要什么。」
- 「替用户改选 / 猜测配方。」

在 reasoning / 可见 content 中请用 **正推句式** 写出调度理由；终止 tool 的 reason 字段同样用正推表述。

## design 阶段提示
- 尚无「设计.创作流程」→ **优先 design-flow**（近期 horizon；status=open；未选则先请用户选）。
- 流程已验收、还有未完成步骤 → **design-step**（一次一步）。
- 已列步骤全验收但 **status=open** → 再 **design-flow**（追加生成规则/具体实例等并钉齐 params，或设 closed）。
- 有编排参数的步骤缺必填 params → 先让 design-flow askUser，不要空壳跑 design-step。
- 禁止 run_worker(design-core|design-fixed|design-worker|design-refine)——已废弃。
- 不要重复问用户「想做什么」——意图已在 用户.需求。
- 运行规格已 accept，且可用 worker 含 opening-generator，尚无开场产物 → opening-generator。
- 进 play 由用户手动决定。
- 未声明开局、用户也未要求开场时，不要硬调 opening-generator。
- **禁止**替用户猜测或改选配方。
- **禁止**一次编排排死全程固定长链。

## play 阶段提示（lifecycleStage=play 时优先）
- 管线顺序：**auditor（旁观维护）→ perspective? → gm（主世界层）→ narrator**。
- auditor/gm/perspective 多为 continue：写完立刻 run 下一槽，不要中途 ask_user。
- 只在 narrator（或 review 终稿槽）停给人看。
- chance 按需；pendingSideEffectWorkers 非空则优先调度。
- 禁止未声明 play ref；旁观维护默认空操作，不是正文作者。

当前 skill 可用 worker：
${workerLines}

信息不足时可多次 read_blackboard；一旦调用终止 tool，本轮循环结束。`;
}

async function completeToolsPreferStream(
  llm: LlmProvider,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
): Promise<Awaited<ReturnType<LlmProvider["completeWithTools"]>>> {
  if (supportsToolStream(llm)) {
    return llm.completeWithToolsStream!(messages, {
      tools: MAIN_AGENT_TOOL_DEFINITIONS,
      caller: "main_agent",
    }, callbacks);
  }
  const result = await llm.completeWithTools(messages, {
    tools: MAIN_AGENT_TOOL_DEFINITIONS,
    caller: "main_agent",
  });
  if (result.reasoning) {
    callbacks.onReasoningDelta?.(result.reasoning);
  }
  if (result.content) {
    callbacks.onContentDelta?.(result.content);
  }
  return result;
}

function executeLoopTool(
  call: ParsedToolCall,
  handlers: ToolLoopHandlers,
): string {
  const name = validateLoopToolCall(call);
  const args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;

  switch (name) {
    case "read_blackboard": {
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((t): t is string => typeof t === "string")
        : [];
      if (tags.length === 0) {
        return JSON.stringify({ error: "tags must be a non-empty string array" });
      }
      return JSON.stringify(handlers.readBlackboard(tags));
    }
    case "list_workers":
      return JSON.stringify(handlers.listWorkers());
    case "list_artifacts":
      return JSON.stringify(handlers.listArtifacts());
    default:
      return JSON.stringify({ error: `Unhandled loop tool: ${name}` });
  }
}

function assistantMessageFromToolCalls(
  content: string | null,
  toolCalls: ParsedToolCall[],
): ChatMessage {
  return {
    role: "assistant",
    content,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    })),
  };
}

function emitThinkingDone(handlers: ToolLoopHandlers, parts: {
  reasoning?: string;
  content?: string | null;
}): void {
  const reasoning = parts.reasoning?.trim() ?? "";
  const content = parts.content?.trim() ?? "";
  const combined = [reasoning, content].filter(Boolean).join("\n\n").trim();
  if (combined) handlers.onThinkingDone?.(combined);
}

/**
 * 总管 tool loop：在 running 相位内可多轮调用 read_blackboard 等，
 * 直到调用终止 tool 并返回 MainAgentDecision。
 */
export async function runMainAgentToolLoop(
  llm: LlmProvider,
  context: MainAgentContext,
  handlers: ToolLoopHandlers,
): Promise<ToolLoopResult> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildToolLoopSystemPrompt(context.availableWorkers),
    },
    { role: "user", content: buildMainAgentUserPrompt(context) },
  ];

  const toolTrace: string[] = [];
  const streamCallbacks: StreamCallbacks = {
    onReasoningDelta: (delta) => handlers.onThinkingDelta?.(delta),
    onContentDelta: (delta) => handlers.onThinkingDelta?.(delta),
  };

  for (let iteration = 1; iteration <= MAX_TOOL_LOOP_ITERATIONS; iteration++) {
    const result = await completeToolsPreferStream(llm, messages, streamCallbacks);
    emitThinkingDone(handlers, result);

    if (result.toolCalls.length === 0) {
      if (result.content?.trim()) {
        const decision = parseMainAgentDecision(result.content);
        return { decision, iterations: iteration, toolTrace };
      }
      throw new Error("Main Agent returned no tool calls and no content");
    }

    const terminalCalls = result.toolCalls.filter((tc) =>
      isMainAgentTerminalTool(tc.name),
    );
    const loopCalls = result.toolCalls.filter(
      (tc) => !isMainAgentTerminalTool(tc.name),
    );

    if (terminalCalls.length > 1) {
      throw new Error(
        `Main Agent returned multiple terminal tools: ${terminalCalls.map((t) => t.name).join(", ")}`,
      );
    }

    messages.push(
      assistantMessageFromToolCalls(result.content, result.toolCalls),
    );

    if (terminalCalls.length === 1) {
      const terminal = terminalCalls[0];
      handlers.onToolCall?.(terminal.name, terminal.arguments);
      toolTrace.push(`${terminal.name} (terminal)`);
      return {
        decision: toolCallToDecision(terminal),
        iterations: iteration,
        toolTrace,
      };
    }

    for (const call of loopCalls) {
      const output = executeLoopTool(call, handlers);
      handlers.onToolCall?.(call.name, output.slice(0, 200));
      toolTrace.push(call.name);
      messages.push({
        role: "tool",
        content: output,
        tool_call_id: call.id,
      });
    }
  }

  throw new Error(
    `Main Agent tool loop exceeded ${MAX_TOOL_LOOP_ITERATIONS} iterations`,
  );
}
