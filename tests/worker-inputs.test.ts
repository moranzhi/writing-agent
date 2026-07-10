import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import { gatherWorkerInputs } from "../src/worker/executor.js";

describe("worker input gathering", () => {
  it("merges userInputs fallback when demand tag missing from blackboard", () => {
    const blackboard = new Blackboard();
    const inputs = gatherWorkerInputs(
      ["用户.博弈需求", "用户.worker答复"],
      "latest",
      {
        userInputs: ["德州扑克", "需要思考标签"],
      },
      blackboard,
    );
    expect(inputs["用户.博弈需求"]).toBe("德州扑克\n\n需要思考标签");
  });

  it("prefers blackboard and slots over userInputs fallback", () => {
    const blackboard = new Blackboard();
    blackboard.write({
      tag: "用户.博弈需求",
      content: "来自黑板",
      source: "user",
    });
    const inputs = gatherWorkerInputs(
      ["用户.博弈需求"],
      "latest",
      {
        "用户.博弈需求": "来自 slots",
        userInputs: ["旧输入"],
      },
      blackboard,
    );
    expect(inputs["用户.博弈需求"]).toBe("来自 slots");
  });

  it("falls back to userInputs transcript when demand slot empty", () => {
    const blackboard = new Blackboard();
    const longMsg =
      "1.德州扑克 2.角色：赌徒、职业玩家 3.终止：有人破产 4.规则：标准德州 5.要看思考";
    const inputs = gatherWorkerInputs(
      ["用户.博弈需求"],
      "latest",
      { userInputs: [longMsg] },
      blackboard,
    );
    expect(inputs["用户.博弈需求"]).toBe(longMsg);
  });
});
