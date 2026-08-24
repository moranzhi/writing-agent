/**
 * 主世界层（world-simulator）游玩期 tool harness：
 * 反复 completeWithTools 直到不再调用工具，最后一次正文视为裁决 JSON。
 */
import type { ChatMessage, LlmProvider } from "../llm/client.js";
import {
  createLocalLlmDriver,
  type DriverToolCall,
} from "../runtime/driver.js";
import {
  GM_CHANCE_TOOL_NAME,
  GM_TOOL_DEFINITIONS,
  handleGmToolCall,
} from "../skills/gm-tools.js";

export type GmHarnessStreamCallbacks = {
  onThinkingDelta?: (delta: string) => void;
  onOutputDelta?: (delta: string) => void;
};

export const DEFAULT_GM_HARNESS_MAX_ITERATIONS = 6;

export type GmHarnessParams = {
  llm: LlmProvider;
  system: string;
  messages: ChatMessage[];
  stream?: GmHarnessStreamCallbacks;
  maxIterations?: number;
  caller?: string;
};

export type GmHarnessResult = {
  content: string;
  iterations: number;
};

export async function runGmHarness(
  params: GmHarnessParams,
): Promise<GmHarnessResult> {
  const driver = createLocalLlmDriver(params.llm);
  const label = "主世界层 harness";

  const result = await driver.run({
    system: params.system,
    messages: params.messages,
    tools: GM_TOOL_DEFINITIONS,
    caller: params.caller ?? "worker:world-simulator",
    label,
    maxIterations: params.maxIterations ?? DEFAULT_GM_HARNESS_MAX_ITERATIONS,
    onThinkingDelta: (delta) => params.stream?.onThinkingDelta?.(delta),
    onOutputDelta: (delta) => params.stream?.onOutputDelta?.(delta),
    onThinkingDone: () => {
      /* 思维链由 stream 增量展示 */
    },
    handleStep: (calls: DriverToolCall[]) => {
      const results: Array<{ callId: string; content: string }> = [];
      for (const call of calls) {
        if (call.name !== GM_CHANCE_TOOL_NAME) {
          results.push({
            callId: call.id,
            content: JSON.stringify({
              ok: false,
              error: `不允许的工具：${call.name}`,
            }),
          });
          continue;
        }
        const content =
          handleGmToolCall(call.name, call.arguments) ??
          JSON.stringify({ ok: false, error: "未知工具" });
        results.push({ callId: call.id, content });
      }
      return { kind: "continue", results };
    },
  });

  if (result.stop.kind === "text") {
    return { content: result.stop.content, iterations: result.iterations };
  }

  throw new Error(
    `${label} 以边界 tool 结束（${result.stop.call.name}），主世界层仅允许 ${GM_CHANCE_TOOL_NAME}`,
  );
}
