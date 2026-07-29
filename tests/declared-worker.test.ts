import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import { createSession } from "../src/runtime/phase-machine.js";
import {
  buildDeclaredWorkerSkill,
  resolveAcceptanceModeForWorker,
} from "../src/skills/declared-worker.js";
import { parseWorkerSetYaml } from "../src/skills/worker-set-parse.js";

describe("resolveAcceptanceModeForWorker", () => {
  it("always confirms design-flow", () => {
    const mode = resolveAcceptanceModeForWorker({
      session: createSession(),
      blackboard: new Blackboard(),
      workerId: "design-flow",
    });
    expect(mode).toBe("user_confirmed");
  });

  it("maps review → user_confirmed and continue → no_confirmation", () => {
    const bb = new Blackboard();
    const yaml = JSON.stringify({
      version: 1,
      workers: [
        { ref: "world-simulator", acceptance: "continue" },
        { ref: "narrator", acceptance: "review" },
      ],
    });
    bb.write({ tag: "设计.worker集", content: yaml, source: "test" });
    const session = {
      ...createSession(),
      slots: {
        ...createSession().slots,
        designInstanceReady: true,
        uiLifecycleStage: "play",
      },
    };

    expect(
      resolveAcceptanceModeForWorker({
        session,
        blackboard: bb,
        workerId: "world-simulator",
      }),
    ).toBe("no_confirmation");
    expect(
      resolveAcceptanceModeForWorker({
        session,
        blackboard: bb,
        workerId: "narrator",
      }),
    ).toBe("user_confirmed");
  });
});

describe("buildDeclaredWorkerSkill", () => {
  it("builds runnable contract from entry + template", () => {
    const parsed = parseWorkerSetYaml(
      JSON.stringify({
        version: 1,
        narrative_guide: "残酷但不虐主",
        core_premises: ["主角免疫"],
        workers: [
          {
            ref: "narrator",
            duty: "组装用户可见回复",
            rationale: "需要可读终稿",
            acceptance: "review",
            outputs: ["输出.用户展示"],
            context: {
              static: ["设计.worker集"],
              dynamic: ["运行.本轮.裁决"],
            },
          },
        ],
      }),
    );
    const entry = parsed!.workers[0];
    const { worker, promptBody } = buildDeclaredWorkerSkill({
      skillPackName: "world-simulator",
      entry,
      template: {
        label: "转述",
        prompt_excerpt: "只改表达不改事实",
        suggested_outputs: ["输出.用户展示"],
      },
      workerSet: parsed,
    });
    expect(worker.id).toBe("narrator");
    expect(worker.outputTags).toContain("输出.用户展示");
    expect(worker.inputTags).toContain("设计.worker集");
    expect(promptBody).toContain("残酷但不虐主");
    expect(promptBody).toContain("主角免疫");
    expect(promptBody).toContain("声明驱动");
  });
});
