import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import { DIALOGUE_HISTORY_TAG } from "../src/skills/dialogue-history.js";
import {
  CURRENT_TURN_TAG,
  resolveWorldInfoMarker,
  worldInfoPackFromSegments,
} from "../src/preset/world-info-pack.js";
import {
  CURRENT_TURN,
  WORLD_BOOK_AFTER,
  WORLD_BOOK_BEFORE,
} from "../src/preset/markers.js";
import type { ContextSegmentDef } from "../src/skills/context-segments.js";

describe("worldInfoPackFromSegments", () => {
  it("splits lore / history / after-history / turn by the two anchors", () => {
    const bb = new Blackboard();
    const segments: ContextSegmentDef[] = [
      {
        id: "stage",
        tier: "static",
        tags: [],
        inline: "古镇夜雨",
        label: "## 舞台骨架",
      },
      {
        id: "hist",
        tier: "dynamic",
        tags: [DIALOGUE_HISTORY_TAG],
      },
      {
        id: "vars",
        tier: "dynamic",
        tags: ["变量.当前"],
        label: "## 变量",
      },
      {
        id: "turn",
        tier: "dynamic",
        tags: [CURRENT_TURN_TAG],
      },
      {
        id: "note",
        tier: "dynamic",
        tags: [],
        inline: "尾注",
        label: "## 本轮后",
      },
    ];
    const pack = worldInfoPackFromSegments({
      segments,
      inputs: {
        [DIALOGUE_HISTORY_TAG]: "用户：你好",
        "变量.当前": "HP 3",
        [CURRENT_TURN_TAG]: "我推门进去",
      },
      blackboard: bb,
    });
    expect(pack.worldBookBefore.map((e) => e.content)).toEqual(["古镇夜雨"]);
    expect(pack.history).toContain("你好");
    expect(pack.worldBookAfter.map((e) => e.content)).toEqual(["HP 3"]);
    expect(pack.turn).toBe("我推门进去");
    expect(pack.postTurn.map((e) => e.content)).toEqual(["尾注"]);
    expect(resolveWorldInfoMarker(pack, WORLD_BOOK_BEFORE)).toContain("古镇夜雨");
    expect(resolveWorldInfoMarker(pack, WORLD_BOOK_AFTER)).toContain("HP 3");
    expect(resolveWorldInfoMarker(pack, CURRENT_TURN)).toBe("我推门进去");
    expect(resolveWorldInfoMarker(pack, "charDescription")).toBeNull();
  });
});
