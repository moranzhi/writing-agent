/**
 * API profile 能力探测与 structured 投递选路。
 * 优先 response json_schema；不可用则 forced tool；再退 json_object。
 */

import {
  applyRejectedGenerationField,
  forceReasoningEffortNoneWhenTools,
  isToolsReasoningEffortConflictError,
  parseRejectedGenerationField,
} from "./generation-compat.js";

export type CapabilityStatus = "ok" | "fail" | "unknown";

export type StructuredDeliveryMode =
  | "json_schema"
  | "forced_tool"
  | "json_object"
  | "text";

export type ProfileCapabilities = {
  /** 普通聊天 /models 或极简 completion */
  chat: CapabilityStatus;
  /** response_format: json_object */
  jsonObject: CapabilityStatus;
  /** response_format: json_schema（真 schema 约束） */
  jsonSchema: CapabilityStatus;
  /** tools + 返回 tool_calls */
  tools: CapabilityStatus;
  /** tool_choice=required（或指名函数）能强制提交 */
  forcedTool: CapabilityStatus;
  /** tools[].function.strict（若探测时带了） */
  strictTool: CapabilityStatus;
  testedAt?: string;
  notes?: string[];
};

export const UNKNOWN_CAPABILITIES: ProfileCapabilities = {
  chat: "unknown",
  jsonObject: "unknown",
  jsonSchema: "unknown",
  tools: "unknown",
  forcedTool: "unknown",
  strictTool: "unknown",
};

/** 探测固定 low，避免 always-on 思考把 max_tokens 吃光导致误判 */
export const CAPABILITY_PROBE_REASONING_EFFORT = "low" as const;

const PROBE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ping", "n"],
  properties: {
    ping: { type: "string" },
    n: { type: "number" },
  },
} as const;

const PROBE_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_probe",
    description: "Submit the probe result. Always call this tool.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["ping", "n"],
      properties: {
        ping: { type: "string" },
        n: { type: "number" },
      },
    },
  },
};

const PROBE_TOOL_STRICT = {
  type: "function" as const,
  function: {
    ...PROBE_TOOL.function,
    strict: true,
  },
};

export function normalizeCapabilities(
  raw: unknown,
): ProfileCapabilities | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const read = (k: string): CapabilityStatus => {
    const v = row[k];
    if (v === "ok" || v === "fail" || v === "unknown") return v;
    return "unknown";
  };
  return {
    chat: read("chat"),
    jsonObject: read("jsonObject"),
    jsonSchema: read("jsonSchema"),
    tools: read("tools"),
    forcedTool: read("forcedTool"),
    strictTool: read("strictTool"),
    testedAt: typeof row.testedAt === "string" ? row.testedAt : undefined,
    notes: Array.isArray(row.notes)
      ? row.notes.filter((x): x is string => typeof x === "string")
      : undefined,
  };
}

/** 选路：schema → forced tool → json_object → text */
export function resolveStructuredDeliveryMode(
  caps: ProfileCapabilities | null | undefined,
): StructuredDeliveryMode {
  if (!caps) return "json_object";
  if (caps.jsonSchema === "ok") return "json_schema";
  if (caps.forcedTool === "ok") return "forced_tool";
  if (caps.jsonObject === "ok") return "json_object";
  return "text";
}

export function deliveryModeLabel(mode: StructuredDeliveryMode): string {
  switch (mode) {
    case "json_schema":
      return "JSON Schema";
    case "forced_tool":
      return "强制 Tool";
    case "json_object":
      return "JSON Object";
    default:
      return "纯文本";
  }
}

type ProbeConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

async function postOnce(
  config: ProbeConfig,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, ...body }),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      /* ignore */
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 探测请求始终带 reasoning_effort=low。
 * 若供应商拒收该字段，剥掉后再试；tools 冲突则改 none 再试。
 */
async function postChat(
  config: ProbeConfig,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const withEffort: Record<string, unknown> = {
    ...body,
    reasoning_effort: CAPABILITY_PROBE_REASONING_EFFORT,
  };
  const first = await postOnce(config, withEffort);
  if (first.ok || (first.status !== 400 && first.status !== 422)) return first;

  const retryBody = { ...withEffort };
  const tried = new Set<string>();

  if (isToolsReasoningEffortConflictError(first.text, first.status)) {
    forceReasoningEffortNoneWhenTools(retryBody, config.model);
    tried.add("reasoning_effort_none");
    return postOnce(config, retryBody);
  }

  const rejected = parseRejectedGenerationField(first.text);
  if (!rejected) return first;
  if (!applyRejectedGenerationField(retryBody, rejected, tried)) {
    return first;
  }
  return postOnce(config, retryBody);
}

function assistantMessage(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    return null;
  }
  const msg = (choices[0] as { message?: unknown }).message;
  if (!msg || typeof msg !== "object") return null;
  return msg as Record<string, unknown>;
}

