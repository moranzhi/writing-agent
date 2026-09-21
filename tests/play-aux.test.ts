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
});
