import type { ChatMessage, LlmProvider, ParsedToolCall, StreamCallbacks } from "../llm/client.js";
import { supportsToolStream } from "../llm/stream-complete.js";
import { toolCallToDecision, validateLoopToolCall } from "../runtime/tool-registry.js";
import type { MainAgentDecision } from "../types/runtime.js";
import { isMainAgentTerminalTool } from "../types/tools.js";
import { MAIN_AGENT_TOOL_DEFINITIONS } from "./tools.js";
import { buildMainAgentUserPrompt, parseMainAgentDecision } from "./main-agent.js";
import type { MainAgentContext } from "./main-agent.js";
import { debugLog } from "../log.js";

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
  /** 一轮 LLM 调用结束后的完整思维链（不含正文） */
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

  return `你是创作节点路由器。只根据「设计.创作流程」DAG 选择下一个创作节点。

1. 用 read_blackboard 读取「设计.创作流程」及其进度 tag。
2. 没有 DAG 或 DAG 需要追加节点时，run_worker(design-flow)。
3. DAG 已给出下一个可执行节点时，run_worker(design-step)。
4. 不创作正文，不改写 DAG，不处理运行状态或游玩流程。

当前 skill 可用 worker：
${workerLines}

选定节点后立即调用 run_worker。`;
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

function emitThinkingDone(handlers: ToolLoopHandlers, reasoning?: string): void {
  const text = reasoning?.trim() ?? "";
  if (text) handlers.onThinkingDone?.(text);
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
  };

  for (let iteration = 1; iteration <= MAX_TOOL_LOOP_ITERATIONS; iteration++) {
    debugLog("llm", `总管循环 第${iteration}轮`);
    const result = await completeToolsPreferStream(llm, messages, streamCallbacks);
    emitThinkingDone(handlers, result.reasoning);

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
