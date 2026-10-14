/**
 * 工作流库 → 创作提示里的短目录。不含 ComfyUI 节点图。
 */

import { listImageWorkflows, type ImageWorkflowEntry } from "./store.js";

export function formatImageWorkflowCatalogForPrompt(
  entries?: ImageWorkflowEntry[],
): string {
  const workflows = entries ?? listImageWorkflows();
  if (!workflows.length) return "";

  const lines = workflows.map(
    (entry) => `- ${entry.id}｜${entry.name}｜${entry.summary}`,
  );

  return `## 【工作流库 · 可选用】

本机已导出的画面工作流。选定一个 id 写入本步产物。这里只有短名和一句画面说明。

${lines.join("\n")}`;
}
