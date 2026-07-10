/** worker 读取多条同 tag 时的合并策略 */
export type BlackboardInputMerge = "latest" | "concat";

export type BlackboardItem = {
  id: string;
  tag: string;
  content: string;
  source: string;
  scope?: string;
  createdAt: string;
  updatedAt: string;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
};

/** 总管可见：无 content */
export type BlackboardTagIndex = Pick<
  BlackboardItem,
  "id" | "tag" | "source" | "scope" | "updatedAt"
>;

export type BlackboardWriteInput = {
  tag: string;
  content: string;
  source: string;
  scope?: string;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
};
