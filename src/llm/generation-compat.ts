import type { GenerationParameters } from "../types/preset.js";

/**
 * OpenAI-compatible Chat Completions 的生成参数兼容层，对齐 SillyTavern Custom 源：
 * - `auto` / 关闭值不发送
 * - top_k、min_p、repetition_penalty 不是官方 Chat Completions 字段，默认不发
 * - 推理模型去掉 temperature / top_p / penalty
 * - o 系列与 gpt-5 用 max_completion_tokens
 * - GLM：按型号映射 thinking / reasoning_effort（5.3 拒收 none；旧版拒收 effort）
 * - Gemini 3（如 gemini-3.8-flash）：思考不能关，none/minimal 抬到 low
 * - 带 tools 时：非上述型号强制 reasoning_effort=none（gpt-5.6-luna 等）；始终开启的型号保留合法档
 * - 仍 400 时按错误信息剥掉不支持字段再试；tools 冲突改 none，
 *   “Reasoning is mandatory … cannot be disabled” 则抬到 low 再试
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

/** GLM 思考参数形态（智谱 / 中转常见型号） */
export type GlmThinkingKind =
  /** 非 GLM */
  | "none"
  /** 仅 thinking.type，不发 reasoning_effort（glm-4.5/4.6/4.7/5/5.1 等） */
  | "thinking_only"
  /** thinking + 完整 effort 枚举（glm-5.2） */
  | "effort_full"
  /** 强制思考；effort 仅 low/high/max（glm-5.3） */
  | "effort_lhm_always_on";

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
  "thinking",
  "verbosity",
  "max_tokens",
  "max_completion_tokens",
  "logit_bias",
  "stop",
  "response_format",
  "stream_options",
  "reasoning",
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

/**
 * 识别 GLM 思考 API 形态。
 * 名称含 glm 即走 GLM 路径；未知子版默认 thinking_only（不发 effort，避免 400）。
 */
export function classifyGlmThinking(model: string): GlmThinkingKind {
  const id = modelLeaf(model);
  if (!id.includes("glm")) return "none";
  // 5.3 / 5.3-flash：不可 disabled，effort ∈ {low,high,max}
  if (/glm-?5\.3/.test(id)) return "effort_lhm_always_on";
  // 5.2：可 disabled；effort 枚举较全
  if (/glm-?5\.2/.test(id)) return "effort_full";
  return "thinking_only";
}

/**
 * Gemini 3：OpenRouter 拒绝关闭思考。
 * 3.8 合法档只有 low / medium / high（minimal 也会 400）。
 */
export function modelRejectsDisabledReasoning(model: string): boolean {
  const id = modelLeaf(model);
  return /^gemini-3(?:[.\-]|$)/.test(id);
}

function isGemini38(model: string): boolean {
  return /gemini-3\.8/.test(modelLeaf(model));
}

/** 落到 Gemini 思考档。未设置或 none 视为最低合法档 low。 */
function mapGeminiEffort(
  model: string,
  effort: ReasoningEffort | undefined,
): "minimal" | "low" | "medium" | "high" {
  if (!effort || effort === "none") return "low";
  if (effort === "minimal") return isGemini38(model) ? "low" : "minimal";
  if (effort === "low") return "low";
  if (effort === "medium") return "medium";
  return "high";
}

function writeGeminiReasoning(
  body: Record<string, unknown>,
  model: string,
  effort: ReasoningEffort | undefined,
): void {
  const mapped = mapGeminiEffort(model, effort);
  body.reasoning_effort = mapped;
  body.reasoning = { effort: mapped };
  if (isThinkingDisabled(body.thinking)) delete body.thinking;
}

function mapGlm53Effort(
  effort: ReasoningEffort,
): "low" | "high" | "max" {
  switch (effort) {
    case "none":
    case "minimal":
    case "low":
      return "low";
    case "medium":
    case "high":
      return "high";
    case "xhigh":
    case "max":
      return "max";
  }
}

/** 把配置的 effort 落到当前模型可接受的 body 字段。 */
function applyReasoningToBody(
  body: Record<string, unknown>,
  model: string,
  effort: ReasoningEffort | undefined,
): void {
  if (effort === undefined) return;

  const glm = classifyGlmThinking(model);
  if (glm === "none") {
    if (modelRejectsDisabledReasoning(model)) {
      writeGeminiReasoning(body, model, effort);
      return;
    }
    body.reasoning_effort = effort;
    return;
  }

  if (glm === "effort_lhm_always_on") {
    body.thinking = { type: "enabled" };
    body.reasoning_effort = mapGlm53Effort(effort);
    return;
  }

  if (glm === "effort_full") {
    if (effort === "none" || effort === "minimal") {
      body.thinking = { type: "disabled" };
      body.reasoning_effort = "none";
      return;
    }
    body.thinking = { type: "enabled" };
    body.reasoning_effort = effort;
    return;
  }

  // thinking_only：旧 GLM 拒收 reasoning_effort
  body.thinking = {
    type: effort === "none" || effort === "minimal" ? "disabled" : "enabled",
  };
  delete body.reasoning_effort;
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
  applyReasoningToBody(body, model, reasoningEffort);

  const verbosity = sanitizeVerbosity(gen.verbosity);
  if (verbosity !== undefined && supportsVerbosity) {
    body.verbosity = verbosity;
  }
}

