import type { ChatMessage } from "../llm/client.js";
import type { PresetPackage } from "../types/preset.js";
import { assemblePresetMessages } from "./assembler.js";
import { applyExtendedMarkers } from "./markers.js";
import {
  resolveWorldInfoMarker,
  type WorldInfoEntry,
  type WorldInfoPack,
} from "./world-info-pack.js";

const TASK_SYSTEM_ENTRY_ID = "task-system";
const TASK_SYSTEM_ENTRY_NAME = "任务契约";

function withTaskSystem(
  pack: WorldInfoPack,
  systemPrompt: string,
): WorldInfoPack {
  const text = systemPrompt.trim();
  if (!text) return pack;
  const entry: WorldInfoEntry = {
    id: TASK_SYSTEM_ENTRY_ID,
    name: TASK_SYSTEM_ENTRY_NAME,
    content: text,
  };
  return {
    ...pack,
    worldBookBefore: [entry, ...pack.worldBookBefore],
  };
}

/**
 * 严格按扩展 prompt_order 填洞。任务契约进 worldBookBefore，不在预设外另挂 system。
 */
export function assemblePlayWorkerMessages(params: {
  systemPrompt: string;
  preset: PresetPackage;
  pack: WorldInfoPack;
}): ChatMessage[] {
  const framed = applyExtendedMarkers(params.preset);
  const pack = withTaskSystem(params.pack, params.systemPrompt);
  return assemblePresetMessages(framed, (id) =>
    resolveWorldInfoMarker(pack, id),
  );
}

function isToolLoopBoundary(m: ChatMessage): boolean {
  if (m.role === "tool") return true;
  return Boolean(
    m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0,
  );
}

function formatHistoryMessages(msgs: ChatMessage[]): string {
  const parts: string[] = [];
  for (const m of msgs) {
    if (m.role === "user" && m.content.trim()) {
      parts.push(`【用户】\n${m.content.trim()}`);
    } else if (m.role === "assistant") {
      const text = (m.content ?? "").trim();
      if (text) parts.push(`【助手】\n${text}`);
    } else if (m.role === "system" && m.content.trim()) {
      parts.push(`【系统】\n${m.content.trim()}`);
    }
  }
  return parts.join("\n\n");
}

/**
 * 任务 messages → 只填四袋 + chatHistory；发出序列的首尾由预设 prompt_order 决定。
 * tool 循环尾接在夹心后。
 */
export function frameMessagesWithPreset(
  preset: PresetPackage,
  messages: ChatMessage[],
): ChatMessage[] {
  let splitAt = messages.length;
  for (let i = 0; i < messages.length; i++) {
    if (isToolLoopBoundary(messages[i]!)) {
      splitAt = i;
      break;
    }
  }
  const prefix = messages.slice(0, splitAt);
  const continuation = messages.slice(splitAt);

  const systems: string[] = [];
  const body: ChatMessage[] = [];
  for (const m of prefix) {
    if (m.role === "system") systems.push(m.content);
    else body.push(m);
  }

  let turn = "";
  let history = "";
  if (body.length > 0) {
    const last = body[body.length - 1]!;
    if (last.role === "user") {
      turn = last.content.trim();
      history = formatHistoryMessages(body.slice(0, -1));
    } else {
      history = formatHistoryMessages(body);
    }
  }

  const framed = assemblePlayWorkerMessages({
    systemPrompt: systems.join("\n\n"),
    preset,
    pack: {
      worldBookBefore: [],
      history,
      worldBookAfter: [],
      turn,
      postTurn: [],
    },
  });

  return continuation.length > 0 ? [...framed, ...continuation] : framed;
}
