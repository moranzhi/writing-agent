import { describe, expect, it } from "vitest";
import { createMockMainAgentResponse, MockLlmProvider } from "../src/llm/client.js";
import { parseMainAgentDecision } from "../src/main-agent/main-agent.js";

describe("main agent", () => {
  it("parses valid JSON decision", () => {
    const raw = createMockMainAgentResponse({
      action: "run_worker",
      workerId: "outline-worker",
      requiresApproval: true,
    });
    const decision = parseMainAgentDecision(raw);
    expect(decision.action).toBe("run_worker");
    expect(decision.workerId).toBe("outline-worker");
    expect(decision.statePatchAllowed).toBe(false);
  });
});

// 带 skill 的完整闭环见 tests/phase-skill.test.ts（PhaseRuntime）
// RuntimeOrchestrator 接 skill 层留待 Phase A1

describe("runtime orchestrator", () => {
  it("placeholder until orchestrator uses PhaseRuntime + skill", () => {
    expect(MockLlmProvider).toBeDefined();
  });
});
