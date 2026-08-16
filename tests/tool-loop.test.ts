import { describe, expect, it } from "vitest";
import {
  createMockMainAgentResponse,
  createMockToolCall,
  MockLlmProvider,
} from "../src/llm/client.js";
import { runMainAgentToolLoop } from "../src/main-agent/tool-loop.js";
import { MAIN_AGENT_TOOL_DEFINITIONS } from "../src/main-agent/tools.js";
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

  it("exposes only DAG routing tools", () => {
    expect(
      MAIN_AGENT_TOOL_DEFINITIONS.map((tool) => tool.function.name),
    ).toEqual(["read_blackboard", "run_worker"]);
  });

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

  it("maps ask_user assessment + questions", () => {
    const decision = toolCallToDecision({
      id: "c2",
      name: "ask_user",
      arguments: JSON.stringify({
        reason: "核心体验分叉需用户拍板",
        assessment:
          "核心感觉: 完备度 40%\n  已知: 皇帝权力幻想\n  待探: 【冷峻威严】还是【感官沉沦】？",
        questions: [
          {
            id: "q1",
            prompt: "你更倾向于哪种皇帝的享受？",
            options: [
              {
                label: "冰冷的、主宰一切的权力感——九重宫阙一言定生死",
              },
              {
                label: "私密的、极致的感官享受——温柔乡中的沉沦",
              },
            ],
          },
        ],
      }),
    });
    expect(decision.action).toBe("ask_user");
    expect(decision.reason).toBe("核心体验分叉需用户拍板");
    expect(decision.assessment).toContain("完备度 40%");
    expect(decision.questions).toHaveLength(1);
    expect(decision.questions?.[0]?.prompt).toContain("皇帝的享受");
    expect(decision.questions?.[0]?.options?.[0]?.label).toContain("权力感");
  });
});