function hasToolCallNamed(json: unknown, name: string): boolean {
  const msg = assistantMessage(json);
  if (!msg) return false;
  const calls = msg.tool_calls;
  if (!Array.isArray(calls)) return false;
  return calls.some((c) => {
    if (!c || typeof c !== "object") return false;
    const fn = (c as { function?: unknown }).function;
    if (!fn || typeof fn !== "object") return false;
    return (fn as { name?: unknown }).name === name;
  });
}

function contentLooksLikeJsonObject(json: unknown): boolean {
  const msg = assistantMessage(json);
  const content = msg?.content;
  if (typeof content !== "string" || !content.trim()) return false;
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * 对单个 profile 跑一轮能力探测（会真实打 API，费用很小）。
 */
export async function probeProfileCapabilities(
  config: ProbeConfig,
): Promise<ProfileCapabilities> {
  const notes: string[] = [];
  const caps: ProfileCapabilities = {
    ...UNKNOWN_CAPABILITIES,
    testedAt: new Date().toISOString(),
  };

  const chat = await postChat(config, {
    messages: [{ role: "user", content: "Reply with exactly: ok" }],
    max_tokens: 32,
  });
  caps.chat = chat.ok ? "ok" : "fail";
  if (!chat.ok) {
    notes.push(`chat: HTTP ${chat.status} ${chat.text.slice(0, 160)}`);
    caps.notes = notes;
    return caps;
  }

  const jsonObject = await postChat(config, {
    messages: [
      {
        role: "user",
        content:
          'Return a JSON object with keys ping (string "ok") and n (number 1).',
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 128,
  });
  caps.jsonObject =
    jsonObject.ok && contentLooksLikeJsonObject(jsonObject.json) ? "ok" : "fail";
  if (!jsonObject.ok) {
    notes.push(`json_object: HTTP ${jsonObject.status} ${jsonObject.text.slice(0, 120)}`);
  } else if (caps.jsonObject === "fail") {
    notes.push("json_object: 返回了但不是可解析对象");
  }

  const jsonSchema = await postChat(config, {
    messages: [
      {
        role: "user",
        content: "Fill ping=ok and n=1.",
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "probe_result",
        strict: true,
        schema: PROBE_SCHEMA,
      },
    },
    max_tokens: 128,
  });
  caps.jsonSchema =
    jsonSchema.ok && contentLooksLikeJsonObject(jsonSchema.json) ? "ok" : "fail";
  if (!jsonSchema.ok) {
    notes.push(`json_schema: HTTP ${jsonSchema.status} ${jsonSchema.text.slice(0, 120)}`);
  }

  const tools = await postChat(config, {
    messages: [
      {
        role: "user",
        content: "Call submit_probe with ping=ok and n=1.",
      },
    ],
    tools: [PROBE_TOOL],
    tool_choice: "auto",
    max_tokens: 256,
  });
  caps.tools = tools.ok && hasToolCallNamed(tools.json, "submit_probe") ? "ok" : "fail";
  if (!tools.ok) {
    notes.push(`tools: HTTP ${tools.status} ${tools.text.slice(0, 120)}`);
  } else if (caps.tools === "fail") {
    notes.push("tools: 请求成功但未返回 submit_probe");
  }

  const forced = await postChat(config, {
    messages: [
      {
        role: "user",
        content: "Submit the probe.",
      },
    ],
    tools: [PROBE_TOOL],
    tool_choice: "required",
    max_tokens: 256,
  });
  let forcedOk =
    forced.ok && hasToolCallNamed(forced.json, "submit_probe");
  if (!forcedOk && forced.ok) {
    const named = await postChat(config, {
      messages: [{ role: "user", content: "Submit the probe." }],
      tools: [PROBE_TOOL],
      tool_choice: {
        type: "function",
        function: { name: "submit_probe" },
      },
      max_tokens: 256,
    });
    forcedOk = named.ok && hasToolCallNamed(named.json, "submit_probe");
    if (!named.ok) {
      notes.push(`forced_tool(named): HTTP ${named.status} ${named.text.slice(0, 120)}`);
    }
  } else if (!forced.ok) {
    notes.push(`forced_tool: HTTP ${forced.status} ${forced.text.slice(0, 120)}`);
  }
  caps.forcedTool = forcedOk ? "ok" : "fail";

  if (caps.tools === "ok" || caps.forcedTool === "ok") {
    const strict = await postChat(config, {
      messages: [{ role: "user", content: "Submit the probe." }],
      tools: [PROBE_TOOL_STRICT],
      tool_choice: "required",
      max_tokens: 256,
    });
    caps.strictTool =
      strict.ok && hasToolCallNamed(strict.json, "submit_probe") ? "ok" : "fail";
    if (!strict.ok) {
      notes.push(`strict_tool: HTTP ${strict.status} ${strict.text.slice(0, 120)}`);
    }
  } else {
    caps.strictTool = "fail";
  }

  caps.notes = notes.length ? notes : undefined;
  return caps;
}