/**
 * 带 function tools 时改写思考参数。
 * - 非 GLM、且允许关闭思考（如 gpt-5.6-luna）：须显式 reasoning_effort=none
 * - Gemini 3：不能 none/minimal，缺省或关闭档抬到 low
 * - GLM-5.3：不能 none，保留/压到合法档（默认 low）
 * - GLM-5.2 / 旧版：thinking disabled，去掉 effort
 */
export function forceReasoningEffortNoneWhenTools(
  body: Record<string, unknown>,
  model?: string,
): void {
  const tools = body.tools;
  if (!Array.isArray(tools) || tools.length === 0) return;

  const modelId =
    (typeof model === "string" && model) ||
    (typeof body.model === "string" ? body.model : "");
  const glm = classifyGlmThinking(modelId);

  if (glm === "effort_lhm_always_on") {
    const current = sanitizeReasoningEffort(body.reasoning_effort) ?? "low";
    body.thinking = { type: "enabled" };
    body.reasoning_effort = mapGlm53Effort(current);
    return;
  }
  if (modelRejectsDisabledReasoning(modelId)) {
    writeGeminiReasoning(
      body,
      modelId,
      sanitizeReasoningEffort(body.reasoning_effort),
    );
    return;
  }
  if (glm === "effort_full" || glm === "thinking_only") {
    body.thinking = { type: "disabled" };
    delete body.reasoning_effort;
    return;
  }

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

/** OpenRouter 等：该端点必须开思考，显式 none / disabled 会被 400。 */
export function isReasoningMandatoryError(
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
  return (
    /reasoning is mandatory/.test(message) && /cannot be disabled/.test(message)
  );
}

function isThinkingDisabled(thinking: unknown): boolean {
  return (
    !!thinking &&
    typeof thinking === "object" &&
    (thinking as { type?: unknown }).type === "disabled"
  );
}

/**
 * 把关闭思考的字段抬到合法最低档 low。
 * 只改 none / minimal / disabled；已经是 low 及以上则不动，避免空转重试。
 */
export function applyMandatoryReasoningFloor(
  body: Record<string, unknown>,
  tried: Set<string>,
): boolean {
  if (tried.has("reasoning_mandatory_floor")) return false;

  let changed = false;
  if (isThinkingDisabled(body.thinking)) {
    body.thinking = { type: "enabled" };
    changed = true;
  }

  const effort = sanitizeReasoningEffort(body.reasoning_effort);
  if (effort === "none" || effort === "minimal") {
    body.reasoning_effort = "low";
    body.reasoning = { effort: "low" };
    changed = true;
  }

  if (body.reasoning && typeof body.reasoning === "object") {
    const reasoning = { ...(body.reasoning as Record<string, unknown>) };
    const effortValue =
      typeof reasoning.effort === "string"
        ? reasoning.effort.trim().toLowerCase()
        : "";
    if (
      reasoning.enabled === false ||
      effortValue === "none" ||
      effortValue === "minimal"
    ) {
      delete reasoning.enabled;
      reasoning.effort = "low";
      body.reasoning = reasoning;
      changed = true;
    }
  }

  if (!changed) return false;
  tried.add("reasoning_mandatory_floor");
  return true;
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

  // tools + reasoning_effort 冲突：按型号改写（非 GLM → none；GLM 另处理）
  if (
    field === "reasoning_effort" &&
    Array.isArray(body.tools) &&
    body.tools.length > 0 &&
    !tried.has("reasoning_effort_none")
  ) {
    const before = snapshotThinkingFields(body);
    forceReasoningEffortNoneWhenTools(body);
    tried.add("reasoning_effort_none");
    if (snapshotThinkingFields(body) !== before) return true;
    // 已是目标态仍报错 → 继续往下删字段
  }

  if (!(field in body)) return false;
  delete body[field];
  tried.add(field);
  return true;
}

function snapshotThinkingFields(body: Record<string, unknown>): string {
  return JSON.stringify({
    reasoning_effort: body.reasoning_effort ?? null,
    thinking: body.thinking ?? null,
  });
}

function applyToolsReasoningEffortNone(
  body: Record<string, unknown>,
  tried: Set<string>,
): boolean {
  if (
    !Array.isArray(body.tools) ||
    body.tools.length === 0 ||
    tried.has("reasoning_effort_none")
  ) {
    return false;
  }
  const before = snapshotThinkingFields(body);
  forceReasoningEffortNoneWhenTools(body);
  if (snapshotThinkingFields(body) === before) return false;
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

    if (isReasoningMandatoryError(text, last.status)) {
      if (applyMandatoryReasoningFloor(next, tried)) {
        body = next;
        continue;
      }
    }

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
