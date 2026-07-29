import { describe, expect, it } from "vitest";
import {
  createMessageBranchState,
  createUserVariantMessage,
  ensureBranchForEdit,
  recordPreMessageCheckpoint,
  switchBranchVariant,
} from "../src/server/message-branch.js";
import { createSession } from "../src/runtime/phase-machine.js";

describe("message-branch", () => {
  it("switchBranchVariant restores alternate user text", () => {
    const state = createMessageBranchState();
    const checkpoint = {
      runtimeSession: createSession("default"),
      blackboardItems: [],
    };
    const messages = [
      createUserVariantMessage("版本 A", "g1", 0),
      { id: "w1", role: "system" as const, text: "回复 A", createdAt: "1" },
    ];
    messages[0].branchGroupId = "g1";
    messages[0].branchIndex = 0;
    messages[0].branchTotal = 2;

    state.branches.g1 = {
      anchorIndex: 0,
      groupId: "g1",
      activeIndex: 1,
      variants: [
        {
          messages: [messages[0], messages[1]],
          checkpoint,
        },
        {
          messages: [
            createUserVariantMessage("版本 B", "g1", 1),
            { id: "w2", role: "system" as const, text: "回复 B", createdAt: "2" },
          ],
          checkpoint,
        },
      ],
    };

    const switched = switchBranchVariant(state, messages, "g1", -1);
    expect(switched?.messages[0].text).toBe("版本 A");
    expect(switched?.messages[1].text).toBe("回复 A");
    expect(state.branches.g1.activeIndex).toBe(0);
  });

  it("ensureBranchForEdit captures first variant", () => {
    const state = createMessageBranchState();
    const messages = [
      createUserVariantMessage("首句", "u1", 0),
    ];
    recordPreMessageCheckpoint(state, 0, {
      runtimeSession: createSession("default"),
      blackboardItems: [],
    });
    const branch = ensureBranchForEdit(state, messages, 0, state.preMessageCheckpoints[0]!);
    expect(branch.variants).toHaveLength(1);
    expect(branch.variants[0].messages[0].text).toBe("首句");
  });
});
