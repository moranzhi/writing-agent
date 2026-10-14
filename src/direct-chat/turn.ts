import { randomUUID } from "node:crypto";
import { getApiProfile, profileToLlmConfig } from "../config/api-profiles.js";
import {
  ensureActiveProfileDefault,
  loadAppSettings,
  resolveActiveProfile,
} from "../config/settings.js";
import {
  OpenAiCompatibleProvider,
  type ChatMessage,
  type LlmProvider,
} from "../llm/client.js";
import { wrapLlmForSession } from "../llm/preset-wrapper.js";
import type { LlmTrackingContext } from "../llm/token-tracker.js";
import { assemblePlayWorkerMessages } from "../preset/play-frame.js";
import { getPreset, resolveActivePreset } from "../preset/store.js";
import type { WorldInfoPack } from "../preset/world-info-pack.js";
import { hasRealLlmConfig } from "../runtime/llm-factory.js";
import {
  pruneContextTraces,
  type LlmContextTrace,
} from "../types/context-trace.js";
import type { PresetPackage } from "../types/preset.js";
import {
  DEFAULT_DIRECT_CHAT_SYSTEM,
  buildPriorForWindow,
  type DirectChatAssistantReply,
  type DirectChatMessage,
  type DirectChatShellSlots,
  type DirectChatTurn,
  type DirectChatWindow,
} from "./types.js";

export type DirectChatTurnInput = {
  message: string;
  slots: DirectChatShellSlots;
  /** 本会话已落定的多轮（不含本轮） */
  priorMessages: Array<{ role: "user" | "assistant"; content: string }>;
  presetId?: string | null;
  /** 覆盖当前 API profile */
  profileId?: string | null;
  complete?: boolean;
};

export type DirectChatTurnResult = {
  messages: Array<{ role: string; content: string }>;
  reply: string | null;
  reasoning: string | null;
  model?: string;
  completed: boolean;
  contextTrace?: LlmContextTrace;
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

function formatTranscript(
  prior: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  const parts: string[] = [];
  for (const m of prior) {
    const text = m.content.trim();
    if (!text) continue;
    if (m.role === "user") parts.push(`【用户】\n${text}`);
    else parts.push(`【助手】\n${text}`);
  }
  return parts.join("\n\n");
}

export function buildChatHistory(
  seedHistory: string,
  priorMessages: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  const seed = seedHistory.trim();
  const transcript = formatTranscript(priorMessages);
  if (seed && transcript) return `${seed}\n\n${transcript}`;
  return seed || transcript;
}

export function worldInfoPackFromDirectChat(input: {
  message: string;
  slots: DirectChatShellSlots;
  priorMessages: Array<{ role: "user" | "assistant"; content: string }>;
}): WorldInfoPack {
  const history = buildChatHistory(
    input.slots.seedHistory,
    input.priorMessages,
  );
  return {
    worldBookBefore: optionalEntry(
      "direct-before",
      "直聊设定",
      input.slots.loreBefore,
    ),
    history,
    worldBookAfter: optionalEntry(
      "direct-after",
      "本轮状态",
      input.slots.loreAfter,
    ),
    turn: input.message.trim(),
    postTurn: optionalEntry("direct-post", "尾注", input.slots.postTurn),
  };
}

export function resolveDirectChatPreset(
  presetId?: string | null,
): PresetPackage {
  if (presetId?.trim()) {
    const preset = getPreset(presetId.trim());
    if (!preset) throw new Error(`预设不存在：${presetId}`);
    return preset;
  }
  const active = resolveActivePreset(loadAppSettings().activePresetId);
  if (!active) {
    throw new Error("请先在设置中选用一条预设；直聊请求必须由预设包裹");
  }
  return active;
}

export function systemPromptForSlots(slots: DirectChatShellSlots): string {
  return slots.systemPrompt.trim() || DEFAULT_DIRECT_CHAT_SYSTEM;
}

/** UI / 对照用的理想夹心 */
export function assembleDirectChatMessages(
  preset: PresetPackage,
  input: {
    message: string;
    slots: DirectChatShellSlots;
    priorMessages: Array<{ role: "user" | "assistant"; content: string }>;
  },
): ChatMessage[] {
  return assemblePlayWorkerMessages({
    systemPrompt: systemPromptForSlots(input.slots),
    preset,
    pack: worldInfoPackFromDirectChat(input),
  });
}

/** 交给 PresetLlmProvider 的任务消息（未夹心） */
export function buildDirectChatTaskMessages(input: {
  message: string;
  slots: DirectChatShellSlots;
  priorMessages: Array<{ role: "user" | "assistant"; content: string }>;
}): ChatMessage[] {
  const pack = worldInfoPackFromDirectChat(input);
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
  const user = ctx ? `${ctx}\n\n## 本轮输入\n${pack.turn}` : pack.turn;
  return [
    { role: "system", content: systemPromptForSlots(input.slots) },
    { role: "user", content: user },
  ];
}

function serializeMessages(
  messages: ChatMessage[],
): Array<{ role: string; content: string }> {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
  }));
}

