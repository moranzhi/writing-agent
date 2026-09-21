/**
 * 模型请求日志：发送一行、完成/中断/失败一行。
 * 只写任务骨架（轮次、待消化什么、可调工具、上下文体积），不写正文。
 */
import type {
  ChatMessage,
  CompleteResult,
  CompleteWithToolsResult,
  ToolDefinition,
} from "./client.js";
import { isAbortError } from "./run-abort.js";
import { debugLog, labelCaller, labelLlmMode, labelTool } from "../log.js";

export type LlmRequestLogInput = {
  kind: string;
  caller?: string;
  label?: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
};

function requestTitle(caller: string | undefined, label: string | undefined): string {
  const task = label?.trim();
  const who = labelCaller(caller);
  if (task && (task === who || task.startsWith(`${who} `) || task.startsWith(`${who}·`))) {
    return task;
  }
  if (task) return `${who} · ${task}`;
  return who;
}

function countRoles(messages: ChatMessage[]): string {
  const n = { system: 0, user: 0, assistant: 0, tool: 0 };
  for (const m of messages) {
    if (m.role === "system") n.system += 1;
    else if (m.role === "user") n.user += 1;
    else if (m.role === "assistant") n.assistant += 1;
    else if (m.role === "tool") n.tool += 1;
  }
  const bits = [
    n.system ? `系统${n.system}` : "",
    n.user ? `用户${n.user}` : "",
    n.assistant ? `助手${n.assistant}` : "",
    n.tool ? `工具${n.tool}` : "",
  ].filter(Boolean);
  return bits.length ? `条=${bits.join("+")}` : "条=0";
}

function messageChars(m: ChatMessage): number {
  let n = typeof m.content === "string" ? m.content.length : 0;
  if (m.role === "assistant" && m.tool_calls) {
    for (const tc of m.tool_calls) {
      n += (tc.function?.name?.length ?? 0) + (tc.function?.arguments?.length ?? 0);
    }
  }
  return n;
}

function formatContextSize(messages: ChatMessage[]): string {
  const n = messages.reduce((sum, m) => sum + messageChars(m), 0);
  if (n >= 10_000) {
    const wan = n / 10_000;
    const text = wan >= 10 ? String(Math.round(wan)) : wan.toFixed(1).replace(/\.0$/, "");
    return `上下文≈${text}万字`;
  }
  return `上下文=${n}字`;
}

function nearestAssistantToolNames(messages: ChatMessage[]): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.tool_calls?.length) {
      return m.tool_calls.map((tc) => tc.function.name);
    }
  }
  return [];
}

/** 这次请求在等什么：用户话、工具结果、还是空上下文。不含正文。 */
export function describeRequestAwaiting(messages: ChatMessage[]): string {
  if (!messages.length) return "空上下文";
  const last = messages[messages.length - 1];
  if (last.role === "user") return "待答用户";
  if (last.role === "tool") {
    const names = nearestAssistantToolNames(messages);
    return names.length
      ? `待消化 ${names.map((n) => labelTool(n)).join("、")}`
      : "待消化工具";
  }
  if (last.role === "assistant") {
    const names =
      last.tool_calls?.map((tc) => tc.function.name) ?? [];
    return names.length
      ? `续轮 ${names.map((n) => labelTool(n)).join("、")}`
      : "待续助手";
  }
  if (last.role === "system") return "仅系统";
  return last.role;
}

function formatAvailableTools(tools: ToolDefinition[] | undefined): string {
  if (!tools?.length) return "";
  const names = tools.map((t) => labelTool(t.function.name));
  if (names.length <= 6) return `可调 ${names.join("、")}`;
  return `可调 ${names.slice(0, 5).join("、")} 等${names.length}个`;
}

export function formatLlmSendLine(input: LlmRequestLogInput): string {
  const title = requestTitle(input.caller, input.label);
  const mode = labelLlmMode(input.kind);
  const bits = [
    `发送 ${title} · ${mode}`,
    describeRequestAwaiting(input.messages),
    countRoles(input.messages),
    formatAvailableTools(input.tools),
    formatContextSize(input.messages),
  ];
  return bits.filter(Boolean).join("  ");
}

function formatUsage(usage: CompleteResult["usage"]): string {
  if (!usage) return "";
  const cache =
    usage.cachedTokens != null && usage.cachedTokens > 0
      ? ` 缓存=${usage.cachedTokens}`
      : "";
  return `用量=${usage.promptTokens}+${usage.completionTokens}${cache}`;
}

export function formatLlmFinishLine(
  input: LlmRequestLogInput,
  elapsedMs: number,
  result: CompleteResult | CompleteWithToolsResult,
): string {
  const title = requestTitle(input.caller, input.label);
  const mode = labelLlmMode(input.kind);
  const toolCalls =
    "toolCalls" in result
      ? result.toolCalls.map((t) => labelTool(t.name)).join("、") || "无"
      : undefined;
  const bits = [
    `完成 ${title} · ${mode}`,
    `${elapsedMs}毫秒`,
    result.model ? `模型=${result.model}` : "",
    `思维链=${result.reasoning?.trim().length ?? 0}字`,
    `正文=${result.content?.length ?? 0}字`,
    toolCalls != null ? `调用=${toolCalls}` : "",
    formatUsage(result.usage),
  ];
  return bits.filter(Boolean).join("  ");
}

export function formatLlmAbortLine(
  input: Pick<LlmRequestLogInput, "kind" | "caller" | "label">,
  elapsedMs: number,
): string {
  const title = requestTitle(input.caller, input.label);
  const mode = labelLlmMode(input.kind);
  return `中断 ${title} · ${mode}  ${elapsedMs}毫秒`;
}

export function formatLlmFailLine(
  input: Pick<LlmRequestLogInput, "kind" | "caller" | "label">,
  elapsedMs: number,
  err: unknown,
): string {
  const title = requestTitle(input.caller, input.label);
  const mode = labelLlmMode(input.kind);
  const detail = err instanceof Error ? err.message : String(err);
  return `失败 ${title} · ${mode}  ${elapsedMs}毫秒  ${detail.slice(0, 160)}`;
}

export async function loggedLlmRequest<
  T extends CompleteResult | CompleteWithToolsResult,
>(input: LlmRequestLogInput, run: () => Promise<T>): Promise<T> {
  debugLog("llm", formatLlmSendLine(input));
  const t0 = Date.now();
  try {
    const result = await run();
    debugLog("llm", formatLlmFinishLine(input, Date.now() - t0, result));
    return result;
  } catch (err) {
    const elapsed = Date.now() - t0;
    if (isAbortError(err)) {
      debugLog("llm", formatLlmAbortLine(input, elapsed));
    } else {
      debugLog("llm", formatLlmFailLine(input, elapsed, err));
    }
    throw err;
  }
}
