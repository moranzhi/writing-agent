import { describe, expect, it } from "vitest";
import {
  PRESENT_BYTE_LIMIT,
  PRESENT_FRAME_SANDBOX,
  buildPresentSrcdoc,
  isFrontendBundle,
  presentFrameSlotHtml,
  presentSourceBytes,
  previewPacket,
} from "../web/present-frame.js";

describe("present frame srcdoc", () => {
  it("keeps the sandbox flag to scripts only", () => {
    expect(PRESENT_FRAME_SANDBOX).toBe("allow-scripts");
    expect(PRESENT_FRAME_SANDBOX).not.toContain("allow-same-origin");
  });

  it("embeds the skeleton, styles, script, and sample packet", () => {
    const srcdoc = buildPresentSrcdoc({
      html: `<div id="app"></div>`,
      css: `#app { color: #e1e7f0; }`,
      js: `present.onData(function (data) { document.getElementById("app").textContent = data.blocks.body; });`,
      packet: { schema: "present.v1", blocks: { body: "示例正文" } },
      frameId: "pf1",
    });
    expect(srcdoc).toContain(`<div id="app"></div>`);
    expect(srcdoc).toContain(`#app { color: #e1e7f0; }`);
    expect(srcdoc).toContain("present-host");
    expect(srcdoc).toContain("applyPacket");
    expect(srcdoc).toContain("示例正文");
    expect(srcdoc).toContain(`default-src 'none'`);
    expect(srcdoc.indexOf("window.present")).toBeLessThan(srcdoc.indexOf("data.blocks.body"));
    const scripts = [...srcdoc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const source of scripts) {
      expect(() => new Function(source)).not.toThrow();
    }
  });

  it("does not let a script closer in the template js break the document", () => {
    const srcdoc = buildPresentSrcdoc({
      html: "<div id=\"app\"></div>",
      css: "body{}",
      js: `var s = "</script><script>parent.stolen = 1";`,
      packet: { schema: "present.v1", blocks: {} },
      frameId: "pf2",
    });
    expect(srcdoc).not.toContain(`</script><script>parent.stolen`);
    expect(srcdoc).toContain(`<\\/script>`);
  });

  it("recognizes a frontend bundle and the 60 KB budget", () => {
    expect(isFrontendBundle({ html: `<div id="app"></div>`, css: "body{}" })).toBe(true);
    expect(isFrontendBundle({ html: "只是说明" })).toBe(false);
    expect(presentSourceBytes({ html: "abc", css: "de", js: "f" })).toBe(6);
    expect(PRESENT_BYTE_LIMIT).toBe(60 * 1024);
  });

  it("sizes the frame to content and fills contract slots", () => {
    const srcdoc = buildPresentSrcdoc({
      html: `<article data-block="body"></article>`,
      css: `html,body{height:100vh;overflow:auto}`,
      js: `present.onData(function () {});`,
      packet: { schema: "present.v1", blocks: { body: "正文", forum_feed: ["一帖"] } },
      slots: [
        { id: "body", type: "markdown" },
        { id: "forum_feed", type: "list" },
      ],
      frameId: "pf3",
    });
    expect(srcdoc).not.toContain("100vh");
    expect(srcdoc).not.toContain("overflow:auto");
    expect(srcdoc).toContain("overflow:hidden!important");
    expect(srcdoc).toContain("fillSlots");
    expect(srcdoc).toContain("isProgramOwned");
    expect(srcdoc).toContain("forum_feed");
    expect(srcdoc).toContain('"type":"list"');
  });

  it("turns markdown newlines into paragraphs even if the shell wrote textContent first", () => {
    const srcdoc = buildPresentSrcdoc({
      html: `<article id="body" data-block="body"></article>`,
      css: "",
      js: `present.onData(function (data) {
        document.getElementById("body").textContent = data.blocks.body;
      });`,
      packet: {
        schema: "present.v1",
        blocks: { body: "第一段\\n\\n第二段 **加粗**" },
      },
      slots: [{ id: "body", type: "markdown" }],
      frameId: "pf4",
    });
    // packet JSON keeps real newlines; template sample above used escaped for the test string —
    // rebuild with actual newlines:
    const withBreaks = buildPresentSrcdoc({
      html: `<article id="body" data-block="body"></article>`,
      css: "",
      js: `present.onData(function (data) {
        document.getElementById("body").textContent = data.blocks.body;
      });`,
      packet: {
        schema: "present.v1",
        blocks: { body: "第一段\n\n第二段 **加粗**" },
      },
      slots: [{ id: "body", type: "markdown" }],
      frameId: "pf4b",
    });
    const match = withBreaks.match(/function markdown\(raw\) \{[\s\S]*?\n  \}/);
    expect(match).toBeTruthy();
    const markdown = new Function(`${match![0]}; return markdown;`)();
    const html = markdown("第一段\n\n第二段 **加粗**");
    expect(html).toContain("<p>第一段</p>");
    expect(html).toContain("<p>第二段 <strong>加粗</strong></p>");
    expect(withBreaks).toContain("isProgramOwned");
    expect(srcdoc).toContain("isProgramOwned");
  });

  it("applies program fill after shell onData so textContent cannot keep a wall of text", () => {
    const srcdoc = buildPresentSrcdoc({
      html: `<article id="body" data-block="body"></article>`,
      css: "",
      js: `present.onData(function (data) {
        document.getElementById("body").textContent = data.blocks.body;
      });`,
      packet: { schema: "present.v1", blocks: { body: "a\\nb" } },
      slots: [{ id: "body", type: "markdown" }],
      frameId: "pf5",
    });
    const sealIdx = srcdoc.indexOf("present.__seal");
    const ownedIdx = srcdoc.indexOf("isProgramOwned");
    expect(ownedIdx).toBeGreaterThan(-1);
    expect(sealIdx).toBeGreaterThan(-1);
    // applyPacket: renderCb then fillSlots
    const applyIdx = srcdoc.indexOf("function applyPacket");
    const applyChunk = srcdoc.slice(applyIdx, applyIdx + 450);
    expect(applyChunk.indexOf("renderCb")).toBeLessThan(applyChunk.lastIndexOf("fillSlots"));
    expect(srcdoc).toContain('t === "kv" || t === "table" || t === "topology"');
  });

  it("renders list objects by text/label instead of JSON.stringify", () => {
    const srcdoc = buildPresentSrcdoc({
      html: `<ol data-block="options"></ol>`,
      css: "",
      js: `present.onData(function () {});`,
      packet: { schema: "present.v1", blocks: { options: [] } },
      slots: [{ id: "options", type: "list" }],
      frameId: "pf6",
    });
    const match = srcdoc.match(/function listItemText\(item\) \{[\s\S]*?\n  \}/);
    expect(match).toBeTruthy();
    const listItemText = new Function(`${match![0]}; return listItemText;`)();
    expect(listItemText({ type: "继续推进1", text: "顺着旧话试探" })).toBe("顺着旧话试探");
    expect(listItemText({ label: "换方向" })).toBe("换方向");
    expect(listItemText("纯字符串")).toBe("纯字符串");
    expect(listItemText('{"type":"x","text":"从字符串JSON取出"}')).toBe("从字符串JSON取出");
  });

  it("keeps the previous frame height so a remount does not collapse the page", () => {
    expect(presentFrameSlotHtml("pf9", 1280)).toContain('style="min-height:1280px"');
    expect(presentFrameSlotHtml("pf9")).not.toContain("min-height");
    expect(presentFrameSlotHtml("pf9", 4)).not.toContain("min-height");
  });

  it("normalizes sample data into present.v1 blocks", () => {
    expect(previewPacket({ schema: "present.v1", blocks: { body: "x" } })).toEqual({
      schema: "present.v1",
      blocks: { body: "x" },
    });
    expect(previewPacket(null)).toEqual({ schema: "present.v1", blocks: {} });
  });

  it("accepts Chinese block ids and expands nested matrix JSON into a table", () => {
    const srcdoc = buildPresentSrcdoc({
      html: `<section data-block="卷宗表"></section><article data-block="正文"></article>`,
      css: "",
      js: "present.onData(function () {});",
      packet: {
        schema: "present.v1",
        blocks: {
          卷宗表: {
            source: "heroines_matrix",
            rows: [
              { name: "塞琳娜", 亲密度: -10, 服从度: 10 },
              { name: "崔岚", 亲密度: -10, 服从度: 10 },
            ],
          },
          正文: "第一段\n\n第二段",
        },
      },
      slots: [
        { id: "卷宗表", type: "table" },
        { id: "正文", type: "markdown" },
      ],
      frameId: "pf-zh",
    });
    expect(srcdoc).toContain("function isBlockId");
    expect(srcdoc).toContain("present-data-table");
    expect(srcdoc).toContain("matrixMapToRows");
    expect(srcdoc).not.toContain("/^[A-Za-z_]");

    const writeMatch = srcdoc.match(/function writeDataTable\(el, rows, columns\) \{[\s\S]*?\n  \}/);
    expect(writeMatch).toBeTruthy();
    const idMatch = srcdoc.match(/function isBlockId\(id\) \{[\s\S]*?\n  \}/);
    expect(idMatch).toBeTruthy();
    const isBlockId = new Function(`${idMatch![0]}; return isBlockId;`)();
    expect(isBlockId("正文")).toBe(true);
    expect(isBlockId("body")).toBe(true);
    expect(isBlockId('bad"id')).toBe(false);
  });
});
