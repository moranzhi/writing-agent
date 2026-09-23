/**
 * 节点可绑定的全局库：某能力声明 libraries 后，design-step 注入对应块。
 * 新库：实现 formatForPrompt，在本文件 register。
 */

import { formatPreferenceCatalogForPrompt } from "../preference/catalog.js";
import { formatStylePackCatalogForPrompt } from "../style-pack/catalog.js";

export type LibraryProvider = {
  id: string;
  /** 给人看的短名 */
  label: string;
  /** 空串 = 库空或无可注入，跳过 */
  formatForPrompt: () => string;
};

const providers = new Map<string, LibraryProvider>();

export function registerLibrary(provider: LibraryProvider): void {
  const id = provider.id.trim();
  if (!id) return;
  providers.set(id, { ...provider, id });
}

export function getLibrary(id: string): LibraryProvider | undefined {
  return providers.get(id.trim());
}

export function listRegisteredLibraries(): LibraryProvider[] {
  return [...providers.values()];
}

/** 从 catalog / meta 原始值收成 id 列表 */
export function parseLibraryIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length ? ids : undefined;
}

/**
 * 按节点绑定的库 id 拼注入块；未知 id 忽略；库空跳过。
 */
export function formatBoundLibrariesForPrompt(
  libraryIds: readonly string[] | undefined,
): string {
  if (!libraryIds?.length) return "";
  const blocks: string[] = [];
  for (const id of libraryIds) {
    const provider = providers.get(id.trim());
    if (!provider) continue;
    const text = provider.formatForPrompt().trim();
    if (text) blocks.push(text);
  }
  return blocks.join("\n\n");
}

// —— 内置库 ——
registerLibrary({
  id: "style-packs",
  label: "文风库",
  formatForPrompt: formatStylePackCatalogForPrompt,
});

registerLibrary({
  id: "preferences",
  label: "偏好库",
  formatForPrompt: formatPreferenceCatalogForPrompt,
});

/**
 * 从模块列表收集绑定的库 id（去重、保序）。
 * 对话落盘：通常传入 intake≠recipe 的模块。
 */
export function collectLibraryIdsFromModules(
  modules: ReadonlyArray<{ libraries?: readonly string[] }>,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of modules) {
    for (const raw of m.libraries ?? []) {
      const id = typeof raw === "string" ? raw.trim() : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
