import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  applyPlayAuxLlmBubbles,
  isPlayAuxLlmBubblesEnabled,
  isPlayAuxLlmOutput,
} from "../web/feed-prefs.js";

describe("play aux LLM bubbles", () => {
  beforeEach(() => {
    applyPlayAuxLlmBubbles(false);
  });
  afterEach(() => {
    applyPlayAuxLlmBubbles(false);
  });

  it("stores the more-menu preference", () => {
    expect(isPlayAuxLlmBubblesEnabled()).toBe(false);
    applyPlayAuxLlmBubbles(true);
    expect(isPlayAuxLlmBubblesEnabled()).toBe(true);
  });

  it("treats auditor worker_output as aux and world-simulator as main", () => {
    const play = { lifecycleStage: "play" };
    expect(
      isPlayAuxLlmOutput(
        { role: "assistant", kind: "worker_output", actor: "auditor" },
        play,
      ),
    ).toBe(true);
    expect(
      isPlayAuxLlmOutput(
        {
          role: "assistant",
          kind: "worker_output",
          actor: "world-simulator",
          title: "主世界层 · 产出",
        },
        play,
      ),
    ).toBe(false);
    expect(
      isPlayAuxLlmOutput(
        {
          role: "assistant",
          kind: "worker_output",
          actor: "narrator",
          title: "叙事转述 · 产出",
        },
        play,
      ),
    ).toBe(false);
  });
});
