import type { ChatMessage } from "../llm/client.js";
import type { PresetPackage } from "../types/preset.js";
import { isStUnfilledMarker } from "./markers.js";

export type MarkerResolver = (identifier: string) => string | null;

const defaultMarkerResolver: MarkerResolver = () => null;

/**
 * 按 prompt_order 装配 preset 消息。
 * 酒馆角色卡 / WI marker 不走 resolver（空洞跳过）；自有洞由 resolver 填。
 */
export function assemblePresetMessages(
  preset: PresetPackage,
  resolveMarker: MarkerResolver = defaultMarkerResolver,
): ChatMessage[] {
  const promptById = new Map(preset.prompts.map((p) => [p.id, p]));
  const messages: ChatMessage[] = [];

  const ordered = [...preset.promptOrder].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );

  for (const orderItem of ordered) {
    if (!orderItem.enabled) continue;
    const entry = promptById.get(orderItem.promptId);
    if (!entry || !entry.enabled) continue;

    let content = entry.content.trim();
    const markerId = entry.sourceIdentifier || entry.id;
    const skipFill = isStUnfilledMarker(markerId);
    if (!content && entry.marker && !skipFill) {
      const resolved = resolveMarker(markerId);
      if (resolved?.trim()) content = resolved.trim();
    }

    if (!content) continue;

    messages.push({
      role: entry.role,
      content,
    });
  }

  return messages;
}

export function mergeMessages(
  presetMessages: ChatMessage[],
  taskMessages: ChatMessage[],
): ChatMessage[] {
  return [...presetMessages, ...taskMessages];
}
