import { describe, expect, it } from "vitest";
import {
  expandPlaySlotsToWorkers,
  mergeWorkersWithPlaySlots,
  onDemandRefsFromPlaySlots,
  parsePlaySlots,
  refsFromPlaySlots,
} from "../src/skills/play-slots.js";
import {
  deriveOnDemandWorkerScope,
  deriveRunWorkerScope,
  parseWorkerSetYaml,
} from "../src/skills/worker-set-parse.js";
import { parseSettlementPacket } from "../src/skills/settlement-packet.js";
import {
  executeChance,
  parseChanceRequest,
} from "../src/skills/chance-tools.js";

describe("play_slots", () => {
  it("expands default gm+narrator", () => {
    const slots = parsePlaySlots({ gm: true, narrator: true, perspective: false })!;
    expect(refsFromPlaySlots(slots)).toEqual(["world-simulator", "narrator"]);
    const workers = expandPlaySlotsToWorkers(slots);
    expect(workers.map((w) => w.ref)).toEqual(["world-simulator", "narrator"]);
    expect(workers[0].acceptance).toBe("continue");
    expect(workers[1].acceptance).toBe("review");
  });

  it("orders perspective before gm", () => {
    const slots = parsePlaySlots({
      gm: true,
      narrator: true,
      perspective: true,
    })!;
    expect(refsFromPlaySlots(slots)).toEqual([
      "role-decide",
      "world-simulator",
      "narrator",
    ]);
  });

  it("merges play_slots into worker set JSON", () => {
    const parsed = parseWorkerSetYaml(
      JSON.stringify({
        form_summary: "恋爱升温",
        play_slots: { gm: true, narrator: true, perspective: false },
        workers: [],
      }),
    );
    expect(parsed?.play_slots?.gm).toBe(true);
    expect(parsed?.workers).toHaveLength(2);
    expect(deriveRunWorkerScope(parsed)).toEqual([
      "world-simulator",
      "narrator",
    ]);
  });

  it("preserves custom context on merge", () => {
    const slots = parsePlaySlots({ gm: true, narrator: true })!;
    const merged = mergeWorkersWithPlaySlots(
      [
        {
          ref: "world-simulator",
          name: "自定义世界",
          context: { dynamic: ["变量.当前"] },
          outputs: ["运行.本轮.裁决"],
        },
      ],
      slots,
    );
    expect(merged[0].name).toBe("自定义世界");
    expect(merged[0].context?.dynamic).toEqual(["变量.当前"]);
    expect(merged[1].ref).toBe("narrator");
  });

  it("chance is on-demand and not in turn pipeline", () => {
    const slots = parsePlaySlots({
      gm: true,
      narrator: true,
      perspective: false,
      chance: true,
    })!;
    expect(refsFromPlaySlots(slots)).toEqual(["world-simulator", "narrator"]);
    expect(onDemandRefsFromPlaySlots(slots)).toEqual(["chance"]);
    const workers = expandPlaySlotsToWorkers(slots);
    expect(workers.map((w) => w.ref)).toEqual([
      "world-simulator",
      "narrator",
      "chance",
    ]);
    expect(workers.find((w) => w.ref === "chance")?.invocation).toBe(
      "on_demand",
    );

    const parsed = parseWorkerSetYaml(
      JSON.stringify({
        play_slots: {
          gm: true,
          narrator: true,
          perspective: false,
          chance: true,
        },
        workers: [],
      }),
    );
    expect(deriveRunWorkerScope(parsed)).toEqual([
      "world-simulator",
      "narrator",
    ]);
    expect(deriveOnDemandWorkerScope(parsed)).toEqual(["chance"]);
  });
});

describe("chance tools", () => {
  it("parses and rolls dice expression", () => {
    const req = parseChanceRequest({ op: "roll", expression: "2d6+1" });
    expect(req?.op).toBe("roll");
    const result = executeChance(req!);
    expect(result.ok).toBe(true);
    expect(result.detail.total).toBeTypeOf("number");
  });

  it("compares scores", () => {
    const result = executeChance({
      op: "compare",
      left: 15,
      right: 12,
      mode: "gte",
    });
    expect(result.ok).toBe(true);
    expect(result.detail.win).toBe(true);
  });

  it("draws from pool", () => {
    const result = executeChance({
      op: "draw",
      pool: ["甲", "乙", "丙"],
      count: 2,
      unique: true,
    });
    expect(result.ok).toBe(true);
    expect((result.detail.drawn as string[]).length).toBe(2);
  });
});

describe("settlement packet", () => {
  it("parses settlement.v1 into sections", () => {
    const view = parseSettlementPacket(
      JSON.stringify({
        schema: "settlement.v1",
        player_action: "送画册",
        resolved: ["林晚收下"],
        visible_now: "短谢，未邀留下",
        variable_changes: [{ key: "好感", from: 10, to: 18, delta: 8 }],
        do_not_say: ["好感数字"],
      }),
    );
    expect(view.ok).toBe(true);
    expect(view.sections.map((s) => s.title)).toContain("玩家行动");
    expect(view.sections.map((s) => s.title)).toContain("变量变更");
  });

  it("treats prose as visible_now fallback", () => {
    const view = parseSettlementPacket("林晚点头收下了画册。");
    expect(view.ok).toBe(true);
    expect(view.packet?.visible_now).toContain("画册");
  });
});
