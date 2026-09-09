import { describe, expect, it } from "vitest";
import {
  applyOpenAiGeneration,
  applyRejectedGenerationField,
  classifyChatModel,
  fetchWithGenerationCompat,
  forceReasoningEffortNoneWhenTools,
  isToolsReasoningEffortConflictError,
  parseRejectedGenerationField,
  sanitizeReasoningEffort,
  sanitizeVerbosity,
} from "../src/llm/generation-compat.js";
import { buildRequestBody } from "../src/llm/client.js";
import type { LlmConfig } from "../src/config/env.js";

const stGeneration = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  minP: 0.05,
  frequencyPenalty: 0,
  presencePenalty: 0,
  repetitionPenalty: 1.05,
  maxOutputTokens: 60000,
  seed: -1,
  reasoningEffort: "auto",
  verbosity: "auto",
};

describe("sanitizeReasoningEffort", () => {
  it("omits SillyTavern auto and empty values", () => {
    expect(sanitizeReasoningEffort("auto")).toBeUndefined();
    expect(sanitizeReasoningEffort("AUTO")).toBeUndefined();
    expect(sanitizeReasoningEffort("")).toBeUndefined();
    expect(sanitizeReasoningEffort("  ")).toBeUndefined();
    expect(sanitizeReasoningEffort(undefined)).toBeUndefined();
  });

  it("keeps values the provider enum accepts", () => {
    expect(sanitizeReasoningEffort("none")).toBe("none");
    expect(sanitizeReasoningEffort("minimal")).toBe("minimal");
    expect(sanitizeReasoningEffort("low")).toBe("low");
    expect(sanitizeReasoningEffort("medium")).toBe("medium");
    expect(sanitizeReasoningEffort("high")).toBe("high");
    expect(sanitizeReasoningEffort("xhigh")).toBe("xhigh");
    expect(sanitizeReasoningEffort("max")).toBe("max");
  });

  it("maps SillyTavern min to minimal and ignores unknown values", () => {
    expect(sanitizeReasoningEffort("min")).toBe("minimal");
    expect(sanitizeReasoningEffort("MIN")).toBe("minimal");
    expect(sanitizeReasoningEffort("unknown")).toBeUndefined();
  });
});

describe("sanitizeVerbosity", () => {
  it("omits auto and unknown values", () => {
    expect(sanitizeVerbosity("auto")).toBeUndefined();
    expect(sanitizeVerbosity("loud")).toBeUndefined();
    expect(sanitizeVerbosity("medium")).toBe("medium");
  });
});

describe("classifyChatModel", () => {
  it("treats o-series, gpt-5, kimi-k2.5 and deepseek-reasoner as no-sampling", () => {
    expect(classifyChatModel("o3-mini").omitSampling).toBe(true);
    expect(classifyChatModel("openai/o4-mini").omitSampling).toBe(true);
    expect(classifyChatModel("gpt-5").omitSampling).toBe(true);
    expect(classifyChatModel("deepseek-reasoner").omitSampling).toBe(true);
    expect(classifyChatModel("kimi-k2.5").omitSampling).toBe(true);
  });

  it("keeps sampling for ordinary chat models", () => {
    expect(classifyChatModel("gpt-4o").omitSampling).toBe(false);
    expect(classifyChatModel("deepseek-v4-pro").omitSampling).toBe(false);
    expect(classifyChatModel("gpt-5-chat-latest").omitSampling).toBe(false);
  });
});

describe("applyOpenAiGeneration", () => {
  it("does not send ST extras or auto sentinels on a chat model", () => {
    const body: Record<string, unknown> = { model: "deepseek-v4-pro" };
    applyOpenAiGeneration(body, stGeneration, "deepseek-v4-pro");
    expect(body.temperature).toBe(1);
    expect(body.top_p).toBe(0.95);
    expect(body.max_tokens).toBe(60000);
    expect(body.top_k).toBeUndefined();
    expect(body.min_p).toBeUndefined();
    expect(body.repetition_penalty).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.verbosity).toBeUndefined();
    expect(body.seed).toBeUndefined();
  });

  it("drops sampling params for reasoning models and uses max_completion_tokens", () => {
    const body: Record<string, unknown> = { model: "o3-mini" };
    applyOpenAiGeneration(body, stGeneration, "o3-mini");
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.frequency_penalty).toBeUndefined();
    expect(body.presence_penalty).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBe(60000);
  });
});

describe("forceReasoningEffortNoneWhenTools", () => {
  it("forces none when tools are present", () => {
    const body: Record<string, unknown> = {
      tools: [{ type: "function", function: { name: "x" } }],
      reasoning_effort: "high",
    };
    forceReasoningEffortNoneWhenTools(body);
    expect(body.reasoning_effort).toBe("none");
  });

  it("sets none even when effort was omitted", () => {
    const body: Record<string, unknown> = {
      tools: [{ type: "function", function: { name: "x" } }],
    };
    forceReasoningEffortNoneWhenTools(body);
    expect(body.reasoning_effort).toBe("none");
  });

  it("leaves body alone without tools", () => {
    const body: Record<string, unknown> = { reasoning_effort: "high" };
    forceReasoningEffortNoneWhenTools(body);
    expect(body.reasoning_effort).toBe("high");
  });
});

