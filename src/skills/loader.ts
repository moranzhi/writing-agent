import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { BookKind } from "../types/runtime.js";
import type {
  ParsedSkill,
  ParsedWorkerSkill,
  SkillIndexEntry,
  SkillWorkerLlmBindings,
  StartupInquiry,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = path.resolve(__dirname, "../../skills");

export const ORCHESTRATOR_FILENAME = "orchestrator.md";
export const WORKER_SKILL_FILENAME = "SKILL.md";
export const DEFAULT_SHARED_CONTEXT_FILENAME = "shared-context.md";
export const LLM_BINDINGS_FILENAME = "llm-bindings.yaml";

/** 按 Book 形态分文件夹；skill 可为平铺 .md 或 {name}/orchestrator.md 包 */
export const SKILL_BOOK_KIND_FOLDERS: BookKind[] = ["novel", "dialogue"];

type RegistryDoc = {
  skills?: Array<
    SkillIndexEntry & { path?: string; bookKind?: BookKind }
  >;
};

/** 解析 YAML frontmatter（仅支持本项目用到的简单字段） */
function parseFrontmatter(raw: string): {
  meta: Record<string, string | string[] | number>;
  body: string;
} {
  if (!raw.startsWith("---")) {
    return { meta: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    return { meta: {}, body: raw };
  }
  const yaml = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const meta: Record<string, string | string[] | number> = {};

  let currentKey = "";
  let listItems: string[] = [];
  let inList = false;

  const flushList = () => {
    if (inList && currentKey) {
      meta[currentKey] = listItems;
      listItems = [];
      inList = false;
    }
  };

  for (const line of yaml.split("\n")) {
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && inList) {
      listItems.push(listMatch[1].trim());
      continue;
    }
    flushList();
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    currentKey = key;
    if (value === "" || value === ">-" || value === "|") {
      inList = true;
      listItems = [];
    } else if (value === ">-" || value.startsWith(">")) {
      meta[key] = value;
    } else {
      meta[key] = value.trim();
      inList = false;
    }
  }
  flushList();
  return { meta, body };
}

function extractSection(body: string, heading: string): string {
  const re = new RegExp(`^## ${heading}\\s*$`, "m");
  const match = re.exec(body);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function parseStartupInquiry(section: string): StartupInquiry {
  const promptBlock = section.match(/```text\n([\s\S]*?)```/);
  const prompt = promptBlock?.[1]?.trim() ?? section.slice(0, 500);

  const targetMatch = section.match(/\*\*写入目标：\*\*\s*`([^`]+)`/);
  const targetKey = targetMatch?.[1]?.trim() ?? "book.brief";

  const required: string[] = [];
  const reqSection = section.match(/\*\*必须收集[：:]*\*\*([\s\S]*?)(?=\n\*\*|$)/);
  if (reqSection) {
    for (const line of reqSection[1].split("\n")) {
      const item = line.match(/^-\s+(.+)/);
      if (item) required.push(item[1].trim());
    }
  }

  const optional: string[] = [];
  const optSection = section.match(/\*\*可选收集[：:]*\*\*([\s\S]*?)(?=\n\*\*|$)/);
  if (optSection) {
    for (const line of optSection[1].split("\n")) {
      const item = line.match(/^-\s+(.+)/);
      if (item) optional.push(item[1].trim());
    }
  }

  return { prompt, targetKey, requiredFields: required, optionalFields: optional };
}

function metaString(meta: Record<string, string | string[] | number>, key: string): string {
  const v = meta[key];
  return typeof v === "string" ? v : "";
}

function metaStringArray(meta: Record<string, string | string[] | number>, key: string): string[] {
  const v = meta[key];
  return Array.isArray(v) ? v : [];
}

function parseBookKind(value: string): BookKind | undefined {
  if (value === "novel" || value === "dialogue") return value;
  return undefined;
}

function bookKindFromRelativePath(relativePath: string): BookKind | undefined {
  const folder = relativePath.split("/")[0];
  return parseBookKind(folder);
}

function skillPackRootFromPath(relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, "/");
  if (path.basename(normalized) === ORCHESTRATOR_FILENAME) {
    return path.posix.dirname(normalized);
  }
  return undefined;
}

function workerIdsFromMeta(meta: Record<string, string | string[] | number>): string[] {
  const workers = metaStringArray(meta, "workers");
  if (workers.length > 0) return workers;
  return metaStringArray(meta, "suggestedWorkers");
}

async function readRegistry(skillsRoot = SKILLS_ROOT): Promise<RegistryDoc["skills"]> {
  const registryPath = path.join(skillsRoot, "registry.yaml");
  try {
    const raw = await readFile(registryPath, "utf8");
    const doc = parseYaml(raw) as RegistryDoc;
    return doc.skills ?? [];
  } catch {
    return [];
  }
}

async function isDirectory(fullPath: string): Promise<boolean> {
  try {
    const s = await stat(fullPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/** 扫描 skills/novel/*.md 与 skill 包 novel/{name}/orchestrator.md */
async function scanSkillFiles(skillsRoot = SKILLS_ROOT): Promise<string[]> {
  const files: string[] = [];
  for (const folder of SKILL_BOOK_KIND_FOLDERS) {
    const dir = path.join(skillsRoot, folder);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (entry.endsWith(".md")) {
        files.push(`${folder}/${entry}`);
        continue;
      }
      if (await isDirectory(full)) {
        const orchestrator = path.join(full, ORCHESTRATOR_FILENAME);
        try {
          await readFile(orchestrator, "utf8");
          files.push(`${folder}/${entry}/${ORCHESTRATOR_FILENAME}`);
        } catch {
          // not a skill pack
        }
      }
    }
  }
  return files.sort();
}

async function loadWorkerLlmBindings(
  packRoot: string | undefined,
  skillsRoot = SKILLS_ROOT,
): Promise<SkillWorkerLlmBindings | undefined> {
  if (!packRoot) return undefined;
  const bindingsPath = path.join(skillsRoot, packRoot, LLM_BINDINGS_FILENAME);
  try {
    const raw = await readFile(bindingsPath, "utf8");
    const doc = parseYaml(raw) as SkillWorkerLlmBindings;
    if (!doc || typeof doc !== "object") return undefined;
    return doc;
  } catch {
    return undefined;
  }
}

async function parseSkillFile(
  relativePath: string,
  skillsRoot = SKILLS_ROOT,
): Promise<ParsedSkill> {
  const fullPath = path.join(skillsRoot, relativePath);
  const raw = await readFile(fullPath, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  const startupSection = extractSection(body, "启动询问");
  const folderBookKind = bookKindFromRelativePath(relativePath);
  const category = metaString(meta, "category") || folderBookKind || "custom";
  const bookKind =
    parseBookKind(metaString(meta, "bookKind")) ??
    folderBookKind ??
    parseBookKind(category);

  const normalizedPath = relativePath.replace(/\\/g, "/");
  const fileStem = path.basename(normalizedPath, ".md");
  const packRoot = skillPackRootFromPath(normalizedPath);
  const defaultName = packRoot ? path.basename(packRoot) : fileStem;
  const workerLlmBindings = await loadWorkerLlmBindings(packRoot, skillsRoot);

  return {
    name: metaString(meta, "name") || defaultName,
    description: metaString(meta, "description"),
    category,
    bookKind,
    path: normalizedPath,
    skillPackRoot: packRoot,
    version: typeof meta.version === "number" ? meta.version : Number(meta.version) || 1,
    defaultFlowId: metaString(meta, "defaultFlowId") || undefined,
    suggestedWorkers: workerIdsFromMeta(meta),
    tags: metaStringArray(meta, "tags"),
    sharedContextPath: resolveSharedContextPath(meta, packRoot),
    workerLlmBindings,
    startupInquiry: parseStartupInquiry(startupSection),
    body,
  };
}

function resolveSharedContextPath(
  meta: Record<string, string | string[] | number>,
  packRoot: string | undefined,
): string | undefined {
  if (!packRoot) return undefined;
  const explicit = metaString(meta, "sharedContext");
  return explicit || DEFAULT_SHARED_CONTEXT_FILENAME;
}

async function parseWorkerSkillFile(
  relativePath: string,
  skillsRoot = SKILLS_ROOT,
): Promise<ParsedWorkerSkill> {
  const fullPath = path.join(skillsRoot, relativePath);
  const raw = await readFile(fullPath, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const idFromPath = path.posix.basename(path.posix.dirname(normalizedPath));
  const inputTags =
    metaStringArray(meta, "inputTags").length > 0
      ? metaStringArray(meta, "inputTags")
      : metaStringArray(meta, "inputKeys");
  const outputTags =
    metaStringArray(meta, "outputTags").length > 0
      ? metaStringArray(meta, "outputTags")
      : metaStringArray(meta, "outputKeys");
  const inputMergeRaw = metaString(meta, "inputMerge");
  const inputMerge =
    inputMergeRaw === "concat" || inputMergeRaw === "latest"
      ? inputMergeRaw
      : undefined;
  const llmProfileId = metaString(meta, "llmProfileId") || undefined;

  return {
    id: metaString(meta, "id") || idFromPath,
    skill: metaString(meta, "skill"),
    name: metaString(meta, "name") || idFromPath,
    description: metaString(meta, "description"),
    version: typeof meta.version === "number" ? meta.version : Number(meta.version) || 1,
    inputTags,
    outputTags,
    inputMerge,
    llmProfileId,
    path: normalizedPath,
    body,
  };
}

/** 列举 skill：优先 registry.yaml，否则扫描 novel/ 与 dialogue/ */
export async function listSkills(skillsRoot = SKILLS_ROOT): Promise<SkillIndexEntry[]> {
  const registry = (await readRegistry(skillsRoot)) ?? [];
  if (registry.length > 0) {
    return registry.map((entry) => ({
      name: entry.name,
      description: entry.description,
      category: entry.category,
      bookKind: entry.bookKind ?? parseBookKind(entry.category),
      path: entry.path,
    }));
  }

  const entries: SkillIndexEntry[] = [];
  for (const relativePath of await scanSkillFiles(skillsRoot)) {
    try {
      const parsed = await parseSkillFile(relativePath, skillsRoot);
      entries.push({
        name: parsed.name,
        description: parsed.description,
        category: parsed.category,
        bookKind: parsed.bookKind,
        path: parsed.path,
      });
    } catch {
      // skip unreadable
    }
  }
  return entries;
}

/** 按 skill name 解析相对路径 */
export async function resolveSkillPath(
  skillIdOrName: string,
  skillsRoot = SKILLS_ROOT,
): Promise<string | null> {
  const trimmed = skillIdOrName.trim();
  const registry = (await readRegistry(skillsRoot)) ?? [];

  const fromRegistry = registry.find((s) => s.name === trimmed);
  if (fromRegistry?.path) {
    return fromRegistry.path.replace(/\\/g, "/");
  }

  for (const folder of SKILL_BOOK_KIND_FOLDERS) {
    const packCandidate = `${folder}/${trimmed}/${ORCHESTRATOR_FILENAME}`;
    try {
      await readFile(path.join(skillsRoot, packCandidate), "utf8");
      return packCandidate;
    } catch {
      // continue
    }
    const flatCandidate = `${folder}/${trimmed}.md`;
    try {
      await readFile(path.join(skillsRoot, flatCandidate), "utf8");
      return flatCandidate;
    } catch {
      // continue
    }
  }

  for (const relativePath of await scanSkillFiles(skillsRoot)) {
    try {
      const parsed = await parseSkillFile(relativePath, skillsRoot);
      if (parsed.name === trimmed) {
        return relativePath;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/** 加载并解析总管 skill（orchestrator.md 或平铺 .md） */
export async function loadSkill(
  skillIdOrName: string,
  skillsRoot = SKILLS_ROOT,
): Promise<ParsedSkill> {
  const relativePath = await resolveSkillPath(skillIdOrName, skillsRoot);
  if (!relativePath) {
    throw new Error(`未找到 skill: ${skillIdOrName}`);
  }
  return parseSkillFile(relativePath, skillsRoot);
}

/** 解析 skill 包内 worker 的 SKILL.md 相对路径 */
export async function resolveWorkerSkillPath(
  skillIdOrName: string,
  workerId: string,
  skillsRoot = SKILLS_ROOT,
): Promise<string | null> {
  const skill = await loadSkill(skillIdOrName, skillsRoot);
  if (!skill.skillPackRoot) {
    return null;
  }
  const relativePath = `${skill.skillPackRoot}/workers/${workerId}/${WORKER_SKILL_FILENAME}`;
  try {
    await readFile(path.join(skillsRoot, relativePath), "utf8");
    return relativePath;
  } catch {
    return null;
  }
}

/** 加载 skill 包固定上下文（注入所有 worker prompt 开头） */
export async function loadSkillSharedContext(
  skillIdOrName: string,
  skillsRoot = SKILLS_ROOT,
): Promise<string | null> {
  const skill = await loadSkill(skillIdOrName, skillsRoot);
  if (!skill.skillPackRoot || !skill.sharedContextPath) return null;
  const fullPath = path.join(skillsRoot, skill.skillPackRoot, skill.sharedContextPath);
  try {
    return await readFile(fullPath, "utf8");
  } catch {
    return null;
  }
}

/** 加载 worker skill 正文，可选拼接 skill 包固定上下文 */
export async function loadWorkerSkillWithContext(
  skillIdOrName: string,
  workerId: string,
  skillsRoot = SKILLS_ROOT,
): Promise<{ worker: ParsedWorkerSkill; sharedContext: string | null; promptBody: string }> {
  const worker = await loadWorkerSkill(skillIdOrName, workerId, skillsRoot);
  const sharedContext = await loadSkillSharedContext(skillIdOrName, skillsRoot);
  const promptBody = sharedContext
    ? `# 固定创作上下文\n\n${sharedContext}\n\n---\n\n${worker.body}`
    : worker.body;
  return { worker, sharedContext, promptBody };
}

/** 加载 skill 包内专属 worker skill */
export async function loadWorkerSkill(
  skillIdOrName: string,
  workerId: string,
  skillsRoot = SKILLS_ROOT,
): Promise<ParsedWorkerSkill> {
  const relativePath = await resolveWorkerSkillPath(skillIdOrName, workerId, skillsRoot);
  if (!relativePath) {
    throw new Error(`未找到 worker skill: ${skillIdOrName}/${workerId}`);
  }
  return parseWorkerSkillFile(relativePath, skillsRoot);
}

/** 列举 skill 包内所有 worker skill */
export async function listWorkerSkills(
  skillIdOrName: string,
  skillsRoot = SKILLS_ROOT,
): Promise<ParsedWorkerSkill[]> {
  const skill = await loadSkill(skillIdOrName, skillsRoot);
  if (!skill.skillPackRoot) {
    return [];
  }
  const workersDir = path.join(skillsRoot, skill.skillPackRoot, "workers");
  let entries: string[];
  try {
    entries = await readdir(workersDir);
  } catch {
    return [];
  }
  const workers: ParsedWorkerSkill[] = [];
  for (const entry of entries.sort()) {
    const skillPath = `${skill.skillPackRoot}/workers/${entry}/${WORKER_SKILL_FILENAME}`;
    try {
      workers.push(await parseWorkerSkillFile(skillPath, skillsRoot));
    } catch {
      // skip
    }
  }
  return workers;
}

/** 按 name 或文件名（不含 .md）匹配 skill，返回 loadSkill 可用的 id */
export async function resolveSkillId(
  input: string,
  skillsRoot = SKILLS_ROOT,
): Promise<string | null> {
  const trimmed = input.trim();
  const relativePath = await resolveSkillPath(trimmed, skillsRoot);
  if (!relativePath) return null;
  try {
    const parsed = await parseSkillFile(relativePath, skillsRoot);
    return parsed.name;
  } catch {
    return null;
  }
}

export { SKILLS_ROOT };
