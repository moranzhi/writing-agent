import type { GenerationParameters } from "../types/preset.js";

/**
 * OpenAI-compatible Chat Completions 的生成参数兼容层，对齐 SillyTavern Custom 源：
 * - `auto` / 关闭值不发送
 * - top_k、min_p、repetition_penalty 不是官方 Chat Completions 字段，默认不发
 * - 推理模型去掉 temperature / top_p / penalty
 * - o 系列与 gpt-5 用 max_completion_tokens
 * - 带 tools 时强制 reasoning_effort=none（gpt-5.6-luna 等网关：省略字段仍会注入默认 effort）
 * - 仍 400 时按错误信息剥掉不支持字段再试；tools+reasoning 冲突则改 none 再试
 */

const REASONING_EFFORT_VALUES = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number];

const REASONING_EFFORT_ALIASES: Record<string, ReasoningEffort> = {
  min: "minimal",
};

const VERBOSITY_VALUES = ["low", "medium", "high"] as const;
type Verbosity = (typeof VERBOSITY_VALUES)[number];

export const STRIPPABLE_GENERATION_FIELDS = new Set([
  "temperature",
  "top_p",
  "top_k",
  "min_p",
  "frequency_penalty",
  "presence_penalty",
  "repetition_penalty",
  "seed",
  "n",
  "reasoning_effort",
  "verbosity",
  "max_tokens",
  "max_completion_tokens",
  "logit_bias",
  "stop",
  "response_format",
  "stream_options",
]);

export type ChatModelCompat = {
  omitSampling: boolean;
  useMaxCompletionTokens: boolean;
  supportsVerbosity: boolean;
};

function modelLeaf(model: string): string {
  const trimmed = model.trim().toLowerCase();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

export function classifyChatModel(model: string): ChatModelCompat {
  const id = modelLeaf(model);
  const isOSeries = /^o[134]($|[-.\d])/.test(id);
  const isGpt5 = id.includes("gpt-5");
  const isGpt5Chat = isGpt5 && id.includes("chat");
  const isKimi25 = id.includes("kimi-k2.5");
  const isDeepseekReasoner = id.includes("deepseek-reasoner");
  const isGrok3Mini = id.includes("grok-3-mini");

  return {
    omitSampling:
      isOSeries ||
      (isGpt5 && !isGpt5Chat) ||
      isKimi25 ||
      isDeepseekReasoner ||
      isGrok3Mini,
    useMaxCompletionTokens: isOSeries || isGpt5,
    supportsVerbosity: isGpt5,
  };
}

export function sanitizeReasoningEffort(
  value: unknown,
): ReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  if (!key || key === "auto") return undefined;
  const mapped = REASONING_EFFORT_ALIASES[key] ?? key;
  return (REASONING_EFFORT_VALUES as readonly string[]).includes(mapped)
    ? (mapped as ReasoningEffort)
    : undefined;
}

export function sanitizeVerbosity(value: unknown): Verbosity | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  if (!key || key === "auto") return undefined;
  return (VERBOSITY_VALUES as readonly string[]).includes(key)
    ? (key as Verbosity)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

export type GenerationDefaults = {
  /** API profile 等来源的默认思考强度；仅当 gen 未指定时生效 */
  reasoningEffort?: string;
};

export function applyOpenAiGeneration(
  body: Record<string, unknown>,
  gen: GenerationParameters,
  model: string,
  defaults?: GenerationDefaults,
): void {
  const { omitSampling, useMaxCompletionTokens, supportsVerbosity } =
    classifyChatModel(model);

  if (!omitSampling) {
    body.temperature = gen.temperature !== undefined ? gen.temperature : 0.2;
    const topP = finiteNumber(gen.topP);
    if (topP !== undefined && topP > 0) body.top_p = topP;
    const frequencyPenalty = finiteNumber(gen.frequencyPenalty);
    if (frequencyPenalty !== undefined) {
      body.frequency_penalty = frequencyPenalty;
    }
    const presencePenalty = finiteNumber(gen.presencePenalty);
    if (presencePenalty !== undefined) {
      body.presence_penalty = presencePenalty;
    }
  }

  const maxOutput = finiteNumber(gen.maxOutputTokens);
  if (maxOutput !== undefined && maxOutput > 0) {
    if (useMaxCompletionTokens) body.max_completion_tokens = maxOutput;
    else body.max_tokens = maxOutput;
  }

  const seed = finiteNumber(gen.seed);
  if (seed !== undefined && seed >= 0) body.seed = seed;

  const reasoningEffort =
    sanitizeReasoningEffort(gen.reasoningEffort) ??
    sanitizeReasoningEffort(defaults?.reasoningEffort);
  if (reasoningEffort !== undefined) {
    body.reasoning_effort = reasoningEffort;
  }

  const verbosity = sanitizeVerbosity(gen.verbosity);
  if (verbosity !== undefined && supportsVerbosity) {
    body.verbosity = verbosity;
  }
}

