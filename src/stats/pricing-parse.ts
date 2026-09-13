/** 从官方价目文档（HTML / Markdown / JSON）抽出按型号的单价。 */

export type PeakWindow = {
  /** 距 UTC 当天 00:00 的分钟数，含起点不含终点 */
  startMinutes: number;
  endMinutes: number;
};

export type RateBand = {
  offPeak: number;
  peak?: number;
};

export type ModelRate = {
  model: string;
  aliases: string[];
  currency: string;
  unitTokens: number;
  inputCacheHit?: RateBand;
  inputCacheMiss: RateBand;
  output: RateBand;
  peakWindows?: PeakWindow[];
  /** JS getUTCDay：0 日 … 6 六。省略则每天都可能高峰 */
  peakWeekdays?: number[];
};

export type ParsePricingResult = {
  title?: string;
  rates: ModelRate[];
  warnings: string[];
};

const UNIT_1M = 1_000_000;

const MODEL_STOP = new Set(
  [
    "model",
    "models",
    "pricing",
    "features",
    "peak",
    "off-peak",
    "offpeak",
    "input",
    "output",
    "tokens",
    "token",
    "cache",
    "hit",
    "miss",
    "thinking",
    "maximum",
    "vision",
    "usd",
    "cny",
    "base",
    "url",
    "openai",
    "anthropic",
    "format",
    "version",
    "concurrency",
    "limit",
  ].map((s) => s.toLowerCase()),
);

export function parsePricingDocument(
  text: string,
  contentType = "text/html",
): ParsePricingResult {
  const trimmed = text.trim();
  const type = contentType.toLowerCase();
  if (type.includes("json") || (trimmed.startsWith("{") && trimmed.includes("pricing"))) {
    const jsonResult = parsePricingJson(trimmed);
    if (jsonResult.rates.length) return jsonResult;
  }
  const html = /<table[\s>]/i.test(trimmed) ? parsePricingHtml(trimmed) : { rates: [], warnings: [] as string[], title: pageTitle(trimmed) };
  if (html.rates.length) {
    return decorate(html, trimmed);
  }
  const md = parsePricingMarkdown(stripTags(trimmed));
  if (md.rates.length) return decorate(md, trimmed);
  return {
    title: pageTitle(trimmed),
    rates: [],
    warnings: ["未能从文档解析出型号价格"],
  };
}

function decorate(result: ParsePricingResult, source: string): ParsePricingResult {
  const peak = parsePeakSchedule(source);
  const aliases = parseLegacyAliases(source, result.rates.map((r) => r.model));
  const rates = result.rates.map((r) => ({
    ...r,
    aliases: unique([...(r.aliases ?? []), ...(aliases.get(r.model.toLowerCase()) ?? [])]),
    ...(peak
      ? { peakWindows: peak.windows, peakWeekdays: peak.weekdays }
      : {}),
  }));
  return {
    title: result.title ?? pageTitle(source),
    rates,
    warnings: result.warnings,
  };
}

function parsePricingHtml(html: string): ParsePricingResult {
  const tables = extractHtmlTables(html).map(expandTableGrid);
  return extractFromGrids(tables, html);
}

function parsePricingMarkdown(text: string): ParsePricingResult {
  const tables = extractMarkdownTables(text);
  return extractFromGrids(tables, text);
}

function extractFromGrids(grids: string[][][], source: string): ParsePricingResult {
  const warnings: string[] = [];
  const rates: ModelRate[] = [];
  const currencyHint = detectCurrency(source);
  const unit = detectUnitTokens(source);

  for (const grid of grids) {
    const fromMatrix = extractDeepSeekStyle(grid, currencyHint, unit);
    if (fromMatrix.length) {
      rates.push(...fromMatrix);
      continue;
    }
    const generic = extractGenericHeaderTable(grid, currencyHint, unit);
    rates.push(...generic);
  }

  const uniqueRates = mergeRatesByModel(rates);
  if (!uniqueRates.length) {
    warnings.push("表格里没有识别到单价");
  }
  return { title: pageTitle(source), rates: uniqueRates, warnings };
}

