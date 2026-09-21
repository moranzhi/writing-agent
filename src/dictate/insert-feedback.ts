/**
 * insert(tag) → 反查能力 → 独立「回复模块」规范，塞进 tool result。
 * 一轮可多次 insert：每个模块各自一份；末尾回复须分段全部附带。
 * 不照搬 schema / mount；只抽 probe、交互原则、自评关注点。
 */

import {
  getModuleSection,
  loadModulePrompt,
  parseModulePromptSections,
  type ModuleCatalog,
  type ModuleCatalogEntry,
} from "../skills/creation-flow.js";

/** 对话落盘常用简化 tag → 能力 id（catalog.artifact 之外） */
export const DICTATE_INSERT_TAG_ALIASES: Readonly<Record<string, string>> = {
  "设计.开场白": "opening-setup",
  "设计.美学纲领": "aesthetics-interaction",
  "设计.文风": "narrative-guide",
  "设计.监控栏": "status-bar",
};

/** 多模块同轮：写进每条 insert tool result 的 reply_hint */
export const DICTATE_MULTI_MODULE_REPLY_HINT =
  "本轮带回了多个 reply_module。末尾可见回复：每个模块各写一块 markdown，标题用 ## 模块 · {名称}（与该 reply_module 一致）；块间空一行；每块只写该模块的确认 / 薄弱点 / 追问。全部模块写完后，可另起一段写 1 条「建议下一刀」（条件须已接近成立）。缺某一块则补上后再结束本轮。";

const MAX_PROBE_CHARS = 1200;
const MAX_PRINCIPLES_CHARS = 900;
const MAX_BRIEF_CHARS = 2800;

export type DictateInsertFeedback = {
  moduleId: string;
  moduleName: string;
  tag: string;
  /** 给模型的独立模块 markdown */
  text: string;
};

export function resolveModuleForInsertTag(
  tag: string,
  catalog: ModuleCatalog | null | undefined,
): ModuleCatalogEntry | null {
  const t = tag.trim();
  if (!t || !catalog?.modules?.length) return null;

  const byArtifact = catalog.modules.find((m) => m.artifact?.trim() === t);
  if (byArtifact) return byArtifact;

  // 可增殖拆分：设计.生成规则#slug → 仍反查 设计.生成规则
  const hash = t.indexOf("#");
  if (hash > 0) {
    const family = t.slice(0, hash).trim();
    const byFamily = catalog.modules.find((m) => m.artifact?.trim() === family);
    if (byFamily) return byFamily;
  }

  const aliasId = DICTATE_INSERT_TAG_ALIASES[t];
  if (aliasId) {
    return catalog.modules.find((m) => m.id === aliasId) ?? null;
  }
  return null;
}

/** 从 output 块里抽自评维度名（用户向；不交 JSON） */
export function extractSelfScoreDimensionNames(outputFence: string): string[] {
  const names: string[] = [];
  const re = /"名"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(outputFence)) !== null) {
    const name = m[1]!.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names.slice(0, 8);
}

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * 从能力 prompt.md 抽「回答时附带本模块」的 markdown（无匹配块则空串）。
 */
export function formatDictateUserFacingBrief(params: {
  tag: string;
  module: ModuleCatalogEntry;
  promptMd: string;
}): string {
  const sections = parseModulePromptSections(params.promptMd);
  const probe = getModuleSection(sections, "probe");
  const principles = getModuleSection(sections, "principles");
  const output = getModuleSection(sections, "output");
  const dims = output ? extractSelfScoreDimensionNames(output) : [];

  if (!probe && !principles && dims.length === 0) return "";

  const includes: string[] = [];
  if (probe) includes.push("探测与追问口径");
  if (principles) includes.push("交互原则");
  if (dims.length) includes.push(`自评关注（${dims.join("、")}）`);

  const parts: string[] = [
    `# 模块 · ${params.module.name}`,
    "",
    `回答时请附带本模块（落盘 tag：\`${params.tag}\`）。`,
    "",
    "本模块内容包括：",
    ...includes.map((x) => `- ${x}`),
    "",
    "## 写入用户回复时做什么",
    `1. 用二级标题 \`## 模块 · ${params.module.name}\` 开一段（多模块时本段只写本模块）。`,
    "2. 确认：2～4 句复述本模块已落要点，让用户能判断对不对。",
    "3. 薄弱点：对照下方「自评关注」口头点 1 处不够硬的地方（不必交打分表或 JSON）。",
    "4. 追问：1～2 点；每点给建议选项或短场景，用户可直接采用或改写。材料已够则追问可空，改写「建议下一刀」。",
    "5. 不粘贴产物全文；不复述 tool JSON。",
  ];

  if (probe) {
    parts.push("", "## 探测与追问（本模块口径）", clip(probe, MAX_PROBE_CHARS));
  }
  if (principles) {
    parts.push("", "## 交互原则（摘）", clip(principles, MAX_PRINCIPLES_CHARS));
  }
  if (dims.length) {
    parts.push("", "## 自评关注", dims.map((d) => `- ${d}`).join("\n"));
  }

  return clip(parts.join("\n"), MAX_BRIEF_CHARS);
}

export function buildDictateInsertFeedback(params: {
  tag: string;
  catalog: ModuleCatalog | null | undefined;
  promptMd: string | null | undefined;
}): DictateInsertFeedback | null {
  const module = resolveModuleForInsertTag(params.tag, params.catalog);
  if (!module || !params.promptMd?.trim()) return null;
  const text = formatDictateUserFacingBrief({
    tag: params.tag.trim(),
    module,
    promptMd: params.promptMd,
  });
  if (!text.trim()) return null;
  return {
    moduleId: module.id,
    moduleName: module.name,
    tag: params.tag.trim(),
    text,
  };
}

/**
 * 预加载 catalog 全部能力的 insert 反馈索引（tag → 模块 markdown）。
 * 含 artifact 与别名 key。
 */
export async function buildDictateInsertFeedbackIndex(params: {
  catalog: ModuleCatalog;
  skillPackRoot: string;
  skillsRoot?: string;
}): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const { catalog, skillPackRoot } = params;

  await Promise.all(
    catalog.modules.map(async (module) => {
      const promptMd = await loadModulePrompt(
        skillPackRoot,
        module.id,
        params.skillsRoot,
      );
      if (!promptMd) return;
      const artifact = module.artifact?.trim();
      if (artifact) {
        const fb = buildDictateInsertFeedback({
          tag: artifact,
          catalog,
          promptMd,
        });
        if (fb) index.set(artifact, fb.text);
      }
      for (const [aliasTag, moduleId] of Object.entries(
        DICTATE_INSERT_TAG_ALIASES,
      )) {
        if (moduleId !== module.id) continue;
        const fb = buildDictateInsertFeedback({
          tag: aliasTag,
          catalog,
          promptMd,
        });
        if (fb) index.set(aliasTag, fb.text);
      }
    }),
  );

  return index;
}

export function lookupDictateInsertFeedback(
  index: Map<string, string> | null | undefined,
  tag: string,
): string | undefined {
  const t = tag.trim();
  if (!t || !index?.size) return undefined;
  const direct = index.get(t);
  if (direct) return direct;
  const hash = t.indexOf("#");
  if (hash > 0) return index.get(t.slice(0, hash).trim());
  return undefined;
}
