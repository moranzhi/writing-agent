import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureUserDataDirs, getUserDataDir } from "../config/user-data-dir.js";
import { recentDistinctModels } from "./token-store.js";
import {
  parsePricingDocument,
  type ModelRate,
} from "./pricing-parse.js";

export type PricingSource = {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  fetchedAt?: string;
  fetchError?: string;
  title?: string;
  rates: ModelRate[];
  /** 上一次成功拉取的单价，跨进程保留，用来看价格有没有变 */
  previousRates?: ModelRate[];
  previousFetchedAt?: string;
};

type PricingFile = {
  version: 1;
  sources: PricingSource[];
};

const FILE_NAME = "pricing-sources.json";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 2_000_000;

export const OPENROUTER_PRICING_URL = "https://openrouter.ai/api/v1/models";
/** 预估对比使用的最近调用条数 */
export const RECENT_COMPARE_CALLS = 100;

export const SUGGESTED_PRICING_DOCS: Array<{ name: string; url: string }> = [
  {
    name: "DeepSeek Models & Pricing",
    url: "https://api-docs.deepseek.com/quick_start/pricing",
  },
  {
    name: "DeepSeek 模型与价格",
    url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
  },
  {
    name: "智谱 GLM API 定价",
    url: "https://docs.bigmodel.cn/cn/guide/start/pricing",
  },
  {
    name: "Z.AI GLM Pricing",
    url: "https://docs.z.ai/guides/overview/pricing",
  },
];

const USUAL_SKIP_PARTS = new Set([
  "image",
  "audio",
  "vision",
  "codex",
  "preview",
  "exp",
  "lite",
  "nano",
  "mini",
  "instruct",
  "banana",
  "oss",
  "safeguard",
]);

function filePath(): string {
  return path.join(getUserDataDir(), FILE_NAME);
}

function emptyFile(): PricingFile {
  return { version: 1, sources: [] };
}

function readFile(): PricingFile {
  ensureUserDataDirs();
  try {
    const raw = readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(raw) as PricingFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.sources)) return emptyFile();
    return parsed;
  } catch {
    return emptyFile();
  }
}

function writeFile(data: PricingFile): void {
  ensureUserDataDirs();
  writeFileSync(filePath(), JSON.stringify(data, null, 2), "utf8");
}

export function listPricingSources(): PricingSource[] {
  return readFile().sources;
}

export function getPricingSource(id: string): PricingSource | null {
  return listPricingSources().find((s) => s.id === id) ?? null;
}

export function isOpenRouterModelsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "openrouter.ai" &&
      parsed.pathname.replace(/\/+$/, "") === "/api/v1/models"
    );
  } catch {
    return false;
  }
}

/**
 * 对比用的当前档：每个家族只留最新一档（DeepSeek / Claude / GLM / Gemini / GPT / Grok）。
 * 同一档有多个 id 时留 created 更新的那个。
 */
export function usualOpenRouterBucket(modelId: string): string | null {
  const id = modelId.trim().toLowerCase();
  if (!id || id.startsWith("~") || id.includes(":")) return null;
  const name = id.split("/").pop() ?? id;
  if (
    name.includes("multi-agent") ||
    name.includes("chat-latest") ||
    name.includes("customtools") ||
    name.includes("build-")
  ) {
    return null;
  }
  const parts = name.split(/[^a-z0-9.]+/);
  if (parts.some((part) => USUAL_SKIP_PARTS.has(part))) return null;
  if (name.includes("claude-haiku")) return "claude-haiku";
  if (name.includes("claude-sonnet")) return "claude-sonnet";
  if (name.includes("claude-opus")) return "claude-opus";
  if (name.includes("claude-fable")) return "claude-fable";
  if (name.includes("grok")) return "grok";
  if (name.includes("deepseek") && name.includes("pro")) return "deepseek-pro";
  if (name.includes("deepseek") && name.includes("flash")) return "deepseek-flash";
  if (name.includes("glm") && name.includes("prime")) return "glm-prime";
  if (name.includes("glm") && name.includes("flashx")) return "glm-flashx";
  if (name.includes("glm") && name.includes("flash")) return "glm-flash";
  if (name.includes("glm") && !name.includes("air") && !name.includes("turbo") && !/v$/.test(name)) {
    return "glm";
  }
  if (name.includes("gemini") && name.includes("pro")) return "gemini-pro";
  if (name.includes("gemini") && name.includes("flash")) return "gemini-flash";
  if (name.startsWith("gpt-") && name.includes("luna-pro")) return "gpt-luna-pro";
  if (name.startsWith("gpt-") && name.includes("luna")) return "gpt-luna";
  if (name.startsWith("gpt-") && name.includes("sol-pro")) return "gpt-sol-pro";
  if (name.startsWith("gpt-") && /-sol(?:$|-)/.test(name)) return "gpt-sol";
  if (name.startsWith("gpt-") && name.includes("astra-pro")) return "gpt-astra-pro";
  if (name.startsWith("gpt-") && name.includes("astra")) return "gpt-astra";
  return null;
}

