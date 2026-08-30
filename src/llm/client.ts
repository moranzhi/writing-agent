import type { LlmConfig } from "../config/env.js";
import type { GenerationParameters } from "../types/preset.js";
import {
  applyOpenAiGeneration,
  fetchWithGenerationCompat,
  sanitizeReasoningEffort,
} from "./generation-compat.js";
import { consumeOpenAiToolStream } from "./stream-complete.js";
import {
  currentAbortSignal,
  throwIfAborted,
} from "./run-abort.js";

export { sanitizeReasoningEffort };

export type ToolCallPayload = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCallPayload[];
    }
  | { role: "tool"; content: string; tool_call_id: string };

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    /** 部分供应商支持的严格参数约束 */
    strict?: boolean;
  };
};

export type ParsedToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Prompt tokens served from provider cache (OpenAI cached_tokens, DeepSeek prompt_cache_hit_tokens) */
  cachedTokens?: number;
  /** Prompt tokens not served from cache (DeepSeek prompt_cache_miss_tokens) */
  cacheMissTokens?: number;
};

export type CompleteResult = {
  content: string;
  /** 推理模型思维链（如 DeepSeek reasoner 的 reasoning_content） */
  reasoning?: string;
  usage?: TokenUsage;
  model?: string;
};

export type JsonSchemaFormat = {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
};

export type CompleteOptions = {
  responseFormat?: "json_object" | "json_schema" | "text";
  /** responseFormat=json_schema 时使用 */
  jsonSchema?: JsonSchemaFormat;
  generation?: GenerationParameters;
  /** 统计用途，如 main_agent / worker:write-rules */
  caller?: string;
  /** 取消进行中的 LLM 请求（停止并重试） */
  signal?: AbortSignal;
};

export type ToolChoice =
  | "auto"
  | "required"
  | "none"
  | { type: "function"; function: { name: string } };

export type CompleteWithToolsOptions = CompleteOptions & {
  tools: ToolDefinition[];
  toolChoice?: ToolChoice;
};

export type CompleteWithToolsResult = {
  content: string | null;
  toolCalls: ParsedToolCall[];
  reasoning?: string;
  usage?: TokenUsage;
  model?: string;
};

export type StreamCallbacks = {
  onReasoningDelta?: (delta: string) => void;
  onContentDelta?: (delta: string) => void;
};

export type LlmProvider = {
  complete(
    messages: ChatMessage[],
    options?: CompleteOptions,
  ): Promise<CompleteResult>;
  completeStream?(
    messages: ChatMessage[],
    options?: CompleteOptions,
    callbacks?: StreamCallbacks,
  ): Promise<CompleteResult>;
  completeWithTools(
    messages: ChatMessage[],
    options: CompleteWithToolsOptions,
  ): Promise<CompleteWithToolsResult>;
  completeWithToolsStream?(
    messages: ChatMessage[],
    options: CompleteWithToolsOptions,
    callbacks: StreamCallbacks,
  ): Promise<CompleteWithToolsResult>;
};

export function buildRequestBody(
  config: LlmConfig,
  messages: ChatMessage[],
  options?: CompleteOptions & { tools?: ToolDefinition[]; stream?: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
  };

  if (options?.tools?.length) {
    body.tools = options.tools;
    body.tool_choice =
      (options as CompleteWithToolsOptions).toolChoice ?? "auto";
  }

  applyOpenAiGeneration(body, options?.generation ?? {}, config.model, {
    reasoningEffort: config.reasoningEffort,
  });

  if (options?.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  } else if (
    options?.responseFormat === "json_schema" &&
    options.jsonSchema
  ) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: options.jsonSchema.name,
        strict: options.jsonSchema.strict ?? true,
        schema: options.jsonSchema.schema,
      },
    };
  }

  if (options?.stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  return body;
}

function readFiniteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readCachedTokens(u: Record<string, unknown>): number | undefined {
  const details = u.prompt_tokens_details ?? u.promptTokensDetails;
  if (details && typeof details === "object") {
    const d = details as Record<string, unknown>;
    const cached = readFiniteNumber(d.cached_tokens ?? d.cachedTokens);
    if (cached != null) return cached;
  }
  return readFiniteNumber(u.prompt_cache_hit_tokens ?? u.promptCacheHitTokens);
}

function readCacheMissTokens(u: Record<string, unknown>): number | undefined {
  return readFiniteNumber(u.prompt_cache_miss_tokens ?? u.promptCacheMissTokens);
}

