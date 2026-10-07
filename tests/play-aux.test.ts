import { describe, expect, it } from "vitest";
import { formatTableValue, parseTableDraft } from "../web/play-aux.js";
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
    expect(view.openings[0]?.document).toContain("present.v1");
    expect(view.openings[0]?.document).toContain("@玩家站在债契前，堂屋很静。");
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

  it("prefers slotted 设计.开场白#场景短码 over the bare card and the legacy bundle", () => {
    const board = new Blackboard();
    board.write({
      tag: "设计.开场白",
      content: JSON.stringify({
        schema: "present.v1",
        shell: "prose",
        blocks: { body: "这张没有短码。" },
      }),
      source: "agent",
    });
    board.write({
      tag: "设计.开场白#opening-cycle2",
      content: JSON.stringify({
        schema: "present.v1",
        shell: "status_card",
        blocks: { status_card: "天数|阶段" },
      }),
      source: "agent",
    });
    board.write({
      tag: "设计.开场白与开场变量",
      content: JSON.stringify({
        schema: "context-fragment.v1",
        技能: "开场白与开场变量",
        正文: { 开场白全文: "@玩家站在债契前。" },
      }),
      source: "agent",
    });
    const view = buildPlayAuxView(board);
    expect(view.openings).toHaveLength(1);
    expect(view.openings[0]?.tag).toBe("设计.开场白#opening-cycle2");
    expect(view.openings[0]?.slot).toBe("opening-cycle2");
    expect(view.openings[0]?.document).toContain("status_card");
    expect(view.openings[0]?.document).toContain("天数|阶段");
    // 无 body 时预览回退整包；选用仍走 document，不会压丢 status_card
    expect(view.openings[0]?.document).toBe(view.openings[0]?.text);
  });

  it("lists proliferated zero-layer openings for play swipe", () => {
    const board = new Blackboard();
    board.write({
      tag: "设计.0层开场白与初态#dorm",
      content: "@玩家推开宿舍门。",
      source: "agent",
    });
    board.write({
      tag: "设计.0层开场白与初态#gate",
      content: "@玩家停在闸机前。",
      source: "agent",
    });
    const view = buildPlayAuxView(board, { [SLOT_OPENING_SELECTED_INDEX]: 1 });
    expect(view.openings.map((o) => o.slot).sort()).toEqual(["dorm", "gate"]);
    expect(view.selectedOpeningIndex).toBe(1);
  });
});

describe("play table drafts", () => {
  it("keeps numbers, booleans, and JSON values in their original types", () => {
    expect(parseTableDraft(1, "12")).toEqual({ ok: true, value: 12 });
    expect(parseTableDraft(1, "nope").ok).toBe(false);
    expect(parseTableDraft(false, "是")).toEqual({ ok: true, value: true });
    expect(parseTableDraft(["基础侦察术"], '["基础侦察术","追踪"]')).toEqual({
      ok: true,
      value: ["基础侦察术", "追踪"],
    });
    expect(parseTableDraft(["基础侦察术"], "[")).toEqual({ ok: false, error: "JSON 不合法" });
    expect(parseTableDraft("空", "  还在  ")).toEqual({ ok: true, value: "还在" });
  });

  it("pretty-prints long structured values and keeps short ones on one line", () => {
    expect(formatTableValue(["基础侦察术"])).toBe('["基础侦察术"]');
    const long = { a: "x".repeat(40), b: [1, 2, 3] };
    expect(formatTableValue(long)).toContain("\n");
    expect(formatTableValue(10)).toBe("10");
  });

  it("parses JSON strings so nested matrices are editable as objects", () => {
    const matrix =
      '{"塞琳娜":{"认知度":"有所耳闻","亲密度":-10},"崔岚":{"认知度":"有所耳闻","亲密度":-10}}';
    expect(formatTableValue(matrix)).toContain("\n");
    expect(formatTableValue(matrix)).toContain("塞琳娜");
    expect(parseTableDraft(matrix, formatTableValue(matrix))).toEqual({
      ok: true,
      value: {
        塞琳娜: { 认知度: "有所耳闻", 亲密度: -10 },
        崔岚: { 认知度: "有所耳闻", 亲密度: -10 },
      },
    });
  });
});
