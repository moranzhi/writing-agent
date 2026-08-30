import { describe, expect, it } from "vitest";
import {
  buildContextTrace,
  pruneContextTraces,
} from "../src/types/context-trace.js";

function msg(id: string, withTrace = false) {
  return {
    id,
    ...(withTrace
      ? {
          contextTrace: buildContextTrace({
            caller: `c-${id}`,
            messages: [{ role: "user", content: `hello-${id}` }],
          }),
        }
      : {}),
  };
}

describe("pruneContextTraces", () => {
  it("keeps only the latest N traces", () => {
    const messages = [
      msg("1", true),
      msg("2"),
      msg("3", true),
      msg("4", true),
      msg("5", true),
      msg("6", true),
    ];
    const pruned = pruneContextTraces(messages, 2);
    expect(pruned.map((m) => Boolean(m.contextTrace))).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(pruned[4].id).toBe("5");
    expect(pruned[5].contextTrace?.caller).toBe("c-6");
  });

  it("clears all when keepLatest is 0", () => {
    const messages = [msg("a", true), msg("b", true)];
    const pruned = pruneContextTraces(messages, 0);
    expect(pruned.every((m) => !m.contextTrace)).toBe(true);
    expect(pruned.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("pins design-flow traces while pruning others", () => {
    const messages = [
      {
        id: "flow",
        contextTrace: buildContextTrace({
          caller: "worker:design-flow",
          messages: [{ role: "user", content: "plan" }],
        }),
      },
      msg("1", true),
      msg("2", true),
      msg("3", true),
    ];
    const pruned = pruneContextTraces(messages, 1);
    expect(pruned[0]?.contextTrace?.caller).toBe("worker:design-flow");
    expect(pruned.map((m) => Boolean(m.contextTrace))).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  it("is a no-op when under the limit", () => {
    const messages = [msg("1", true), msg("2", true)];
    const pruned = pruneContextTraces(messages, 5);
    expect(pruned).toBe(messages);
  });
});

describe("buildContextTrace", () => {
  it("counts characters and copies messages", () => {
    const trace = buildContextTrace({
      caller: "worker:x",
      model: "m",
      messages: [
        { role: "system", content: "abc" },
        { role: "user", content: "de" },
      ],
    });
    expect(trace.charCount).toBe(5);
    expect(trace.caller).toBe("worker:x");
    expect(trace.model).toBe("m");
    expect(trace.messages).toHaveLength(2);
  });
});
