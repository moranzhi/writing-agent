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
  "本轮写入了多个产物。末尾用一段自然回复综合说明本轮变化、共同强项与关键缺口；不要逐模块套标题或重复模板。只有缺口确需用户决定时才提问。";

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

function extractScoreFenceDimensionNames(scoreFence: string): string[] {
  const names: string[] = [];
  for (const match of scoreFence.matchAll(/^([^#\-\s][^：\n]{0,30})：\s*$/gm)) {
    const name = match[1]?.trim();
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
  const score = getModuleSection(sections, "score");
  const dims = score
    ? extractScoreFenceDimensionNames(score)
    : output
      ? extractSelfScoreDimensionNames(output)
      : [];

  if (!probe && !principles && dims.length === 0) return "";

  const includes: string[] = [];
  if (probe) includes.push("探测与追问口径");
  if (principles) includes.push("交互原则");
  if (dims.length) includes.push(`自评关注（${dims.join("、")}）`);

  const parts: string[] = [
    `# 本轮关注 · ${params.module.name}`,
    "",
    `用于组织写入 \`${params.tag}\` 后的自然回复，不要求固定标题或独立模块段。`,
    "",
    "本模块内容包括：",
    ...includes.map((x) => `- ${x}`),
    "",
    "## 写入用户回复时做什么",
    "1. 自然回应用户本轮值得保留、需要纠正或存在矛盾的内容。",
    "2. 简要说明形成或改写了什么；完整 JSON 由产物卡展示。",
    "3. 结合 self_score 说明最强处与关键缺口，不复述整张评分表。",
    "4. 只有低分缺口确需用户决定时才提问，并给具体选项或短场景。",
    "5. 同轮多个产物时合并回应，不逐模块套模板；不粘贴产物全文或 tool JSON。",
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
