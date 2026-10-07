/** TTS 提供方（默认 edge；本地/腾讯后接） */

export type TtsProviderId = "edge" | "local" | "tencent";

export type TtsSynthesizeParams = {
  text: string;
  /** 缓存键额外盐（如 sectionId），便于按节失效 */
  cacheKey?: string;
  voice?: string;
};

export type TtsSynthesizeResult = {
  audio: Buffer;
  contentType: string;
  provider: TtsProviderId;
  voice: string;
  cached: boolean;
};

export const DEFAULT_TTS_PROVIDER: TtsProviderId = "edge";
/** 听书默认中文声线 */
export const DEFAULT_EDGE_VOICE = "zh-CN-XiaoxiaoNeural";
