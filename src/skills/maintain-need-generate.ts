/**
 * 旁观维护 need_generate：按生成规则合同程序抽样（不走 LLM 编随机）。
 */
import {
  executeChanceBatch,
  type ChanceBatchRequestItem,
  type ChanceBatchResult,
} from "./chance-tools.js";
import { extractJsonObjectText } from "./worker-set-parse.js";
import type { MaintainNeedGenerate } from "./maintain-packet.js";

export const MAINTAIN_GENERATE_TAG = "运行.本轮.旁观.生成抽样";

type PoolEntry = { id?: string; 内容?: string; 权重?: number; weight?: number };

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function findRuleBody(
  parsed: Record<string, unknown>,
  ruleId: string,
): Record<string, unknown> | undefined {
  const body = parsed.正文;
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const rules = (body as Record<string, unknown>).rules;
  if (!Array.isArray(rules)) return undefined;
  for (const row of rules) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const id =
      asString(r.rule_id) ??
      asString(r.id) ??
      asString(r.规则id);
    if (id === ruleId) return r;
  }
  return undefined;
}

/** 从生成规则产物中为指定 rule_id 构建批量随机请求（每个池一条 pick） */
export function buildChanceBatchFromGenerationRule(
  rulesArtifactRaw: string,
  ruleId: string,
): ChanceBatchRequestItem[] | null {
  const text = extractJsonObjectText(rulesArtifactRaw) ?? rulesArtifactRaw.trim();
  if (!text) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rule = findRuleBody(parsed, ruleId);
  if (!rule) return null;
  const pools = rule.池 ?? rule.pools;
  if (!Array.isArray(pools) || !pools.length) return null;

  const requests: ChanceBatchRequestItem[] = [];
  for (const poolRaw of pools) {
    if (!poolRaw || typeof poolRaw !== "object" || Array.isArray(poolRaw)) continue;
    const pool = poolRaw as Record<string, unknown>;
    const poolId =
      asString(pool.pool_id) ?? asString(pool.池id) ?? asString(pool.名称);
    const entries = (pool.条目 ?? pool.entries) as PoolEntry[] | undefined;
    if (!poolId || !Array.isArray(entries) || !entries.length) continue;
    const items = entries
      .map((e, idx) => {
        const id = asString(e.id) ?? asString(e.内容) ?? `item-${idx}`;
        const weight =
          typeof e.权重 === "number"
            ? e.权重
            : typeof e.weight === "number"
              ? e.weight
              : undefined;
        return id ? { id, weight } : undefined;
      })
      .filter((x): x is { id: string; weight?: number } => Boolean(x));
    if (!items.length) continue;
    requests.push({
      id: `pool:${poolId}`,
      op: "pick",
      items,
      count: 1,
      unique: true,
      reason: `生成规则 ${ruleId} · 池 ${poolId}`,
    });
  }
  return requests.length ? requests : null;
}

export function runMaintainNeedGenerateSampling(params: {
  need: Exclude<MaintainNeedGenerate, false>;
  generationRulesRaw: string | null | undefined;
}): ChanceBatchResult | null {
  const raw = params.generationRulesRaw?.trim();
  if (!raw) return null;
  const batch = buildChanceBatchFromGenerationRule(raw, params.need.rule_id);
  if (!batch?.length) return null;
  return executeChanceBatch(batch);
}
