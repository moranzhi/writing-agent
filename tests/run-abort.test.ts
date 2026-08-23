import { describe, expect, it } from "vitest";
import { MockLlmProvider } from "../src/llm/client.js";
import {
  isAbortError,
  runWithAbortSignal,
  throwIfAborted,
} from "../src/llm/run-abort.js";

describe("run abort", () => {
  it("isAbortError detects AbortError name", () => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    expect(isAbortError(err)).toBe(true);
    expect(isAbortError(new Error("LLM request failed"))).toBe(false);
  });

  it("throwIfAborted raises AbortError when the signal is aborted", () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => throwIfAborted(ac.signal)).toThrowError(/aborted/i);
  });

  it("mock LLM respects the active abort signal", async () => {
    const llm = new MockLlmProvider(["ok"]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      runWithAbortSignal(ac.signal, () => llm.complete([{ role: "user", content: "x" }])),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
