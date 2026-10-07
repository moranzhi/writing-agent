import { synthesizeWithEdge } from "./edge.js";
import {
  DEFAULT_TTS_PROVIDER,
  type TtsProviderId,
  type TtsSynthesizeParams,
  type TtsSynthesizeResult,
} from "./types.js";

export {
  DEFAULT_EDGE_VOICE,
  DEFAULT_TTS_PROVIDER,
  type TtsProviderId,
  type TtsSynthesizeParams,
  type TtsSynthesizeResult,
} from "./types.js";

export function resolveTtsProvider(): TtsProviderId {
  const raw = (process.env.WRITING_AGENT_TTS_PROVIDER ?? DEFAULT_TTS_PROVIDER)
    .trim()
    .toLowerCase();
  if (raw === "local" || raw === "tencent" || raw === "edge") return raw;
  return DEFAULT_TTS_PROVIDER;
}

/**
 * 统一合成入口。当前仅实现 edge；local / tencent 占位。
 */
export async function synthesizeSpeech(
  params: TtsSynthesizeParams,
): Promise<TtsSynthesizeResult> {
  const provider = resolveTtsProvider();
  if (provider === "edge") {
    return synthesizeWithEdge(params);
  }
  if (provider === "local") {
    throw new Error("本地 TTS 尚未接入；请将 WRITING_AGENT_TTS_PROVIDER=edge");
  }
  if (provider === "tencent") {
    throw new Error("腾讯云 TTS 尚未接入；请将 WRITING_AGENT_TTS_PROVIDER=edge");
  }
  return synthesizeWithEdge(params);
}
