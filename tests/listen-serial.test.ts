import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import {
  applyRedirectCut,
  isConfirmText,
  isListenSerialModeValue,
  LISTEN_SERIAL_MODE_VALUE,
  makeOutlineItems,
  markListenConsumed,
  readListenState,
  toListenView,
  unreadChars,
  writeListenBrief,
  writeListenOutline,
  writeListenPhase,
  writeListenSections,
} from "../src/listen-serial/index.js";
import { ensureBufferTarget } from "../src/listen-serial/state.js";

describe("listen-serial state", () => {
  it("recognizes mode value", () => {
    expect(isListenSerialModeValue(LISTEN_SERIAL_MODE_VALUE)).toBe(true);
    expect(isListenSerialModeValue("dictate")).toBe(false);
  });

  it("round-trips brief/outline/sections on blackboard", () => {
    const board = new Blackboard();
    ensureBufferTarget(board);
    writeListenPhase(board, "running");
    writeListenBrief(board, {
      thrill: "身份反差打脸",
      world: "现代都市；主角是隐退龙王",
      structure: "三段式",
    });
    const outline = makeOutlineItems(["被嘲", "亮身份", "全员后悔"], "全员后悔");
    writeListenOutline(board, outline);
    writeListenSections(board, [
      {
        id: "s1",
        outlineId: outline[0]!.id,
        title: "被嘲",
        text: "甲".repeat(100),
        summary: "被嘲讽",
        consumedChars: 0,
      },
    ]);
    const state = readListenState(board);
    expect(state.phase).toBe("running");
    expect(state.thrill).toContain("身份反差");
    expect(state.outline).toHaveLength(3);
    expect(state.outline[2]?.payoff).toBe(true);
    expect(unreadChars(state)).toBe(100);
    const view = toListenView(state, true);
    expect(view.unreadChars).toBe(100);
    expect(view.playActive).toBe(true);
    expect(toListenView(state).playActive).toBe(false);
  });

  it("applyRedirectCut drops unconsumed sections and keeps consumed", () => {
    const outline = makeOutlineItems(["A", "B", "C"], "C");
    outline[0]!.status = "done";
    const state = {
      phase: "running" as const,
      thrill: "打脸",
      world: "都市",
      structure: "三段式",
      outline,
      sections: [
        {
          id: "s1",
          outlineId: outline[0]!.id,
          title: "A",
          text: "已读完的一节",
          summary: "A小结",
          consumedChars: 6,
        },
        {
          id: "s2",
          outlineId: "pending-x",
          title: "B",
          text: "整节未读应丢掉",
          summary: "B小结",
          consumedChars: 0,
        },
      ],
      summaries: ["A小结", "B小结"],
      bufferTargetChars: 4000,
      consumedChars: 6,
    };
    const cut = applyRedirectCut(state, ["主角反杀", "对面后悔"]);
    expect(cut.sections).toHaveLength(1);
    expect(cut.sections[0]?.title).toBe("A");
    expect(cut.outline.filter((o) => o.status === "pending")).toHaveLength(2);
    expect(cut.outline.some((o) => o.title === "主角反杀")).toBe(true);
  });

  it("markListenConsumed advances pointer", () => {
    const board = new Blackboard();
    writeListenSections(board, [
      {
        id: "s1",
        outlineId: "o1",
        title: "一",
        text: "一二三四五",
        summary: "一",
        consumedChars: 0,
      },
    ]);
    const next = markListenConsumed(board, 3);
    expect(next.consumedChars).toBe(3);
    expect(next.sections[0]?.consumedChars).toBe(3);
  });

  it("detects confirm phrases", () => {
    expect(isConfirmText("确认")).toBe(true);
    expect(isConfirmText("开始！")).toBe(true);
    expect(isConfirmText("主角反过来打脸")).toBe(false);
  });
});
