import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseLegacyAliases,
  parsePeakSchedule,
  parsePricingDocument,
} from "../src/stats/pricing-parse.js";
import { buildCostReport, costForRecord, isPeakAt, splitPromptTokens } from "../src/stats/pricing-cost.js";
import type { ResolvedRate } from "../src/stats/pricing.js";
import type { TokenUsageRecord } from "../src/stats/token-store.js";

const DEEPSEEK_HTML = `<!doctype html>
<html><head><title>Models &amp; Pricing | DeepSeek API Docs</title></head>
<body>
<p>The prices listed below are in units of per 1M tokens.</p>
<table style="text-align:center">
<tr><td colspan="3">MODEL</td><td>deepseek-flash<sup>(1)</sup></td><td>deepseek-v4-pro<sup>(2)</sup></td></tr>
<tr><td colspan="3">BASE URL (OpenAI Format)</td><td colspan="2">https://api.deepseek.com</td></tr>
<tr><td rowspan="6">PRICING<sup>(3)</sup></td><td rowspan="2">1M INPUT TOKENS<br>(CACHE HIT)</td><td>OFF-PEAK</td><td>$0.003</td><td>$0.022</td></tr>
<tr><td>PEAK</td><td>$0.006</td><td>$0.044</td></tr>
<tr><td rowspan="2">1M INPUT TOKENS<br>(CACHE MISS)</td><td>OFF-PEAK</td><td>$0.15</td><td>$0.66</td></tr>
<tr><td>PEAK</td><td>$0.3</td><td>$1.32</td></tr>
<tr><td rowspan="2">1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.6</td><td>$1.98</td></tr>
<tr><td>PEAK</td><td>$1.2</td><td>$3.96</td></tr>
</table>
<p>(1) Use <code>deepseek-flash</code> as the model name. The legacy names <code>deepseek-v4-flash</code> and <code>deepseek-v4-flash-vision-exp</code> are still accepted, but the corresponding models have been retired, their requests are served by the DeepSeek-V4.1-Flash model and billed at the Flash price.</p>
<p>(3) Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday (all other hours are off-peak).</p>
</body></html>`;

function flashRate(partial?: Partial<ResolvedRate>): ResolvedRate {
  return {
    model: "deepseek-flash",
    aliases: ["deepseek-v4-flash"],
    currency: "USD",
    unitTokens: 1_000_000,
    inputCacheHit: { offPeak: 0.003, peak: 0.006 },
    inputCacheMiss: { offPeak: 0.15, peak: 0.3 },
    output: { offPeak: 0.6, peak: 1.2 },
    peakWindows: [
      { startMinutes: 60, endMinutes: 240 },
      { startMinutes: 360, endMinutes: 600 },
    ],
    peakWeekdays: [1, 2, 3, 4, 5],
    sourceId: "src",
    sourceName: "DeepSeek",
    sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing",
    ...partial,
  };
}

describe("parsePricingDocument DeepSeek HTML", () => {
  it("reads flash/pro peak and off-peak from the official table", () => {
    const parsed = parsePricingDocument(DEEPSEEK_HTML, "text/html");
    expect(parsed.rates.map((r) => r.model)).toEqual([
      "deepseek-flash",
      "deepseek-v4-pro",
    ]);
    const flash = parsed.rates[0];
    expect(flash.inputCacheHit).toEqual({ offPeak: 0.003, peak: 0.006 });
    expect(flash.inputCacheMiss).toEqual({ offPeak: 0.15, peak: 0.3 });
    expect(flash.output).toEqual({ offPeak: 0.6, peak: 1.2 });
    expect(flash.aliases).toEqual(
      expect.arrayContaining(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]),
    );
    expect(flash.peakWeekdays).toEqual([1, 2, 3, 4, 5]);
    expect(flash.peakWindows).toEqual([
      { startMinutes: 60, endMinutes: 240 },
      { startMinutes: 360, endMinutes: 600 },
    ]);
    const pro = parsed.rates[1];
    expect(pro.inputCacheMiss.offPeak).toBe(0.66);
    expect(pro.output.peak).toBe(3.96);
  });
});

