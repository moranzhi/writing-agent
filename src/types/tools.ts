/** 总管 tool 名称 */
export type MainAgentToolName =
  | "read_blackboard"
  | "list_workers"
  | "list_artifacts"
  | "ask_user"
  | "run_worker"
  | "review_blackboard"
  | "finish";

/** 可在 tool loop 内反复调用、不改变运行相位的 tool */
export const MAIN_AGENT_LOOP_TOOLS: MainAgentToolName[] = [
  "read_blackboard",
  "list_workers",
  "list_artifacts",
];

/** 调用后应退出 loop、交给阶段机的终止 tool */
export const MAIN_AGENT_TERMINAL_TOOLS: MainAgentToolName[] = [
  "ask_user",
  "run_worker",
  "review_blackboard",
  "finish",
];

export function isMainAgentTerminalTool(name: string): name is MainAgentToolName {
  return (MAIN_AGENT_TERMINAL_TOOLS as string[]).includes(name);
}

export function isMainAgentLoopTool(name: string): name is MainAgentToolName {
  return (MAIN_AGENT_LOOP_TOOLS as string[]).includes(name);
}

export type ReadBlackboardParams = {
  tags: string[];
};

export type ListWorkersParams = Record<string, never>;

export type ListArtifactsParams = Record<string, never>;

export type AskUserParams = {
  reason: string;
  message?: string;
};

export type RunWorkerParams = {
  workerId: string;
  reason: string;
  requiresApproval: boolean;
  roleId?: string;
};

export type ReviewBlackboardParams = {
  reason: string;
  summary: string;
};

export type FinishParams = {
  reason: string;
};