export function trimOpenRouterUsualCatalog(text: string, keepIds: string[] = []): string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return text;
  }
  const rows = openRouterRows(data);
  if (!rows) return text;
  const pinned = new Set(keepIds.map((id) => id.trim().toLowerCase()).filter(Boolean));
  const best = new Map<string, { created: number; row: Record<string, unknown> }>();
  for (const row of rows) {
    const id = String(row.id ?? row.model ?? "").trim();
    const bucket = usualOpenRouterBucket(id);
    const keepExact = pinned.has(id.toLowerCase()) && isWatchedFamily(id);
    if (!bucket && !keepExact) continue;
    const key = keepExact ? `keep:${id.toLowerCase()}` : bucket!;
    const created = Number(row.created);
    const at = Number.isFinite(created) ? created : 0;
    const prev = best.get(key);
    if (!prev || at >= prev.created) best.set(key, { created: at, row });
  }
  return JSON.stringify({ data: [...best.values()].map((item) => item.row) });
}

function isWatchedFamily(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id || id.startsWith("~") || id.includes(":")) return false;
  const name = id.split("/").pop() ?? id;
  return (
    name.includes("deepseek") ||
    name.includes("claude") ||
    name.includes("glm") ||
    name.includes("gemini") ||
    name.startsWith("gpt-") ||
    name.includes("grok")
  );
}

function openRouterRows(data: unknown): Array<Record<string, unknown>> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const rows = (data as { data?: unknown }).data;
  if (!Array.isArray(rows)) return null;
  return rows.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row != null && !Array.isArray(row),
  );
}

const FAMILY_ORDER = ["deepseek", "claude", "glm", "gemini", "gpt", "grok"];

export function listOpenRouterCompareModels(
  sources = listPricingSources(),
): string[] {
  const source = sources.find((item) => isOpenRouterModelsUrl(item.url));
  if (!source) return [];
  return [...source.rates]
    .map((rate) => rate.model)
    .sort((a, b) => {
      const rank = (model: string) => {
        const name = model.toLowerCase();
        const index = FAMILY_ORDER.findIndex((family) => name.includes(family));
        return index < 0 ? 99 : index;
      };
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      return a.localeCompare(b);
    });
}

/** 拉取 OpenRouter。keepIds 里最近用过的型号会按原 id 留下，即使不是当前档。 */
export async function refreshOpenRouterPricing(keepIds: string[] = []): Promise<PricingSource> {
  const url = normalizePricingUrl(OPENROUTER_PRICING_URL);
  const existing = listPricingSources().find((source) => source.url === url);
  if (existing) return refreshPricingSource(existing.id, keepIds);
  const data = readFile();
  const source: PricingSource = {
    id: randomUUID(),
    name: "OpenRouter",
    url,
    createdAt: new Date().toISOString(),
    rates: [],
  };
  data.sources.push(source);
  writeFile(data);
  return refreshPricingSource(source.id, keepIds);
}

export function normalizePricingUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("不是合法 URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("只支持 http/https 官方文档");
  }
  url.hash = "";
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

export async function addPricingSource(input: {
  url: string;
  name?: string;
}): Promise<PricingSource> {
  const url = normalizePricingUrl(input.url);
  const data = readFile();
  const existing = data.sources.find((s) => s.url === url);
  if (existing) {
    return refreshPricingSource(existing.id);
  }
  const source: PricingSource = {
    id: randomUUID(),
    name: input.name?.trim() || hostLabel(url),
    url,
    createdAt: new Date().toISOString(),
    rates: [],
  };
  data.sources.push(source);
  writeFile(data);
  return refreshPricingSource(source.id, []);
}

export function deletePricingSource(id: string): boolean {
  const data = readFile();
  const next = data.sources.filter((s) => s.id !== id);
  if (next.length === data.sources.length) return false;
  writeFile({ version: 1, sources: next });
  return true;
}

