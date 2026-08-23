import type {
  CompleteOptions,
  CompleteResult,
  CompleteWithToolsOptions,
  CompleteWithToolsResult,
  LlmProvider,
  StreamCallbacks,
  TokenUsage,
} from "./client.js";
import {
  recordTokenUsage,
  toMessageTokenUsage,
  type MessageTokenUsage,
} from "../stats/token-store.js";
import {
  buildContextTrace,
  type LlmContextTrace,
} from "../types/context-trace.js";
import { debugLog, labelCaller, labelLlmMode, labelTool } from "../log.js";

export type LlmTrackingContext = {
  sessionId?: string;
  bookId?: string;
  bookTitle?: string;
  orchestratorId?: string;
  /** Set after each LLM call; consumed when the next system chat message is created */
  pendingUsage?: MessageTokenUsage;
  pendingReasoning?: string;
  /** 全量请求上下文；挂到下一条「结果向」系统消息 */
  pendingContextTrace?: LlmContextTrace;
};

function capturePendingTrace(
  ctx: LlmTrackingContext,
  messages: Array<{
    role: string;
    content?: string | null;
    tool_calls?: unknown;
    tool_call_id?: string;
  }>,
  caller: string | undefined,
  model?: string,
  generation?: CompleteOptions["generation"],
): void {
  ctx.pendingContextTrace = buildContextTrace({
    caller: caller ?? "unknown",
    messages,
    model,
    generation,
  });
}

function recordUsage(
  ctx: LlmTrackingContext,
  caller: string | undefined,
  model: string | undefined,
  usage: TokenUsage | undefined,
): void {
  if (!usage) return;
  const record = recordTokenUsage({
    sessionId: ctx.sessionId,
    bookId: ctx.bookId,
    bookTitle: ctx.bookTitle,
    orchestratorId: ctx.orchestratorId,
    caller: caller ?? "unknown",
    model: model ?? "unknown",
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cachedTokens: usage.cachedTokens,
    cacheMissTokens: usage.cacheMissTokens,
  });
  ctx.pendingUsage = toMessageTokenUsage(record);
}

function summarizeComplete(result: CompleteResult): string {
  const bits = [
    result.model ? `模型=${result.model}` : "",
    `思维链=${result.reasoning?.trim().length ?? 0}字`,
    `正文=${result.content?.length ?? 0}字`,
  ];
  if (result.usage) {
    bits.push(`用量=${result.usage.promptTokens}+${result.usage.completionTokens}`);
  }
  return bits.filter(Boolean).join(" ");
}

function summarizeTools(result: CompleteWithToolsResult): string {
  const tools =
    result.toolCalls.map((t) => labelTool(t.name)).join("、") || "无";
  const bits = [
    result.model ? `模型=${result.model}` : "",
    `思维链=${result.reasoning?.trim().length ?? 0}字`,
    `正文=${result.content?.length ?? 0}字`,
    `工具=${tools}`,
  ];
  if (result.usage) {
    bits.push(`用量=${result.usage.promptTokens}+${result.usage.completionTokens}`);
  }
  return bits.filter(Boolean).join(" ");
}

async function loggedLlm<T>(
  kind: string,
  caller: string | undefined,
  run: () => Promise<T>,
  summarize: (result: T) => string,
): Promise<T> {
  const who = labelCaller(caller);
  const mode = labelLlmMode(kind);
  const t0 = Date.now();
  debugLog("llm", `开始 ${who} · ${mode}`);
  try {
    const result = await run();
    debugLog("llm", `结束 ${who} · ${mode} ${Date.now() - t0}毫秒 ${summarize(result)}`);
    return result;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    debugLog("llm", `失败 ${who} · ${mode} ${Date.now() - t0}毫秒 ${detail.slice(0, 160)}`);
    throw err;
  }
}

