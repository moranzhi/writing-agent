import { describe, expect, it } from "vitest";
import {
  createMockToolCall,
  MockLlmProvider,
} from "../src/llm/client.js";
import { createLocalLlmDriver } from "../src/runtime/driver.js";

describe("local LLM driver", () => {
  it("continues while tools return results, then stops on text", async () => {
    const llm = new MockLlmProvider([
      createMockToolCall("lookup", { q: "a" }, "c1"),
      "done",
    ]);
    const driver = createLocalLlmDriver(llm);
    const seen: string[] = [];

    const run = await driver.run({
      system: "sys",
      messages: [{ role: "user", content: "go" }],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            description: "lookup",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      handleStep: (calls) => {
        seen.push(...calls.map((c) => c.name));
        return {
          kind: "continue",
          results: calls.map((c) => ({ callId: c.id, content: "ok" })),
        };
      },
    });

    expect(seen).toEqual(["lookup"]);
    expect(run.iterations).toBe(2);
    expect(run.stop).toEqual({ kind: "text", content: "done" });
  });

  it("uses reasoning as the story when tools return no content", async () => {
    const llm = {
      complete: async () => ({ content: "" }),
      completeWithTools: async () => ({
        content: null,
        toolCalls: [],
        reasoning: "门开了。她把耳机摘下，问：「你在干什么？」",
      }),
    };
    const driver = createLocalLlmDriver(llm as never);
    const run = await driver.run({
      system: "sys",
      messages: [{ role: "user", content: "go" }],
      tools: [
        {
          type: "function",
          function: {
            name: "chance",
            description: "roll",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      handleStep: () => ({ kind: "continue", results: [] }),
    });
    expect(run.stop).toEqual({
      kind: "text",
      content: "门开了。她把耳机摘下，问：「你在干什么？」",
    });
  });

  it("stops when handleStep concludes, without another model call", async () => {
    const llm = new MockLlmProvider([
      createMockToolCall("run_worker", { workerId: "x" }, "t1"),
      "should-not-be-used",
    ]);
    const driver = createLocalLlmDriver(llm);

    const run = await driver.run({
      system: "sys",
      messages: [{ role: "user", content: "go" }],
      tools: [
        {
          type: "function",
          function: {
            name: "run_worker",
            description: "run",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      handleStep: (calls) => ({ kind: "conclude", call: calls[0]! }),
    });

    expect(run.iterations).toBe(1);
    expect(run.stop.kind).toBe("conclude");
    if (run.stop.kind === "conclude") {
      expect(run.stop.call.name).toBe("run_worker");
    }
  });

  it("throws when the iteration cap is hit", async () => {
    const llm = new MockLlmProvider([
      createMockToolCall("ping", {}, "p1"),
    ]);
    const driver = createLocalLlmDriver(llm);

    await expect(
      driver.run({
        system: "sys",
        messages: [{ role: "user", content: "go" }],
        tools: [
          {
            type: "function",
            function: {
              name: "ping",
              description: "ping",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        maxIterations: 2,
        handleStep: (calls) => ({
          kind: "continue",
          results: calls.map((c) => ({ callId: c.id, content: "pong" })),
        }),
      }),
    ).rejects.toThrow(/exceeded 2 iterations/);
  });
});
