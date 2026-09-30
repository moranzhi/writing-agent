/**
 * 壳参考库：shell-refs/{id}/prompt.md。
 * 正文组成与 0 层正文组成读取后，按本局启用的区改一版并固定。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getModuleSection,
  parseModulePromptSections,
} from "./creation-flow.js";
import { parsePresentShellCatalog } from "./present-shell-catalog.js";

const DEFAULT_SKILLS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skills",
);

export const SHELL_REF_CATALOG_FILENAME = "shell-refs/catalog.yaml";

export type ShellRefEntry = {
  id: string;
  name: string;
  intro: string;
  layout: string;
  /** 固定摆放与这一次示例填法。样本里的名称、栏目、内部小节按本局改写。 */
  note: string;
  sample: string;
};

export async function loadShellRefCatalog(
  skillPackRoot: string,
  skillsRoot = DEFAULT_SKILLS_ROOT,
): Promise<ShellRefEntry[]> {
  const catalogPath = path.join(
    skillsRoot,
    skillPackRoot,
    SHELL_REF_CATALOG_FILENAME,
  );
  let raw: string;
  try {
    raw = await readFile(catalogPath, "utf8");
  } catch {
    return [];
  }
  const index = parsePresentShellCatalog(raw);
  const out: ShellRefEntry[] = [];
  for (const entry of index) {
    const promptPath = path.join(
      skillsRoot,
      skillPackRoot,
      "shell-refs",
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
    const layout = getModuleSection(sections, "layout") ?? "";
    const note = getModuleSection(sections, "note") ?? "";
    const sample = getModuleSection(sections, "sample") ?? "";
    if (!intro || !layout || !note || !sample) continue;
    out.push({
      id: entry.id,
      name: entry.name,
      intro,
      layout,
      note,
      sample,
    });
  }
  return out;
}

export function formatShellRefsForPrompt(
  shells: readonly ShellRefEntry[],
): string {
  const lines = [
    "## 【壳参考库】程序从仓库动态装载",
    "",
    "选一只与本局已启用区域最接近的参考。备注写两类：不替换的前端结构，以及可按本局用途替换的部位。本局没有的区从样本骨架删除并重排，不留空位。美化用配色、字体层级、边框、间距和简单内联 SVG，按本次能写稳的程度完成。创作时生成一次前端并固定，游玩只灌入各区内容。",
    "",
  ];
  for (const shell of shells) {
    lines.push(`### \`${shell.id}\` · ${shell.name}`, "");
    lines.push(shell.intro, "");
    lines.push("布局：", "", "```", shell.layout, "```", "");
    lines.push("备注：", "", shell.note, "");
    lines.push("前端样本：", "", "```", shell.sample, "```", "");
  }
  return lines.join("\n").trim();
}
