import type { LlmConfig } from "../config/env.js";
import type { GenerationParameters } from "../types/preset.js";
import {
  applyOpenAiGeneration,
  fetchWithGenerationCompat,
  forceReasoningEffortNoneWhenTools,
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
  /** 上游若单独返回缓存写入 token（如 cache_creation_input_tokens） */
  cacheWriteTokens?: number;
};

/** 用量行上的调度信息。不包含提示词或产物正文。 */
export type DictateUsageStep = "select" | "fill" | "fill-retry" | "reply" | "play";

export type UsageDetail = {
  turnId?: string;
  step?: DictateUsageStep;
  retryIndex?: number;
  segmentChars?: {
    rules: number;
    history: number;
    products: number;
    injected: number;
    tail: number;
  };
  plannedTags?: string[];
  succeededTags?: string[];
  failedTags?: string[];
  finish?: string;
};

/** complete 返回后由统计层写入 recordId，供补记成功或失败的 tag。 */
export type UsageSink = { recordId?: string };

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
  /** 日志短名，如「对话落盘 第2轮」；缺则用 caller */
  label?: string;
  /** 取消进行中的 LLM 请求（停止并重试） */
  signal?: AbortSignal;
  /**
   * 本局会话 id。仅 OpenRouter 会写成请求体 `session_id`，用来粘住同一上游，
   * 避免开头 message 一变就换缓存节点。其它渠道不发送。
   */
  sessionId?: string;
  /** 统计补充。不进上游请求体。 */
  usageDetail?: UsageDetail;
  usageSink?: UsageSink;
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

const JSON_OBJECT_HINT = "请用 JSON 对象回复。";
const OPENROUTER_SESSION_ID_MAX = 256;

/** OpenRouter 用 `session_id` 做粘滞路由；其它 OpenAI 兼容渠道不认识这个字段。 */
export function isOpenRouterBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (!trimmed) return false;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const host = new URL(withProtocol).hostname.toLowerCase();
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
}

/** 合法则返回要写入请求体的 session_id；非 OpenRouter 或空 id 则不写。 */
export function openRouterSessionId(
  baseUrl: string,
  sessionId: string | undefined,
): string | undefined {
  if (!isOpenRouterBaseUrl(baseUrl)) return undefined;
  const id = sessionId?.trim();
  if (!id) return undefined;
  return id.slice(0, OPENROUTER_SESSION_ID_MAX);
}

function messagesMentionJson(messages: ChatMessage[]): boolean {
  for (const message of messages) {
    if (typeof message.content === "string" && /json/i.test(message.content)) {
      return true;
    }
  }
  return false;
}

/**
 * OpenAI `response_format: json_object` 要求 messages 里出现 json，否则 400。
 * 偏好/文风等提示不写这个词；预设夹心也可能丢掉带 JSON 的任务契约。
 */
export function ensureJsonObjectPrompt(messages: ChatMessage[]): ChatMessage[] {
  if (messagesMentionJson(messages)) return messages;
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex >= 0) {
    const current = messages[systemIndex];
    if (current?.role === "system") {
      const next = messages.slice();
      next[systemIndex] = {
        role: "system",
        content: `${current.content}\n\n${JSON_OBJECT_HINT}`,
      };
      return next;
    }
  }
  return [{ role: "system", content: JSON_OBJECT_HINT }, ...messages];
}

