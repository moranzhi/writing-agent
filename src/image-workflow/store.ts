/**
 * 本机 ComfyUI 工作流库。
 * 目录：{用户数据}/image-workflows/<id>/
 *   meta.json      短名、一句画面说明、提示词节点
 *   workflow.json  ComfyUI「API 格式」导出的节点图
 * 创作模型只看短目录；节点图留在磁盘，提交生图时才读。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getUserDataDir } from "../config/user-data-dir.js";

export type ImageWorkflowEntry = {
  id: string;
  name: string;
  /** 给创作模型看的一句画面说明 */
  summary: string;
  /** ComfyUI API JSON 里的节点 id */
  promptNode: string;
  /** 该节点上要覆盖的字段，CLIP 文本一般为 text */
  promptField: string;
  /** 可选：这种风格的提示词习惯，仍不是节点图 */
  promptNotes?: string;
};

const DIR_NAME = "image-workflows";

export function getImageWorkflowsDir(): string {
  return path.join(getUserDataDir(), DIR_NAME);
}

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function readJson(file: string): unknown | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function parseEntry(folderName: string, dir: string): ImageWorkflowEntry | null {
  const metaPath = path.join(dir, "meta.json");
  const workflowPath = path.join(dir, "workflow.json");
  if (!existsSync(metaPath) || !existsSync(workflowPath)) return null;
  const meta = readJson(metaPath);
  const workflow = readJson(workflowPath);
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return null;
  const row = meta as Record<string, unknown>;
  const id = asString(row.id) ?? folderName.trim();
  const name = asString(row.name);
  const summary = asString(row.summary);
  const promptNode = asString(row.prompt_node) ?? asString(row.promptNode);
  const promptField = asString(row.prompt_field) ?? asString(row.promptField);
  if (!id || !name || !summary || !promptNode || !promptField) return null;
  const promptNotes = asString(row.prompt_notes) ?? asString(row.promptNotes);
  return {
    id,
    name,
    summary,
    promptNode,
    promptField,
    ...(promptNotes ? { promptNotes } : {}),
  };
}

/** 扫描目录。缺文件或字段不全的文件夹跳过。 */
export function listImageWorkflows(): ImageWorkflowEntry[] {
  const root = getImageWorkflowsDir();
  if (!existsSync(root)) return [];
  const out: ImageWorkflowEntry[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  for (const name of names) {
    if (!name || name.startsWith(".")) continue;
    const dir = path.join(root, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const entry = parseEntry(name, dir);
    if (entry) out.push(entry);
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  return out;
}

export function getImageWorkflow(id: string): ImageWorkflowEntry | null {
  const key = id.trim();
  if (!key) return null;
  return listImageWorkflows().find((entry) => entry.id === key) ?? null;
}
