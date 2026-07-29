import type {
  PresetPackage,
  PresetPromptEntry,
  PresetPromptRole,
} from "../types/preset.js";
import { savePreset } from "./store.js";

export type PresetEntryView = {
  orderIndex: number;
  id: string;
  name: string;
  role: PresetPromptRole;
  marker: boolean;
  content: string;
  /** prompt_order 与条目自身均启用 */
  enabled: boolean;
  orderEnabled: boolean;
  entryEnabled: boolean;
  /** 启用且有非空 content → 会注入 LLM */
  willInject: boolean;
};

/** @deprecated 名称保留：现为全部条目；过滤启用请用 filter */
export type PresetEnabledEntryView = PresetEntryView;

function sortOrder(preset: PresetPackage) {
  return [...preset.promptOrder].sort((a, b) => a.orderIndex - b.orderIndex);
}

function toView(
  orderIndex: number,
  entry: PresetPromptEntry,
  orderEnabled: boolean,
): PresetEntryView {
  const content = entry.content ?? "";
  const enabled = orderEnabled && entry.enabled;
  const trimmed = content.trim();
  return {
    orderIndex,
    id: entry.id,
    name: entry.name,
    role: entry.role,
    marker: entry.marker,
    content,
    enabled,
    orderEnabled,
    entryEnabled: entry.enabled,
    willInject: enabled && trimmed.length > 0,
  };
}

/** 按 prompt_order 列出全部条目（含未启用），便于设置页编辑 */
export function listAllPresetEntries(preset: PresetPackage): PresetEntryView[] {
  const promptById = new Map(preset.prompts.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const entries: PresetEntryView[] = [];

  for (const orderItem of sortOrder(preset)) {
    const entry = promptById.get(orderItem.promptId);
    if (!entry) continue;
    seen.add(entry.id);
    entries.push(toView(orderItem.orderIndex, entry, orderItem.enabled));
  }

  // 未进 order 的条目附在末尾
  let nextIndex =
    entries.reduce((m, e) => Math.max(m, e.orderIndex), -1) + 1;
  for (const entry of preset.prompts) {
    if (seen.has(entry.id)) continue;
    entries.push(toView(nextIndex++, entry, false));
  }

  return entries;
}

/** 仅启用中的条目（装配 / 旧 API 兼容） */
export function listEnabledPresetEntries(
  preset: PresetPackage,
): PresetEntryView[] {
  return listAllPresetEntries(preset).filter((e) => e.enabled);
}

export function countInjectingEntries(
  entries: Array<{ willInject: boolean }>,
): number {
  return entries.filter((e) => e.willInject).length;
}

export function countEnabledEntries(
  entries: Array<{ enabled: boolean }>,
): number {
  return entries.filter((e) => e.enabled).length;
}

export type PresetEntryPatch = {
  id: string;
  enabled?: boolean;
  content?: string;
  name?: string;
  role?: PresetPromptRole;
};

/**
 * 纯函数更新（不写盘）。启用状态同步 order + entry。
 */
export function applyPresetEntryPatches(
  preset: PresetPackage,
  patches: PresetEntryPatch[],
): PresetPackage {
  if (!patches.length) return preset;

  const prompts = preset.prompts.map((p) => ({ ...p }));
  const promptById = new Map(prompts.map((p) => [p.id, p]));
  let order = preset.promptOrder.map((o) => ({ ...o }));

  for (const patch of patches) {
    const entry = promptById.get(patch.id);
    if (!entry) {
      throw new Error(`条目不存在: ${patch.id}`);
    }
    if (typeof patch.content === "string") {
      entry.content = patch.content;
      if (entry.content.trim()) entry.marker = false;
    }
    if (typeof patch.name === "string" && patch.name.trim()) {
      entry.name = patch.name.trim();
    }
    if (
      patch.role === "system" ||
      patch.role === "user" ||
      patch.role === "assistant"
    ) {
      entry.role = patch.role;
    }
    if (typeof patch.enabled === "boolean") {
      entry.enabled = patch.enabled;
      const orderItem = order.find((o) => o.promptId === patch.id);
      if (orderItem) {
        orderItem.enabled = patch.enabled;
      } else if (patch.enabled) {
        const orderIndex =
          order.reduce((m, o) => Math.max(m, o.orderIndex), -1) + 1;
        order.push({
          promptId: patch.id,
          enabled: true,
          orderIndex,
        });
      }
    }
  }

  return {
    ...preset,
    prompts,
    promptOrder: order,
  };
}

/**
 * 更新一条或多条并落盘。
 */
export function patchPresetEntries(
  preset: PresetPackage,
  patches: PresetEntryPatch[],
): PresetPackage {
  return savePreset(applyPresetEntryPatches(preset, patches));
}
