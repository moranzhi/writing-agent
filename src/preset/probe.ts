import type { ChatMessage } from "../llm/client.js";
import type { PresetPackage } from "../types/preset.js";
import { assemblePlayWorkerMessages } from "./play-frame.js";
import type { WorldInfoPack } from "./world-info-pack.js";

/** 试跑窗口用的短契约，不是 play worker SKILL。 */
export const PROBE_SYSTEM_PROMPT =
  "试跑本条预设：对本轮输入做忠实扩写。不增删情节，不另起冲突。";

export const DEFAULT_PROBE_CONTEXT = {
  loreBefore: "写作要求：对本轮输入做忠实扩写；只展开已给出的动作与信息，不另起情节。",
  history: "扩写范围仅限本轮输入，勿补前因后果或无关对话。",
  loreAfter: "",
  postTurn: "",
};

export type PresetProbeInput = {
  message: string;
  loreBefore?: string;
  history?: string;
  loreAfter?: string;
  postTurn?: string;
};

export type PresetProbeMessage = {
  role: string;
  content: string;
};

export type PresetProbeResult = {
  messages: PresetProbeMessage[];
  reply: string | null;
  reasoning: string | null;
  completed: boolean;
  skipReason?: string;
  error?: string;
};

function optionalEntry(
  id: string,
  name: string,
  content: string,
): WorldInfoPack["worldBookBefore"] {
  const text = content.trim();
  return text ? [{ id, name, content: text }] : [];
}

export function worldInfoPackFromProbeInput(
  input: PresetProbeInput,
): WorldInfoPack {
  const loreBefore = input.loreBefore ?? DEFAULT_PROBE_CONTEXT.loreBefore;
  const history = input.history ?? DEFAULT_PROBE_CONTEXT.history;
  const loreAfter = input.loreAfter ?? DEFAULT_PROBE_CONTEXT.loreAfter;
  const postTurn = input.postTurn ?? DEFAULT_PROBE_CONTEXT.postTurn;

  return {
    worldBookBefore: optionalEntry("probe-before", "试跑设定", loreBefore),
    history: history.trim(),
    worldBookAfter: optionalEntry("probe-after", "本轮状态", loreAfter),
    turn: input.message.trim(),
    postTurn: optionalEntry("probe-post", "尾注", postTurn),
  };
}

/** 已夹心的试跑 messages（仅 UI / 对照）；真正发模型走任务消息 + PresetLlmProvider。 */
export function assemblePresetProbe(
  preset: PresetPackage,
  input: PresetProbeInput,
): ChatMessage[] {
  return assemblePlayWorkerMessages({
    systemPrompt: PROBE_SYSTEM_PROMPT,
    preset,
    pack: worldInfoPackFromProbeInput(input),
  });
}

/** 交给 wrapLlmForSession 的任务消息（未夹心）。 */
export function buildPresetProbeTaskMessages(
  input: PresetProbeInput,
): ChatMessage[] {
  const pack = worldInfoPackFromProbeInput(input);
  const parts: string[] = [];
  for (const e of pack.worldBookBefore) {
    parts.push(`### ${e.name}\n\n${e.content}`);
  }
  if (pack.history.trim()) parts.push(pack.history.trim());
  for (const e of pack.worldBookAfter) {
    parts.push(`### ${e.name}\n\n${e.content}`);
  }
  for (const e of pack.postTurn) {
    parts.push(`### ${e.name}\n\n${e.content}`);
  }
  const ctx = parts.join("\n\n").trim();
  const user = ctx
    ? `${ctx}\n\n## 本轮输入\n${pack.turn}`
    : pack.turn;
  return [
    { role: "system", content: PROBE_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

export function serializeProbeMessages(
  messages: ChatMessage[],
): PresetProbeMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
  }));
}

export async function runPresetProbe(params: {
  preset: PresetPackage;
  input: PresetProbeInput;
  complete?: (
    messages: ChatMessage[],
  ) => Promise<{ content: string; reasoning?: string }>;
}): Promise<PresetProbeResult> {
  const message = params.input.message.trim();
  if (!message) {
    throw new Error("缺少本轮输入");
  }

  const input = { ...params.input, message };
  // UI 仍展示「理想分袋夹心」；发模型只交任务消息，由统一包装层夹心
  const serialized = serializeProbeMessages(
    assemblePresetProbe(params.preset, input),
  );

  if (!params.complete) {
    return {
      messages: serialized,
      reply: null,
      reasoning: null,
      completed: false,
      skipReason: "未请求生成",
    };
  }

  try {
    const result = await params.complete(buildPresetProbeTaskMessages(input));
    return {
      messages: serialized,
      reply: result.content,
      reasoning: result.reasoning ?? null,
      completed: true,
    };
  } catch (err) {
    return {
      messages: serialized,
      reply: null,
      reasoning: null,
      completed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