function createTrackedLlm(
  preset: PresetPackage,
  profileId: string | null | undefined,
  trackingRef: { current: LlmTrackingContext },
): LlmProvider {
  if (profileId?.trim()) {
    const profile = getApiProfile(profileId.trim());
    if (!profile?.apiKey?.trim()) {
      throw new Error(`API 配置不可用：${profileId}`);
    }
    const inner = new OpenAiCompatibleProvider(profileToLlmConfig(profile));
    return wrapLlmForSession(inner, trackingRef, () => preset);
  }
  ensureActiveProfileDefault();
  const profile = resolveActiveProfile();
  if (!profile?.apiKey?.trim()) {
    throw new Error("未配置 API Key");
  }
  const inner = new OpenAiCompatibleProvider(profileToLlmConfig(profile));
  return wrapLlmForSession(inner, trackingRef, () => preset);
}

export async function runDirectChatTurn(
  input: DirectChatTurnInput,
): Promise<DirectChatTurnResult> {
  const message = input.message.trim();
  if (!message) throw new Error("缺少本轮输入");

  const preset = resolveDirectChatPreset(input.presetId);
  const turnInput = {
    message,
    slots: input.slots,
    priorMessages: input.priorMessages,
  };
  const assembled = serializeMessages(
    assembleDirectChatMessages(preset, turnInput),
  );

  const wantComplete = input.complete !== false;
  if (!wantComplete) {
    return {
      messages: assembled,
      reply: null,
      reasoning: null,
      completed: false,
      skipReason: "未请求生成",
    };
  }

  if (!hasRealLlmConfig() && !input.profileId?.trim()) {
    return {
      messages: assembled,
      reply: null,
      reasoning: null,
      completed: false,
      skipReason: "未配置 API Key，只返回拼装后的上下文",
    };
  }

  const trackingRef = { current: {} as LlmTrackingContext };
  try {
    const llm = createTrackedLlm(preset, input.profileId, trackingRef);
    const result = await llm.complete(buildDirectChatTaskMessages(turnInput), {
      caller: "direct-chat",
    });
    const contextTrace = trackingRef.current.pendingContextTrace;
    return {
      messages: assembled,
      reply: result.content,
      reasoning: result.reasoning ?? null,
      model: result.model,
      completed: true,
      ...(contextTrace ? { contextTrace } : {}),
    };
  } catch (err) {
    return {
      messages: assembled,
      reply: null,
      reasoning: null,
      completed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function appendTurnMessages(params: {
  prior: DirectChatMessage[];
  userText: string;
  reply: string;
  reasoning?: string | null;
  model?: string;
  contextTrace?: LlmContextTrace;
  keepTraceLatest?: number;
}): DirectChatMessage[] {
  const ts = new Date().toISOString();
  const userMsg: DirectChatMessage = {
    id: randomUUID(),
    role: "user",
    content: params.userText,
    createdAt: ts,
  };
  const assistantMsg: DirectChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: params.reply,
    createdAt: ts,
    ...(params.reasoning ? { thinking: params.reasoning } : {}),
    ...(params.model ? { model: params.model } : {}),
    ...(params.contextTrace ? { contextTrace: params.contextTrace } : {}),
  };
  const keep =
    params.keepTraceLatest ?? loadAppSettings().contextTraceKeepLatest ?? 3;
  return pruneContextTraces([...params.prior, userMsg, assistantMsg], keep);
}

export type DirectChatMultiTurnInput = {
  message: string;
  slots: DirectChatShellSlots;
  presetId?: string | null;
  windows: DirectChatWindow[];
  /** 已落定轮次（不含本轮） */
  turns: DirectChatTurn[];
  complete?: boolean;
};

export type DirectChatMultiWindowResult = {
  windowId: string;
  profileId: string;
  reply: string | null;
  reasoning: string | null;
  model?: string;
  completed: boolean;
  contextTrace?: LlmContextTrace;
  skipReason?: string;
  error?: string;
};

export type DirectChatMultiTurnResult = {
  results: DirectChatMultiWindowResult[];
  turn: DirectChatTurn;
};

/** 同一用户输入，对各窗口并行 completion；各自 prior 按选定规则拼装 */
export async function runDirectChatMultiTurn(
  input: DirectChatMultiTurnInput,
): Promise<DirectChatMultiTurnResult> {
  const message = input.message.trim();
  if (!message) throw new Error("缺少本轮输入");
  if (!input.windows.length) throw new Error("至少需要一个模型窗口");

  const ts = new Date().toISOString();
  const results = await Promise.all(
    input.windows.map(async (win) => {
      const prior = buildPriorForWindow(input.turns, win.id);
      const single = await runDirectChatTurn({
        message,
        slots: input.slots,
        priorMessages: prior,
        presetId: input.presetId,
        profileId: win.profileId,
        complete: input.complete,
      });
      return {
        windowId: win.id,
        profileId: win.profileId,
        reply: single.reply,
        reasoning: single.reasoning,
        model: single.model ?? win.model,
        completed: single.completed,
        ...(single.contextTrace ? { contextTrace: single.contextTrace } : {}),
        ...(single.skipReason ? { skipReason: single.skipReason } : {}),
        ...(single.error ? { error: single.error } : {}),
      } satisfies DirectChatMultiWindowResult;
    }),
  );

  const replies: DirectChatAssistantReply[] = results.map((r) => ({
    windowId: r.windowId,
    content: r.reply ?? "",
    ...(r.reasoning ? { thinking: r.reasoning } : {}),
    ...(r.model ? { model: r.model } : {}),
    ...(r.error ? { error: r.error } : {}),
    ...(r.contextTrace ? { contextTrace: r.contextTrace } : {}),
  }));

  const turn: DirectChatTurn = {
    id: randomUUID(),
    user: { content: message, createdAt: ts },
    replies,
    createdAt: ts,
  };

  return { results, turn };
}
