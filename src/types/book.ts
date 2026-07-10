export type BookProject = {
  id: string;
  title: string;
  /** 用户选定或 agent 确认的 skill 包 */
  activeSkillId?: string;
  activeSkillName?: string;
  preview: string;
  sessionIds: string[];
  /** 最近一次持久化的 sessionId，用于续作 */
  activeSessionId?: string;
  createdAt: string;
  updatedAt: string;
  /** @deprecated 旧字段，等同 activeSkillId */
  orchestratorId?: string;
  /** @deprecated 旧字段，等同 activeSkillName */
  orchestratorName?: string;
};

export type BookSummary = Pick<
  BookProject,
  | "id"
  | "title"
  | "activeSkillId"
  | "activeSkillName"
  | "preview"
  | "updatedAt"
  | "orchestratorId"
  | "orchestratorName"
>;

export type SkillPackInfo = {
  id: string;
  name: string;
  description: string;
  category: string;
  bookKind?: string;
};
