/** 听书连载 · 类型与常量 */

export const LISTEN_SERIAL_MODE_VALUE = "listen_serial";

export const LISTEN_PHASE_TAG = "听书.阶段";
export const LISTEN_THRILL_TAG = "听书.核心爽点";
export const LISTEN_WORLD_TAG = "听书.一句世界";
export const LISTEN_STRUCTURE_TAG = "听书.结构";
export const LISTEN_OUTLINE_TAG = "听书.大纲";
export const LISTEN_SECTIONS_TAG = "听书.正文节";
export const LISTEN_SUMMARIES_TAG = "听书.小总结";
export const LISTEN_BUFFER_TARGET_TAG = "听书.缓冲目标字数";
export const LISTEN_CONSUMED_CHARS_TAG = "听书.已消费字数";
/** 播放层开关：创作只定 brief，播放层才写大纲/正文 */
export const LISTEN_PLAY_LAYER_TAG = "听书.播放层";

/** 默认未读/未听缓冲目标（字）——实现默认值，可后续调 */
export const DEFAULT_BUFFER_TARGET_CHARS = 4000;
/** 单次用户触发最多连写几节，避免一次请求过长 */
export const MAX_SECTIONS_PER_BURST = 3;
/** 进模型的滚动小总结条数上限 */
export const MAX_SUMMARIES_IN_CONTEXT = 8;

export type ListenPhase =
  | "intake"
  | "awaiting_confirm"
  /** 创作已确认，等待进入播放写大纲正文 */
  | "ready"
  | "running"
  | "soft_stop";

export type OutlineItem = {
  id: string;
  title: string;
  /** pending=未写；done=已有正文；cut=被插嘴砍掉 */
  status: "pending" | "done" | "cut";
  /** 本段爽点兑现节点 */
  payoff?: boolean;
};

export type SectionItem = {
  id: string;
  outlineId: string;
  title: string;
  text: string;
  summary: string;
  /** 用户已听/读过的字数（相对本节）；改向时整节未消费可丢 */
  consumedChars: number;
};

export type ListenSerialState = {
  phase: ListenPhase;
  thrill: string;
  world: string;
  structure: string;
  outline: OutlineItem[];
  sections: SectionItem[];
  summaries: string[];
  bufferTargetChars: number;
  /** 全局已消费正文字数（用于 UI「已听」） */
  consumedChars: number;
};

export type ListenSerialView = {
  phase: ListenPhase;
  /** 是否在播放层（大纲/正文/TTS） */
  playActive: boolean;
  thrill: string;
  world: string;
  structure: string;
  outline: Array<{ id: string; title: string; status: string; payoff?: boolean }>;
  sections: Array<{
    id: string;
    outlineId: string;
    title: string;
    text: string;
    summary: string;
    consumedChars: number;
  }>;
  unreadChars: number;
  bufferTargetChars: number;
  consumedChars: number;
};

export function isListenSerialModeValue(raw: string | undefined | null): boolean {
  return (raw ?? "").trim() === LISTEN_SERIAL_MODE_VALUE;
}