function extractDeepSeekStyle(
  grid: string[][],
  currencyHint: string,
  unit: number,
): ModelRate[] {
  let models: string[] = [];
  for (const row of grid) {
    const idx = row.findIndex((c) => /^model$/i.test(cleanCell(c)));
    if (idx < 0) continue;
    const found = row
      .slice(idx + 1)
      .map(cleanCell)
      .filter((c) => looksLikeModelId(c));
    if (found.length) {
      models = unique(found);
      break;
    }
  }
  if (!models.length) return [];

  const hit: Partial<Record<string, number[]>> = {};
  const miss: Partial<Record<string, number[]>> = {};
  const output: Partial<Record<string, number[]>> = {};
  let currency = currencyHint;

  for (const row of grid) {
    const cells = row.map(cleanCell);
    const joined = cells.join(" ").toLowerCase();
    const band = bandOf(joined);
    if (!band) continue;
    const money = parseMoneyCells(row);
    if (money.length < models.length) continue;
    const slice = money.slice(-models.length);
    currency = slice[0]?.currency ?? currency;
    const amounts = slice.map((m) => m.amount);
    if (/cache\s*hit/.test(joined) || /缓存命中/.test(joined)) {
      hit[band] = amounts;
    } else if (/cache\s*miss/.test(joined) || /缓存未命中/.test(joined)) {
      miss[band] = amounts;
    } else if (/output/.test(joined) || /输出/.test(joined)) {
      output[band] = amounts;
    }
  }

  if (!miss.offPeak && !output.offPeak) return [];

  return models.map((model, i) => {
    const missOff = miss.offPeak?.[i] ?? miss.peak?.[i];
    const outOff = output.offPeak?.[i] ?? output.peak?.[i];
    const missPeak = miss.peak?.[i];
    const outPeak = output.peak?.[i];
    const hitOff = hit.offPeak?.[i];
    const hitPeak = hit.peak?.[i];
    const inputMiss = missOff ?? missPeak;
    const out = outOff ?? outPeak;
    if (inputMiss == null || out == null) {
      return null;
    }
    const rate: ModelRate = {
      model,
      aliases: [],
      currency,
      unitTokens: unit,
      inputCacheMiss: {
        offPeak: inputMiss,
        ...(missPeak != null && missPeak !== inputMiss ? { peak: missPeak } : {}),
      },
      output: {
        offPeak: out,
        ...(outPeak != null && outPeak !== out ? { peak: outPeak } : {}),
      },
    };
    if (hitOff != null || hitPeak != null) {
      const off = hitOff ?? hitPeak!;
      rate.inputCacheHit = {
        offPeak: off,
        ...(hitPeak != null && hitPeak !== off ? { peak: hitPeak } : {}),
      };
    }
    return rate;
  }).filter((r): r is ModelRate => r != null);
}

function extractGenericHeaderTable(
  grid: string[][],
  currencyHint: string,
  unit: number,
): ModelRate[] {
  if (grid.length < 2) return [];
  const header = grid[0].map(cleanCell);
  const kinds = header.map(headerKind);
  const modelCol = kinds.indexOf("model");
  const inputCol = kinds.indexOf("input");
  const cachedCol = kinds.indexOf("cached");
  const outputCol = kinds.indexOf("output");
  if (modelCol < 0 || inputCol < 0 || outputCol < 0) return [];

  const rates: ModelRate[] = [];
  for (const row of grid.slice(1)) {
    const model = cleanCell(row[modelCol] ?? "");
    if (!looksLikeModelId(model)) continue;
    const input = parsePriceCell(row[inputCol] ?? "", currencyHint);
    const output = parsePriceCell(row[outputCol] ?? "", currencyHint);
    if (!input || !output) continue;
    const cached =
      cachedCol >= 0 ? parsePriceCell(row[cachedCol] ?? "", currencyHint) : null;
    const currency = input.currency ?? output.currency ?? currencyHint;
    const rate: ModelRate = {
      model,
      aliases: [],
      currency,
      unitTokens: unit,
      inputCacheMiss: { offPeak: input.amount },
      output: { offPeak: output.amount },
    };
    if (cached) rate.inputCacheHit = { offPeak: cached.amount };
    rates.push(rate);
  }
  return rates;
}

function headerKind(cell: string): "model" | "input" | "cached" | "output" | "other" {
  const t = cell.toLowerCase().replace(/\s+/g, " ").trim();
  if (/模型名称|^(model|型号|模型)$/i.test(t) || t === "id") return "model";
  if (/缓存存储|cache(?:d)?\s*input\s*storage/.test(t)) return "other";
  if (/cache\s*hit|cached(?:\s+input)?$|缓存命中/.test(t)) return "cached";
  if (/output|completion|输出/.test(t)) return "output";
  if (/input|prompt|cache\s*miss|输入/.test(t)) return "input";
  return "other";
}

function bandOf(joined: string): "offPeak" | "peak" | null {
  if (/off[- ]?peak|闲时|非高峰|低峰/.test(joined)) return "offPeak";
  if (/(^|[^a-z])peak([^a-z]|$)|高峰/.test(joined)) return "peak";
  return null;
}

