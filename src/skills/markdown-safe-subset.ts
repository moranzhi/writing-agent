/**
 * 正文 Markdown 安全子集目录。
 * 正文组成执行时注入【正文安全子集】，与 web/markdown.js 实现对照维护。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const DEFAULT_SKILLS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skills",
);

export const MARKDOWN_SAFE_SUBSET_FILENAME =
  "markdown-safe-subset/catalog.yaml";

export type MarkdownSafeFeature = {
  id: string;
  name: string;
  syntax: string;
};

export type MarkdownSafeSubsetCatalog = {
  version: number;
  intro: string;
  features: MarkdownSafeFeature[];
  restrictions: string[];
};

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function parseMarkdownSafeSubsetCatalog(
  raw: string,
): MarkdownSafeSubsetCatalog | null {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const row = doc as Record<string, unknown>;
  const featuresRaw = row.features;
  if (!Array.isArray(featuresRaw)) return null;
  const features: MarkdownSafeFeature[] = [];
  for (const item of featuresRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const f = item as Record<string, unknown>;
    const id = asString(f.id);
    const name = asString(f.name);
    const syntax = asString(f.syntax);
    if (!id || !name || !syntax) continue;
    features.push({ id, name, syntax });
  }
  if (!features.length) return null;
  const restrictions: string[] = [];
  if (Array.isArray(row.restrictions)) {
    for (const r of row.restrictions) {
      const s = asString(r);
      if (s) restrictions.push(s);
    }
  }
  const version =
    typeof row.version === "number" && Number.isFinite(row.version)
      ? row.version
      : 1;
  return {
    version,
    intro: asString(row.intro),
    features,
    restrictions,
  };
}

export async function loadMarkdownSafeSubsetCatalog(
  skillPackRoot: string,
  skillsRoot = DEFAULT_SKILLS_ROOT,
): Promise<MarkdownSafeSubsetCatalog | null> {
  const catalogPath = path.join(
    skillsRoot,
    skillPackRoot,
    MARKDOWN_SAFE_SUBSET_FILENAME,
  );
  let raw: string;
  try {
    raw = await readFile(catalogPath, "utf8");
  } catch {
    return null;
  }
  return parseMarkdownSafeSubsetCatalog(raw);
}

export function formatMarkdownSafeSubsetForPrompt(
  catalog: MarkdownSafeSubsetCatalog,
): string {
  const lines = [
    "## 【正文安全子集】程序从仓库动态装载",
    "",
    catalog.intro ||
      "用户开启 Markdown 渲染时，正文只吃下列语法；美化靠程序 class，勿写本局任意 CSS/HTML/JS。",
    "",
  ];
  for (const f of catalog.features) {
    lines.push(`- **${f.name}**（\`${f.id}\`）`);
    const syn = f.syntax.trim();
    if (syn.includes("\n")) {
      lines.push("", "```", syn, "```", "");
    } else {
      lines.push(`  \`${syn}\``);
    }
  }
  if (catalog.restrictions.length) {
    lines.push("", "硬限制：");
    for (const r of catalog.restrictions) {
      lines.push(`- ${r}`);
    }
  }
  lines.push(
    "",
    "区域「渲染提示」选 Markdown 时，只使用上表；日常折叠/表格走子集即可，一般不必填「渲染」里的 html/css/js。",
  );
  return lines.join("\n").trim();
}
