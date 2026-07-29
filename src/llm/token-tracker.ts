import type {
  CompleteOptions,
  CompleteResult,
  CompleteWithToolsOptions,
  CompleteWithToolsResult,
  LlmProvider,
  StreamCallbacks,
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
  messages: Array<{ role: string; content: string }>,
  caller: string | undefined,
  model?: string,
): void {
  ctx.pendingContextTrace = buildContextTrace({
    caller: caller ?? "unknown",
    messages,
    model,
  });
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
    const result = await this.inner.complete(messages, options);
    const ctx = this.getContext();
    capturePendingTrace(ctx, messages, options?.caller, result.model);
    if (result.usage) {
      const record = recordTokenUsage({
        sessionId: ctx.sessionId,
        bookId: ctx.bookId,
        bookTitle: ctx.bookTitle,
        orchestratorId: ctx.orchestratorId,
        caller: options?.caller ?? "unknown",
        model: result.model ?? "unknown",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        cachedTokens: result.usage.cachedTokens,
        cacheMissTokens: result.usage.cacheMissTokens,
      });
      ctx.pendingUsage = toMessageTokenUsage(record);
    }
    if (result.reasoning?.trim()) {
      ctx.pendingReasoning = result.reasoning.trim();
    }
    return result;
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
    let reasoningBuf = "";
    const result = await inner.completeStream(messages, options, {
      onReasoningDelta: (delta) => {
        reasoningBuf += delta;
        const ctx = this.getContext();
        ctx.pendingReasoning = reasoningBuf;
        callbacks.onReasoningDelta?.(delta);
      },
      onContentDelta: callbacks.onContentDelta,
    });
    const ctx = this.getContext();
    capturePendingTrace(ctx, messages, options?.caller, result.model);
    if (result.usage) {
      const record = recordTokenUsage({
        sessionId: ctx.sessionId,
        bookId: ctx.bookId,
        bookTitle: ctx.bookTitle,
        orchestratorId: ctx.orchestratorId,
        caller: options?.caller ?? "unknown",
        model: result.model ?? "unknown",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        cachedTokens: result.usage.cachedTokens,
        cacheMissTokens: result.usage.cacheMissTokens,
      });
      ctx.pendingUsage = toMessageTokenUsage(record);
    }
    if (result.reasoning?.trim()) {
      ctx.pendingReasoning = result.reasoning.trim();
    }
    return result;
  }

  async completeWithTools(
    messages: Parameters<LlmProvider["completeWithTools"]>[0],
    options: CompleteWithToolsOptions,
  ): Promise<CompleteWithToolsResult> {
    const result = await this.inner.completeWithTools(messages, options);
    const ctx = this.getContext();
    capturePendingTrace(ctx, messages, options.caller, result.model);
    if (result.usage) {
      const record = recordTokenUsage({
        sessionId: ctx.sessionId,
        bookId: ctx.bookId,
        bookTitle: ctx.bookTitle,
        orchestratorId: ctx.orchestratorId,
        caller: options.caller ?? "unknown",
        model: result.model ?? "unknown",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        cachedTokens: result.usage.cachedTokens,
        cacheMissTokens: result.usage.cacheMissTokens,
      });
      ctx.pendingUsage = toMessageTokenUsage(record);
    }
    if (result.reasoning?.trim()) {
      ctx.pendingReasoning = result.reasoning.trim();
    }
    return result;
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
    let reasoningBuf = "";
    const result = await inner.completeWithToolsStream(messages, options, {
      onReasoningDelta: (delta) => {
        reasoningBuf += delta;
        const ctx = this.getContext();
        ctx.pendingReasoning = reasoningBuf;
        callbacks.onReasoningDelta?.(delta);
      },
      onContentDelta: callbacks.onContentDelta,
    });
    const ctx = this.getContext();
    capturePendingTrace(ctx, messages, options.caller, result.model);
    if (result.usage) {
      const record = recordTokenUsage({
        sessionId: ctx.sessionId,
        bookId: ctx.bookId,
        bookTitle: ctx.bookTitle,
        orchestratorId: ctx.orchestratorId,
        caller: options.caller ?? "unknown",
        model: result.model ?? "unknown",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        cachedTokens: result.usage.cachedTokens,
        cacheMissTokens: result.usage.cacheMissTokens,
      });
      ctx.pendingUsage = toMessageTokenUsage(record);
    }
    if (result.reasoning?.trim()) {
      ctx.pendingReasoning = result.reasoning.trim();
    }
    return result;
  }
}