export async function refreshPricingSource(
  id: string,
  keepIds: string[] = [],
): Promise<PricingSource> {
  const data = readFile();
  const source = data.sources.find((s) => s.id === id);
  if (!source) throw new Error("价目来源不存在");
  try {
    const parsed = await fetchAndParsePricing(source.url, keepIds);
    if (parsed.rates.length && source.rates.length) {
      source.previousRates = source.rates;
      source.previousFetchedAt = source.fetchedAt;
    }
    source.fetchedAt = new Date().toISOString();
    source.title = parsed.title;
    source.rates = parsed.rates.length ? parsed.rates : source.rates;
    if (parsed.title && looksGenericName(source.name)) {
      source.name = shortenTitle(parsed.title);
    }
    source.fetchError = parsed.rates.length
      ? undefined
      : parsed.warnings[0] || "未能从文档解析出型号价格";
  } catch (err) {
    source.fetchedAt = new Date().toISOString();
    source.fetchError = err instanceof Error ? err.message : String(err);
  }
  writeFile(data);
  return source;
}

export type FetchedDoc = { contentType: string; text: string };

export function markdownDocFallbacks(url: string): string[] {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    if (parsed.pathname.endsWith(".md")) return [];
    const docPath = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = `${docPath}.md`;
    return [parsed.toString()];
  } catch {
    return [];
  }
}

export async function fetchAndParsePricing(
  url: string,
  keepIds: string[] = [],
): Promise<{
  title?: string;
  rates: ModelRate[];
  warnings: string[];
}> {
  const candidates = [url, ...markdownDocFallbacks(url)];
  let lastError = "未能从文档解析出型号价格";
  let lastTitle: string | undefined;
  for (const candidate of candidates) {
    try {
      const doc = await fetchPricingDocument(candidate);
      const text = isOpenRouterModelsUrl(candidate)
        ? trimOpenRouterUsualCatalog(doc.text, keepIds)
        : doc.text;
      const parsed = parsePricingDocument(text, doc.contentType);
      lastTitle = parsed.title ?? lastTitle;
      if (parsed.rates.length) return parsed;
      lastError = parsed.warnings[0] || lastError;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { title: lastTitle, rates: [], warnings: [lastError] };
}

export async function fetchPricingDocument(url: string): Promise<FetchedDoc> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "text/html, text/markdown, application/json, text/plain;q=0.9",
      "User-Agent": "WritingAgent/0.1 (local token cost)",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`拉取失败 HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    throw new Error("文档过大");
  }
  const contentType = res.headers.get("content-type") ?? "text/html";
  return { contentType, text: buf.toString("utf8") };
}

export type ResolvedRate = ModelRate & {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
};

export function resolveRateCatalog(sources = listPricingSources()): {
  byKey: Map<string, ResolvedRate>;
  rates: ResolvedRate[];
} {
  const byKey = new Map<string, ResolvedRate>();
  for (const source of sources) {
    for (const rate of source.rates) {
      const resolved: ResolvedRate = {
        ...rate,
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
      };
      byKey.set(rate.model.toLowerCase(), resolved);
      for (const alias of rate.aliases) {
        byKey.set(alias.toLowerCase(), resolved);
      }
    }
  }
  const seen = new Set<string>();
  const rates: ResolvedRate[] = [];
  for (const rate of byKey.values()) {
    const id = `${rate.sourceId}:${rate.model.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rates.push(rate);
  }
  return { byKey, rates };
}

export type CatalogModelHit = {
  model: string;
  sourceName: string;
  currency: string;
  unitTokens: number;
  input: number;
  output: number;
  cached: number | null;
};

/** 在已同步价目里按型号子串搜索，供对比条加入候选。 */
export function searchPricingModels(
  query: string,
  limit = 12,
  catalog = resolveRateCatalog(),
): CatalogModelHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const cap = Math.min(Math.max(limit, 1), 30);
  const hits = catalog.rates.filter((rate) => rate.model.toLowerCase().includes(q));
  hits.sort((a, b) => {
    const rank = (model: string) => {
      const id = model.toLowerCase();
      let score = 0;
      if (id.includes(":batch") || id.includes(":free")) score += 4;
      if (id.startsWith("~")) score += 2;
      if (id !== q && !id.endsWith(`/${q}`)) score += 1;
      return score;
    };
    const diff = rank(a.model) - rank(b.model);
    if (diff !== 0) return diff;
    return a.model.length - b.model.length;
  });
  return hits.slice(0, cap).map((rate) => ({
    model: rate.model,
    sourceName: rate.sourceName,
    currency: rate.currency,
    unitTokens: rate.unitTokens,
    input: rate.inputCacheMiss.offPeak,
    output: rate.output.offPeak,
    cached: rate.inputCacheHit?.offPeak ?? null,
  }));
}

