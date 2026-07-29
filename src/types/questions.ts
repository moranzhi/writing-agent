/** 结构化追问协议类型（Worker askUser / Agent ask_user 共用） */

export type QuestionOption = {
  id: string;
  label: string;
  /** 默认 true：点文案可改写，点字母才选中 */
  editable?: boolean;
};

export type QuestionItem = {
  id: string;
  prompt: string;
  options?: QuestionOption[];
  allowOther?: boolean;
  required?: boolean;
};

export type QuestionAnswer = {
  questionId: string;
  optionId?: string;
  /** 最终确认文案（必填，可含用户改写） */
  text: string;
};
