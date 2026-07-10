import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureUserDataDirs, getUserDataDir } from "../config/user-data-dir.js";

export type TokenUsageRecord = {
  id: string;
  at: string;
  bookId?: string;
  bookTitle?: string;
  orchestratorId?: string;
  sessionId?: string;
  caller: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  cacheMissTokens?: number;
  messageId?: string;
};

/** Token usage attached to a chat message in SessionView */
export type MessageTokenUsage = {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  cacheMissTokens?: number;
  caller: string;
  model?: string;
  recordId?: string;
};

export type CallerTokenBreakdown = {
  totalTokens: number;
  cachedTokens: number;
  cacheMissTokens: number;
  calls: number;
};

export type TokenStatsQuery = {
  bookId?: string;
  orchestratorId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type TokenStatsSummary = {
  totalCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCached: number;
  totalCacheMiss: number;
  byCaller: Record<string, number>;
  byCallerDetailed: Record<string, CallerTokenBreakdown>;
  byBook: Record<string, number>;
  byOrchestrator: Record<string, number>;
};

function statsDir(): string {
  return path.join(getUserDataDir(), "stats");
}

function dayFile(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return path.join(statsDir(), `${y}-${m}-${d}.jsonl`);
}

function ensureStatsDir(): void {
  ensureUserDataDirs();
  mkdirSync(statsDir(), { recursive: true });
}

export function recordTokenUsage(
  partial: Omit<TokenUsageRecord, "id" | "at"> & { at?: string },
): TokenUsageRecord {
  ensureStatsDir();
  const record: TokenUsageRecord = {
    id: randomUUID(),
    at: partial.at ?? new Date().toISOString(),
    bookId: partial.bookId,
    bookTitle: partial.bookTitle,
    orchestratorId: partial.orchestratorId,
    sessionId: partial.sessionId,
    caller: partial.caller,
    model: partial.model,
    promptTokens: partial.promptTokens,
    completionTokens: partial.completionTokens,
    totalTokens: partial.totalTokens,
    cachedTokens: partial.cachedTokens,
    cacheMissTokens: partial.cacheMissTokens,
    messageId: partial.messageId,
  };
  appendFileSync(dayFile(new Date(record.at)), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

function listStatFiles(): string[] {
  ensureStatsDir();
  const dir = statsDir();
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

export function readRecords(query: TokenStatsQuery = {}): TokenUsageRecord[] {
  const files = listStatFiles();
  const records: TokenUsageRecord[] = [];
  const fromMs = query.from ? Date.parse(query.from) : NaN;
  const toMs = query.to ? Date.parse(query.to) : NaN;
  const limit = query.limit ?? 500;

  for (let i = files.length - 1; i >= 0 && records.length < limit; i--) {
    const file = files[i];
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    for (let j = lines.length - 1; j >= 0 && records.length < limit; j--) {
      try {
        const record = JSON.parse(lines[j]) as TokenUsageRecord;
        if (query.bookId && record.bookId !== query.bookId) continue;
        if (query.orchestratorId && record.orchestratorId !== query.orchestratorId) {
          continue;
        }
        if (query.sessionId && record.sessionId !== query.sessionId) continue;
        const atMs = Date.parse(record.at);
        if (Number.isFinite(fromMs) && atMs < fromMs) continue;
        if (Number.isFinite(toMs) && atMs > toMs) continue;
        records.push(record);
      } catch {
        /* skip bad line */
      }
    }
  }

  return records.sort((a, b) => b.at.localeCompare(a.at));
}

function accumulateCaller(
  map: Record<string, CallerTokenBreakdown>,
  caller: string,
  record: Pick<
    TokenUsageRecord,
    "totalTokens" | "cachedTokens" | "cacheMissTokens"
  >,
): void {
  const prev = map[caller] ?? {
    totalTokens: 0,
    cachedTokens: 0,
    cacheMissTokens: 0,
    calls: 0,
  };
  map[caller] = {
    totalTokens: prev.totalTokens + record.totalTokens,
    cachedTokens: prev.cachedTokens + (record.cachedTokens ?? 0),
    cacheMissTokens: prev.cacheMissTokens + (record.cacheMissTokens ?? 0),
    calls: prev.calls + 1,
  };
}

export function summarizeTokenUsage(query: TokenStatsQuery = {}): TokenStatsSummary {
  const records = readRecords({ ...query, limit: query.limit ?? 2000 });
  const summary: TokenStatsSummary = {
    totalCalls: records.length,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    totalCached: 0,
    totalCacheMiss: 0,
    byCaller: {},
    byCallerDetailed: {},
    byBook: {},
    byOrchestrator: {},
  };

  for (const r of records) {
    summary.promptTokens += r.promptTokens;
    summary.completionTokens += r.completionTokens;
    summary.totalTokens += r.totalTokens;
    summary.totalCached += r.cachedTokens ?? 0;
    summary.totalCacheMiss += r.cacheMissTokens ?? 0;
    summary.byCaller[r.caller] = (summary.byCaller[r.caller] ?? 0) + r.totalTokens;
    accumulateCaller(summary.byCallerDetailed, r.caller, r);
    if (r.bookId) {
      const label = r.bookTitle ? `${r.bookTitle} (${r.bookId.slice(0, 8)})` : r.bookId;
      summary.byBook[label] = (summary.byBook[label] ?? 0) + r.totalTokens;
    }
    if (r.orchestratorId) {
      summary.byOrchestrator[r.orchestratorId] =
        (summary.byOrchestrator[r.orchestratorId] ?? 0) + r.totalTokens;
    }
  }

  return summary;
}

export function getSessionTokenTotals(sessionId: string): {
  totalTokens: number;
  totalCached: number;
  totalCacheMiss: number;
  byCaller: Record<string, CallerTokenBreakdown>;
  last?: TokenUsageRecord;
  records: TokenUsageRecord[];
} {
  const records = readRecords({ sessionId, limit: 500 });
  let totalTokens = 0;
  let totalCached = 0;
  let totalCacheMiss = 0;
  const byCaller: Record<string, CallerTokenBreakdown> = {};
  for (const r of records) {
    totalTokens += r.totalTokens;
    totalCached += r.cachedTokens ?? 0;
    totalCacheMiss += r.cacheMissTokens ?? 0;
    accumulateCaller(byCaller, r.caller, r);
  }
  return {
    totalTokens,
    totalCached,
    totalCacheMiss,
    byCaller,
    last: records[0],
    records,
  };
}

export function toMessageTokenUsage(record: TokenUsageRecord): MessageTokenUsage {
  return {
    totalTokens: record.totalTokens,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    cachedTokens: record.cachedTokens,
    cacheMissTokens: record.cacheMissTokens,
    caller: record.caller,
    model: record.model,
    recordId: record.id,
  };
}
