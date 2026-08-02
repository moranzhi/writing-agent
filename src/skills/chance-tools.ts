/**
 * 程序机遇工具：骰子、比点、抽签/加权抽取。
 * 供按需执行单元 `chance` 使用；禁止用模型「假装随机」。
 */

export type ChanceRollRequest = {
  op: "roll";
  /** 如 1d20、2d6+3、d100；空格可忽略 */
  expression: string;
  reason?: string;
};

export type ChanceCompareRequest = {
  op: "compare";
  left: number;
  right: number;
  mode?: "gt" | "gte" | "lt" | "lte" | "eq";
  reason?: string;
};

export type ChanceDrawRequest = {
  op: "draw";
  pool: string[];
  count?: number;
  /** 默认 true：不放回 */
  unique?: boolean;
  reason?: string;
};

export type ChancePickRequest = {
  op: "pick";
  items: Array<{ id: string; weight?: number }>;
  count?: number;
  unique?: boolean;
  reason?: string;
};

export type ChanceRequest =
  | ChanceRollRequest
  | ChanceCompareRequest
  | ChanceDrawRequest
  | ChancePickRequest;

export type ChanceResult = {
  schema: "chance.v1";
  op: ChanceRequest["op"];
  ok: boolean;
  reason?: string;
  /** 人话摘要 */
  summary: string;
  detail: Record<string, unknown>;
  error?: string;
};

const DICE_RE = /^\s*(\d*)\s*[dD]\s*(\d+)\s*([+-]\s*\d+)?\s*$/;

function randInt(min: number, max: number): number {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export function parseChanceRequest(raw: unknown): ChanceRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const op = typeof row.op === "string" ? row.op.trim() : "";
  if (op === "roll") {
    const expression = typeof row.expression === "string" ? row.expression : "";
    if (!expression.trim()) return null;
    return {
      op: "roll",
      expression: expression.trim(),
      reason: typeof row.reason === "string" ? row.reason : undefined,
    };
  }
  if (op === "compare") {
    if (typeof row.left !== "number" || typeof row.right !== "number") return null;
    const mode = row.mode;
    const okMode =
      mode === "gt" ||
      mode === "gte" ||
      mode === "lt" ||
      mode === "lte" ||
      mode === "eq" ||
      mode === undefined;
    if (!okMode) return null;
    return {
      op: "compare",
      left: row.left,
      right: row.right,
      mode,
      reason: typeof row.reason === "string" ? row.reason : undefined,
    };
  }
  if (op === "draw") {
    if (!Array.isArray(row.pool)) return null;
    const pool = row.pool.filter((x): x is string => typeof x === "string");
    if (!pool.length) return null;
    return {
      op: "draw",
      pool,
      count: typeof row.count === "number" ? row.count : undefined,
      unique: typeof row.unique === "boolean" ? row.unique : undefined,
      reason: typeof row.reason === "string" ? row.reason : undefined,
    };
  }
  if (op === "pick") {
    if (!Array.isArray(row.items)) return null;
    const items: Array<{ id: string; weight?: number }> = [];
    for (const it of row.items) {
      if (!it || typeof it !== "object" || Array.isArray(it)) continue;
      const id = (it as { id?: unknown }).id;
      const weight = (it as { weight?: unknown }).weight;
      if (typeof id !== "string" || !id.trim()) continue;
      items.push({
        id: id.trim(),
        weight: typeof weight === "number" ? weight : undefined,
      });
    }
    if (!items.length) return null;
    return {
      op: "pick",
      items,
      count: typeof row.count === "number" ? row.count : undefined,
      unique: typeof row.unique === "boolean" ? row.unique : undefined,
      reason: typeof row.reason === "string" ? row.reason : undefined,
    };
  }
  return null;
}

export function executeChance(request: ChanceRequest): ChanceResult {
  const reason = request.reason;
  try {
    switch (request.op) {
      case "roll":
        return executeRoll(request, reason);
      case "compare":
        return executeCompare(request, reason);
      case "draw":
        return executeDraw(request, reason);
      case "pick":
        return executePick(request, reason);
      default:
        return fail("unknown", "不支持的 op", reason);
    }
  } catch (e) {
    return fail(
      (request as ChanceRequest).op,
      e instanceof Error ? e.message : String(e),
      reason,
    );
  }
}

function fail(
  op: string,
  error: string,
  reason?: string,
): ChanceResult {
  return {
    schema: "chance.v1",
    op: op as ChanceRequest["op"],
    ok: false,
    reason,
    summary: `机遇失败：${error}`,
    detail: {},
    error,
  };
}

