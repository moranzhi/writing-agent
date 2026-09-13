import { describe, expect, it } from "vitest";
import { reconstructLlmMessages } from "../src/server/model-compare.js";
import { buildContextTrace } from "../src/types/context-trace.js";

describe("model-compare reconstructLlmMessages", () => {
  it("restores plain roles", () => {
    const trace = buildContextTrace({
      caller: "test",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      model: "m1",
    });
    expect(reconstructLlmMessages(trace)).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
  });

  it("restores tool_calls extras frozen as JSON content", () => {
    const trace = buildContextTrace({
      caller: "test",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "foo", arguments: "{}" },
            },
          ],
        },
        { role: "tool", content: "ok", tool_call_id: "c1" },
      ],
    });
    const msgs = reconstructLlmMessages(trace);
    expect(msgs[0]).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "foo", arguments: "{}" },
        },
      ],
    });
    expect(msgs[1]).toEqual({
      role: "tool",
      content: "ok",
      tool_call_id: "c1",
    });
  });
});
