/** 启动「填空题」字段定义（来自 SKILL ## 启动询问） */
export type IntakeFieldDef = {
  id: string;
  label: string;
  required: boolean;
};

/** 单字段展示状态 */
export type IntakeFieldStatus = {
  id: string;
  label: string;
  required: boolean;
  value?: string;
  filled: boolean;
};

/** 填空进度（供 Web 展示） */
export type IntakeProgress = {
  fields: IntakeFieldStatus[];
  requiredTotal: number;
  requiredFilled: number;
  optionalTotal: number;
  optionalFilled: number;
  /** 全部必要项已填 */
  ready: boolean;
};