function executeRoll(req: ChanceRollRequest, reason?: string): ChanceResult {
  const m = req.expression.replace(/\s+/g, "").match(DICE_RE);
  if (!m) {
    return fail("roll", `无法解析骰式：${req.expression}`, reason);
  }
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  const mod = m[3] ? Number(m[3].replace(/\s+/g, "")) : 0;
  if (!Number.isFinite(count) || count < 1 || count > 100) {
    return fail("roll", "骰子个数须在 1～100", reason);
  }
  if (!Number.isFinite(sides) || sides < 2 || sides > 1000) {
    return fail("roll", "面数须在 2～1000", reason);
  }
  const dice: number[] = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const v = randInt(1, sides);
    dice.push(v);
    sum += v;
  }
  const total = sum + mod;
  const modText = mod === 0 ? "" : mod > 0 ? `+${mod}` : `${mod}`;
  return {
    schema: "chance.v1",
    op: "roll",
    ok: true,
    reason,
    summary: `掷骰 ${count}d${sides}${modText} → [${dice.join(",")}]${modText} = ${total}`,
    detail: {
      expression: `${count}d${sides}${modText}`,
      dice,
      modifier: mod,
      total,
    },
  };
}

function executeCompare(
  req: ChanceCompareRequest,
  reason?: string,
): ChanceResult {
  const mode = req.mode ?? "gte";
  let win = false;
  switch (mode) {
    case "gt":
      win = req.left > req.right;
      break;
    case "gte":
      win = req.left >= req.right;
      break;
    case "lt":
      win = req.left < req.right;
      break;
    case "lte":
      win = req.left <= req.right;
      break;
    case "eq":
      win = req.left === req.right;
      break;
  }
  return {
    schema: "chance.v1",
    op: "compare",
    ok: true,
    reason,
    summary: `比点 ${req.left} ${mode} ${req.right} → ${win ? "成立" : "不成立"}`,
    detail: { left: req.left, right: req.right, mode, win },
  };
}

function executeDraw(req: ChanceDrawRequest, reason?: string): ChanceResult {
  const count = req.count ?? 1;
  const unique = req.unique !== false;
  if (count < 1 || count > 50) {
    return fail("draw", "抽取数量须在 1～50", reason);
  }
  if (unique && count > req.pool.length) {
    return fail("draw", "不放回抽取数量超过池大小", reason);
  }
  const bag = [...req.pool];
  const drawn: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = randInt(0, bag.length - 1);
    drawn.push(bag[idx]!);
    if (unique) bag.splice(idx, 1);
  }
  return {
    schema: "chance.v1",
    op: "draw",
    ok: true,
    reason,
    summary: `抽签 ×${count} → ${drawn.join("、")}`,
    detail: { drawn, unique, poolSize: req.pool.length },
  };
}

function executePick(req: ChancePickRequest, reason?: string): ChanceResult {
  const count = req.count ?? 1;
  const unique = req.unique !== false;
  if (count < 1 || count > 50) {
    return fail("pick", "抽取数量须在 1～50", reason);
  }
  let bag = req.items.map((it) => ({
    id: it.id,
    weight: it.weight && it.weight > 0 ? it.weight : 1,
  }));
  if (unique && count > bag.length) {
    return fail("pick", "不放回加权抽取数量超过条目数", reason);
  }
  const picked: string[] = [];
  for (let i = 0; i < count; i++) {
    const totalW = bag.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * totalW;
    let chosen = bag[0]!;
    for (const it of bag) {
      r -= it.weight;
      if (r <= 0) {
        chosen = it;
        break;
      }
    }
    picked.push(chosen.id);
    if (unique) bag = bag.filter((x) => x.id !== chosen.id);
  }
  return {
    schema: "chance.v1",
    op: "pick",
    ok: true,
    reason,
    summary: `加权抽取 ×${count} → ${picked.join("、")}`,
    detail: { picked, unique },
  };
}

/** 从黑板正文或 workerContext 解析请求 */
export function resolveChanceRequest(params: {
  workerContext?: Record<string, unknown> | null;
  blackboardRequestJson?: string | null;
}): ChanceRequest | null {
  const ctx = params.workerContext;
  if (ctx && typeof ctx === "object") {
    const nested = ctx.chance ?? ctx.request ?? ctx;
    const parsed = parseChanceRequest(nested);
    if (parsed) return parsed;
  }
  const raw = params.blackboardRequestJson?.trim();
  if (!raw) return null;
  try {
    return parseChanceRequest(JSON.parse(raw));
  } catch {
    return null;
  }
}
