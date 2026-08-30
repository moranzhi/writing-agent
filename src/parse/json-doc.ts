/** 从模型正文里抽出 JSON：先按原文 parse，再宽松修，避免弯引号/围栏/夹叙把合法稿撕开。 */

export function stripCodeFences(text: string): string {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json|yaml|yml)?\s*\r?\n?/i, "");
  t = t.replace(/\r?\n?```\s*$/i, "");
  const fenced = t.match(/```(?:json|yaml|yml)?\s*\r?\n([\s\S]*?)\r?\n```/i);
  if (fenced) t = fenced[1]!.trim();
  return t.trim();
}

export function escapeRawControlsInJsonStrings(s: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inString) {
      if (escaped) {
        out += c;
        escaped = false;
        continue;
      }
      if (c === "\\") {
        out += c;
        escaped = true;
        continue;
      }
      if (c === '"') {
        out += c;
        inString = false;
        continue;
      }
      if (c === "\n") {
        out += "\\n";
        continue;
      }
      if (c === "\r") {
        out += "\\r";
        continue;
      }
      if (c === "\t") {
        out += "\\t";
        continue;
      }
      out += c;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    out += c;
  }
  return out;
}

export function convertStructuralSmartQuotes(s: string): string {
  const text = String(s || "");
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const isOpen = c === "\u201C" || c === "\u201E" || c === "\u201F";
    const isClose = c === "\u201D" || c === "\u2033" || c === "\u2036";
    if (!isOpen && !isClose) {
      out += c;
      continue;
    }
    let prev = i - 1;
    while (prev >= 0 && /\s/.test(text[prev]!)) prev -= 1;
    let next = i + 1;
    while (next < text.length && /\s/.test(text[next]!)) next += 1;
    const prevCh = prev >= 0 ? text[prev]! : "";
    const nextCh = next < text.length ? text[next]! : "";
    const afterOpen = !prevCh || "{[:,[".includes(prevCh);
    const beforeClose = !nextCh || ":,}]".includes(nextCh);
    if (isOpen && afterOpen) out += '"';
    else if (isClose && beforeClose) out += '"';
    else out += c;
  }
  return out;
}

export function softenJsonText(s: string): string {
  let t = String(s || "")
    .replace(/^\uFEFF/, "")
    .replace(/\u2026/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  t = t.replace(/^\s*\/\/.*$/gm, "");
  t = t.replace(/\/\*[\s\S]*?\*\//g, "");
  t = escapeRawControlsInJsonStrings(t);
  t = t.replace(/,\s*([\]}])/g, "$1");
  return t;
}

export function repairTruncatedJsonObject(slice: string): string {
  let s = String(slice || "").trim();
  if (!s.startsWith("{")) return s;
  s = s.replace(/,\s*"[^"]*$/u, "");
  s = s.replace(/,\s*$/u, "");
  const opens = (s.match(/\{/g) || []).length;
  const closes = (s.match(/\}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length;
  const closeBrackets = (s.match(/\]/g) || []).length;
  const quoteCount = (s.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 === 1) s += '"';
  if (openBrackets > closeBrackets) s += "]".repeat(openBrackets - closeBrackets);
  if (opens > closes) s += "}".repeat(opens - closes);
  return s;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const PRODUCT_HINT_KEYS = [
  "outputs",
  "schema",
  "正文",
  "body",
  "技能",
  "workers",
  "steps",
  "brief",
  "追问",
] as const;

export function looksLikeProductJson(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return PRODUCT_HINT_KEYS.some((k) => k in row);
}

function parseSlice(slice: string): unknown {
  return (
    tryParse(slice) ??
    tryParse(softenJsonText(slice)) ??
    tryParse(softenJsonText(convertStructuralSmartQuotes(slice))) ??
    tryParse(repairTruncatedJsonObject(slice)) ??
    tryParse(softenJsonText(repairTruncatedJsonObject(slice)))
  );
}

/** 思维链末尾常整段 JSON；从后往前找像产物的对象，避免吃进前面的举例 `{ }` */
export function extractLastProductJson(text: string): unknown {
  const s = String(text || "");
  const starts: number[] = [];
  for (let i = s.length - 1; i >= 0 && starts.length < 8; i--) {
    if (s[i] === "{") starts.push(i);
  }
  let fallback: unknown = null;
  for (const start of starts) {
    const slice = s.slice(start);
    const end = slice.lastIndexOf("}");
    if (end < 1) continue;
    const parsed = parseSlice(slice.slice(0, end + 1));
    if (parsed == null) continue;
    if (looksLikeProductJson(parsed)) return parsed;
    if (fallback == null) fallback = parsed;
  }
  return fallback;
}

/** 模型常把弯引号写进字符串；必须先按原文 parse，再做宽松修复 */
export function tryParseJsonDoc(text: string): unknown {
  const stripped = stripCodeFences(text);
  const attempts = [
    stripped,
    softenJsonText(stripped),
    softenJsonText(convertStructuralSmartQuotes(stripped)),
  ];
  for (const candidate of attempts) {
    const parsed = tryParse(candidate);
    if (parsed != null) return parsed;
  }

  const cleaned = softenJsonText(convertStructuralSmartQuotes(stripped));
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    const inner = tryParse(cleaned);
    if (typeof inner === "string") {
      const parsed = tryParse(softenJsonText(inner)) ?? tryParse(inner);
      if (parsed != null) return parsed;
    }
  }

  const fromTail = extractLastProductJson(stripped) ?? extractLastProductJson(cleaned);
  if (fromTail != null) return fromTail;

  const arrStart = cleaned.indexOf("[");
  const arrEnd = cleaned.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    const parsed = tryParse(cleaned.slice(arrStart, arrEnd + 1));
    if (parsed != null) return parsed;
  }
  return null;
}

/**
 * 正文可能是闲聊/英文收束，JSON 在思维链里。
 * 能 parse 的一边优先；两边都能 parse 时用更像产物的那边。
 */
export function selectJsonPayload(content: string, reasoning?: string): string {
  const body = String(content ?? "").trim();
  const think = String(reasoning ?? "").trim();
  const fromBody = body ? tryParseJsonDoc(body) : null;
  const fromThink = think ? tryParseJsonDoc(think) : null;
  const bodyOk = fromBody != null && typeof fromBody === "object";
  const thinkOk = fromThink != null && typeof fromThink === "object";
  if (bodyOk && thinkOk) {
    if (looksLikeProductJson(fromThink) && !looksLikeProductJson(fromBody)) {
      return think;
    }
    return body;
  }
  if (bodyOk) return body;
  if (thinkOk) return think;
  return body || think;
}