export class TokenTrackingProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly getContext: () => LlmTrackingContext,
  ) {}

  async complete(
    messages: Parameters<LlmProvider["complete"]>[0],
    options?: CompleteOptions,
  ): Promise<CompleteResult> {
    return loggedLlm(
      "complete",
      options?.caller,
      async () => {
        const result = await this.inner.complete(messages, options);
        const ctx = this.getContext();
        capturePendingTrace(
          ctx,
          messages,
          options?.caller,
          result.model,
          options?.generation,
        );
        recordUsage(ctx, options?.caller, result.model, result.usage);
        if (result.reasoning?.trim()) {
          ctx.pendingReasoning = result.reasoning.trim();
        }
        return result;
      },
      summarizeComplete,
    );
  }

  async completeStream(
    messages: Parameters<LlmProvider["complete"]>[0],
    options?: CompleteOptions,
    callbacks: StreamCallbacks = {},
  ): Promise<CompleteResult> {
    const inner = this.inner;
    if (!inner.completeStream) {
      const result = await this.complete(messages, options);
      if (result.reasoning) callbacks.onReasoningDelta?.(result.reasoning);
      if (result.content) callbacks.onContentDelta?.(result.content);
      return result;
    }
    return loggedLlm(
      "stream",
      options?.caller,
      async () => {
        let reasoningBuf = "";
        const result = await inner.completeStream!(messages, options, {
          onReasoningDelta: (delta) => {
            reasoningBuf += delta;
            const ctx = this.getContext();
            ctx.pendingReasoning = reasoningBuf;
            callbacks.onReasoningDelta?.(delta);
          },
          onContentDelta: callbacks.onContentDelta,
        });
        const ctx = this.getContext();
        capturePendingTrace(
          ctx,
          messages,
          options?.caller,
          result.model,
          options?.generation,
        );
        recordUsage(ctx, options?.caller, result.model, result.usage);
        if (result.reasoning?.trim()) {
          ctx.pendingReasoning = result.reasoning.trim();
        }
        return result;
      },
      summarizeComplete,
    );
  }

  async completeWithTools(
    messages: Parameters<LlmProvider["completeWithTools"]>[0],
    options: CompleteWithToolsOptions,
  ): Promise<CompleteWithToolsResult> {
    return loggedLlm(
      "tools",
      options.caller,
      async () => {
        const result = await this.inner.completeWithTools(messages, options);
        const ctx = this.getContext();
        capturePendingTrace(
          ctx,
          messages,
          options.caller,
          result.model,
          options.generation,
        );
        recordUsage(ctx, options.caller, result.model, result.usage);
        if (result.reasoning?.trim()) {
          ctx.pendingReasoning = result.reasoning.trim();
        }
        return result;
      },
      summarizeTools,
    );
  }

  async completeWithToolsStream(
    messages: Parameters<LlmProvider["completeWithTools"]>[0],
    options: CompleteWithToolsOptions,
    callbacks: StreamCallbacks,
  ): Promise<CompleteWithToolsResult> {
    const inner = this.inner;
    if (!inner.completeWithToolsStream) {
      return this.completeWithTools(messages, options);
    }
    return loggedLlm(
      "tools-stream",
      options.caller,
      async () => {
        let reasoningBuf = "";
        const result = await inner.completeWithToolsStream!(messages, options, {
          onReasoningDelta: (delta) => {
            reasoningBuf += delta;
            const ctx = this.getContext();
            ctx.pendingReasoning = reasoningBuf;
            callbacks.onReasoningDelta?.(delta);
          },
          onContentDelta: callbacks.onContentDelta,
        });
        const ctx = this.getContext();
        capturePendingTrace(
          ctx,
          messages,
          options.caller,
          result.model,
          options.generation,
        );
        recordUsage(ctx, options.caller, result.model, result.usage);
        if (result.reasoning?.trim()) {
          ctx.pendingReasoning = result.reasoning.trim();
        }
        return result;
      },
      summarizeTools,
    );
  }
}