export function buildRequestBody(
  config: LlmConfig,
  messages: ChatMessage[],
  options?: CompleteOptions & { tools?: ToolDefinition[]; stream?: boolean },
): Record<string, unknown> {
  const requestMessages =
    options?.responseFormat === "json_object"
      ? ensureJsonObjectPrompt(messages)
      : messages;
  const body: Record<string, unknown> = {
    model: config.model,
    messages: requestMessages,
  };

  if (options?.tools?.length) {
    body.tools = options.tools;
    body.tool_choice =
      (options as CompleteWithToolsOptions).toolChoice ?? "auto";
  }

  applyOpenAiGeneration(body, options?.generation ?? {}, config.model, {
    reasoningEffort: config.reasoningEffort,
  });
  // 带 tools 时按型号改写思考参数（Gemini 3 / GLM-5.3 保留合法档，其余强制 none）
  forceReasoningEffortNoneWhenTools(body, config.model);

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

  const sessionId = openRouterSessionId(config.baseUrl, options?.sessionId);
  if (sessionId) body.session_id = sessionId;

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

function readCacheWriteTokens(u: Record<string, unknown>): number | undefined {
  const details = u.prompt_tokens_details ?? u.promptTokensDetails;
  if (details && typeof details === "object") {
    const row = details as Record<string, unknown>;
    const nested = readFiniteNumber(row.cache_write_tokens ?? row.cacheWriteTokens);
    if (nested != null) return nested;
  }
  return readFiniteNumber(
    u.cache_creation_input_tokens ??
      u.cache_write_input_tokens ??
      u.cacheWriteTokens,
  );
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
  const cacheWriteTokens = readCacheWriteTokens(u);

  return {
    promptTokens: Number.isFinite(prompt) ? prompt : 0,
    completionTokens: Number.isFinite(completion) ? completion : 0,
    totalTokens: Number.isFinite(total)
      ? total
      : (Number.isFinite(prompt) ? prompt : 0) +
        (Number.isFinite(completion) ? completion : 0),
    ...(cachedTokens != null ? { cachedTokens } : {}),
    ...(cacheMissTokens != null ? { cacheMissTokens } : {}),
    ...(cacheWriteTokens != null ? { cacheWriteTokens } : {}),
  };
}

function stringifyToolArguments(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") return JSON.stringify(value);
  return "{}";
}

function toolCallFromRow(row: Record<string, unknown>, index: number): ParsedToolCall | null {
  const fn = row.function;
  const nested = fn && typeof fn === "object" ? (fn as Record<string, unknown>) : null;
  const source = nested ?? row;
  const name = typeof source.name === "string" ? source.name.trim() : "";
  if (!name) return null;
  const rawId = typeof row.id === "string" ? row.id.trim() : "";
  return {
    id: rawId || `call-${index}`,
    name,
    arguments: stringifyToolArguments(
      source.arguments ?? source.args ?? row.arguments ?? row.args ?? row.input,
    ),
  };
}

function embeddedContent(raw: unknown): { text: string | null; calls: ParsedToolCall[] } {
  if (typeof raw === "string") return { text: raw.trim() || null, calls: [] };
  if (!Array.isArray(raw)) return { text: raw == null ? null : "", calls: [] };
  const texts: string[] = [];
  const calls: ParsedToolCall[] = [];
  raw.forEach((part, index) => {
    if (!part || typeof part !== "object") return;
    const row = part as Record<string, unknown>;
    if (typeof row.text === "string" && row.text.trim()) texts.push(row.text.trim());
    const fn = row.functionCall ?? row.function_call;
    if (row.type === "tool_use" || (fn && typeof fn === "object")) {
      const nested = fn && typeof fn === "object" ? (fn as Record<string, unknown>) : row;
      const parsed = toolCallFromRow(
        {
          id: row.id,
          name: nested.name ?? row.name,
          arguments: nested.args ?? nested.arguments ?? row.input ?? row.arguments,
        },
        index,
      );
      if (parsed) calls.push(parsed);
    }
  });
  return { text: texts.join("\n").trim() || null, calls };
}

/** 从一条 assistant message 取出正文和工具调用。对象参数、缺 id、content 片段里的调用都收。 */
export function extractMessageParts(message: Record<string, unknown> | undefined): {
  content: string | null;
  reasoning?: string;
  toolCalls: ParsedToolCall[];
} {
  if (!message) return { content: "", toolCalls: [] };
  const embedded = embeddedContent(message.content);
  const reasoningRaw =
    (typeof message.reasoning_content === "string" &&
      message.reasoning_content.trim()) ||
    (typeof message.reasoning === "string" && message.reasoning.trim()) ||
    (typeof message.thinking === "string" && message.thinking.trim()) ||
    "";
  const reasoning = reasoningRaw || undefined;

  const toolCalls: ParsedToolCall[] = [];
  const rawCalls = message.tool_calls;
  if (Array.isArray(rawCalls)) {
    rawCalls.forEach((call, index) => {
      if (!call || typeof call !== "object") return;
      const parsed = toolCallFromRow(call as Record<string, unknown>, index);
      if (parsed) toolCalls.push(parsed);
    });
  }
  for (const call of embedded.calls) {
    if (!toolCalls.some((item) => item.id === call.id && item.name === call.name)) {
      toolCalls.push(call);
    }
  }
  const content = embedded.text;

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
    // 空正文不抛错：游玩/Worker 会落「本轮场面未写完」等占位，仍可重 roll
    const parts = extractMessageParts(data.choices?.[0]?.message);
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

    // 空流不抛错：下游会落占位正文，消息正常渲染以便重 roll
    const parts = await consumeOpenAiToolStream(response.body, callbacks);
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
    const content =
      parts.content ??
      (parts.toolCalls.length === 0 ? parts.reasoning || null : null);
    return {
      content,
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
