import type { ChatMessage } from "../llm/client.js";
import type { PresetPackage } from "../types/preset.js";
import { assemblePresetMessages } from "./assembler.js";
import { applyExtendedMarkers } from "./markers.js";
import {
  resolveWorldInfoMarker,
  type WorldInfoPack,
} from "./world-info-pack.js";

/**
 * Play worker：system 契约 + 按扩展 prompt_order 填洞。
 * 不要再把同一份 context-order 正文叠成第二包 user。
 */
export function assemblePlayWorkerMessages(params: {
  systemPrompt: string;
  preset: PresetPackage;
  pack: WorldInfoPack;
}): ChatMessage[] {
  const framed = applyExtendedMarkers(params.preset);
  const filled = assemblePresetMessages(framed, (id) =>
    resolveWorldInfoMarker(params.pack, id),
  );
  return [{ role: "system", content: params.systemPrompt }, ...filled];
}
