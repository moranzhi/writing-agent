import { describe, expect, it } from "vitest";
import {
  SLOT_PLAY_LAYER_ACTIVE,
  SLOT_PLAY_TURN_QUEUE,
  isPlayLayerActive,
  readPlayTurnQueue,
  withPlayTurnQueue,
} from "../src/skills/play-turn.js";

describe("play-turn slots", () => {
  it("reads a trimmed queue and ignores junk", () => {
    expect(readPlayTurnQueue(undefined)).toEqual([]);
    expect(
      readPlayTurnQueue({ [SLOT_PLAY_TURN_QUEUE]: [" auditor ", "", 3, "gm"] }),
    ).toEqual(["auditor", "gm"]);
  });

  it("writes queue or clears when empty", () => {
    const withIds = withPlayTurnQueue({ a: 1 }, ["gm", "narrator"]);
    expect(withIds[SLOT_PLAY_TURN_QUEUE]).toEqual(["gm", "narrator"]);
    expect(withPlayTurnQueue(withIds, []).playTurnQueue).toBeUndefined();
  });

  it("detects play layer flag", () => {
    expect(isPlayLayerActive(undefined)).toBe(false);
    expect(isPlayLayerActive({ [SLOT_PLAY_LAYER_ACTIVE]: true })).toBe(true);
  });
});