describe("parsePricingDocument generic markdown", () => {
  it("reads model / input / cached / output columns", () => {
    const md = `
| Model | Input | Cached | Output |
| --- | --- | --- | --- |
| gpt-4o | $2.50 | $1.25 | $10.00 |
`;
    const parsed = parsePricingDocument(md, "text/markdown");
    expect(parsed.rates).toHaveLength(1);
    expect(parsed.rates[0]).toMatchObject({
      model: "gpt-4o",
      inputCacheMiss: { offPeak: 2.5 },
      inputCacheHit: { offPeak: 1.25 },
      output: { offPeak: 10 },
    });
  });
});

describe("parsePricingDocument GLM official tables", () => {
  it("reads Z.AI USD table including Free", () => {
    const md = `
Prices per 1M tokens.

| Model | Input | Cached Input | Cached Input Storage | Output |
| --- | --- | --- | --- | --- |
| GLM-5.3-Flash | $0.15 | $0.03 | Limited-time Free | $0.50 |
| GLM-5.3 | $1.4 | $0.26 | Limited-time Free | $4.4 |
| GLM-4.7-Flash | Free | Free | Free | Free |
`;
    const parsed = parsePricingDocument(md, "text/markdown");
    const flash = parsed.rates.find((r) => r.model === "GLM-5.3-Flash");
    expect(flash).toMatchObject({
      currency: "USD",
      inputCacheMiss: { offPeak: 0.15 },
      inputCacheHit: { offPeak: 0.03 },
      output: { offPeak: 0.5 },
    });
    const free = parsed.rates.find((r) => r.model === "GLM-4.7-Flash");
    expect(free?.inputCacheMiss.offPeak).toBe(0);
    expect(free?.output.offPeak).toBe(0);
  });

  it("reads 智谱 CNY 元/百万 Tokens table", () => {
    const md = `
除特别说明外，模型价格统一按照“元/百万 Tokens”展示。

| 模型名称 | 上下文 | 输入单价（元/百万 Tokens） | 输出单价（元/百万 Tokens） | 缓存存储（元/百万 Tokens/小时） | 缓存命中（元/百万 Tokens） | 输入模态 |
| --- | --- | --- | --- | --- | --- | --- |
| GLM-5.3 | 1M | 8 | 28 | 限时免费 | 2 | 文本 |
| GLM-5.3-Flash | 1M | 0.8 | 2.8 | 限时免费 | 0.23 | 图片、视频、文件、文本 |
`;
    const parsed = parsePricingDocument(md, "text/markdown");
    const glm = parsed.rates.find((r) => r.model === "GLM-5.3");
    expect(glm).toMatchObject({
      currency: "CNY",
      inputCacheMiss: { offPeak: 8 },
      inputCacheHit: { offPeak: 2 },
      output: { offPeak: 28 },
    });
    const flash = parsed.rates.find((r) => r.model === "GLM-5.3-Flash");
    expect(flash?.inputCacheMiss.offPeak).toBe(0.8);
    expect(flash?.inputCacheHit?.offPeak).toBe(0.23);
  });

  it("keeps 智谱 CNY even if the HTML also contains $", () => {
    const html = `
<script>var x = "$";</script>
<p>模型价格统一按照“元/百万 Tokens”展示。</p>
<table>
<tr><th>模型名称</th><th>输入单价（元/百万 Tokens）</th><th>输出单价（元/百万 Tokens）</th><th>缓存命中（元/百万 Tokens）</th></tr>
<tr><td>GLM-5.3</td><td>8</td><td>28</td><td>2</td></tr>
</table>`;
    const parsed = parsePricingDocument(html, "text/html");
    expect(parsed.rates[0]).toMatchObject({
      model: "GLM-5.3",
      currency: "CNY",
      inputCacheMiss: { offPeak: 8 },
      output: { offPeak: 28 },
    });
  });
});

describe("parsePricingDocument JSON", () => {
  it("converts OpenRouter per-token strings to per-million", () => {
    const parsed = parsePricingDocument(
      JSON.stringify({
        data: [
          {
            id: "deepseek/deepseek-chat",
            pricing: { prompt: "0.00000014", completion: "0.00000028" },
          },
        ],
      }),
      "application/json",
    );
    expect(parsed.rates[0].model).toBe("deepseek-chat");
    expect(parsed.rates[0].inputCacheMiss.offPeak).toBeCloseTo(0.14);
    expect(parsed.rates[0].output.offPeak).toBeCloseTo(0.28);
  });
});

