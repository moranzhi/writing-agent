import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureUserDataDirs, getUserDataDir } from "../config/user-data-dir.js";
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
};

type PricingFile = {
  version: 1;
  sources: PricingSource[];
};

const FILE_NAME = "pricing-sources.json";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 2_000_000;

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
  return refreshPricingSource(source.id);
}

export function deletePricingSource(id: string): boolean {
  const data = readFile();
  const next = data.sources.filter((s) => s.id !== id);
  if (next.length === data.sources.length) return false;
  writeFile({ version: 1, sources: next });
  return true;
}

export async function refreshPricingSource(id: string): Promise<PricingSource> {
  const data = readFile();
  const source = data.sources.find((s) => s.id === id);
  if (!source) throw new Error("价目来源不存在");
  try {
    const parsed = await fetchAndParsePricing(source.url);
    source.fetchedAt = new Date().toISOString();
    source.title = parsed.title;
    source.rates = parsed.rates;
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

export async function fetchAndParsePricing(url: string): Promise<{
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
      const parsed = parsePricingDocument(doc.text, doc.contentType);
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
