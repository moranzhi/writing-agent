import { describe, expect, it } from "vitest";
import {
  foldRunProcessMessages,
  pruneCreationUnitMessages,
  trimCreationDialogueMessages,
  selectCreationDialogueForAi,
  buildCreationDialogueTranscript,
  type PrunableChatMessage,
} from "../src/server/prune-creation-messages.js";
import {
  isDesignUnitArtifact,
  isFinalWorkerSetArtifact,
  isWorkerSetReadyForFinal,
  listCreationUnits,
  nextCreationUnitId,
} from "../src/skills/creation-units.js";
import type { ParsedWorkerSet } from "../src/skills/worker-set-parse.js";
import { Blackboard } from "../src/blackboard/blackboard.js";
import { compressAfterWorkerAccept } from "../src/runtime/compress-after-worker.js";
import { hasAcceptedWorkerSet } from "../src/skills/worker-declaration.js";
import { createSession } from "../src/runtime/phase-machine.js";

function msg(
  partial: Partial<PrunableChatMessage> & Pick<PrunableChatMessage, "id" | "role" | "text">,
): PrunableChatMessage {
  return { createdAt: "2026-01-01T00:00:00.000Z", ...partial };
}

describe("pruneCreationUnitMessages", () => {
  it("is a no-op: does not delete user-visible messages", () => {
    const messages: PrunableChatMessage[] = [
      msg({ id: "1", role: "user", text: "我想玩校园末日", kind: "user_input" }),
      msg({
        id: "2",
        role: "system",
        text: "[Worker] design-core 运行中",
        kind: "worker_running",
        actor: "design-core",
      }),
      msg({
        id: "3",
        role: "system",
        text: "[Worker] design-core 提问",
        kind: "worker_questions",
        actor: "design-core",
      }),
      msg({ id: "4", role: "user", text: "单角代入", kind: "user_input" }),
      msg({
        id: "5",
        role: "system",
        text: "[Worker] design-core 草稿",
        kind: "worker_output",
        actor: "design-core",
        body: "{ draft }",
      }),
      msg({
        id: "6",
        role: "system",
        text: "[Worker] design-core 定稿",
        kind: "worker_output",
        actor: "design-core",
        body: "{ final }",
      }),
    ];
    const idsBefore = messages.map((m) => m.id);
    const result = pruneCreationUnitMessages(messages, "design-core");
    expect(result).toEqual({ removedCount: 0, productKept: false });
    expect(messages.map((m) => m.id)).toEqual(idsBefore);
  });
});

describe("selectCreationDialogueForAi / buildCreationDialogueTranscript", () => {
  it("keeps full messages for browsing; AI transcript only last AI + all users", () => {
    const messages: PrunableChatMessage[] = [
      msg({ id: "u1", role: "user", text: "荒野求生", kind: "user_input" }),
      msg({
        id: "a1",
        role: "system",
        text: "draft1",
        kind: "worker_output",
        actor: "design-core",
      }),
      msg({ id: "u2", role: "user", text: "无其它幸存者", kind: "user_input" }),
      msg({
        id: "run",
        role: "system",
        text: "running",
        kind: "worker_running",
        actor: "design-core",
      }),
      msg({
        id: "a2",
        role: "system",
        text: "draft2",
        kind: "worker_output",
        actor: "design-core",
        body: "{ v2 }",
      }),
    ];

    // 用户浏览：原数组不动
    const { removedCount } = trimCreationDialogueMessages(messages);
    expect(removedCount).toBe(0);
    expect(messages.map((m) => m.id)).toEqual(["u1", "a1", "u2", "run", "a2"]);

    // 拼给 AI：用户全量 + 最后一次 AI
    expect(selectCreationDialogueForAi(messages).map((m) => m.id)).toEqual([
      "u1",
      "u2",
      "a2",
    ]);
    const transcript = buildCreationDialogueTranscript(messages);
    expect(transcript).toContain("荒野求生");
    expect(transcript).toContain("无其它幸存者");
    expect(transcript).toContain("{ v2 }");
    expect(transcript).not.toContain("draft1");
    expect(transcript).not.toContain("running");
  });
});

describe("foldRunProcessMessages", () => {
  it("marks process messages compressed without deleting", () => {
    const messages: PrunableChatMessage[] = [
      msg({
        id: "1",
        role: "system",
        text: "q",
        kind: "worker_questions",
        actor: "narrator",
      }),
      msg({
        id: "2",
        role: "system",
        text: "out",
        kind: "worker_output",
        actor: "narrator",
      }),
    ];
    foldRunProcessMessages(messages, "narrator");
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.compressed)).toBe(true);
  });
});

