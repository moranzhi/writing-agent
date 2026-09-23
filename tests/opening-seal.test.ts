import { describe, expect, it } from "vitest";
import {
  closeCreationFlowRaw,
  isOpeningSealArtifact,
  parseOpeningSealPayload,
  openingVariablesToTableDoc,
  reopenCreationFlowRaw,
  splitOpeningDocument,
} from "../src/skills/opening-seal.js";

const fragment = JSON.stringify({
  schema: "context-fragment.v1",
  技能: "开场白与开场变量",
  brief: "宿舍缺水",
  mount: ["narrator"],
  正文: {
    开场白全文: "你在宿舍醒来，瓶里只剩一口水。",
    开场白候选: [
      "你在宿舍醒来，瓶里只剩一口水。",
      "门外有人砸门。你还没想好要不要开。",
    ],
    开场变量: [{ 名: "口粮", 值: 1, 依据: "开场只剩一口水" }],
  },
  开放问题: [],
});

describe("opening-seal", () => {
  it("detects opening-setup and opening-generator artifacts", () => {
    expect(
      isOpeningSealArtifact({
        workerId: "design-step",
        outputTags: ["设计.开场白与开场变量"],
      }),
    ).toBe(true);
    expect(
      isOpeningSealArtifact({
        workerId: "opening-generator",
        outputTags: ["输出.开场白"],
      }),
    ).toBe(true);
    expect(
      isOpeningSealArtifact({
        workerId: "design-step",
        stepId: "开场白与开场变量",
        outputTags: ["artifact.flat.v1"],
      }),
    ).toBe(true);
    expect(
      isOpeningSealArtifact({
        workerId: "design-step",
        outputTags: ["设计.美学纲领与交互范式"],
      }),
    ).toBe(false);
  });

  it("parses 1+ opening candidates and selects by index", () => {
    const first = parseOpeningSealPayload(fragment, 0);
    expect(first?.candidates).toHaveLength(2);
    expect(first?.selectedText).toContain("宿舍醒来");
    const second = parseOpeningSealPayload(fragment, 1);
    expect(second?.selectedText).toContain("砸门");
    expect(second?.variables).toEqual([
      { name: "口粮", value: 1, note: "开场只剩一口水" },
    ]);
  });

  it("reads 用户角色 from candidate meta and 正文", () => {
    const raw = JSON.stringify({
      schema: "context-fragment.v1",
      技能: "开场白与开场变量",
      正文: {
        开场白全文: "@玩家站在债契前。",
        开场白候选: [
          {
            meta: {
              用户角色: { 名字: "沈聿", 简介: "本地放贷人；与这对母女相识但不熟。" },
            },
            正文: "@玩家站在债契前。",
          },
          {
            meta: {
              用户角色: { 名字: "阿泽", 简介: "刚穿进来的社畜。" },
            },
            正文: "门外有人喊 @玩家 的名字。",
          },
        ],
        开场变量: [{ 名: "债额", 值: 3 }],
      },
    });
    const first = parseOpeningSealPayload(raw, 0);
    expect(first?.persona).toEqual({
      name: "沈聿",
      description: "本地放贷人；与这对母女相识但不熟。",
    });
    const second = parseOpeningSealPayload(raw, 1);
    expect(second?.selectedText).toContain("门外");
    expect(second?.persona).toEqual({
      name: "阿泽",
      description: "刚穿进来的社畜。",
    });
  });

  it("serializes present.v1 正文 and per-candidate 开场变量", () => {
    const packet = {
      schema: "present.v1",
      shell: "chat_monitor",
      blocks: {
        monitor: { 债额: "三两" },
        body: "@玩家站在债契前。",
      },
      meta: { suggested_actions: ["问债"] },
    };
    const raw = JSON.stringify({
      schema: "context-fragment.v1",
      技能: "开场白与开场变量",
      正文: {
        开场白全文: packet,
        开场白候选: [
          {
            meta: {
              用户角色: { 名字: "沈聿", 简介: "放贷人" },
              开场变量: [{ 名: "债额", 值: 3, 依据: "桌上债契" }],
            },
            正文: packet,
          },
          {
            meta: {
              用户角色: { 名字: "阿泽", 简介: "社畜" },
              开场变量: [{ 名: "口粮", 值: 1 }],
            },
            正文: {
              schema: "present.v1",
              shell: "chat_monitor",
              blocks: { body: "门外有人喊 @玩家。" },
            },
          },
        ],
        开场变量: [{ 名: "债额", 值: 3, 依据: "桌上债契" }],
      },
    });
    const first = parseOpeningSealPayload(raw, 0);
    expect(first?.candidates).toHaveLength(2);
    const selected = JSON.parse(first!.selectedText);
    expect(selected.schema).toBe("present.v1");
    expect(selected.shell).toBe("chat_monitor");
    expect(selected.blocks.body).toContain("@玩家");
    expect(first?.persona).toEqual({ name: "沈聿", description: "放贷人" });
    expect(first?.variables).toEqual([
      { name: "债额", value: 3, note: "桌上债契" },
    ]);
    const second = parseOpeningSealPayload(raw, 1);
    expect(second?.persona?.name).toBe("阿泽");
    expect(second?.variables).toEqual([{ name: "口粮", value: 1 }]);
    expect(JSON.parse(second!.selectedText).blocks.body).toContain("门外");
  });

  it("splits YAML frontmatter meta from opening 正文", () => {
    const nested = splitOpeningDocument(`---
用户角色:
  名字: 沈聿
  简介: 本地放贷人
---
清晨，@玩家推开堂屋门。
`);
    expect(nested.persona).toEqual({ name: "沈聿", description: "本地放贷人" });
    expect(nested.text).toBe("清晨，@玩家推开堂屋门。");

    const dotted = splitOpeningDocument(`---
用户角色.名字: 阿泽
用户角色.简介: 刚穿进来的社畜
---
门外有人喊 @玩家。
`);
    expect(dotted.persona).toEqual({ name: "阿泽", description: "刚穿进来的社畜" });
    expect(dotted.text).toBe("门外有人喊 @玩家。");
  });

  it("strips bare 用户角色 meta lines without YAML fence", () => {
    const bare = splitOpeningDocument(`用户角色.名字: 李宗
用户角色.简介: 18cm 男大学生，家境贫穷
……@玩家推开宿舍门。
`);
    expect(bare.persona).toEqual({
      name: "李宗",
      description: "18cm 男大学生，家境贫穷",
    });
    expect(bare.text).toBe("……@玩家推开宿舍门。");

    const onlyMeta = splitOpeningDocument(`用户角色.名字: 李宗
用户角色.简介: 男大学生
`);
    expect(onlyMeta.persona?.name).toBe("李宗");
    expect(onlyMeta.text).toBe("");
  });

  it("builds table rows from opening variables", () => {
    const payload = parseOpeningSealPayload(fragment, 0);
    const doc = openingVariablesToTableDoc(payload!.variables);
    expect(doc.rows[0]?.key).toBe("口粮");
    expect(doc.rows[0]?.value).toBe(1);
  });

  it("closes an open creation flow", () => {
    const raw = JSON.stringify({
      version: 1,
      status: "open",
      steps: [{ id: "开场白与开场变量", name: "开场白与开场变量", depends_on: [] }],
    });
    const closed = JSON.parse(closeCreationFlowRaw(raw)!);
    expect(closed.status).toBe("closed");
  });

  it("reopens a closed creation flow", () => {
    const raw = JSON.stringify({
      version: 1,
      status: "closed",
      steps: [{ id: "开场白与开场变量", name: "开场白与开场变量", depends_on: [] }],
    });
    const opened = JSON.parse(reopenCreationFlowRaw(raw)!);
    expect(opened.status).toBe("open");
  });
});
