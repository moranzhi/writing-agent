import type { IncomingMessage, ServerResponse } from "node:http";
import {
  readRecords,
  summarizeTokenUsage,
  type TokenStatsQuery,
} from "../stats/token-store.js";

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

export async function handleStatsApi(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  searchParams: URLSearchParams,
): Promise<boolean> {
  if (pathname !== "/api/stats/tokens") return false;

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

  json(res, 200, {
    summary: summarizeTokenUsage(query),
    records: readRecords({ ...query, limit: query.limit ?? 100 }),
  });
  return true;
}
