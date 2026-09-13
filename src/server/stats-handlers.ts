import type { IncomingMessage, ServerResponse } from "node:http";
import {
  readRecords,
  summarizeRecords,
  type TokenStatsQuery,
} from "../stats/token-store.js";
import {
  addPricingSource,
  deletePricingSource,
  getPricingSource,
  listPricingSources,
  refreshPricingSource,
  resolveRateCatalog,
  SUGGESTED_PRICING_DOCS,
} from "../stats/pricing.js";
import { attachRecordCost, buildCostReport } from "../stats/pricing-cost.js";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function publicSource(source: ReturnType<typeof listPricingSources>[number]) {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    createdAt: source.createdAt,
    fetchedAt: source.fetchedAt ?? null,
    fetchError: source.fetchError ?? null,
    title: source.title ?? null,
    modelCount: source.rates.length,
    rates: source.rates.map((r) => ({
      model: r.model,
      aliases: r.aliases,
      currency: r.currency,
      unitTokens: r.unitTokens,
      inputCacheHit: r.inputCacheHit ?? null,
      inputCacheMiss: r.inputCacheMiss,
      output: r.output,
    })),
  };
}

export async function handleStatsApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  searchParams: URLSearchParams,
): Promise<boolean> {
  if (!pathname.startsWith("/api/stats/")) return false;

  if (pathname === "/api/stats/tokens") {
    if (req.method && req.method !== "GET") {
      json(res, 405, { error: "Method Not Allowed" });
      return true;
    }
    const query: TokenStatsQuery = {
      bookId: searchParams.get("bookId") ?? undefined,
      orchestratorId: searchParams.get("orchestratorId") ?? undefined,
      sessionId: searchParams.get("sessionId") ?? undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      limit: searchParams.get("limit")
        ? Number(searchParams.get("limit"))
        : undefined,
    };
    const summaryRecords = readRecords({ ...query, limit: query.limit ?? 2000 });
    const records = readRecords({ ...query, limit: query.limit ?? 100 });
    const catalog = resolveRateCatalog();
    const cost = buildCostReport(summaryRecords, catalog);
    json(res, 200, {
      summary: {
        ...summarizeRecords(summaryRecords),
        estimatedCost: cost.total,
        unpricedCalls: cost.unpricedCalls,
        byCurrency: cost.byCurrency,
        byModel: cost.byModel,
      },
      cost,
      records: records.map((r) => {
        const priced = attachRecordCost(r, catalog);
        return {
          ...r,
          estimatedCost: priced.cost,
          unmatchedRate: priced.unmatched,
        };
      }),
    });
    return true;
  }

  if (pathname === "/api/stats/pricing") {
    if (req.method !== "GET") {
      json(res, 405, { error: "Method Not Allowed" });
      return true;
    }
    json(res, 200, {
      sources: listPricingSources().map(publicSource),
      suggested: SUGGESTED_PRICING_DOCS,
    });
    return true;
  }

  if (pathname === "/api/stats/pricing/sources" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as { url?: string; name?: string };
      if (!body.url?.trim()) {
        json(res, 400, { error: "请填写官方价目文档 URL" });
        return true;
      }
      const source = await addPricingSource({ url: body.url, name: body.name });
      json(res, 201, { source: publicSource(source) });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : "添加失败" });
    }
    return true;
  }

  const refreshMatch = pathname.match(
    /^\/api\/stats\/pricing\/sources\/([^/]+)\/refresh$/,
  );
  if (refreshMatch && req.method === "POST") {
    const id = decodeURIComponent(refreshMatch[1]);
    if (!getPricingSource(id)) {
      json(res, 404, { error: "价目来源不存在" });
      return true;
    }
    try {
      const source = await refreshPricingSource(id);
      json(res, 200, {
        source: publicSource(source),
      });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : "更新失败" });
    }
    return true;
  }

  const sourceMatch = pathname.match(/^\/api\/stats\/pricing\/sources\/([^/]+)$/);
  if (sourceMatch && req.method === "DELETE") {
    const id = decodeURIComponent(sourceMatch[1]);
    if (!deletePricingSource(id)) {
      json(res, 404, { error: "价目来源不存在" });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