describe("peak schedule", () => {
  it("parses DeepSeek UTC weekday windows", () => {
    const peak = parsePeakSchedule(
      "Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday",
    );
    expect(peak?.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(isPeakAt(new Date("2026-09-14T02:00:00Z"), peak?.windows, peak?.weekdays)).toBe(
      true,
    );
    expect(isPeakAt(new Date("2026-09-13T02:00:00Z"), peak?.windows, peak?.weekdays)).toBe(
      false,
    );
    expect(isPeakAt(new Date("2026-09-14T05:00:00Z"), peak?.windows, peak?.weekdays)).toBe(
      false,
    );
  });

  it("maps legacy flash names", () => {
    const map = parseLegacyAliases(DEEPSEEK_HTML, ["deepseek-flash"]);
    expect(map.get("deepseek-flash")).toEqual(
      expect.arrayContaining(["deepseek-v4-flash"]),
    );
  });
});

describe("costForRecord", () => {
  const rate = flashRate();

  it("uses cache hit/miss and off-peak on weekend", () => {
    const record: TokenUsageRecord = {
      id: "1",
      at: "2026-09-13T02:00:00.000Z",
      caller: "dictate_agent",
      model: "deepseek-flash",
      promptTokens: 1000,
      completionTokens: 100,
      totalTokens: 1100,
      cachedTokens: 800,
    };
    expect(splitPromptTokens(record)).toEqual({ cached: 800, miss: 200, output: 100 });
    const cost = costForRecord(record, rate);
    expect(cost.currency).toBe("USD");
    expect(cost.amount).toBeCloseTo((800 * 0.003 + 200 * 0.15 + 100 * 0.6) / 1e6);
  });

  it("uses peak weekday window", () => {
    const record: TokenUsageRecord = {
      id: "2",
      at: "2026-09-14T02:30:00.000Z",
      caller: "dictate_agent",
      model: "deepseek-flash",
      promptTokens: 1000,
      completionTokens: 100,
      totalTokens: 1100,
      cachedTokens: 800,
      cacheMissTokens: 200,
    };
    const cost = costForRecord(record, rate);
    expect(cost.amount).toBeCloseTo((800 * 0.006 + 200 * 0.3 + 100 * 1.2) / 1e6);
  });
});

describe("normalizePricingUrl", () => {
  it("rejects non-http URLs", async () => {
    const { normalizePricingUrl, markdownDocFallbacks } = await import("../src/stats/pricing.js");
    expect(() => normalizePricingUrl("file:///tmp/x")).toThrow(/http/);
    expect(markdownDocFallbacks("https://docs.bigmodel.cn/cn/guide/start/pricing")).toEqual([
      "https://docs.bigmodel.cn/cn/guide/start/pricing.md",
    ]);
  });
});

describe("buildCostReport", () => {
  beforeAll(() => {
    process.env.WRITING_AGENT_DATA_DIR = mkdtempSync(
      path.join(tmpdir(), "wa-pricing-"),
    );
  });

  it("groups by model and marks unmatched", () => {
    const rate = flashRate();
    const catalog = {
      byKey: new Map([
        ["deepseek-flash", rate],
        ["deepseek-v4-flash", rate],
      ]),
      rates: [rate],
    };
    const report = buildCostReport(
      [
        {
          id: "a",
          at: "2026-09-13T08:00:00.000Z",
          caller: "x",
          model: "deepseek-v4-flash",
          promptTokens: 100,
          completionTokens: 10,
          totalTokens: 110,
          cachedTokens: 50,
        },
        {
          id: "b",
          at: "2026-09-13T08:00:00.000Z",
          caller: "x",
          model: "mystery-model",
          promptTokens: 10,
          completionTokens: 1,
          totalTokens: 11,
        },
      ],
      catalog,
    );
    expect(report.unpricedCalls).toBe(1);
    expect(report.pricedCalls).toBe(1);
    expect(report.byModel[0].model).toBe("deepseek-v4-flash");
    expect(report.byModel[0].cost?.amount).toBeGreaterThan(0);
    expect(report.byModel.find((r) => r.model === "mystery-model")?.unmatched).toBe(
      true,
    );
  });
});
