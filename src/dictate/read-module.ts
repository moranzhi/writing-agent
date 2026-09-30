import { createHash } from "node:crypto";
import {
  getModuleSection,
  loadModulePrompt,
  parseModulePromptSections,
  type ModuleCatalog,
  type ModuleCatalogEntry,
} from "../skills/creation-flow.js";
import {
  loadShellRefCatalog,
  type ShellRefEntry,
} from "../skills/shell-ref-catalog.js";
import {
  formatMarkdownSafeSubsetForPrompt,
  loadMarkdownSafeSubsetCatalog,
} from "../skills/markdown-safe-subset.js";
import { getLibrary } from "../libraries/registry.js";
import {
  getPreference,
  listActivePreferences,
} from "../preference/store.js";
import {
  getStylePack,
  listActiveStylePacks,
} from "../style-pack/store.js";

export const DICTATE_MODULE_READ_STATE_TAG = "运行.对话落盘.已读能力";

export type DictateModuleReadPayload = {
  module_id: string;
  name: string;
  artifact: string;
  version: string;
  task: string;
  principles: string;
  output: string;
  score: string;
  score_dimensions: string[];
  libraries: Array<{
    library_id: string;
    label: string;
    entries: Array<{ id: string; name?: string; summary: string }>;
  }>;
  constraints: string[];
  presentation_references?: {
    shells: ShellRefEntry[];
    markdown_safe_subset: string;
    iframe_contract: string;
  };
};

export type DictateModuleReadState = {
  schema: "dictate-module-read.v1";
  modules: Record<string, string>;
  active_module_id?: string;
};

export async function buildDictateModuleReadIndex(params: {
  skillPackRoot: string;
  catalog: ModuleCatalog;
}): Promise<Map<string, DictateModuleReadPayload>> {
  const index = new Map<string, DictateModuleReadPayload>();
  const [shells, markdown] = await Promise.all([
    loadShellRefCatalog(params.skillPackRoot),
    loadMarkdownSafeSubsetCatalog(params.skillPackRoot),
  ]);
  for (const module of params.catalog.modules) {
    const prompt = await loadModulePrompt(params.skillPackRoot, module.id);
    if (!prompt) continue;
    const sections = parseModulePromptSections(prompt);
    const payload: DictateModuleReadPayload = {
      module_id: module.id,
      name: module.name,
      artifact: module.artifact,
      version: modulePromptVersion(sections.blocks),
      task: getModuleSection(sections, "task") ?? "",
      principles: getModuleSection(sections, "principles") ?? "",
      output: getModuleSection(sections, "output") ?? "",
      score: getModuleSection(sections, "score") ?? "",
      score_dimensions: extractScoreDimensions(
        getModuleSection(sections, "score") ?? "",
      ),
      libraries: libraryDirectories(module),
      constraints: moduleConstraints(module),
      ...(module.id === "reply-format" || module.id === "zero-layer-reply-format"
        ? {
            presentation_references: {
              shells,
              markdown_safe_subset: markdown
                ? formatMarkdownSafeSubsetForPrompt(markdown)
                : "",
              iframe_contract:
                module.id === "reply-format"
                  ? "正文组成生成一次 frontend 模板与数据契约；游玩每轮只传 present.v1 blocks，由程序装进已固定的壳。iframe 使用 sandbox=\"allow-scripts\"，不含 allow-same-origin；模板只通过 present.onData(cb) 收数据，不提供 action 回传。html+css+js 合计不超过 60 KB；未知 blocks 键必须保留。"
                  : "0层正文组成生成一次持久前端；之后每轮只提交 slot_updates。模板通过 zeroLayer.onInit 与 zeroLayer.onPatch 收数据，不提供 action 回传。html+css+js 合计不超过 60 KB。",
            },
          }
        : {}),
    };
    index.set(module.id, payload);
    index.set(module.name, payload);
  }
  return index;
}

export function parseDictateModuleReadState(
  raw: string | undefined | null,
): DictateModuleReadState {
  if (raw?.trim()) {
    try {
      const row = JSON.parse(raw) as DictateModuleReadState;
      if (
        row?.schema === "dictate-module-read.v1" &&
        row.modules &&
        typeof row.modules === "object"
      ) {
        return row;
      }
    } catch {
      // Reset malformed internal state.
    }
  }
  return { schema: "dictate-module-read.v1", modules: {} };
}

export function serializeDictateModuleReadState(
  state: DictateModuleReadState,
): string {
  return JSON.stringify(state);
}

