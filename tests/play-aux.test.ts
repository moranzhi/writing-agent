import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import { stringifyTableDoc, createTableFromValues } from "../src/blackboard/table-cells.js";
import { buildPlayAuxView } from "../src/skills/play-aux.js";
import { SLOT_OPENING_SELECTED_INDEX } from "../src/skills/opening-seal.js";

describe("play-aux view", () => {
  it("splits visible and hidden table rows and lists opening candidates", () => {
    const board = new Blackboard();
    board.write({
      tag: "变量.当前",
      content: stringifyTableDoc(
        createTableFromValues(
          { 口粮: 1, 暗线: "未揭" },
          "worker:opening-setup",
          {
            口粮: { visibility: "visible", editable: true },
            暗线: { visibility: "hidden", editable: false },
          },
        ),
      ),
      source: "runtime",
    });
    board.write({
      tag: "设计.开场白与开场变量",
      content: JSON.stringify({
        schema: "context-fragment.v1",
        技能: "开场白与开场变量",
        正文: {
          开场白全文: "@玩家站在债契前。",
          开场白候选: [
            {
              meta: { 用户角色: { 名字: "沈聿", 简介: "放贷人" } },
              正文: "@玩家站在债契前。",
            },
            {
              meta: { 用户角色: { 名字: "阿泽", 简介: "社畜" } },
              正文: "门外有人喊 @玩家。",
            },
          ],
        },
      }),
      source: "agent",
    });
    const view = buildPlayAuxView(board, { [SLOT_OPENING_SELECTED_INDEX]: 1 });
    expect(view.table?.rows.find((r) => r.key === "口粮")?.editable).toBe(true);
    expect(view.table?.rows.find((r) => r.key === "暗线")?.visibility).toBe("hidden");
    expect(view.table?.rows.find((r) => r.key === "暗线")?.editable).toBe(false);
    expect(view.openings).toHaveLength(2);
    expect(view.selectedOpeningIndex).toBe(1);
    expect(view.openings[1]?.persona?.name).toBe("阿泽");
  });

  it("previews present.v1 opening body instead of raw JSON", () => {
    const board = new Blackboard();
    board.write({
      tag: "设计.开场白与开场变量",
      content: JSON.stringify({
        schema: "context-fragment.v1",
        技能: "开场白与开场变量",
        正文: {
          开场白全文: {
            schema: "present.v1",
            shell: "chat_monitor",
            blocks: { body: "@玩家站在债契前，堂屋很静。" },
          },
        },
      }),
      source: "agent",
    });
    const view = buildPlayAuxView(board);
    expect(view.openings).toHaveLength(1);
    expect(view.openings[0]?.text).toBe("@玩家站在债契前，堂屋很静。");
    expect(view.openings[0]?.text).not.toContain("present.v1");
  });

  it("lists dictate 设计.开场白#slot openings with same-slot 主角设定", () => {
    const board = new Blackboard();
    board.write({
      tag: "设计.开场白#dorm",
      content: "@玩家推开宿舍门。",
      source: "agent",
    });
    board.write({
      tag: "设计.开场白#gate",
      content: "@玩家停在闸机前。",
      source: "agent",
    });
    board.write({
      tag: "设计.主角设定#dorm",
      content: JSON.stringify({
        正文: { 名字: "李宗", 背景: "男大学生", 特殊设定: { 身份: "无", 金手指: "无", 其它: "无" } },
      }),
      source: "agent",
    });
    board.write({
      tag: "设计.主角设定#gate",
      content: JSON.stringify({
        正文: { 名字: "阿泽", 背景: "社畜", 特殊设定: { 身份: "无", 金手指: "无", 其它: "无" } },
      }),
      source: "agent",
    });
    const view = buildPlayAuxView(board, { [SLOT_OPENING_SELECTED_INDEX]: 0 });
    expect(view.openings).toHaveLength(2);
    expect(view.openings.map((o) => o.slot).sort()).toEqual(["dorm", "gate"]);
    const dorm = view.openings.find((o) => o.slot === "dorm");
    const gate = view.openings.find((o) => o.slot === "gate");
    expect(dorm?.persona?.name).toBe("李宗");
    expect(gate?.persona?.name).toBe("阿泽");
  });
});
