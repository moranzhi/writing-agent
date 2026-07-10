import { describe, expect, it } from "vitest";
import {
  createMockMainAgentResponse,
  createMockToolCall,
  MockLlmProvider,
} from "../src/llm/client.js";
import { runMainAgentToolLoop } from "../src/main-agent/tool-loop.js";
import { toolCallToDecision } from "../src/runtime/tool-registry.js";
import { createSession } from "../src/runtime/phase-machine.js";

describe("main agent tool loop", () => {
  const baseContext = {
    session: createSession("default"),
    blackboardIndex: [{ id: "1", tag: "book.brief", source: "user" }],
    availableWorkers: [{ id: "outline", description: "生成大纲" }],
  };

  const handlers = {
    readBlackboard: (tags: string[]) =>
      Object.fromEntries(tags.map((t) => [t, t === "book.brief" ? "科幻中篇" : ""])),
    listWorkers: () => [{ id: "outline", description: "生成大纲" }],
    listArtifacts: () => [],
  };

  it("runs loop tools then returns terminal decision", async () => {
    const llm = new MockLlmProvider([
      createMockToolCall("read_blackboard", { tags: ["book.brief"] }),
      createMockToolCall("run_worker", {
        workerId: "outline",
        reason: "需求已齐，生成大纲",
        requiresApproval: true,
      }),
    ]);

    const result = await runMainAgentToolLoop(llm, baseContext, handlers);
    expect(result.iterations).toBe(2);
    expect(result.toolTrace).toEqual(["read_blackboard", "run_worker (terminal)"]);
    expect(result.decision.action).toBe("run_worker");
    expect(result.decision.workerId).toBe("outline");
    expect(result.decision.requiresApproval).toBe(true);
  });

  it("falls back to JSON content when no tool calls", async () => {
    const llm = new MockLlmProvider([
      createMockMainAgentResponse({
        action: "ask_user",
        reason: "请补充篇幅",
        requiresApproval: false,
      }),
    ]);

    const result = await runMainAgentToolLoop(llm, baseContext, handlers);
    expect(result.decision.action).toBe("ask_user");
    expect(result.decision.reason).toContain("篇幅");
  });

  it("maps finish tool to decision", () => {
    const decision = toolCallToDecision({
      id: "c1",
      name: "finish",
      arguments: JSON.stringify({ reason: "完成" }),
    });
    expect(decision.action).toBe("finish");
    expect(decision.reason).toBe("完成");
  });
});
