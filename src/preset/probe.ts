import type { ChatMessage } from "../llm/client.js";
import type { PresetPackage } from "../types/preset.js";
import { assemblePlayWorkerMessages } from "./play-frame.js";
import type { WorldInfoPack } from "./world-info-pack.js";

/** 试跑窗口用的短契约，不是 play worker SKILL。 */
export const PROBE_SYSTEM_PROMPT =
  "试跑本条预设：根据已拼好的上下文写一轮短回复。产物是对白或叙述，对应本轮用户输入。";

export const DEFAULT_PROBE_CONTEXT = {
  loreBefore: "一座雨夜的港口旅馆。柜台点着油灯。",
  history: "店员：今晚只剩阁楼那间。\n你：好。",
  loreAfter: "时间：深夜。地点：旅馆大厅。",
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

  const messages = assemblePresetProbe(params.preset, {
    ...params.input,
    message,
  });
  const serialized = serializeProbeMessages(messages);

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
    const result = await params.complete(messages);
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
