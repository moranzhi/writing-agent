import { describe, expect, it } from "vitest";
import {
  createMockMainAgentResponse,
  createMockToolCall,
  MockLlmProvider,
} from "../src/llm/client.js";
import { PhaseRuntime, createDecision } from "../src/runtime/phase-runtime.js";

describe("phase runtime", () => {
  it("auto-loads default orchestrator and awaits first user input", async () => {
    const runtime = new PhaseRuntime();
    await runtime.start();
    expect(runtime.getActiveSkill()?.name).toBe("world-simulator");
    expect(runtime.getActiveSkill()?.startupMode).toBe("agent-first");
    expect(runtime.getSession().waitingReason?.kind).toBe("input");
  });

  it("writes 用户.需求 and invokes main agent after first input", async () => {
    const llm = new MockLlmProvider([
      createMockMainAgentResponse([
        createMockToolCall("ask_user", {
          question: "还需要补充吗？",
          reason: "确认交互细节",
        }),
      ]),
    ]);
    const runtime = new PhaseRuntime({ llm });
    await runtime.start();
    await runtime.submitInput("西幻升级交互，世界推着走");
    expect(runtime.getSession().slots["用户.需求"]).toContain("西幻");
    expect(runtime.getSession().slots.startupCompleted).toBe(true);
  });

  it("stub run_worker design-flow is allowed before worker set accept", async () => {
    const runtime = new PhaseRuntime({ autoStubWorker: true });
    await runtime.start();
    await runtime.submitInput("网恋对象对话");
    await runtime.submitDecision(
      createDecision({
        action: "run_worker",
        reason: "编排创作流程",
        workerId: "design-flow",
        requiresApproval: false,
      }),
    );
    expect(runtime.getSession().artifacts.some((a) => a.workerId === "design-flow")).toBe(
      true,
    );
  });
});
