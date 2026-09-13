import type { TokenUsageRecord } from "./token-store.js";
import {
  findModelRate,
  resolveRateCatalog,
  type ResolvedRate,
} from "./pricing.js";
import type { PeakWindow, RateBand } from "./pricing-parse.js";

export type Money = {
  amount: number;
  currency: string;
};

export type RecordCost = {
  cost: Money | null;
  unmatched: boolean;
  sourceName?: string;
};

export type ModelCostRow = {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cacheMissTokens: number;
  cost: Money | null;
  unmatched: boolean;
  sourceName?: string;
  sourceUrl?: string;
};

export type CostReport = {
  total: Money | null;
  byCurrency: Record<string, number>;
  unpricedCalls: number;
  pricedCalls: number;
  byModel: ModelCostRow[];
};

export function isPeakAt(
  at: Date,
  windows: PeakWindow[] | undefined,
  weekdays: number[] | undefined,
): boolean {
  if (!windows?.length) return false;
  if (weekdays?.length && !weekdays.includes(at.getUTCDay())) return false;
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  return windows.some((w) => minutes >= w.startMinutes && minutes < w.endMinutes);
}

export function splitPromptTokens(record: TokenUsageRecord): {
  cached: number;
  miss: number;
  output: number;
} {
  const cached = Math.max(0, record.cachedTokens ?? 0);
  let miss = record.cacheMissTokens;
  if (miss == null) {
    miss = Math.max(0, record.promptTokens - cached);
  }
  const covered = cached + miss;
  if (covered < record.promptTokens) {
    miss += record.promptTokens - covered;
  }
  return { cached, miss, output: Math.max(0, record.completionTokens) };
}

function bandPrice(band: RateBand | undefined, peak: boolean): number {
  if (!band) return 0;
  if (peak && band.peak != null) return band.peak;
  return band.offPeak;
}

export function costForRecord(
  record: TokenUsageRecord,
  rate: ResolvedRate,
): Money {
  const at = new Date(record.at);
  const peak = isPeakAt(at, rate.peakWindows, rate.peakWeekdays);
  const parts = splitPromptTokens(record);
  const hitPrice = rate.inputCacheHit
    ? bandPrice(rate.inputCacheHit, peak)
    : bandPrice(rate.inputCacheMiss, peak);
  const missPrice = bandPrice(rate.inputCacheMiss, peak);
  const outPrice = bandPrice(rate.output, peak);
  const unit = rate.unitTokens || 1_000_000;
  const amount =
    (parts.cached * hitPrice + parts.miss * missPrice + parts.output * outPrice) /
    unit;
  return { amount: Math.round(amount * 1e10) / 1e10, currency: rate.currency };
}

export function attachRecordCost(
  record: TokenUsageRecord,
  catalog = resolveRateCatalog(),
): RecordCost {
  const rate = findModelRate(record.model || "", catalog);
  if (!rate) return { cost: null, unmatched: true };
  return {
    cost: costForRecord(record, rate),
    unmatched: false,
    sourceName: rate.sourceName,
  };
}

export function buildCostReport(
  records: TokenUsageRecord[],
  catalog = resolveRateCatalog(),
): CostReport {
  const byModel = new Map<string, ModelCostRow>();
  const byCurrency: Record<string, number> = {};
  let unpricedCalls = 0;
  let pricedCalls = 0;

  for (const record of records) {
    const model = record.model?.trim() || "(未填型号)";
    const rate = findModelRate(record.model || "", catalog);
    const priced = rate ? costForRecord(record, rate) : null;
    if (priced) {
      pricedCalls += 1;
      byCurrency[priced.currency] = (byCurrency[priced.currency] ?? 0) + priced.amount;
    } else {
      unpricedCalls += 1;
    }

    const prev = byModel.get(model) ?? {
      model,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      cacheMissTokens: 0,
      cost: priced ? { amount: 0, currency: priced.currency } : null,
      unmatched: !rate,
      sourceName: rate?.sourceName,
      sourceUrl: rate?.sourceUrl,
    };
    prev.calls += 1;
    prev.promptTokens += record.promptTokens;
    prev.completionTokens += record.completionTokens;
    prev.totalTokens += record.totalTokens;
    prev.cachedTokens += record.cachedTokens ?? 0;
    prev.cacheMissTokens += record.cacheMissTokens ?? 0;
    if (priced) {
      if (!prev.cost) prev.cost = { amount: 0, currency: priced.currency };
      if (prev.cost.currency === priced.currency) {
        prev.cost.amount += priced.amount;
      }
      prev.unmatched = false;
    }
    byModel.set(model, prev);
  }

  const currencies = Object.keys(byCurrency);
  const total =
    currencies.length === 1
      ? { amount: byCurrency[currencies[0]], currency: currencies[0] }
      : null;

  const rows = [...byModel.values()].sort((a, b) => {
    const ac = a.cost?.amount ?? -1;
    const bc = b.cost?.amount ?? -1;
    return bc - ac;
  });

  return {
    total,
    byCurrency,
    unpricedCalls,
    pricedCalls,
    byModel: rows,
  };
}