export function parsePeakSchedule(text: string): {
  windows: PeakWindow[];
  weekdays: number[];
} | null {
  const plain = stripTags(text).replace(/\s+/g, " ");
  const windows: PeakWindow[] = [];
  const utcRange =
    /peak hours are\s+(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s+and\s+(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*utc/i.exec(
      plain,
    ) ??
    /高峰.*?(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2}).*?(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2}).*utc/i.exec(
      plain,
    );
  if (utcRange) {
    windows.push(
      { startMinutes: parseHhMm(utcRange[1]), endMinutes: parseHhMm(utcRange[2]) },
      { startMinutes: parseHhMm(utcRange[3]), endMinutes: parseHhMm(utcRange[4]) },
    );
  }
  if (!windows.length) return null;
  const weekdays = /monday through friday|周一至周五|星期一至星期五/i.test(plain)
    ? [1, 2, 3, 4, 5]
    : [0, 1, 2, 3, 4, 5, 6];
  return { windows, weekdays };
}

export function parseLegacyAliases(
  text: string,
  models: string[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const codes = [
    ...text.matchAll(/<code\b[^>]*>([^<]+)<\/code>/gi),
    ...text.matchAll(/`([a-zA-Z][a-zA-Z0-9._:+/-]{1,80})`/g),
  ].map((m) => cleanCell(m[1]));
  const plain = stripTags(text).replace(/\s+/g, " ");
  const flash = models.find((m) => /flash/i.test(m));
  if (
    flash &&
    /legacy names[\s\S]{0,800}billed at the flash price/i.test(plain)
  ) {
    const legacy = codes.filter(
      (c) => /flash/i.test(c) && c.toLowerCase() !== flash.toLowerCase(),
    );
    if (legacy.length) map.set(flash.toLowerCase(), unique(legacy));
  }
  return map;
}

function parsePricingJson(text: string): ParsePricingResult {
  try {
    const data = JSON.parse(text) as unknown;
    const rates: ModelRate[] = [];
    const rows = jsonModelRows(data);
    for (const row of rows) {
      const model = String(row.id ?? row.model ?? "").trim();
      if (!model) continue;
      const pricing = (row.pricing ?? row) as Record<string, unknown>;
      const prompt = jsonPrice(pricing.prompt ?? pricing.input ?? pricing.inputCacheMiss);
      const completion = jsonPrice(pricing.completion ?? pricing.output);
      if (prompt == null || completion == null) continue;
      const cached = jsonPrice(pricing.input_cache_read ?? pricing.cached ?? pricing.inputCacheHit);
      // OpenRouter 等接口用「每个 token」；官方价目表通常是每 1M。
      const perToken = prompt > 0 && prompt < 1e-4;
      const rate: ModelRate = {
        model: model.includes("/") ? model.split("/").pop()! : model,
        aliases: model.includes("/") ? [model] : [],
        currency: "USD",
        unitTokens: UNIT_1M,
        inputCacheMiss: { offPeak: perToken ? prompt * UNIT_1M : prompt },
        output: { offPeak: perToken ? completion * UNIT_1M : completion },
      };
      if (cached != null) {
        rate.inputCacheHit = { offPeak: perToken ? cached * UNIT_1M : cached };
      }
      rates.push(rate);
    }
    return { rates: mergeRatesByModel(rates), warnings: rates.length ? [] : ["JSON 中没有单价"] };
  } catch {
    return { rates: [], warnings: ["JSON 解析失败"] };
  }
}

function jsonModelRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (!isRecord(data)) return [];
  if (Array.isArray(data.models)) return data.models.filter(isRecord);
  if (Array.isArray(data.data)) return data.data.filter(isRecord);
  if (Array.isArray(data.rates)) return data.rates.filter(isRecord);
  return [];
}

function jsonPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v != null && !Array.isArray(v);
}

type RawCell = { text: string; colspan: number; rowspan: number };

function extractHtmlTables(html: string): RawCell[][][] {
  const tables: RawCell[][][] = [];
  const re = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    tables.push(parseHtmlTableRows(m[1]));
  }
  return tables;
}