export function findModelRate(
  model: string,
  catalog = resolveRateCatalog(),
): ResolvedRate | undefined {
  const key = model.trim().toLowerCase();
  if (!key) return undefined;
  const exact = catalog.byKey.get(key);
  if (exact) return exact;
  const tail = key.split("/").pop();
  if (tail && tail !== key) return catalog.byKey.get(tail);
  return undefined;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function looksGenericName(name: string): boolean {
  return /^(https?:|www\.|[a-z0-9.-]+\.[a-z]{2,}$)/i.test(name);
}

function shortenTitle(title: string): string {
  return title.replace(/\s*[·|]\s*.*$/, "").trim() || title;
}

export type UnitSnap = {
  currency: string;
  input: number;
  output: number;
  cached: number | null;
};

export type PriceWatchItem = {
  model: string;
  status: "changed" | "unchanged" | "unpriced" | "baseline";
  previous: UnitSnap | null;
  current: UnitSnap | null;
};

export type PriceWatchNotice = {
  at: string;
  error?: string;
  items: PriceWatchItem[];
};

const NOTICE_FILE = "pricing-notice.json";
let watchInFlight: Promise<PriceWatchNotice> | null = null;
let watchStatus: "idle" | "pulling" | "done" | "error" = "idle";

export function getPriceWatchStatus(): "idle" | "pulling" | "done" | "error" {
  return watchStatus;
}

export function unitSnap(rate: ModelRate): UnitSnap {
  return {
    currency: rate.currency,
    input: rate.inputCacheMiss.offPeak,
    output: rate.output.offPeak,
    cached: rate.inputCacheHit?.offPeak ?? null,
  };
}

function rateIndex(rates: ModelRate[]): Map<string, ModelRate> {
  const map = new Map<string, ModelRate>();
  for (const rate of rates) {
    map.set(rate.model.toLowerCase(), rate);
    for (const alias of rate.aliases) map.set(alias.toLowerCase(), rate);
  }
  return map;
}

function lookupRate(map: Map<string, ModelRate>, model: string): ModelRate | undefined {
  const key = model.trim().toLowerCase();
  const exact = map.get(key);
  if (exact) return exact;
  const tail = key.split("/").pop();
  if (tail && tail !== key) return map.get(tail);
  return undefined;
}

function sameSnap(a: UnitSnap, b: UnitSnap): boolean {
  return (
    a.currency === b.currency &&
    a.input === b.input &&
    a.output === b.output &&
    a.cached === b.cached
  );
}

export function compareStoredPrices(
  previous: ModelRate[],
  current: ModelRate[],
  models: string[],
): PriceWatchItem[] {
  const before = rateIndex(previous);
  const after = rateIndex(current);
  return models.map((model) => {
    const prev = lookupRate(before, model);
    const next = lookupRate(after, model);
    if (!next) {
      return {
        model,
        status: "unpriced",
        previous: prev ? unitSnap(prev) : null,
        current: null,
      };
    }
    const currentSnap = unitSnap(next);
    if (!prev) {
      return { model, status: "baseline", previous: null, current: currentSnap };
    }
    const previousSnap = unitSnap(prev);
    return {
      model,
      status: sameSnap(previousSnap, currentSnap) ? "unchanged" : "changed",
      previous: previousSnap,
      current: currentSnap,
    };
  });
}

export function readPriceWatchNotice(): PriceWatchNotice | null {
  try {
    const raw = readFileSync(path.join(getUserDataDir(), NOTICE_FILE), "utf8");
    const parsed = JSON.parse(raw) as PriceWatchNotice;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePriceWatchNotice(notice: PriceWatchNotice): void {
  ensureUserDataDirs();
  writeFileSync(path.join(getUserDataDir(), NOTICE_FILE), JSON.stringify(notice, null, 2), "utf8");
}

/** 启动或手动拉取：更新本机价目，并和上次留下的单价比较最近 2 个型号。 */
export async function syncOpenRouterPrices(): Promise<PriceWatchNotice> {
  if (watchInFlight) return watchInFlight;
  watchStatus = "pulling";
  watchInFlight = syncOpenRouterPricesInner().finally(() => {
    watchInFlight = null;
  });
  return watchInFlight;
}

async function syncOpenRouterPricesInner(): Promise<PriceWatchNotice> {
  const models = recentDistinctModels(2);
  try {
    const source = await refreshOpenRouterPricing(models);
    const notice: PriceWatchNotice = {
      at: new Date().toISOString(),
      error: source.fetchError,
      items: source.fetchError
        ? []
        : compareStoredPrices(source.previousRates ?? [], source.rates, models),
    };
    writePriceWatchNotice(notice);
    watchStatus = source.fetchError ? "error" : "done";
    return notice;
  } catch (err) {
    watchStatus = "error";
    const notice: PriceWatchNotice = {
      at: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      items: [],
    };
    writePriceWatchNotice(notice);
    return notice;
  }
}