/** Parse OpenAI-compatible usage object, including provider-specific cache fields. */
export function parseUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const prompt = Number(u.prompt_tokens ?? u.promptTokens);
  const completion = Number(u.completion_tokens ?? u.completionTokens);
  const total = Number(u.total_tokens ?? u.totalTokens);
  if (!Number.isFinite(total) && !Number.isFinite(prompt)) return undefined;

  const cachedTokens = readCachedTokens(u);
  const cacheMissTokens = readCacheMissTokens(u);

  return {
    promptTokens: Number.isFinite(prompt) ? prompt : 0,
    completionTokens: Number.isFinite(completion) ? completion : 0,
    totalTokens: Number.isFinite(total)
      ? total
      : (Number.isFinite(prompt) ? prompt : 0) +
        (Number.isFinite(completion) ? completion : 0),
    ...(cachedTokens != null ? { cachedTokens } : {}),
    ...(cacheMissTokens != null ? { cacheMissTokens } : {}),
  };
}

function extractMessageParts(message: Record<string, unknown> | undefined): {
  content: string | null;
  reasoning?: string;
  toolCalls: ParsedToolCall[];
} {
  if (!message) return { content: "", toolCalls: [] };
  const rawContent = message.content;
  const content =
    typeof rawContent === "string"
      ? rawContent.trim() || null
      : rawContent == null
        ? null
        : "";
  const reasoning =
    typeof message.reasoning_content === "string"
      ? message.reasoning_content.trim()
      : undefined;

  const toolCalls: ParsedToolCall[] = [];
  const rawCalls = message.tool_calls;
  if (Array.isArray(rawCalls)) {
    for (const call of rawCalls) {
      if (!call || typeof call !== "object") continue;
      const c = call as Record<string, unknown>;
      const fn = c.function;
      if (!fn || typeof fn !== "object") continue;
      const f = fn as Record<string, unknown>;
      const name = typeof f.name === "string" ? f.name : "";
      const id = typeof c.id === "string" ? c.id : "";
      const args =
        typeof f.arguments === "string" ? f.arguments : "{}";
      if (name && id) {
        toolCalls.push({ id, name, arguments: args });
      }
    }
  }

  if (toolCalls.length > 0) {
    return { content, reasoning: reasoning || undefined, toolCalls };
  }
  if (content) return { content, reasoning: reasoning || undefined, toolCalls };
  if (reasoning) return { content: reasoning, reasoning, toolCalls };
  return { content: "", toolCalls };
}

async function llmFetch(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  options?: CompleteOptions,
): Promise<Response> {
  return fetchWithGenerationCompat(async (payload) => {
    throwIfAborted(options?.signal);
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: options?.signal ?? currentAbortSignal(),
    });
  }, body);
}

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(private readonly config: LlmConfig) {}

  async complete(
    messages: ChatMessage[],
    options?: CompleteOptions,
  ): Promise<CompleteResult> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await llmFetch(
      url,
      this.config.apiKey,
      buildRequestBody(this.config, messages, options),
      options,
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      model?: string;
      usage?: unknown;
      choices?: Array<{ message?: Record<string, unknown> }>;
    };
    const parts = extractMessageParts(data.choices?.[0]?.message);
    if (!parts.content && parts.toolCalls.length === 0) {
      throw new Error("LLM returned empty content");
    }
    return {
      content: parts.content ?? "",
      reasoning: parts.reasoning,
      usage: parseUsage(data.usage),
      model: data.model ?? this.config.model,
    };
  }

  async completeStream(
    messages: ChatMessage[],
    options?: CompleteOptions,
    callbacks: StreamCallbacks = {},
  ): Promise<CompleteResult> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await llmFetch(
      url,
      this.config.apiKey,
      buildRequestBody(this.config, messages, { ...options, stream: true }),
      options,
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${body}`);
    }

    if (!response.body) {
      throw new Error("LLM stream response has no body");
    }

    const parts = await consumeOpenAiToolStream(response.body, callbacks);
    if (!parts.content && !parts.reasoning) {
      throw new Error("LLM stream returned empty content");
    }
    return {
      content: parts.content ?? parts.reasoning ?? "",
      reasoning: parts.reasoning || undefined,
      usage: parts.usage,
      model: parts.model ?? this.config.model,
    };
  }

  async completeWithTools(
    messages: ChatMessage[],
    options: CompleteWithToolsOptions,
  ): Promise<CompleteWithToolsResult> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await llmFetch(
      url,
      this.config.apiKey,
      buildRequestBody(this.config, messages, {
        ...options,
        tools: options.tools,
      }),
      options,
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      model?: string;
      usage?: unknown;
      choices?: Array<{ message?: Record<string, unknown> }>;
    };
    const parts = extractMessageParts(data.choices?.[0]?.message);
    if (!parts.content && parts.toolCalls.length === 0) {
      throw new Error("LLM returned empty content and no tool calls");
    }
    return {
      content: parts.content,
      toolCalls: parts.toolCalls,
      reasoning: parts.reasoning,
      usage: parseUsage(data.usage),
      model: data.model ?? this.config.model,
    };
  }

  async completeWithToolsStream(
    messages: ChatMessage[],
    options: CompleteWithToolsOptions,
    callbacks: StreamCallbacks,
  ): Promise<CompleteWithToolsResult> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await llmFetch(
      url,
      this.config.apiKey,
      buildRequestBody(this.config, messages, {
        ...options,
        tools: options.tools,
        stream: true,
      }),
      options,
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${body}`);
    }

    if (!response.body) {
      throw new Error("LLM stream response has no body");
    }

    const parts = await consumeOpenAiToolStream(response.body, callbacks);
    if (!parts.content && parts.toolCalls.length === 0 && !parts.reasoning) {
      throw new Error("LLM stream returned empty content and no tool calls");
    }
    return {
      content: parts.content,
      toolCalls: parts.toolCalls,
      reasoning: parts.reasoning || undefined,
      usage: parts.usage,
      model: parts.model ?? this.config.model,
    };
  }
}

