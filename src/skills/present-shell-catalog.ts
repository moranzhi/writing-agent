/**
 * 游玩呈现壳目录：介绍与壳规格写在 present-shells/{id}/prompt.md。
 * 正文组成执行时注入【可选呈现壳】，不在技能 prompt 里写死清单。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  getModuleSection,
  parseModulePromptSections,
} from "./creation-flow.js";

const DEFAULT_SKILLS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skills",
);

export const PRESENT_SHELL_CATALOG_FILENAME = "present-shells/catalog.yaml";

export type PresentShellCatalogEntry = {
  id: string;
  name: string;
  intro: string;
  shell: string;
};

export function parsePresentShellCatalog(
  raw: string,
): Array<{ id: string; name: string }> {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
  const shellsRaw = (doc as Record<string, unknown>).shells;
  if (!Array.isArray(shellsRaw)) return [];
  const out: Array<{ id: string; name: string }> = [];
  for (const item of shellsRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!id || !name) continue;
    out.push({ id, name });
  }
  return out;
}

export async function loadPresentShellCatalog(
  skillPackRoot: string,
  skillsRoot = DEFAULT_SKILLS_ROOT,
): Promise<PresentShellCatalogEntry[]> {
  const catalogPath = path.join(
    skillsRoot,
    skillPackRoot,
    PRESENT_SHELL_CATALOG_FILENAME,
  );
  let raw: string;
  try {
    raw = await readFile(catalogPath, "utf8");
  } catch {
    return [];
  }
  const index = parsePresentShellCatalog(raw);
  const out: PresentShellCatalogEntry[] = [];
  for (const entry of index) {
    const promptPath = path.join(
      skillsRoot,
      skillPackRoot,
      "present-shells",
      entry.id,
      "prompt.md",
    );
    let promptMd = "";
    try {
      promptMd = await readFile(promptPath, "utf8");
    } catch {
      continue;
    }
    const sections = parseModulePromptSections(promptMd);
    const intro = getModuleSection(sections, "intro") ?? "";
    const shell = getModuleSection(sections, "shell") ?? "";
    if (!intro && !shell) continue;
    out.push({
      id: entry.id,
      name: entry.name,
      intro,
      shell,
    });
  }
  return out;
}

export function formatPresentShellsForPrompt(
  shells: readonly PresentShellCatalogEntry[],
): string {
  const lines = [
    "## 【可选呈现壳】程序从仓库动态装载",
    "",
    "只从下列 id 里选一个并做微调。禁止自造目录没有的壳，禁止从零发明布局。介绍与壳规格以各壳自己的文档为准。",
    "",
  ];
  for (const s of shells) {
    lines.push(`### \`${s.id}\` · ${s.name}`, "");
    if (s.intro) {
      lines.push("介绍：", "", s.intro, "");
    }
    if (s.shell) {
      lines.push("壳：", "", "```", s.shell, "```", "");
    }
  }
  return lines.join("\n").trim();
}
