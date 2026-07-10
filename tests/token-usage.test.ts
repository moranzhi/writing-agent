import { describe, expect, it } from "vitest";
import { parseUsage } from "../src/llm/client.js";
import {
  recordTokenUsage,
  summarizeTokenUsage,
} from "../src/stats/token-store.js";
import { TokenTrackingProvider, type LlmTrackingContext } from "../src/llm/token-tracker.js";
import type { CompleteResult, LlmProvider } from "../src/llm/client.js";

describe("parseUsage", () => {
  it("parses standard OpenAI usage", () => {
    const usage = parseUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
    expect(usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
  });

  it("parses OpenAI cached_tokens via prompt_tokens_details", () => {
    const usage = parseUsage({
      prompt_tokens: 1000,
      completion_tokens: 20,
      total_tokens: 1020,
      prompt_tokens_details: { cached_tokens: 800 },
    });
    expect(usage?.cachedTokens).toBe(800);
    expect(usage?.cacheMissTokens).toBeUndefined();
  });

  it("parses DeepSeek cache hit and miss fields", () => {
    const usage = parseUsage({
      prompt_tokens: 500,
      completion_tokens: 30,
      total_tokens: 530,
      prompt_cache_hit_tokens: 400,
      prompt_cache_miss_tokens: 100,
    });
    expect(usage?.cachedTokens).toBe(400);
    expect(usage?.cacheMissTokens).toBe(100);
  });

  it("returns undefined for empty usage", () => {
    expect(parseUsage(null)).toBeUndefined();
    expect(parseUsage({})).toBeUndefined();
  });
});

describe("TokenTrackingProvider", () => {
  it("stores pending usage with cache fields on context", async () => {
    const inner: LlmProvider = {
      async complete(): Promise<CompleteResult> {
        return {
          content: "ok",
          model: "test-model",
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
            cachedTokens: 8,
            cacheMissTokens: 2,
          },
        };
      },
    };

    const ctx: LlmTrackingContext = { sessionId: "sess-1" };
    const provider = new TokenTrackingProvider(inner, () => ctx);
    await provider.complete([], { caller: "worker:write-rules" });

    expect(ctx.pendingUsage).toMatchObject({
      totalTokens: 15,
      cachedTokens: 8,
      cacheMissTokens: 2,
      caller: "worker:write-rules",
      model: "test-model",
    });
    expect(ctx.pendingUsage?.recordId).toBeTruthy();
  });

  it("stores pending reasoning when usage is absent", async () => {
    const inner: LlmProvider = {
      async complete(): Promise<CompleteResult> {
        return {
          content: "ok",
          model: "test-model",
          reasoning: " chain of thought ",
        };
      },
    };

    const ctx: LlmTrackingContext = { sessionId: "sess-2" };
    const provider = new TokenTrackingProvider(inner, () => ctx);
    await provider.complete([], { caller: "worker:test" });

    expect(ctx.pendingUsage).toBeUndefined();
    expect(ctx.pendingReasoning).toBe("chain of thought");
  });
});

describe("summarizeTokenUsage", () => {
  it("aggregates cache totals in byCallerDetailed", () => {
    const sessionId = `test-${Date.now()}`;
    recordTokenUsage({
      sessionId,
      caller: "main_agent",
      model: "m",
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      cachedTokens: 50,
    });
    recordTokenUsage({
      sessionId,
      caller: "worker:write-rules",
      model: "m",
      promptTokens: 200,
      completionTokens: 20,
      totalTokens: 220,
      cachedTokens: 100,
      cacheMissTokens: 100,
    });

    const updated = summarizeTokenUsage({ sessionId, limit: 10 });
    expect(updated.totalCalls).toBe(2);
    expect(updated.totalCached).toBe(150);
    expect(updated.totalCacheMiss).toBe(100);
    expect(updated.byCallerDetailed["main_agent"]).toMatchObject({
      totalTokens: 110,
      cachedTokens: 50,
      calls: 1,
    });
    expect(updated.byCallerDetailed["worker:write-rules"]).toMatchObject({
      totalTokens: 220,
      cachedTokens: 100,
      cacheMissTokens: 100,
      calls: 1,
    });
  });
});
