import { describe, expect, it } from "vitest";
import { renderMarkdownToHtml } from "../web/markdown.js";

describe("markdown safe subset render", () => {
  it("renders GFM tables", () => {
    const html = renderMarkdownToHtml(
      ["| 甲 | 乙 |", "| --- | --- |", "| 1 | **粗** |"].join("\n"),
    );
    expect(html).toContain('<table class="md-table">');
    expect(html).toContain("<th>");
    expect(html).toContain("<td>");
    expect(html).toContain("<strong>粗</strong>");
    expect(html).not.toContain("| 甲 |");
  });

  it("renders details folds", () => {
    const html = renderMarkdownToHtml(
      [":::details 规则说明", "里面有 *斜体*", ":::"].join("\n"),
    );
    expect(html).toContain('<details class="md-details">');
    expect(html).toContain('<summary class="md-summary">');
    expect(html).toContain("规则说明");
    expect(html).toContain("<em>斜体</em>");
  });

  it("supports open details", () => {
    const html = renderMarkdownToHtml(
      [":::details open 已展开", "内容", ":::"].join("\n"),
    );
    expect(html).toContain("<details class=\"md-details\" open>");
  });

  it("escapes raw html tags", () => {
    const html = renderMarkdownToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
