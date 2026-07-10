import type { ChatMessage, LlmProvider, ParsedToolCall } from "../llm/client.js";
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

规则：
1. 你不能直接生成小说/文章正文。
2. 你不能修改运行状态。
3. 先用 read_blackboard / list_workers / list_artifacts 收集信息，再决定下一步。
4. 终止动作只能用 tool：ask_user、run_worker、review_blackboard、finish。
5. run_worker 只传 workerId；inputTags/outputTags 由 Runtime 从 Worker Skill 读取。
6. requiresApproval=true 时 run_worker 需用户确认后再执行。
7. run_worker 可选 roleId，用于 role-decide 等指定当前决策角色。
8. 不能把未验收产物当作已定事实。

当前 skill 可用 worker：
${workerLines}

在信息足够前可多次调用 read_blackboard 等；一旦调用终止 tool，本轮循环结束。`;
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

  for (let iteration = 1; iteration <= MAX_TOOL_LOOP_ITERATIONS; iteration++) {
    const result = await llm.completeWithTools(messages, {
      tools: MAIN_AGENT_TOOL_DEFINITIONS,
      caller: "main_agent",
    });

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
