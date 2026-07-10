import type { BlackboardInputMerge } from "../types/blackboard.js";
import type { AdvancePolicy } from "../types/runtime.js";

export type WorkerLlmBinding = {
  /** 固定 ApiProfile.id；省略 = 会话默认 */
  profileId?: string | null;
  /** 按当前决策角色 id 选用 profile（多 AI 博弈） */
  byRole?: Record<string, string>;
};

/** skill 包 llm-bindings.yaml 解析结果（可选） */
export type SkillWorkerLlmBindings = {
  defaultProfileId?: string | null;
  workers?: Record<string, WorkerLlmBinding>;
};

/** skills/registry.yaml 或目录扫描得到的索引项 */
export type SkillIndexEntry = {
  name: string;
  description: string;
  /** 与 bookKind 一致，兼容旧字段名 */
  category: string;
  bookKind?: "novel" | "dialogue";
  /** 相对 skills/ 的路径，如 novel/weird-rules-short/orchestrator.md 或 novel/basic.md */
  path?: string;
};

/** 来自 skill 文件 ## 启动询问 */
export type StartupInquiry = {
  prompt: string;
  targetKey: string;
  requiredFields: string[];
  optionalFields: string[];
};

/** 解析后的总管 skill，供 session.slots.activeSkill 使用 */
export type ParsedSkill = {
  name: string;
  description: string;
  category: string;
  bookKind?: "novel" | "dialogue";
  /** 相对 skills/ 的路径（orchestrator.md 或平铺 .md） */
  path: string;
  /** skill 包根目录，如 novel/weird-rules-short；平铺 .md 时为 undefined */
  skillPackRoot?: string;
  version: number;
  defaultFlowId?: string;
  /** 本包可调度 worker id（frontmatter workers 或 suggestedWorkers） */
  suggestedWorkers: string[];
  tags: string[];
  /** 包内固定上下文相对路径（可选）；有则注入该包 worker prompt */
  sharedContextPath?: string;
  /** llm-bindings.yaml（可选）；见 docs/worker-skill-format.md §9 */
  workerLlmBindings?: SkillWorkerLlmBindings;
  startupInquiry: StartupInquiry;
  /** 推进策略（预留）。loader 第一版不解析 orchestrator ## 推进策略 */
  advancePolicy?: AdvancePolicy;
  body: string;
};

/** 解析后的 worker skill（skills/{pack}/workers/{id}/SKILL.md） */
export type ParsedWorkerSkill = {
  id: string;
  skill: string;
  name: string;
  description: string;
  version: number;
  inputTags: string[];
  outputTags: string[];
  inputMerge?: BlackboardInputMerge;
  /** ApiProfile.id；省略 = 走 llm-bindings 或会话默认 */
  llmProfileId?: string;
  /** 相对 skills/ 的路径 */
  path: string;
  body: string;
};