export type MockLlmStep =
  | string
  | {
      toolCalls: Array<{ name: string; arguments: Record<string, unknown>; id?: string }>;
      content?: string | null;
    };

export class MockLlmProvider implements LlmProvider {
  private readonly responses: MockLlmStep[];
  private index = 0;

  constructor(responses: MockLlmStep[]) {
    this.responses = responses;
  }

  private nextStep(): MockLlmStep {
    const step = this.responses[this.index] ?? this.responses.at(-1)!;
    this.index += 1;
    return step;
  }

  async complete(
    _messages: ChatMessage[],
    options?: CompleteOptions,
  ): Promise<CompleteResult> {
    throwIfAborted(options?.signal);
    const step = this.nextStep();
    const response =
      typeof step === "string"
        ? step
        : (step.content ?? JSON.stringify({ action: "ask_user", reason: "mock" }));
    const approx = Math.max(1, Math.ceil(response.length / 4));
    return {
      content: response,
      usage: {
        promptTokens: approx,
        completionTokens: approx,
        totalTokens: approx * 2,
      },
      model: "mock",
      ...(options?.caller ? {} : {}),
    };
  }

  async completeStream(
    _messages: ChatMessage[],
    options?: CompleteOptions,
    callbacks: StreamCallbacks = {},
  ): Promise<CompleteResult> {
    throwIfAborted(options?.signal);
    const step = this.nextStep();
    const response =
      typeof step === "string"
        ? step
        : (step.content ?? JSON.stringify({ action: "ask_user", reason: "mock" }));
    const reasoning = "用户需要明确分工 → 调用 design-intake 产出 worker 集。";
    for (const ch of reasoning) {
      throwIfAborted(options?.signal);
      callbacks.onReasoningDelta?.(ch);
      await new Promise((r) => setTimeout(r, 0));
    }
    for (const ch of response) {
      throwIfAborted(options?.signal);
      callbacks.onContentDelta?.(ch);
      await new Promise((r) => setTimeout(r, 0));
    }
    const approx = Math.max(1, Math.ceil(response.length / 4));
    return {
      content: response,
      reasoning,
      usage: {
        promptTokens: approx,
        completionTokens: approx,
        totalTokens: approx * 2,
      },
      model: "mock",
      ...(options?.caller ? {} : {}),
    };
  }

  async completeWithTools(
    _messages: ChatMessage[],
    _options: CompleteWithToolsOptions,
  ): Promise<CompleteWithToolsResult> {
    throwIfAborted(_options?.signal);
    const step = this.nextStep();
    if (typeof step === "string") {
      return {
        content: step,
        toolCalls: [],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: "mock",
      };
    }
    const toolCalls: ParsedToolCall[] = step.toolCalls.map((tc, i) => ({
      id: tc.id ?? `mock_call_${this.index}_${i}`,
      name: tc.name,
      arguments: JSON.stringify(tc.arguments),
    }));
    return {
      content: step.content ?? null,
      toolCalls,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: "mock",
    };
  }

  async completeWithToolsStream(
    _messages: ChatMessage[],
    _options: CompleteWithToolsOptions,
    callbacks: StreamCallbacks,
  ): Promise<CompleteWithToolsResult> {
    throwIfAborted(_options?.signal);
    const reasoning =
      "用户需要明确 Worker 分工 → 先读取黑板与 worker 列表 → 调用 design-intake 产出 worker 集。";
    for (const ch of reasoning) {
      throwIfAborted(_options?.signal);
      callbacks.onReasoningDelta?.(ch);
      await new Promise((r) => setTimeout(r, 0));
    }
    return this.completeWithTools(_messages, _options);
  }
}

export function createMockMainAgentResponse(
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    action: "ask_user",
    reason: "请告诉我你想创作什么类型的作品、目标篇幅和风格偏好。",
    workerId: null,
    requiresApproval: false,
    ...overrides,
  });
}

export function createMockToolCall(
  name: string,
  args: Record<string, unknown>,
  id?: string,
): MockLlmStep {
  return { toolCalls: [{ name, arguments: args, id }] };
}