/** chat/completions + function tools 时须显式 none，否则网关可能注入默认 effort 并 400。 */
export function forceReasoningEffortNoneWhenTools(
  body: Record<string, unknown>,
): void {
  const tools = body.tools;
  if (!Array.isArray(tools) || tools.length === 0) return;
  body.reasoning_effort = "none";
}

/**
 * gpt-5.6-luna 等：/v1/chat/completions 下 function tools 不能与非 none 的
 * reasoning_effort 同用。需显式 reasoning_effort='none'。
 */
export function isToolsReasoningEffortConflictError(
  errorText: string,
  status?: number,
): boolean {
  if (status != null && status !== 400 && status !== 422) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(errorText);
  } catch {
    parsed = undefined;
  }
  const message = `${readErrorMessage(parsed)}\n${errorText}`.toLowerCase();
  if (!message.trim()) return false;

  const mentionsTools =
    /\b(function\s+)?tools?\b/.test(message) ||
    /tool_choice|function tools/.test(message);
  const mentionsReasoningEffort = /reasoning_effort/.test(message);
  const conflict =
    /not support|unsupported|does not support|not supported|not allowed|cannot|can't/.test(
      message,
    );

  return mentionsTools && mentionsReasoningEffort && conflict;
}

function readErrorMessage(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const err = (raw as { error?: unknown }).error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  const message = (raw as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function readErrorParam(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const err = (raw as { error?: unknown }).error;
  if (err && typeof err === "object") {
    const param = (err as { param?: unknown }).param;
    if (typeof param === "string" && STRIPPABLE_GENERATION_FIELDS.has(param)) {
      return param;
    }
  }
  return undefined;
}

export function parseRejectedGenerationField(
  errorText: string,
): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(errorText);
  } catch {
    parsed = undefined;
  }
  const fromParam = readErrorParam(parsed);
  if (fromParam) return fromParam;

  const message = `${readErrorMessage(parsed)}\n${errorText}`;
  if (/temperature and top_p cannot both/i.test(message)) return "top_p";

  const patterns = [
    /unsupported parameter:?\s*['"`]?([a-z_]+)/i,
    /unknown field [`'"]([a-z_]+)[`'"]/i,
    /([a-z_]+):\s*unknown variant/i,
    /invalid value[^\n]*for[^\n]*['"`]([a-z_]+)['"`]/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    const field = match?.[1]?.toLowerCase();
    if (field && STRIPPABLE_GENERATION_FIELDS.has(field)) return field;
  }
  return undefined;
}

export function applyRejectedGenerationField(
  body: Record<string, unknown>,
  field: string,
  tried: Set<string>,
): boolean {
  if (!STRIPPABLE_GENERATION_FIELDS.has(field)) return false;

  if (
    field === "max_completion_tokens" &&
    body.max_completion_tokens != null &&
    !tried.has("max_tokens")
  ) {
    body.max_tokens = body.max_completion_tokens;
    delete body.max_completion_tokens;
    tried.add("max_completion_tokens");
    return true;
  }
  if (
    field === "max_tokens" &&
    body.max_tokens != null &&
    !tried.has("max_completion_tokens")
  ) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
    tried.add("max_tokens");
    return true;
  }

  // tools + reasoning_effort 冲突：删字段不够，须显式 none
  if (
    field === "reasoning_effort" &&
    Array.isArray(body.tools) &&
    body.tools.length > 0 &&
    body.reasoning_effort !== "none" &&
    !tried.has("reasoning_effort_none")
  ) {
    body.reasoning_effort = "none";
    tried.add("reasoning_effort_none");
    return true;
  }

  if (!(field in body)) return false;
  delete body[field];
  tried.add(field);
  return true;
}

function applyToolsReasoningEffortNone(
  body: Record<string, unknown>,
  tried: Set<string>,
): boolean {
  if (
    !Array.isArray(body.tools) ||
    body.tools.length === 0 ||
    body.reasoning_effort === "none" ||
    tried.has("reasoning_effort_none")
  ) {
    return false;
  }
  body.reasoning_effort = "none";
  tried.add("reasoning_effort_none");
  return true;
}

function replayResponse(source: Response, text: string): Response {
  return new Response(text, {
    status: source.status,
    statusText: source.statusText,
    headers: source.headers,
  });
}

export async function fetchWithGenerationCompat(
  send: (body: Record<string, unknown>) => Promise<Response>,
  initialBody: Record<string, unknown>,
): Promise<Response> {
  let body = initialBody;
  const tried = new Set<string>();
  let last: Response | undefined;

  for (let attempt = 0; attempt < 8; attempt++) {
    last = await send(body);
    if (last.ok || (last.status !== 400 && last.status !== 422)) return last;
    const text = await last.text();
    const next = { ...body };

    if (isToolsReasoningEffortConflictError(text, last.status)) {
      if (applyToolsReasoningEffortNone(next, tried)) {
        body = next;
        continue;
      }
    }

    const field = parseRejectedGenerationField(text);
    if (!field) return replayResponse(last, text);
    if (!applyRejectedGenerationField(next, field, tried)) {
      return replayResponse(last, text);
    }
    body = next;
  }

  return last ?? new Response("LLM request failed", { status: 400 });
}
