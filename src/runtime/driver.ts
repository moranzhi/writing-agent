/**
 * 可替换的 agent 司机：问模型 → 有 tool-call 则交给调用方处理 → 再问，直到不再欠请求。
 *
 * 相位机、黑板、规格不走这里。换 dsh / 其它 harness 时只换 {@link AgentDriver} 实现。
 *
 * @module runtime/driver
 */

import type {
  ChatMessage,
  CompleteWithToolsResult,
  LlmProvider,
  StreamCallbacks,
  ToolDefinition,
} from "../llm/client.js";
import { supportsToolStream } from "../llm/stream-complete.js";
import { debugLog } from "../log.js";

export type DriverToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/** 一步里所有 tool-call 的处理结果：继续把结果写回，或本步结账停循环。 */
export type DriverStepOutcome =
  | { kind: "continue"; results: Array<{ callId: string; content: string }> }
  | { kind: "conclude"; call: DriverToolCall };

export type DriverRunInput = {
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  caller?: string;
  /** 日志用短名，如「总管循环」 */
  label?: string;
  maxIterations?: number;
  onThinkingDelta?: (delta: string) => void;
  onThinkingDone?: (text: string) => void;
  onOutputDelta?: (delta: string) => void;
  handleStep: (
    calls: DriverToolCall[],
  ) => DriverStepOutcome | Promise<DriverStepOutcome>;
};

export type DriverStop =
  | { kind: "text"; content: string }
  | { kind: "conclude"; call: DriverToolCall };

export type DriverRunResult = {
  iterations: number;
  stop: DriverStop;
};

/** 司机：直到模型不再欠一次请求。 */
export type AgentDriver = {
  run(input: DriverRunInput): Promise<DriverRunResult>;
};

export const DEFAULT_DRIVER_MAX_ITERATIONS = 12;

function assistantMessageFromToolCalls(
  content: string | null,
  toolCalls: DriverToolCall[],
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

function emitThinkingDone(
  input: DriverRunInput,
  reasoning?: string,
): void {
  const text = reasoning?.trim() ?? "";
  if (text) input.onThinkingDone?.(text);
}

async function completeToolsPreferStream(
  llm: LlmProvider,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  caller: string | undefined,
  callbacks: StreamCallbacks,
): Promise<CompleteWithToolsResult> {
  const options = { tools, caller };
  if (supportsToolStream(llm)) {
    return llm.completeWithToolsStream!(messages, options, callbacks);
  }
  const result = await llm.completeWithTools(messages, options);
  if (result.reasoning) callbacks.onReasoningDelta?.(result.reasoning);
  if (result.content) callbacks.onContentDelta?.(result.content);
  return result;
}

/** 现有 OpenAI 兼容 provider 上的司机，行为对齐旧 tool-loop。 */
export function createLocalLlmDriver(llm: LlmProvider): AgentDriver {
  return {
    async run(input: DriverRunInput): Promise<DriverRunResult> {
      const maxIterations = input.maxIterations ?? DEFAULT_DRIVER_MAX_ITERATIONS;
      const messages: ChatMessage[] = [
        { role: "system", content: input.system },
        ...input.messages,
      ];
      const streamCallbacks: StreamCallbacks = {
        onReasoningDelta: (delta) => input.onThinkingDelta?.(delta),
        onContentDelta: (delta) => input.onOutputDelta?.(delta),
      };
      const label = input.label ?? "driver";

      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        debugLog("llm", `${label} 第${iteration}轮`);
        const result = await completeToolsPreferStream(
          llm,
          messages,
          input.tools,
          input.caller,
          streamCallbacks,
        );
        emitThinkingDone(input, result.reasoning);

        if (result.toolCalls.length === 0) {
          const content = result.content?.trim() ?? "";
          if (content) {
            return { iterations: iteration, stop: { kind: "text", content } };
          }
          throw new Error("Driver returned no tool calls and no content");
        }

        const calls: DriverToolCall[] = result.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        }));
        messages.push(assistantMessageFromToolCalls(result.content, calls));

        const outcome = await input.handleStep(calls);
        if (outcome.kind === "conclude") {
          return {
            iterations: iteration,
            stop: { kind: "conclude", call: outcome.call },
          };
        }

        for (const item of outcome.results) {
          messages.push({
            role: "tool",
            content: item.content,
            tool_call_id: item.callId,
          });
        }
      }

      throw new Error(`Driver exceeded ${maxIterations} iterations`);
    },
  };
}
