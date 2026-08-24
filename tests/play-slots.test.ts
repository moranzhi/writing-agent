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
import {
  parseSettlementPacket,
  settlementChangesToTablePatch,
} from "../src/skills/settlement-packet.js";
import {
  emptyMaintainPacket,
  isMaintainPacketEmpty,
  maintainOpsToTablePatch,
  parseMaintainPacket,
} from "../src/skills/maintain-packet.js";
import {
  createTableFromValues,
  mergeTableCells,
} from "../src/blackboard/table-cells.js";
import {
  executeChance,
  executeChanceBatch,
  parseChanceRequest,
} from "../src/skills/chance-tools.js";
import { synthesizeContextOrderFromWorkers } from "../src/skills/context-order.js";
import { DIALOGUE_HISTORY_TAG } from "../src/skills/dialogue-history.js";

describe("play_slots", () => {
  it("expands default auditor+gm+narrator", () => {
    const slots = parsePlaySlots({
      gm: true,
      narrator: true,
      perspective: false,
    })!;
    expect(slots.auditor).toBe(true);
    expect(refsFromPlaySlots(slots)).toEqual([
      "world-simulator",
      "narrator",
      "auditor",
    ]);
    const workers = expandPlaySlotsToWorkers(slots);
    expect(workers.map((w) => w.ref)).toEqual([
      "world-simulator",
      "narrator",
      "auditor",
    ]);
    expect(workers[0].acceptance).toBe("continue");
    expect(workers[1].acceptance).toBe("review");
    expect(workers[2].acceptance).toBe("continue");
  });

  it("orders gm first then perspective before narrator and auditor", () => {
    const slots = parsePlaySlots({
      auditor: true,
      gm: true,
      narrator: true,
      perspective: true,
    })!;
    expect(refsFromPlaySlots(slots)).toEqual([
      "world-simulator",
      "role-decide",
      "narrator",
      "auditor",
    ]);
  });

  it("can disable auditor", () => {
    const slots = parsePlaySlots({
      auditor: false,
      gm: true,
      narrator: true,
      perspective: false,
    })!;
    expect(refsFromPlaySlots(slots)).toEqual(["world-simulator", "narrator"]);
  });

  it("merges play_slots into worker set JSON", () => {
    const parsed = parseWorkerSetYaml(
      JSON.stringify({
        form_summary: "恋爱升温",
        play_slots: {
          auditor: true,
          gm: true,
          narrator: true,
          perspective: false,
        },
        workers: [],
      }),
    );
    expect(parsed?.play_slots?.auditor).toBe(true);
    expect(parsed?.workers).toHaveLength(3);
    expect(deriveRunWorkerScope(parsed)).toEqual([
      "world-simulator",
      "narrator",
      "auditor",
    ]);
  });

  it("preserves custom context on merge", () => {
    const slots = parsePlaySlots({
      auditor: false,
      gm: true,
      narrator: true,
    })!;
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
      auditor: false,
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
          auditor: false,
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

  it("batch executes multiple requests with ids", () => {
    const batch = executeChanceBatch([
      { id: "a", op: "roll", expression: "1d6" },
      { id: "b", op: "compare", left: 10, right: 5, mode: "gte" },
    ]);
    expect(batch.schema).toBe("chance.batch.v1");
    expect(batch.ok).toBe(true);
    expect(batch.results).toHaveLength(2);
    expect(batch.results[0]!.id).toBe("a");
    expect(batch.results[1]!.id).toBe("b");
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

  it("merges variable_changes into table patch with delta", () => {
    const current = createTableFromValues({ 好感: 10 }, "system");
    const patch = settlementChangesToTablePatch(
      [{ key: "好感", delta: 8 }],
      current,
    )!;
    const { doc } = mergeTableCells({
      current,
      patch,
      actor: "worker:world-simulator",
    });
    expect(doc.rows.find((r) => r.key === "好感")?.value).toBe(18);
  });

  it("merges variable_changes with absolute to", () => {
    const current = createTableFromValues({ 阶段: "相识" }, "system");
    const patch = settlementChangesToTablePatch(
      [{ key: "阶段", to: "暧昧" }],
      current,
    )!;
    const { doc } = mergeTableCells({
      current,
      patch,
      actor: "worker:world-simulator",
    });
    expect(doc.rows.find((r) => r.key === "阶段")?.value).toBe("暧昧");
  });
});

describe("maintain packet", () => {
  it("defaults to empty ops", () => {
    const view = parseMaintainPacket(
      JSON.stringify({
        schema: "maintain.v1",
        need_generate: false,
        table_ops: [],
        notes: [],
      }),
    );
    expect(view.ok).toBe(true);
    expect(view.empty).toBe(true);
    expect(isMaintainPacketEmpty(emptyMaintainPacket())).toBe(true);
  });

  it("accepts noop shorthand", () => {
    expect(parseMaintainPacket("无需").empty).toBe(true);
  });

  it("applies table_ops delta to 变量.当前", () => {
    const current = createTableFromValues({ 好感: 5 }, "system");
    const view = parseMaintainPacket(
      JSON.stringify({
        schema: "maintain.v1",
        table_ops: [{ op: "delta", key: "好感", delta: 3 }],
      }),
    );
    const patch = maintainOpsToTablePatch(
      view.packet!.table_ops!,
      current,
      "变量.当前",
    )!;
    const { doc } = mergeTableCells({
      current,
      patch,
      actor: "worker:auditor",
    });
    expect(doc.rows.find((r) => r.key === "好感")?.value).toBe(8);
  });
});

describe("context order synth", () => {
  it("skips dialogue history for auditor", () => {
    const order = synthesizeContextOrderFromWorkers(
      [
        { ref: "auditor", name: "旁观维护" },
        { ref: "world-simulator", name: "主世界层" },
      ],
      parsePlaySlots({ auditor: true, gm: true, narrator: false }),
    )!;
    const auditor = order.slots.find((s) => s.ref === "auditor")!;
    const gm = order.slots.find((s) => s.ref === "world-simulator")!;
    expect(auditor.inserts.some((i) => i.ref === DIALOGUE_HISTORY_TAG)).toBe(
      false,
    );
    expect(gm.inserts.some((i) => i.ref === DIALOGUE_HISTORY_TAG)).toBe(true);
  });
});
