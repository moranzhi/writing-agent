import type {
  CompleteOptions,
  CompleteResult,
  CompleteWithToolsOptions,
  CompleteWithToolsResult,
  LlmProvider,
} from "./client.js";
import {
  recordTokenUsage,
  toMessageTokenUsage,
  type MessageTokenUsage,
} from "../stats/token-store.js";

export type LlmTrackingContext = {
  sessionId?: string;
  bookId?: string;
  bookTitle?: string;
  orchestratorId?: string;
  /** Set after each LLM call; consumed when the next system chat message is created */
  pendingUsage?: MessageTokenUsage;
  pendingReasoning?: string;
};

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
