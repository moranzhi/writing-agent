import type { PresetPackage, PresetPromptRole } from "../types/preset.js";

export type PresetEnabledEntryView = {
  orderIndex: number;
  id: string;
  name: string;
  role: PresetPromptRole;
  marker: boolean;
  content: string;
  /** 实际会注入 LLM 请求（有非空 content） */
  willInject: boolean;
};

/** 按 prompt_order 列出所有启用条目及其内容 */
export function listEnabledPresetEntries(
  preset: PresetPackage,
): PresetEnabledEntryView[] {
  const promptById = new Map(preset.prompts.map((p) => [p.id, p]));
  const ordered = [...preset.promptOrder].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );
  const entries: PresetEnabledEntryView[] = [];

  for (const orderItem of ordered) {
    if (!orderItem.enabled) continue;
    const entry = promptById.get(orderItem.promptId);
    if (!entry || !entry.enabled) continue;

    const content = entry.content.trim();
    entries.push({
      orderIndex: orderItem.orderIndex,
      id: entry.id,
      name: entry.name,
      role: entry.role,
      marker: entry.marker,
      content,
      willInject: content.length > 0,
    });
  }

  return entries;
}

export function countInjectingEntries(entries: PresetEnabledEntryView[]): number {
  return entries.filter((e) => e.willInject).length;
}
