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
  generation: { temperature: 0.91, maxOutputTokens: 1234, reasoningEffort: "max" },
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
  it("frames task messages with preset prompt_order and merges generation", async () => {
    const { provider, received } = recordingProvider();
    const ctx: LlmTrackingContext = {};
    const llm = wrapLlmForSession(provider, { current: ctx }, () => samplePreset);

    await llm.complete(
      [{ role: "user", content: "TASK" }],
      { caller: "worker:design-step" },
    );

    expect(received).toHaveLength(1);
    expect(received[0].messages.map((m) => [m.role, m.content])).toEqual([
      ["system", "PRESET_RULES"],
      ["user", "TASK"],
    ]);
    expect(received[0].generation).toMatchObject({
      temperature: 0.91,
      maxOutputTokens: 1234,
    });
    expect(received[0].generation).not.toHaveProperty("reasoningEffort");
    expect(ctx.pendingContextTrace?.messages).toEqual(received[0].messages);
    expect(ctx.pendingContextTrace?.generation).toMatchObject({
      temperature: 0.91,
      maxOutputTokens: 1234,
    });
    expect(ctx.pendingContextTrace?.caller).toBe("worker:design-step");
    expect(ctx.pendingContextTrace?.model).toBe("rec-model");
  });

  it("puts task system inside worldBookBefore, not before the preset shell", async () => {
    const { provider, received } = recordingProvider();
    const llm = wrapLlmForSession(provider, undefined, () => samplePreset);

    await llm.completeWithTools(
      [
        { role: "system", content: "SKILL" },
        { role: "user", content: "do it" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "1",
              type: "function",
              function: { name: "t", arguments: "{}" },
            },
          ],
        },
        { role: "tool", content: "{}", tool_call_id: "1" },
      ],
      { tools: [], caller: "dictate_agent" },
    );

    expect(received[0].messages[0].content).toBe("PRESET_RULES");
    expect(
      received[0].messages.some(
        (m) => m.content === "### 任务契约\n\nSKILL",
      ),
    ).toBe(true);
    expect(received[0].messages.some((m) => m.content === "do it")).toBe(true);
    expect(received[0].messages.map((m) => m.role).slice(-2)).toEqual([
      "assistant",
      "tool",
    ]);
  });

  it("completeStream also records the framed request", async () => {
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
    expect(received[0].messages.some((m) => m.content === "PRESET_RULES")).toBe(
      true,
    );
    expect(ctx.pendingContextTrace?.messages).toEqual(received[0].messages);
  });

  it("uses getPersona so @玩家 stays @玩家 during creation", async () => {
    const preset: PresetPackage = {
      ...samplePreset,
      prompts: [
        {
          id: "sys",
          name: "系统",
          enabled: true,
          role: "system",
          content: "称呼 @玩家",
          marker: false,
          sourceIdentifier: "sys",
        },
      ],
    };
    const { provider, received } = recordingProvider();
    const llm = wrapLlmForSession(
      provider,
      undefined,
      () => preset,
      () => ({ name: "@玩家", description: "占位" }),
    );
    await llm.complete([{ role: "user", content: "TASK" }]);
    expect(received[0].messages[0].content).toBe("称呼 @玩家");
  });
});