export function readLibraryEntries(params: {
  module: DictateModuleReadPayload;
  libraryId: string;
  entryIds: string[];
  reason?: string;
}): { entries?: unknown[]; error?: string } {
  const libraryId = params.libraryId.trim();
  const bound = params.module.libraries.some(
    (library) => library.library_id === libraryId,
  );
  if (!bound) {
    return { error: `能力 ${params.module.module_id} 未绑定库 ${libraryId}` };
  }
  const ids = [...new Set(params.entryIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { error: "entry_ids 不能为空" };
  if (ids.length > 2 && !params.reason?.trim()) {
    return { error: "默认最多读取两个库条目；读取更多时必须提供 reason" };
  }
  if (libraryId === "preferences") {
    const entries = ids.map(getPreference);
    const missing = ids.filter((_, index) => !entries[index]);
    if (missing.length) return { error: `偏好库无条目：${missing.join("、")}` };
    return {
      entries: entries.map((entry) => ({
        id: entry!.id,
        content: entry!.content,
      })),
    };
  }
  if (libraryId === "style-packs") {
    const entries = ids.map(getStylePack);
    const missing = ids.filter((_, index) => !entries[index]);
    if (missing.length) return { error: `文风库无条目：${missing.join("、")}` };
    return {
      entries: entries.map((entry) => ({
        id: entry!.id,
        name: entry!.name,
        content: entry!.content,
        ...(entry!.samples ? { samples: entry!.samples } : {}),
      })),
    };
  }
  return { error: `库 ${libraryId} 尚不支持按条目读取` };
}

function modulePromptVersion(blocks: Record<string, string>): string {
  const source = ["task", "principles", "output", "score"]
    .map((id) => `${id}\n${blocks[id]?.trim() ?? ""}`)
    .join("\n---\n");
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

function libraryDirectories(module: ModuleCatalogEntry): DictateModuleReadPayload["libraries"] {
  return (module.libraries ?? []).map((id) => {
    const provider = getLibrary(id);
    if (id === "preferences") {
      return {
        library_id: id,
        label: provider?.label ?? id,
        entries: listActivePreferences().map((entry) => ({
          id: entry.id,
          summary: clip(entry.content),
        })),
      };
    }
    if (id === "style-packs") {
      return {
        library_id: id,
        label: provider?.label ?? id,
        entries: listActiveStylePacks().map((entry) => ({
          id: entry.id,
          name: entry.name,
          summary: clip(entry.content),
        })),
      };
    }
    return { library_id: id, label: provider?.label ?? id, entries: [] };
  });
}

function repeatableLandLine(module: ModuleCatalogEntry): string {
  if (module.id === "opening-setup") {
    return "产物可反复：每条开场使用 设计.开场白#场景短码；同完整 tag 才覆盖。游玩时左右切换，选中的一条作为 0 层";
  }
  if (module.id === "zero-layer-opening-setup") {
    return "产物可反复：每条开场使用 设计.0层开场白与初态#场景短码；同完整 tag 才覆盖。游玩时左右切换，选中的一条作为 0 层";
  }
  if (module.id === "generation-rules") {
    return "产物可反复：每条规则单独落盘，使用 设计.生成规则#规则名；同完整 tag 才覆盖";
  }
  if (module.id === "concrete-instances") {
    return "产物可反复：每条实例单独落盘，使用 设计.具体实例#名称；同完整 tag 才覆盖";
  }
  if (module.repeatable) {
    return `产物可反复：每条单独落盘，使用 ${module.artifact}#唯一id；同完整 tag 才覆盖`;
  }
  return `产物 tag：${module.artifact}`;
}

function moduleConstraints(module: ModuleCatalogEntry): string[] {
  const constraints = [repeatableLandLine(module)];
  if (module.id === "generation-rules") {
    constraints.push(
      "产物层由生命周期决定：只预生成=intermediate；仅游玩期 / 预生成并游玩期=final",
    );
    constraints.push("每个产物只写一条规则");
  } else if (module.layer) {
    constraints.push(`默认产物层：${module.layer}`);
  }
  if (module.mount?.length) constraints.push(`默认挂载：${module.mount.join("、")}`);
  if (module.auto) constraints.push("机械程序节点，不受读取门禁");
  return constraints;
}

function clip(text: string, max = 140): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

function extractScoreDimensions(score: string): string[] {
  const names: string[] = [];
  for (const match of score.matchAll(/^([^#\-\s][^：\n]{0,30})：\s*$/gm)) {
    const name = match[1]?.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
