/**
 * 游玩回合：按运行规格 playWorkerIds 连跑（主世界层 → 视角? → 转述 → 旁观维护）。
 * 旁观维护在本轮末执行，表变更供下一轮主世界层读取。
 * 与创作总管无关；收口后的输入走这里。
 */
export const SLOT_PLAY_TURN_QUEUE = "playTurnQueue";
export const SLOT_PLAY_LAYER_ACTIVE = "playLayerActive";

export const PLAY_WORKING_SNAPSHOT_ID = "play-working";
export const PLAY_WORKING_SNAPSHOT_LABEL = "当前游玩";

export function isPlayLayerActive(slots: Record<string, unknown> | undefined): boolean {
  return Boolean(slots?.[SLOT_PLAY_LAYER_ACTIVE]);
}

export function readPlayTurnQueue(
  slots: Record<string, unknown> | undefined,
): string[] {
  const raw = slots?.[SLOT_PLAY_TURN_QUEUE];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
    .map((id) => id.trim());
}

export function withPlayTurnQueue(
  slots: Record<string, unknown>,
  queue: string[] | undefined,
): Record<string, unknown> {
  return {
    ...slots,
    [SLOT_PLAY_TURN_QUEUE]: queue?.length ? queue : undefined,
  };
}
