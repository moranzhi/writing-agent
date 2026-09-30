import { describe, expect, it } from "vitest";
import {
  PRESENT_BYTE_LIMIT,
  PRESENT_FRAME_SANDBOX,
  buildPresentSrcdoc,
  isFrontendBundle,
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
    expect(srcdoc).toContain("present.onData");
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

  it("normalizes sample data into present.v1 blocks", () => {
    expect(previewPacket({ schema: "present.v1", blocks: { body: "x" } })).toEqual({
      schema: "present.v1",
      blocks: { body: "x" },
    });
    expect(previewPacket(null)).toEqual({ schema: "present.v1", blocks: {} });
  });
});
