import { describe, expect, it } from "vitest";
import {
  createMockMainAgentResponse,
  createMockToolCall,
  MockLlmProvider,
} from "../src/llm/client.js";
import { buildIntakeProgress, readIntakeValues } from "../src/intake/intake.js";
import { PhaseRuntime } from "../src/runtime/phase-runtime.js";

describe("phase runtime", () => {
  it("selects basic skill and shows startup inquiry", async () => {
    const runtime = new PhaseRuntime();
    await runtime.start();
    expect(runtime.getSession().waitingReason?.kind).toBe("skill_selection");

    await runtime.selectSkill("basic");
    expect(runtime.getSession().waitingReason?.kind).toBe("intake");
    expect(runtime.getActiveSkill()?.name).toBe("basic");
  });

  it("writes book.brief after intake confirm", async () => {
    const runtime = new PhaseRuntime();
    await runtime.start();
    await runtime.selectSkill("basic");
    await runtime.submitInput("科幻中篇，第三人称");
    await runtime.confirmIntake();
    expect(runtime.getSession().slots["book.brief"]).toContain("科幻");
    expect(runtime.getSession().slots.startupCompleted).toBe(true);
  });

  it("syncs demand tag to blackboard after intake confirm", async () => {
    const runtime = new PhaseRuntime();
    await runtime.start();
    await runtime.selectSkill("roleplay-game-theory");
    const fields = runtime.getActiveSkill()?.intakeFields ?? [];
    await runtime.submitInput("德州扑克，经典博弈情境");
    await runtime.submitInput("玩家A算计型，玩家B怕吃亏");
    await runtime.submitInput("单轮定胜负，需要思考标签与场景描写");
    const progress = buildIntakeProgress(
      fields,
      readIntakeValues(runtime.getSession().slots),
    );
    if (!progress.ready) {
      const values = readIntakeValues(runtime.getSession().slots);
      for (const f of fields.filter((x) => x.required && !values[x.id])) {
        values[f.id] = "补充";
      }
      await runtime.dispatch({
        type: "user_submitted_input",
        payload: { text: "补充", intakeValues: values },
      });
    }
    await runtime.confirmIntake();
    const demand = runtime.getBlackboard().getContentByTag("用户.博弈需求") ?? "";
    expect(demand).toContain("德州扑克");
    expect(runtime.getSession().slots.startupCompleted).toBe(true);
  });

  it("mock main agent tool loop reads blackboard then proposes worker", async () => {
    const runtime = new PhaseRuntime({
      llm: new MockLlmProvider([
        createMockToolCall("read_blackboard", { tags: ["book.brief"] }),
        createMockToolCall("run_worker", {
          workerId: "outline",
          reason: "已读需求，生成大纲",
          requiresApproval: true,
        }),
      ]),
    });
    await runtime.start();
    await runtime.selectSkill("basic");
    await runtime.submitInput("科幻中篇，第三人称");
    await runtime.confirmIntake();
    expect(runtime.getSession().waitingReason?.kind).toBe("approve_step");
    expect(runtime.getSession().pendingDecision?.workerId).toBe("outline");
  });
});
