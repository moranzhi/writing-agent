import { describe, expect, it } from "vitest";
import {
  annotateCacheBreaks,
  firstCacheBreak,
  outlineRequest,
} from "../src/llm/context-outline.js";

const sample = [
  "规则开头",
  "",
  "## 写入规则",
  "固定规则",
  "",
  "## 更早的对话",
  "",
  "【用户】",
  "第一句",
  "",
  "【助手】",
  "回过",
  "",
  "## 当前产物（已写入黑板）",
  "",
  "### 设计.氛围 〔order=0〕",
  "雨",
  "",
  "### 设计.角色 〔order=1〕",
  "甲",
  "",
  "## 本轮注入",
  "",
  "### topology @ 3",
  "#### task",
  "做一件事",
  "",
  "## 本轮",
  "",
  "方案进度",
  "",
  "最后一轮用户输入",
  "再改一下",
].join("\n");

describe("outlineRequest", () => {
  it("按标题、对话轮次和最后一轮输入切开，不留下正文", () => {
    const segments = outlineRequest([
      { role: "system", content: sample.slice(0, sample.indexOf("## 更早的对话")) },
      { role: "user", content: sample.slice(sample.indexOf("## 更早的对话")) },
    ]);
    expect(segments.map((item) => item.tag)).toEqual([
      "规则",
      "写入规则",
      "更早的对话",
      "更早·用户",
      "更早·助手",
      "当前产物",
      "设计.氛围",
      "设计.角色",
      "本轮注入",
      "topology",
      "task",
      "本轮",
      "最后一轮用户输入",
    ]);
    expect(JSON.stringify(segments)).not.toContain("再改一下");
    expect(JSON.stringify(segments)).not.toContain("雨");
    const again = outlineRequest([
      { role: "system", content: sample.slice(0, sample.indexOf("## 更早的对话")) },
      { role: "user", content: sample.slice(sample.indexOf("## 更早的对话")) },
    ]);
    expect(again.map((item) => item.hash)).toEqual(segments.map((item) => item.hash));
  });

  it("工具定义放在正文之前", () => {
    const segments = outlineRequest(
      [{ role: "user", content: "你好" }],
      [
        {
          type: "function",
          function: { name: "insert", description: "写", parameters: {} },
        },
      ],
    );
    expect(segments.map((item) => item.tag)).toEqual(["工具", "用户"]);
  });
});

describe("firstCacheBreak", () => {
  it("标出第一处标签或哈希不同的位置", () => {
    const prev = outlineRequest([{ role: "user", content: sample.slice(sample.indexOf("## 更早的对话")) }]);
    const changed = sample.replace("雨", "雪");
    const next = outlineRequest([{ role: "user", content: changed.slice(changed.indexOf("## 更早的对话")) }]);
    const index = firstCacheBreak(prev, next);
    expect(next[index]?.tag).toBe("设计.氛围");
    expect(firstCacheBreak(prev, prev)).toBe(-1);
    expect(firstCacheBreak(prev, prev.slice(0, 3))).toBe(-1);
    expect(firstCacheBreak(prev.slice(0, 3), prev)).toBe(3);
  });
});

describe("annotateCacheBreaks", () => {
  it("按同会话时间比较，窗口里第一条算冷启动", () => {
    const a = outlineRequest([{ role: "user", content: "第一" }]);
    const b = outlineRequest([{ role: "user", content: "第二" }]);
    const marks = annotateCacheBreaks([
      { id: "2", at: "2026-10-02T02:00:00.000Z", sessionId: "s", segments: b },
      { id: "1", at: "2026-10-02T01:00:00.000Z", sessionId: "s", segments: a },
      { id: "9", at: "2026-10-02T03:00:00.000Z", sessionId: "other", segments: a },
    ]);
    expect(marks.get("1")).toMatchObject({ cold: true, matched: 0 });
    expect(marks.get("2")).toMatchObject({ cold: false, breakAt: 0, tag: "用户", matched: 0 });
    expect(marks.get("9")?.cold).toBe(true);
  });
});
