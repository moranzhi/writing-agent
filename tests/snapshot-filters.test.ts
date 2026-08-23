import { describe, expect, it } from "vitest";
import {
  isRunPhaseBlackboardTag,
  materializeInstanceSnapshotPayload,
} from "../src/book/snapshot-filters.js";
import { createSession } from "../src/runtime/phase-machine.js";

describe("snapshot-filters", () => {
  it("keeps instance tags, strips run tags", () => {
    expect(isRunPhaseBlackboardTag("情境.实验.设定")).toBe(false);
    expect(isRunPhaseBlackboardTag("角色.A.设定")).toBe(false);
    expect(isRunPhaseBlackboardTag("博弈.规则.草稿")).toBe(false);
    expect(isRunPhaseBlackboardTag("运行.事件流")).toBe(true);
    expect(isRunPhaseBlackboardTag("输出.开场白")).toBe(false);
    expect(isRunPhaseBlackboardTag("运行.初始变量")).toBe(false);
    expect(isRunPhaseBlackboardTag("变量.当前")).toBe(false);
    expect(isRunPhaseBlackboardTag("对话.历史")).toBe(true);
    expect(isRunPhaseBlackboardTag("角色.A.思考")).toBe(true);
    expect(isRunPhaseBlackboardTag("世界.当前状态")).toBe(true);
  });

  it("materializeInstanceSnapshotPayload removes run blackboard items", () => {
    const session = createSession("default");
    session.slots.startupCompleted = true;
    session.slots.playLayerActive = true;
    session.slots.playTurnQueue = ["narrator"];
    session.artifacts = [
      {
        id: "a1",
        workerId: "setup-scenario",
        outputTags: ["情境.实验.设定"],
        status: "accepted",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "a2",
        workerId: "world-engine",
        outputTags: ["运行.事件流"],
        status: "accepted",
        createdAt: "",
        updatedAt: "",
      },
    ];

    const { blackboardItems, runtimeSession } = materializeInstanceSnapshotPayload({
      runtimeSession: session,
      blackboardItems: [
        { id: "1", tag: "情境.实验.设定", content: "x", source: "worker", createdAt: "", updatedAt: "" },
        { id: "2", tag: "运行.事件流", content: "y", source: "worker", createdAt: "", updatedAt: "" },
        { id: "3", tag: "角色.A.设定", content: "z", source: "worker", createdAt: "", updatedAt: "" },
        { id: "4", tag: "对话.历史", content: "## 用户\n\n买金", source: "runtime", createdAt: "", updatedAt: "" },
      ],
    });

    expect(blackboardItems.map((i) => i.tag).sort()).toEqual([
      "情境.实验.设定",
      "角色.A.设定",
    ]);
    expect(runtimeSession.artifacts).toHaveLength(1);
    expect(runtimeSession.artifacts[0].workerId).toBe("setup-scenario");
    expect(runtimeSession.slots.playLayerActive).toBeUndefined();
    expect(runtimeSession.slots.playTurnQueue).toBeUndefined();
  });
});
