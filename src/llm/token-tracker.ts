import type {
  CompleteOptions,
  CompleteResult,
  CompleteWithToolsOptions,
  CompleteWithToolsResult,
  LlmProvider,
  StreamCallbacks,
  TokenUsage,
  ToolDefinition,
  UsageDetail,
  UsageSink,
} from "./client.js";
import {
  outlineRequest,
  type ContextSegment,
  type RequestOutline,
} from "./context-outline.js";
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
  /** 本条回复之前的各次请求轮廓；查看时选题和填写都在 */
  pendingOutlines?: RequestOutline[];
  lastSegments?: ContextSegment[];
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
  tools?: ToolDefinition[],
): void {
  const segments = outlineRequest(messages, tools);
  ctx.lastSegments = segments;
  ctx.pendingContextTrace = buildContextTrace({
    caller: caller ?? "unknown",
    messages,
    model,
    generation,
    segments,
  });
}

function recordUsage(
  ctx: LlmTrackingContext,
  caller: string | undefined,
  model: string | undefined,
  usage: TokenUsage | undefined,
  meta?: { detail?: UsageDetail; latencyMs?: number; sink?: UsageSink },
): void {
  const segments = ctx.lastSegments;
  ctx.lastSegments = undefined;
  const detail = meta?.detail;
  const record = usage
    ? recordTokenUsage({
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
    cacheWriteTokens: usage.cacheWriteTokens,
    turnId: detail?.turnId,
    step: detail?.step,
    retryIndex: detail?.retryIndex,
    segmentChars: detail?.segmentChars,
    plannedTags: detail?.plannedTags,
    succeededTags: detail?.succeededTags,
    failedTags: detail?.failedTags,
    finish: detail?.finish,
    latencyMs: meta?.latencyMs,
    segments,
  })
    : undefined;
  if (record && meta?.sink) meta.sink.recordId = record.id;
  if (record) ctx.pendingUsage = toMessageTokenUsage(record);
  if (!segments?.length && !record) return;
  const outline: RequestOutline = {
    at: record?.at ?? new Date().toISOString(),
    caller: record?.caller ?? caller ?? "unknown",
    step: detail?.step,
    turnId: detail?.turnId,
    model: record?.model ?? model,
    promptTokens: record?.promptTokens,
    completionTokens: record?.completionTokens,
    cachedTokens: record?.cachedTokens,
    cacheMissTokens: record?.cacheMissTokens,
    cacheWriteTokens: record?.cacheWriteTokens,
    segments: segments ?? [],
  };
  ctx.pendingOutlines = [...(ctx.pendingOutlines ?? []), outline];
}

export class TokenTrackingProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly getContext: () => LlmTrackingContext,
  ) {}

  /** 调用方未指定时，用本局会话 id，供 OpenRouter 粘滞路由。 */
  private withSession<T extends CompleteOptions>(options?: T): T {
    const sessionId = this.getContext().sessionId?.trim();
    if (!sessionId) return (options ?? {}) as T;
    if (options?.sessionId?.trim()) return options;
    return { ...options, sessionId } as T;
  }

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
        const started = Date.now();
        const result = await this.inner.complete(messages, this.withSession(options));
        const ctx = this.getContext();
        capturePendingTrace(
          ctx,
          messages,
          options?.caller,
          result.model,
          options?.generation,
        );
        recordUsage(ctx, options?.caller, result.model, result.usage, {
          detail: options?.usageDetail,
          latencyMs: Date.now() - started,
          sink: options?.usageSink,
        });
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
        const started = Date.now();
        const result = await inner.completeStream!(messages, this.withSession(options), {
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
        recordUsage(ctx, options?.caller, result.model, result.usage, {
          detail: options?.usageDetail,
          latencyMs: Date.now() - started,
          sink: options?.usageSink,
        });
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
        const started = Date.now();
        const result = await this.inner.completeWithTools(
          messages,
          this.withSession(options),
        );
        const ctx = this.getContext();
        capturePendingTrace(
          ctx,
          messages,
          options.caller,
          result.model,
          options.generation,
          options.tools,
        );
        recordUsage(ctx, options.caller, result.model, result.usage, {
          detail: options.usageDetail,
          latencyMs: Date.now() - started,
          sink: options.usageSink,
        });
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
        const started = Date.now();
        const result = await inner.completeWithToolsStream!(
          messages,
          this.withSession(options),
          {
            onReasoningDelta: (delta) => {
              reasoningBuf += delta;
              const ctx = this.getContext();
              ctx.pendingReasoning = reasoningBuf;
              callbacks.onReasoningDelta?.(delta);
            },
            onContentDelta: callbacks.onContentDelta,
          },
        );
        const ctx = this.getContext();
        capturePendingTrace(
          ctx,
          messages,
          options.caller,
          result.model,
          options.generation,
          options.tools,
        );
        recordUsage(ctx, options.caller, result.model, result.usage, {
          detail: options.usageDetail,
          latencyMs: Date.now() - started,
          sink: options.usageSink,
        });
        if (result.reasoning?.trim()) {
          ctx.pendingReasoning = result.reasoning.trim();
        }
        return result;
      },
    );
  }
}