describe("isToolsReasoningEffortConflictError", () => {
  it("detects gpt-5.6-luna style conflict", () => {
    const text = JSON.stringify({
      error: {
        message:
          "Provider API error: Function tools with reasoning_effort are not supported for gpt-5.6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
        type: "invalid_request_error",
      },
    });
    expect(isToolsReasoningEffortConflictError(text, 400)).toBe(true);
  });

  it("ignores unrelated 400s", () => {
    expect(
      isToolsReasoningEffortConflictError(
        JSON.stringify({
          error: {
            message: "Unsupported parameter: temperature",
            param: "temperature",
          },
        }),
        400,
      ),
    ).toBe(false);
  });
});

describe("parseRejectedGenerationField", () => {
  it("reads OpenAI unsupported parameter errors", () => {
    expect(
      parseRejectedGenerationField(
        JSON.stringify({
          error: {
            message: "Unsupported parameter: 'temperature' is not supported with this model.",
            param: "temperature",
          },
        }),
      ),
    ).toBe("temperature");
  });

  it("reads strict JSON deserializer unknown variant errors", () => {
    expect(
      parseRejectedGenerationField(
        JSON.stringify({
          error: {
            message:
              "Failed to deserialize the JSON body into the target type: reasoning_effort: unknown variant `auto`, expected one of `none`, `minimal`",
          },
        }),
      ),
    ).toBe("reasoning_effort");
  });

  it("drops top_p when temperature and top_p are mutually exclusive", () => {
    expect(
      parseRejectedGenerationField(
        "temperature and top_p cannot both be specified for this model",
      ),
    ).toBe("top_p");
  });
});

describe("applyRejectedGenerationField", () => {
  it("renames max_completion_tokens to max_tokens once", () => {
    const body: Record<string, unknown> = { max_completion_tokens: 100 };
    const tried = new Set<string>();
    expect(applyRejectedGenerationField(body, "max_completion_tokens", tried)).toBe(
      true,
    );
    expect(body.max_tokens).toBe(100);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(applyRejectedGenerationField(body, "max_tokens", tried)).toBe(true);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  it("sets reasoning_effort to none when tools are present", () => {
    const body: Record<string, unknown> = {
      tools: [{ type: "function" }],
      reasoning_effort: "high",
    };
    const tried = new Set<string>();
    expect(applyRejectedGenerationField(body, "reasoning_effort", tried)).toBe(true);
    expect(body.reasoning_effort).toBe("none");
  });
});

describe("fetchWithGenerationCompat", () => {
  it("retries a 400 after stripping the rejected field", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const response = await fetchWithGenerationCompat(async (body) => {
      sent.push({ ...body });
      if ("temperature" in body) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Unsupported parameter: 'temperature'",
              param: "temperature",
            },
          }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }, { model: "o3", temperature: 1, messages: [] });

    expect(response.ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0].temperature).toBe(1);
    expect(sent[1].temperature).toBeUndefined();
  });

  it("retries tools+reasoning conflict by setting none", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const response = await fetchWithGenerationCompat(async (body) => {
      sent.push({ ...body });
      if (body.reasoning_effort !== "none") {
        return new Response(
          JSON.stringify({
            error: {
              message:
                "Function tools with reasoning_effort are not supported for gpt-5.6-luna. Set reasoning_effort to 'none'.",
            },
          }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }, {
      model: "gpt-5.6-luna",
      tools: [{ type: "function", function: { name: "run" } }],
      messages: [],
    });

    expect(response.ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0].reasoning_effort).toBeUndefined();
    expect(sent[1].reasoning_effort).toBe("none");
  });
});

describe("buildRequestBody", () => {
  const messages = [{ role: "user" as const, content: "hi" }];

  it("does not send reasoning_effort when the preset says auto", () => {
    const config: LlmConfig = {
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: "deepseek-v4-pro",
    };
    const body = buildRequestBody(config, messages, {
      generation: { reasoningEffort: "auto", temperature: 0.5 },
    });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.temperature).toBe(0.5);
  });

  it("sends a supported effort value", () => {
    const config: LlmConfig = {
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: "gpt-5",
    };
    const body = buildRequestBody(config, messages, {
      generation: { reasoningEffort: "High" },
    });
    expect(body.reasoning_effort).toBe("high");
    expect(body.temperature).toBeUndefined();
  });

  it("uses profile default reasoningEffort when generation omits it", () => {
    const config: LlmConfig = {
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: "glm-5.3",
      reasoningEffort: "high",
    };
    const body = buildRequestBody(config, messages, {
      generation: { temperature: 1 },
    });
    expect(body.reasoning_effort).toBe("high");
  });

  it("lets generation reasoningEffort override the profile default", () => {
    const config: LlmConfig = {
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: "glm-5.3",
      reasoningEffort: "max",
    };
    const body = buildRequestBody(config, messages, {
      generation: { reasoningEffort: "low" },
    });
    expect(body.reasoning_effort).toBe("low");
  });

  it("forces reasoning_effort none when tools are attached", () => {
    const config: LlmConfig = {
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
    };
    const body = buildRequestBody(config, messages, {
      tools: [
        {
          type: "function",
          function: { name: "run_worker", parameters: { type: "object" } },
        },
      ],
    });
    expect(body.reasoning_effort).toBe("none");
    expect(body.tools).toHaveLength(1);
  });

  it("does not forward top_k from an imported ST preset", () => {
    const config: LlmConfig = {
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: "deepseek-v4-pro",
    };
    const body = buildRequestBody(config, messages, {
      generation: stGeneration,
    });
    expect(body.top_k).toBeUndefined();
    expect(body.min_p).toBeUndefined();
  });
});
