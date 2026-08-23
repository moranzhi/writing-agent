import { describe, expect, it } from "vitest";
import type {
  ChatMessage,
  CompleteResult,
  LlmProvider,
} from "../src/llm/client.js";
import { wrapLlmForSession } from "../src/llm/preset-wrapper.js";
import type { LlmTrackingContext } from "../src/llm/token-tracker.js";
import type { PresetPackage } from "../src/types/preset.js";

const samplePreset: PresetPackage = {
  id: "p1",
  name: "test-preset",
  source: "native",
  prompts: [
    {
      id: "sys",
      name: "系统",
      enabled: true,
      role: "system",
      content: "PRESET_RULES",
      marker: false,
      sourceIdentifier: "sys",
    },
  ],
  promptOrder: [{ promptId: "sys", enabled: true, orderIndex: 0 }],
  generation: { temperature: 0.91, maxOutputTokens: 1234 },
  unsupported: [],
  importedAt: "2026-01-01T00:00:00.000Z",
};

function recordingProvider(): {
  provider: LlmProvider;
  received: Array<{ messages: ChatMessage[]; generation?: unknown }>;
} {
  const received: Array<{ messages: ChatMessage[]; generation?: unknown }> = [];
  const provider: LlmProvider = {
    async complete(messages, options): Promise<CompleteResult> {
      received.push({ messages, generation: options?.generation });
      return { content: "ok", model: "rec-model" };
    },
    async completeStream(messages, options, callbacks) {
      received.push({ messages, generation: options?.generation });
      callbacks?.onContentDelta?.("ok");
      return { content: "ok", model: "rec-model" };
    },
    async completeWithTools(messages, options) {
      received.push({ messages, generation: options.generation });
      return { content: "ok", toolCalls: [], model: "rec-model" };
    },
  };
  return { provider, received };
}

describe("wrapLlmForSession", () => {
  it("context trace matches the exact messages and generation sent to the inner LLM", async () => {
    const { provider, received } = recordingProvider();
    const ctx: LlmTrackingContext = {};
    const llm = wrapLlmForSession(provider, { current: ctx }, () => samplePreset);

    await llm.complete(
      [{ role: "user", content: "TASK" }],
      { caller: "worker:design-step" },
    );

    expect(received).toHaveLength(1);
    expect(received[0].messages).toEqual([{ role: "user", content: "TASK" }]);
    expect(received[0].generation).toMatchObject({
      temperature: 0.91,
      maxOutputTokens: 1234,
    });
    expect(ctx.pendingContextTrace?.messages).toEqual([
      { role: "user", content: "TASK" },
    ]);
    expect(ctx.pendingContextTrace?.generation).toMatchObject({
      temperature: 0.91,
      maxOutputTokens: 1234,
    });
    expect(ctx.pendingContextTrace?.caller).toBe("worker:design-step");
    expect(ctx.pendingContextTrace?.model).toBe("rec-model");
  });

  it("completeStream also records the merged request", async () => {
    const { provider, received } = recordingProvider();
    const ctx: LlmTrackingContext = {};
    const llm = wrapLlmForSession(provider, { current: ctx }, () => samplePreset);
    const chunks: string[] = [];

    await llm.completeStream!(
      [{ role: "user", content: "TASK" }],
      { caller: "worker:stream" },
      { onContentDelta: (d) => chunks.push(d) },
    );

    expect(chunks.join("")).toBe("ok");
    expect(received[0].messages).toEqual([{ role: "user", content: "TASK" }]);
    expect(ctx.pendingContextTrace?.messages).toEqual(received[0].messages);
  });
});
