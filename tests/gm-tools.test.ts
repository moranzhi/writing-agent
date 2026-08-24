import { describe, expect, it } from "vitest";
import {
  executeChanceBatch,
  parseChanceBatchRequest,
} from "../src/skills/chance-tools.js";
import {
  executeGmChanceTool,
  gmChanceToolsEnabled,
} from "../src/skills/gm-tools.js";

describe("chance batch", () => {
  it("parses requests array", () => {
    const items = parseChanceBatchRequest({
      requests: [
        { id: "door", op: "roll", expression: "1d20" },
        { id: "win", op: "compare", left: 15, right: 12 },
      ],
    });
    expect(items?.map((x) => x.id)).toEqual(["door", "win"]);
  });

  it("executeGmChanceTool returns batch schema", () => {
    const parsed = executeGmChanceTool(
      JSON.stringify({
        requests: [{ id: "x", op: "roll", expression: "1d6" }],
      }),
    );
    expect(parsed.schema).toBe("chance.batch.v1");
    expect(parsed.results[0]!.id).toBe("x");
  });
});

describe("gmChanceToolsEnabled", () => {
  it("defaults on when play_slots omitted", () => {
    expect(gmChanceToolsEnabled(undefined)).toBe(true);
  });

  it("respects chance=false", () => {
    expect(gmChanceToolsEnabled({ chance: false })).toBe(false);
  });

  it("enables when chance=true", () => {
    expect(gmChanceToolsEnabled({ chance: true })).toBe(true);
  });
});
