import type { LlmProvider, ParsedToolCall } from "../llm/client.js";
import { toolCallToDecision, validateLoopToolCall } from "../runtime/tool-registry.js";
import {
  createLocalLlmDriver,
  type AgentDriver,
  type DriverToolCall,
} from "../runtime/driver.js";
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
  /** 一轮 LLM 调用结束后的完整思维链（不含正文） */
  onThinkingDone?: (text: string) => void;
};

export type ToolLoopResult = {
  decision: MainAgentDecision;
  iterations: number;
  toolTrace: string[];
};

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

function executeLoopTool(
  call: DriverToolCall | ParsedToolCall,
  handlers: ToolLoopHandlers,
): string {
  const name = validateLoopToolCall({
    id: call.id,
    name: call.name,
    arguments: call.arguments,
  });
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

/**
 * 总管 tool loop：在 running 相位内可多轮调用 read_blackboard 等，
 * 直到调用终止 tool 并返回 MainAgentDecision。
 *
 * 循环本身交给 {@link AgentDriver}；本函数只解释总管 tool 语义。
 */
export async function runMainAgentToolLoop(
  llm: LlmProvider,
  context: MainAgentContext,
  handlers: ToolLoopHandlers,
  driver: AgentDriver = createLocalLlmDriver(llm),
): Promise<ToolLoopResult> {
  const toolTrace: string[] = [];

  const run = await driver.run({
    system: buildToolLoopSystemPrompt(context.availableWorkers),
    messages: [{ role: "user", content: buildMainAgentUserPrompt(context) }],
    tools: MAIN_AGENT_TOOL_DEFINITIONS,
    caller: "main_agent",
    label: "总管循环",
    onThinkingDelta: (delta) => handlers.onThinkingDelta?.(delta),
    onThinkingDone: (text) => handlers.onThinkingDone?.(text),
    handleStep: (calls) => {
      const terminalCalls = calls.filter((tc) => isMainAgentTerminalTool(tc.name));
      const loopCalls = calls.filter((tc) => !isMainAgentTerminalTool(tc.name));

      if (terminalCalls.length > 1) {
        throw new Error(
          `Main Agent returned multiple terminal tools: ${terminalCalls.map((t) => t.name).join(", ")}`,
        );
      }

      if (terminalCalls.length === 1) {
        const terminal = terminalCalls[0];
        handlers.onToolCall?.(terminal.name, terminal.arguments);
        toolTrace.push(`${terminal.name} (terminal)`);
        return { kind: "conclude" as const, call: terminal };
      }

      const results = loopCalls.map((call) => {
        const output = executeLoopTool(call, handlers);
        handlers.onToolCall?.(call.name, output.slice(0, 200));
        toolTrace.push(call.name);
        return { callId: call.id, content: output };
      });
      return { kind: "continue" as const, results };
    },
  });

  if (run.stop.kind === "text") {
    return {
      decision: parseMainAgentDecision(run.stop.content),
      iterations: run.iterations,
      toolTrace,
    };
  }

  return {
    decision: toolCallToDecision(run.stop.call),
    iterations: run.iterations,
    toolTrace,
  };
}
