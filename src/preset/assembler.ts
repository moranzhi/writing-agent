import type { ChatMessage } from "../llm/client.js";
import type { PresetPackage } from "../types/preset.js";

export type MarkerResolver = (identifier: string) => string | null;

const defaultMarkerResolver: MarkerResolver = () => null;

/**
 * 按 prompt_order 装配 preset 消息，插入在所有业务 prompt 之前。
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
    if (!content && entry.marker) {
      const resolved = resolveMarker(entry.sourceIdentifier);
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