function parseHtmlTableRows(inner: string): RawCell[][] {
  const rows: RawCell[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(inner))) {
    const cells: RawCell[] = [];
    const tdRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1]))) {
      const attrs = td[1];
      cells.push({
        text: cellText(td[2]),
        colspan: attrInt(attrs, "colspan") || 1,
        rowspan: attrInt(attrs, "rowspan") || 1,
      });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function expandTableGrid(rows: RawCell[][]): string[][] {
  const occupier: Array<{ left: number; text: string } | undefined> = [];
  const grid: string[][] = [];
  for (const row of rows) {
    const out: string[] = [];
    let col = 0;
    let i = 0;
    while (i < row.length || occupier.some((o, idx) => idx >= col && o && o.left > 0)) {
      const occ = occupier[col];
      if (occ && occ.left > 0) {
        out[col] = occ.text;
        occ.left -= 1;
        col += 1;
        continue;
      }
      if (i >= row.length) break;
      const cell = row[i++];
      for (let k = 0; k < cell.colspan; k++) {
        while (occupier[col]?.left) {
          out[col] = occupier[col]!.text;
          occupier[col]!.left -= 1;
          col += 1;
        }
        out[col] = cell.text;
        if (cell.rowspan > 1) {
          occupier[col] = { left: cell.rowspan - 1, text: cell.text };
        }
        col += 1;
      }
    }
    grid.push(out);
  }
  return grid;
}

function extractMarkdownTables(text: string): string[][][] {
  const lines = text.split(/\r?\n/);
  const tables: string[][][] = [];
  let current: string[][] = [];
  const flush = () => {
    if (current.length >= 2) tables.push(current);
    current = [];
  };
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) {
      flush();
      continue;
    }
    if (/^\s*\|?\s*:?-{3,}/.test(line)) continue;
    const cells = line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((c) => cleanCell(c));
    current.push(cells);
  }
  flush();
  return tables;
}

function attrInt(attrs: string, name: string): number {
  const m = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i").exec(attrs);
  return m ? Number(m[1]) : 0;
}

function cellText(raw: string): string {
  return cleanCell(
    raw
      .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|tr|h\d)>/gi, " "),
  );
}

export function cleanCell(raw: string): string {
  return decodeEntities(stripTags(raw))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function pageTitle(text: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  if (!m) return undefined;
  return decodeEntities(m[1]).replace(/\s+/g, " ").trim() || undefined;
}

function looksLikeModelId(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (MODEL_STOP.has(t.toLowerCase())) return false;
  if (!/^[a-zA-Z][a-zA-Z0-9._:+/-]*$/.test(t)) return false;
  if (/^(https?:|www\.)/i.test(t)) return false;
  return /[-/._]/.test(t) || /^(gpt|o[1-9]|claude|gemini|deepseek|qwen|glm|mistral|llama)/i.test(t);
}

function parseMoneyCells(row: string[]): Array<{ amount: number; currency: string }> {
  const out: Array<{ amount: number; currency: string }> = [];
  for (const cell of row) {
    const m = parseMoneyCell(cell);
    if (m) out.push(m);
  }
  return out;
}

function parsePriceCell(
  cell: string,
  currencyHint: string,
): { amount: number; currency: string } | null {
  const t = cleanCell(cell);
  if (!t) return null;
  if (/^(?:[-–—\\/]|不支持|暂不支持)$/i.test(t)) return null;
  if (/^(free|免费)$/i.test(t)) return { amount: 0, currency: currencyHint };
  const money = parseMoneyCell(t);
  if (money) return money;
  return parseBareNumber(t, currencyHint);
}

function parseMoneyCell(cell: string): { amount: number; currency: string } | null {
  const t = cleanCell(cell);
  const m =
    /^[\$]\s*([0-9]+(?:\.[0-9]+)?)\b/.exec(t) ||
    /^[¥￥]\s*([0-9]+(?:\.[0-9]+)?)\b/.exec(t) ||
    /^([0-9]+(?:\.[0-9]+)?)\s*元/.exec(t);
  if (!m) return null;
  const amount = Number(m[1]);
  if (!Number.isFinite(amount)) return null;
  const currency = t.includes("¥") || t.includes("￥") || t.includes("元") ? "CNY" : "USD";
  return { amount, currency };
}

function parseBareNumber(
  cell: string,
  currencyHint = "USD",
): { amount: number; currency: string } | null {
  const t = cleanCell(cell);
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(t)) return null;
  const amount = Number(t);
  return Number.isFinite(amount) ? { amount, currency: currencyHint } : null;
}

function detectCurrency(text: string): string {
  if (/元\s*[/／]\s*百万|元\/百万|人民币/.test(text)) return "CNY";
  if (/\$\s*[0-9]|prices are in usd/i.test(text)) return "USD";
  if (/[¥￥]|CNY/.test(text)) return "CNY";
  return "USD";
}

function detectUnitTokens(text: string): number {
  if (/1\s*[Mm]\s*tokens|per\s*1M|每\s*100\s*万|百万\s*token/i.test(text)) return UNIT_1M;
  return UNIT_1M;
}

function parseHhMm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
}

function unique(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function mergeRatesByModel(rates: ModelRate[]): ModelRate[] {
  const map = new Map<string, ModelRate>();
  for (const r of rates) {
    const key = r.model.toLowerCase();
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r, aliases: unique(r.aliases) });
      continue;
    }
    map.set(key, {
      ...prev,
      ...r,
      aliases: unique([...prev.aliases, ...r.aliases]),
    });
  }
  return [...map.values()];
}
