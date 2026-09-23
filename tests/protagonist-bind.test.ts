import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Blackboard } from "../src/blackboard/blackboard.js";

const MARKDOWN_SPEC = `# 主角设定：债主（@玩家）

## 名字
沈聿。母女只知道这个姓和这张脸，叫不出更多。

## 身份
本地放贷人之一，业务不大不小。

## 能做什么
手里握着母亲签下的借据。没有超自然金手指。

## 关键背景（用户补充）
许曼的几笔散债被沈聿合并到自己手里。

---

# 母女档案（NPC）

## 母亲：许曼（33岁）
不应被当成主角名字。
`;

describe("protagonist overlay", () => {
  beforeEach(() => {
    process.env.WRITING_AGENT_DATA_DIR = mkdtempSync(
      path.join(tmpdir(), "wa-protag-"),
    );
  });

  it("parses context-fragment JSON", async () => {
    const { parseProtagonistSpec } = await import(
      "../src/persona/protagonist-bind.js"
    );
    const spec = parseProtagonistSpec(
      JSON.stringify({
        schema: "context-fragment.v1",
        技能: "主角设定",
        正文: {
          名字: "林晚",
          背景: "刚被退婚的庶女",
          特殊设定: { 身份: "侯府庶女", 金手指: "看见好感数字", 其它: "无" },
        },
      }),
    );
    expect(spec?.name).toBe("林晚");
    expect(spec?.cheat).toMatch(/好感/);
  });

  it("parses markdown headings used by dictate", async () => {
    const { parseProtagonistSpec, formatProtagonistSummary } = await import(
      "../src/persona/protagonist-bind.js"
    );
    const spec = parseProtagonistSpec(MARKDOWN_SPEC);
    expect(spec?.name).toBe("沈聿");
    expect(spec?.identity).toMatch(/放贷/);
    expect(spec?.cheat).toMatch(/借据/);
    expect(spec?.background).toMatch(/散债/);
    expect(formatProtagonistSummary(spec!).length).toBeLessThan(80);
    expect(formatProtagonistSummary(spec!)).not.toMatch(/\*\*/);
  });

  it("overlays play persona from the product without touching global cards", async () => {
    const {
      PROTAGONIST_TAG,
      readSessionProtagonist,
      overlayPlayPersona,
    } = await import("../src/persona/protagonist-bind.js");
    const { listPersonas, getActivePersona } = await import(
      "../src/persona/store.js"
    );

    const board = new Blackboard();
    board.write({
      tag: PROTAGONIST_TAG,
      content: JSON.stringify({
        正文: {
          名字: "林晚",
          背景: "刚被退婚的庶女",
          特殊设定: { 身份: "侯府庶女", 金手指: "看见好感数字" },
        },
      }),
      source: "agent",
    });

    const before = listPersonas().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));
    const activeId = getActivePersona()?.id;

    const view = readSessionProtagonist(board);
    expect(view?.name).toBe("林晚");
    expect(view?.summary).toMatch(/庶女|好感/);

    expect(overlayPlayPersona("play", board)?.name).not.toBe("林晚");

    const { OPENING_PERSONA_CHOICE_TAG } = await import(
      "../src/skills/opening-seal.js"
    );
    board.write({
      tag: OPENING_PERSONA_CHOICE_TAG,
      content: "opening",
      source: "user",
    });
    const play = overlayPlayPersona("play", board);
    expect(play?.name).toBe("林晚");
    expect(play?.description).toMatch(/庶女/);
    expect(overlayPlayPersona("design", board)?.name).not.toBe("林晚");

    board.write({
      tag: OPENING_PERSONA_CHOICE_TAG,
      content: "global",
      source: "user",
    });
    expect(overlayPlayPersona("play", board)?.name).not.toBe("林晚");

    expect(
      listPersonas().map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
      })),
    ).toEqual(before);
    expect(getActivePersona()?.id).toBe(activeId);
  });

  it("rejects placeholder names", async () => {
    const { parseProtagonistSpec } = await import(
      "../src/persona/protagonist-bind.js"
    );
    expect(parseProtagonistSpec("名字：@玩家\n背景：无")).toBeNull();
    expect(parseProtagonistSpec("名字：主角\n背景：无")).toBeNull();
    expect(parseProtagonistSpec("## 名字\n（待用户给出）\n## 身份\n债主")).toBeNull();
  });

  it("parses prose fields", async () => {
    const { parseProtagonistSpec } = await import(
      "../src/persona/protagonist-bind.js"
    );
    const spec = parseProtagonistSpec(
      "名字：阿泽\n背景：现代社畜刚穿进书里\n金手指：系统面板\n身份：炮灰男配",
    );
    expect(spec).toMatchObject({
      name: "阿泽",
      background: "现代社畜刚穿进书里",
      cheat: "系统面板",
      identity: "炮灰男配",
    });
  });

  it("prefers 设计.主角设定 over legacy opening meta", async () => {
    const {
      PROTAGONIST_TAG,
      readSessionProtagonist,
      ensureProtagonistFromPersona,
      protagonistFragmentFromPersona,
      protagonistTagForOpeningSlot,
    } = await import("../src/persona/protagonist-bind.js");

    const board = new Blackboard();
    board.write({
      tag: "设计.开场白",
      content: `用户角色.名字: 旧名
用户角色.简介: 旧简介
@玩家推开门。`,
      source: "agent",
    });
    board.write({
      tag: PROTAGONIST_TAG,
      content: protagonistFragmentFromPersona({
        name: "李宗",
        description: "男大学生",
      }),
      source: "agent",
    });
    expect(readSessionProtagonist(board)?.name).toBe("李宗");

    const empty = new Blackboard();
    expect(
      ensureProtagonistFromPersona(empty, {
        name: "阿泽",
        description: "社畜",
      }),
    ).toBe(true);
    expect(readSessionProtagonist(empty)?.name).toBe("阿泽");
    expect(
      ensureProtagonistFromPersona(empty, {
        name: "另一个",
        description: "不覆盖",
      }),
    ).toBe(false);

    expect(protagonistTagForOpeningSlot("设计.开场白#dorm")).toBe(
      "设计.主角设定#dorm",
    );
    expect(protagonistTagForOpeningSlot("设计.开场白")).toBe(PROTAGONIST_TAG);
  });

  it("overlays opening meta 用户角色 when the user switches to that preset", async () => {
    const { readSessionProtagonist, overlayPlayPersona } = await import(
      "../src/persona/protagonist-bind.js"
    );
    const {
      OPENING_PERSONA_TAG,
      OPENING_PERSONA_CHOICE_TAG,
    } = await import("../src/skills/opening-seal.js");
    const { listPersonas } = await import("../src/persona/store.js");

    const board = new Blackboard();
    board.write({
      tag: OPENING_PERSONA_TAG,
      content: JSON.stringify({
        名字: "沈聿",
        简介: "本地放贷人；与这对母女相识但不熟。",
      }),
      source: "runtime",
    });
    board.write({
      tag: OPENING_PERSONA_CHOICE_TAG,
      content: "opening",
      source: "user",
    });

    const before = listPersonas().map((p) => p.name);
    const view = readSessionProtagonist(board);
    expect(view?.name).toBe("沈聿");
    expect(view?.description).toMatch(/放贷人/);

    const play = overlayPlayPersona("play", board);
    expect(play?.name).toBe("沈聿");
    expect(play?.description).toMatch(/放贷人/);
    expect(listPersonas().map((p) => p.name)).toEqual(before);
  });
});