describe("listCreationUnits", () => {
  it("only lists filled fixed topics by default (not empty catalog blanks)", () => {
    const parsed: ParsedWorkerSet = {
      interaction: {
        user_stance: "单角",
        system_role: "世界",
        output: "叙事",
      },
      narrative_guide: "世界不有求必应",
      workers: [
        {
          ref: "narrator",
          duty: "转述",
          rationale: "可读",
          acceptance: "review",
        },
        { ref: null, duty: "缺口", gap: "待定" },
      ],
      resident_context: [
        { id: "tone", content: "文风克制", position: "static" },
      ],
    };
    const units = listCreationUnits(parsed, {
      acceptedUnitIds: ["fixed:interaction", "skeleton:interaction"],
      currentUnitId: "worker:narrator",
    });
    expect(units.map((u) => u.id)).toEqual([
      "phase:core",
      "fixed:narrative_guide",
      "worker:narrator",
      "worker:#2",
      "resident:tone",
    ]);
    expect(units.find((u) => u.id === "phase:core")?.accepted).toBe(true);
    expect(units.every((u) => u.id !== "fixed:input_protocol" || u.filled)).toBe(
      true,
    );
    expect(units.find((u) => u.id === "fixed:input_protocol")).toBeUndefined();
    expect(units.find((u) => u.id === "worker:narrator")?.current).toBe(true);
  });

  it("nextCreationUnitId prefers foundation fixed tags before workers", () => {
    const parsed: ParsedWorkerSet = {
      interaction: {
        user_stance: "单角",
        system_role: "世界",
        output: "叙事",
      },
      workers: [{ ref: "narrator", duty: "转述", rationale: "r" }],
    };
    expect(nextCreationUnitId(parsed, ["fixed:interaction"])).toBe(
      "fixed:narrative_guide",
    );
  });

  it("nextCreationUnitId reaches workers after weighty fixed accepted", () => {
    const parsed: ParsedWorkerSet = {
      interaction: {
        user_stance: "单角",
        system_role: "世界",
        output: "叙事",
      },
      narrative_guide: "边界清晰",
      workers: [{ ref: "narrator", duty: "转述", rationale: "r" }],
    };
    expect(
      nextCreationUnitId(parsed, [
        "fixed:interaction",
        "fixed:narrative_guide",
        "fixed:aesthetics",
        "fixed:input_protocol",
        "fixed:core_premises",
      ]),
    ).toBe("worker:narrator");
  });
});

describe("artifact classification", () => {
  it("distinguishes unit vs final", () => {
    expect(
      isDesignUnitArtifact({
        workerId: "design-core",
        outputTags: ["设计.worker集.草稿"],
      }),
    ).toBe(true);
    expect(
      isFinalWorkerSetArtifact({
        workerId: "design-core",
        outputTags: ["设计.worker集"],
      }),
    ).toBe(true);
    expect(
      isDesignUnitArtifact({
        workerId: "design-core",
        outputTags: ["设计.worker集", "设计.worker集.草稿"],
      }),
    ).toBe(false);
  });
});

describe("hasAcceptedWorkerSet", () => {
  it("does not treat draft-only accepted artifact as ready", () => {
    const session = {
      ...createSession(),
      artifacts: [
        {
          id: "a1",
          workerId: "design-core",
          outputTags: ["设计.worker集.草稿"],
          status: "accepted" as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    expect(hasAcceptedWorkerSet(session)).toBe(false);
  });
});

describe("compressAfterWorkerAccept unit mode", () => {
  it("keeps draft active and does not write brief as final", () => {
    const bb = new Blackboard();
    bb.write({
      tag: "设计.worker集.草稿",
      content: '{ "workers": [{ "ref": "narrator" }] }',
      source: "design-core",
    });
    bb.write({
      tag: "用户.worker答复",
      content: "过程问答",
      source: "user",
    });
    const result = compressAfterWorkerAccept({
      blackboard: bb,
      workerId: "design-core",
      outputTags: ["设计.worker集.草稿"],
      summary: "单位 worker:narrator",
      mode: "unit",
    });
    expect(result.archivedTags).toContain("用户.worker答复");
    expect(bb.getContentByTag("设计.worker集.草稿")).toContain("narrator");
    expect(bb.getLatestByTag("设计.worker集.草稿")?.metadata?.role).not.toBe(
      "archived",
    );
  });
});

describe("isWorkerSetReadyForFinal", () => {
  it("requires accepted filled units", () => {
    const parsed: ParsedWorkerSet = {
      interaction: {
        user_stance: "单角",
        system_role: "世界",
        output: "叙事",
      },
      workers: [{ ref: "narrator", duty: "转述", rationale: "r" }],
    };
    expect(isWorkerSetReadyForFinal(parsed, []).ready).toBe(false);
    expect(
      isWorkerSetReadyForFinal(parsed, [
        "fixed:interaction",
        "worker:narrator",
      ]).ready,
    ).toBe(true);
  });
});
