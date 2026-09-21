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
import { loggedLlmRequest } from "./request-log.js";

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

export class TokenTrackingProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly getContext: () => LlmTrackingContext,
  ) {}

  async complete(
    messages: Parameters<LlmProvider["complete"]>[0],
    options?: CompleteOptions,
  ): Promise<CompleteResult> {
    return loggedLlmRequest(
      {
        kind: "complete",
        caller: options?.caller,
        label: options?.label,
        messages,
      },
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
    return loggedLlmRequest(
      {
        kind: "stream",
        caller: options?.caller,
        label: options?.label,
        messages,
      },
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
    );
  }

  async completeWithTools(
    messages: Parameters<LlmProvider["completeWithTools"]>[0],
    options: CompleteWithToolsOptions,
  ): Promise<CompleteWithToolsResult> {
    return loggedLlmRequest(
      {
        kind: "tools",
        caller: options.caller,
        label: options.label,
        messages,
        tools: options.tools,
      },
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
    return loggedLlmRequest(
      {
        kind: "tools-stream",
        caller: options.caller,
        label: options.label,
        messages,
        tools: options.tools,
      },
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
    );
  }
}
