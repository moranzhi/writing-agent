/** 剥 markdown 代码围栏，便于从验收正文里取出 JSON */
export function stripCodeFences(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json|yaml|yml)?\s*\r?\n?/i, "");
  t = t.replace(/\r?\n?```\s*$/i, "");
  const fenced = t.match(/```(?:json|yaml|yml)?\s*\r?\n([\s\S]*?)\r?\n```/i);
  if (fenced) t = fenced[1].trim();
  return t.trim();
}

/** 字符串字面量里的裸换行/制表 → 转义（模型常犯） */
export function escapeRawControlsInJsonStrings(s) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
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

/**
 * 只把「像 JSON 定界符」的弯引号换成 ASCII。
 * 字符串内部的 “对话/强调” 必须保留，否则会把合法 JSON 撕开。
 */
export function convertStructuralSmartQuotes(s) {
  const text = String(s || "");
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const isOpen = c === "\u201C" || c === "\u201E" || c === "\u201F";
    const isClose = c === "\u201D" || c === "\u2033" || c === "\u2036";
    if (!isOpen && !isClose) {
      out += c;
      continue;
    }
    let prev = i - 1;
    while (prev >= 0 && /\s/.test(text[prev])) prev -= 1;
    let next = i + 1;
    while (next < text.length && /\s/.test(text[next])) next += 1;
    const prevCh = prev >= 0 ? text[prev] : "";
    const nextCh = next < text.length ? text[next] : "";
    const afterOpen = !prevCh || "{[:,[".includes(prevCh);
    const beforeClose = !nextCh || ":,}]".includes(nextCh);
    if (isOpen && afterOpen) out += '"';
    else if (isClose && beforeClose) out += '"';
    else out += c;
  }
  return out;
}

/** 轻度修复模型常出的尾逗号 / 裸换行；不要全局替换弯引号 */
export function softenJsonText(s) {
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

/** 截断的 {… 补齐引号/括号，便于验收卡仍能出 mosaic */
export function repairTruncatedJsonObject(slice) {
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

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 模型常把弯引号写进字符串；必须先按原文 parse，再做宽松修复 */
export function tryParseJsonDoc(text) {
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

  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    const slice = cleaned.slice(objStart, objEnd + 1);
    const parsed =
      tryParse(slice) ??
      tryParse(softenJsonText(slice)) ??
      tryParse(repairTruncatedJsonObject(slice)) ??
      tryParse(softenJsonText(repairTruncatedJsonObject(cleaned.slice(objStart))));
    if (parsed != null) return parsed;

    const rawSlice = stripped.slice(
      stripped.indexOf("{"),
      stripped.lastIndexOf("}") + 1,
    );
    const fromRaw = tryParse(rawSlice) ?? tryParse(repairTruncatedJsonObject(rawSlice));
    if (fromRaw != null) return fromRaw;
  }

  const arrStart = cleaned.indexOf("[");
  const arrEnd = cleaned.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    const parsed = tryParse(cleaned.slice(arrStart, arrEnd + 1));
    if (parsed != null) return parsed;
  }
  return null;
}
