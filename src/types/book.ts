/** 进料/创作方式：一书一方式，目录按此分夹 */
export type BookCreationMode = "recipe" | "dictate" | "listen_serial";

export type BookProject = {
  id: string;
  title: string;
  /** 用户选定或 agent 确认的 skill 包 */
  activeSkillId?: string;
  activeSkillName?: string;
  /** 新建时选定；缺省视为 dictate（旧书） */
  creationMode?: BookCreationMode;
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
  | "creationMode"
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
