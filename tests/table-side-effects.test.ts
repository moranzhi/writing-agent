import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import {
  createTableFromValues,
  mergeTableCells,
} from "../src/blackboard/table-cells.js";
import {
  SIDE_EFFECT_FIRED_TAG,
  applySideEffectTagActions,
  evaluateSideEffects,
  parseFiredRegistry,
  parseSideEffectRules,
  stringifyFiredRegistry,
} from "../src/blackboard/table-side-effects.js";

describe("table-side-effects", () => {
  const rules = parseSideEffectRules({
    side_effects: [
      {
        id: "affinity-romance",
        field: "好感",
        op: "gte",
        value: 60,
        mode: "once",
        action: {
          type: "write_tag",
          tag: "上下文.角色态度",
          content: "恋爱模式",
        },
      },
      {
        id: "chapter-1",
        field: "当前章",
        op: "eq",
        value: "第一章",
        mode: "once",
        action: {
          type: "write_tag",
          tag: "上下文.细纲",
          content: "第一章细纲",
        },
      },
      {
        id: "hp-warn",
        field: "HP",
        op: "lte",
        value: 20,
        mode: "every_edge",
        action: {
          type: "queue_worker",
          workerId: "narrator",
          note: "低血警告",
        },
      },
    ],
  });

  it("parses side_effects from tables", () => {
    expect(rules).toHaveLength(3);
    expect(rules[0]?.id).toBe("affinity-romance");
    expect(rules[0]?.mode).toBe("once");
  });

  it("fires on rising edge only, not while condition stays true", () => {
    const prev = createTableFromValues({ 好感: 50 }, "worker:a");
    const mid = createTableFromValues({ 好感: 65 }, "worker:a");
    const first = evaluateSideEffects({
      prev,
      next: mid,
      rules,
      fired: {},
    });
    expect(first.triggers.map((t) => t.rule.id)).toEqual(["affinity-romance"]);

    const stillHigh = createTableFromValues({ 好感: 80 }, "worker:a");
    const second = evaluateSideEffects({
      prev: mid,
      next: stillHigh,
      rules,
      fired: first.nextFired,
    });
    expect(second.triggers).toHaveLength(0);
    expect(second.nextFired["affinity-romance"]).toBeTruthy();
  });

  it("does not re-fire once rule after drop-and-rise when already fired", () => {
    const fired = { "affinity-romance": { at: "2020-01-01T00:00:00.000Z" } };
    const prev = createTableFromValues({ 好感: 40 }, "worker:a");
    const next = createTableFromValues({ 好感: 70 }, "worker:a");
    const result = evaluateSideEffects({ prev, next, rules, fired });
    expect(result.triggers.find((t) => t.rule.id === "affinity-romance")).toBeUndefined();
  });

  it("every_edge can fire again after leaving and re-entering", () => {
    const low = createTableFromValues({ HP: 10 }, "worker:a");
    const ok = createTableFromValues({ HP: 50 }, "worker:a");
    const lowAgain = createTableFromValues({ HP: 15 }, "worker:a");

    const enter = evaluateSideEffects({
      prev: createTableFromValues({ HP: 40 }, "worker:a"),
      next: low,
      rules,
      fired: {},
    });
    expect(enter.queuedWorkers.map((q) => q.workerId)).toEqual(["narrator"]);

    const leave = evaluateSideEffects({
      prev: low,
      next: ok,
      rules,
      fired: enter.nextFired,
    });
    expect(leave.triggers).toHaveLength(0);

    const reenter = evaluateSideEffects({
      prev: ok,
      next: lowAgain,
      rules,
      fired: leave.nextFired,
    });
    expect(reenter.queuedWorkers.map((q) => q.workerId)).toEqual(["narrator"]);
  });

  it("applies write_tag actions and persists fired registry", () => {
    const bb = new Blackboard();
    const prev = createTableFromValues({ 当前章: "序章" }, "user");
    const next = createTableFromValues({ 当前章: "第一章" }, "worker:var");
    const { triggers, nextFired } = evaluateSideEffects({
      prev,
      next,
      rules,
      fired: {},
    });
    const { writtenTags } = applySideEffectTagActions({
      blackboard: bb,
      triggers,
      source: "side-effect:test",
    });
    expect(writtenTags).toContain("上下文.细纲");
    expect(bb.getContentByTag("上下文.细纲")).toBe("第一章细纲");
    bb.write({
      tag: SIDE_EFFECT_FIRED_TAG,
      content: stringifyFiredRegistry(nextFired),
      source: "system",
    });
    expect(parseFiredRegistry(bb.getContentByTag(SIDE_EFFECT_FIRED_TAG))["chapter-1"]).toBeTruthy();
  });

  it("works after mergeTableCells patch", () => {
    const current = createTableFromValues({ 好感: 55 }, "worker:a");
    const patch = createTableFromValues({ 好感: 60 }, "worker:b");
    const { doc } = mergeTableCells({
      current,
      patch,
      actor: "worker:b",
    });
    const { triggers } = evaluateSideEffects({
      prev: current,
      next: doc,
      rules,
      fired: {},
    });
    expect(triggers[0]?.rule.id).toBe("affinity-romance");
  });
});
