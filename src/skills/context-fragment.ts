/**
 * 上下文片段产物（context-fragment.v1）解析与展示辅助。
 * 规范：docs/context-fragment-design.md
 */
import { tryParseJsonDoc } from "../parse/json-doc.js";
import {
  normalizeQuestions,
  type QuestionItem,
} from "./question-protocol.js";

export const CONTEXT_FRAGMENT_SCHEMA = "context-fragment.v1" as const;

export type ContextFragmentStability = "stable" | "semi" | "volatile";

export type ContextFragment = {
  schema: typeof CONTEXT_FRAGMENT_SCHEMA;
  技能: string;
  brief: string;
  mount: string[];
  稳变?: ContextFragmentStability;
  正文: unknown;
  开放问题: string[];
};

export type ContextFragmentView = {
  ok: boolean;
  parseError?: string;
  fragment?: ContextFragment;
  sections: Array<{ title: string; lines: string[] }>;
};

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asString(x)).filter((x): x is string => Boolean(x));
}

/** 自评分数展示：0–10；兼容旧百分数 */
function formatSelfScoreLabel(score: unknown): string {
  if (typeof score === "number" && Number.isFinite(score)) {
    if (score >= 0 && score <= 10) {
      const shown = Number.isInteger(score) ? String(score) : String(Math.round(score * 10) / 10);
      return `${shown}/10`;
    }
    if (score > 10 && score <= 100) {
      const ten = Math.round((score / 10) * 10) / 10;
      const shown = Number.isInteger(ten) ? String(ten) : String(ten);
      return `${shown}/10`;
    }
  }
  if (typeof score === "string" && score.trim()) {
    const s = score.trim();
    if (/\/\s*10$/i.test(s)) return s.replace(/\s+/g, "");
    const n = Number(s.replace(/%$/, ""));
    if (Number.isFinite(n)) return formatSelfScoreLabel(n);
    return s;
  }
  return "?";
}

function normalizeStability(v: unknown): ContextFragmentStability | undefined {
  if (v === "stable" || v === "semi" || v === "volatile") return v;
  if (v === "稳" || v === "少变") return "stable";
  if (v === "中" || v === "偶发") return "semi";
  if (v === "变" || v === "常变") return "volatile";
  return undefined;
}

/** 从任意 JSON 文本或对象解析片段；兼容无 schema 但含 brief+正文 的旧形 */
export function parseContextFragment(raw: unknown): ContextFragment | undefined {
  let row: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    const parsed = tryParseJsonDoc(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      row = parsed as Record<string, unknown>;
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    row = raw as Record<string, unknown>;
  }
  if (!row) return undefined;

  const hasSchema = row.schema === CONTEXT_FRAGMENT_SCHEMA;
  const hasBody = "正文" in row || "body" in row;
  const brief = asString(row.brief) ?? asString(row.概要);
  if (!hasSchema && !(brief && hasBody)) return undefined;

  const skill =
    asString(row.技能) ?? asString(row.skill) ?? asString(row.name) ?? "";
  const 正文 = row.正文 !== undefined ? row.正文 : row.body !== undefined ? row.body : {};
  const mount = asStringList(row.mount ?? row.挂载);
  const 开放问题 = asStringList(row.开放问题 ?? row.open_questions);

  return {
    schema: CONTEXT_FRAGMENT_SCHEMA,
    技能: skill,
    brief: brief ?? "",
    mount,
    稳变: normalizeStability(row.稳变 ?? row.stability),
    正文,
    开放问题,
  };
}

export function isContextFragmentDoc(doc: unknown): boolean {
  return Boolean(parseContextFragment(doc));
}

const NON_FRAGMENT_DESIGN_TAGS = new Set([
  "设计.创作流程",
  "设计.worker集",
  "设计.worker集.草稿",
  "设计.worker规格",
  "设计.上下文投影排序",
]);

/** 该 output tag 应按 context-fragment.v1 验收（有可用「正文」） */
export function expectsContextFragmentTag(tag: string): boolean {
  const t = tag.trim();
  if (!t.startsWith("设计.")) return false;
  return !NON_FRAGMENT_DESIGN_TAGS.has(t);
}

export function hasUsableFragmentBody(body: unknown): boolean {
  if (body == null) return false;
  if (typeof body === "string") return body.trim().length > 0;
  if (Array.isArray(body)) return body.length > 0;
  if (typeof body === "object") return Object.keys(body as object).length > 0;
  return false;
}

/** 能进验收卡：解析成功且「正文」非空 */
export function isUsableContextFragment(raw: unknown): boolean {
  const frag = parseContextFragment(raw);
  return Boolean(frag && hasUsableFragmentBody(frag.正文));
}

export function looksLikeFragmentDoc(doc: unknown): boolean {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  const row = doc as Record<string, unknown>;
  if (row.schema === CONTEXT_FRAGMENT_SCHEMA) return true;
  if (typeof row.技能 === "string" && row.技能.trim()) return true;
  return (
    typeof row.brief === "string" &&
    ("正文" in row || "body" in row)
  );
}

/** 投影级别：summary 优先 brief；fields 尝试列出正文顶层键 */
export function projectFragmentContent(
  raw: string,
  projection: string,
): string {
  const frag = parseContextFragment(raw);
  const mode = projection.trim().toLowerCase();
  if (!frag) {
    if ((mode === "summary" || mode === "brief" || mode === "index") && raw.length > 800) {
      return `${raw.slice(0, 800)}…`;
    }
    return raw;
  }
  if (mode === "summary" || mode === "brief") {
    return frag.brief || raw;
  }
  if (mode === "index") {
    const lines: string[] = [];
    if (frag.技能) lines.push(`技能：${frag.技能}`);
    if (frag.brief) lines.push(frag.brief);
    if (frag.mount.length) lines.push(`挂载：${frag.mount.join("、")}`);
    if (frag.稳变) lines.push(`稳变：${frag.稳变}`);
    return lines.join("\n") || frag.brief || raw;
  }
  if (mode === "fields") {
    if (frag.正文 && typeof frag.正文 === "object" && !Array.isArray(frag.正文)) {
      const keys = Object.keys(frag.正文 as object);
      return [`brief: ${frag.brief}`, `字段: ${keys.join("、") || "（无）"}`].join("\n");
    }
    return frag.brief || raw;
  }
  if (mode === "fixed") {
    return frag.brief || raw;
  }
  // full
  return JSON.stringify(
    {
      schema: frag.schema,
      技能: frag.技能,
      brief: frag.brief,
      mount: frag.mount,
      稳变: frag.稳变,
      正文: frag.正文,
      开放问题: frag.开放问题,
    },
    null,
    2,
  );
}

export function contextFragmentToView(raw: unknown): ContextFragmentView {
  const fragment = parseContextFragment(raw);
  if (!fragment) {
    return { ok: false, parseError: "无法解析为 context-fragment.v1", sections: [] };
  }
  const sections: Array<{ title: string; lines: string[] }> = [];
  if (fragment.brief) sections.push({ title: "概要", lines: [fragment.brief] });
  const meta: string[] = [];
  if (fragment.技能) meta.push(`技能：${fragment.技能}`);
  if (fragment.mount.length) meta.push(`挂载：${fragment.mount.join("、")}`);
  if (fragment.稳变) meta.push(`稳变：${fragment.稳变}`);
  if (meta.length) sections.push({ title: "挂载", lines: meta });

  if (fragment.正文 != null && fragment.正文 !== "") {
    if (typeof fragment.正文 === "string") {
      sections.push({ title: "正文", lines: [fragment.正文] });
    } else if (typeof fragment.正文 === "object") {
      const lines = flattenObjectLines(fragment.正文, 0, 4);
      if (lines.length) sections.push({ title: "正文", lines });
    }
  }
  const rawDoc =
    typeof raw === "object" && raw && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  const selfScore = rawDoc?.自评;
  if (selfScore && typeof selfScore === "object" && !Array.isArray(selfScore)) {
    const row = selfScore as Record<string, unknown>;
    const dims = Array.isArray(row.维度) ? row.维度 : [];
    const lines = dims.map((d) => {
      if (!d || typeof d !== "object") return String(d);
      const r = d as Record<string, unknown>;
      return `${r.名 ?? "?"}：${formatSelfScoreLabel(r.分数)}${r.说明 ? ` — ${r.说明}` : ""}`;
    });
    if (typeof row.薄弱点 === "string" && row.薄弱点.trim()) {
      lines.push(`薄弱点：${row.薄弱点.trim()}`);
    }
    if (lines.length) sections.push({ title: "自评", lines });
  }
  const probe = rawDoc?.追问;
  if (probe && typeof probe === "object" && !Array.isArray(probe)) {
    const row = probe as Record<string, unknown>;
    const qs = Array.isArray(row.题目) ? row.题目 : [];
    const lines: string[] = [];
    if (qs.length && typeof row.导语 === "string" && row.导语.trim()) {
      lines.push(row.导语.trim());
    }
    qs.forEach((q, i) => {
      if (!q || typeof q !== "object") return;
      const r = q as Record<string, unknown>;
      lines.push(`${i + 1}. ${r.问 ?? "?"}`);
      if (Array.isArray(r.建议选项) && r.建议选项.length) {
        lines.push(`选项：${r.建议选项.map(String).join(" / ")}`);
      }
      if (typeof r.示例 === "string" && r.示例.trim()) {
        lines.push(`示例：${r.示例.trim()}`);
      }
    });
    if (lines.length) sections.push({ title: "追问", lines });
  }
  if (fragment.开放问题.length) {
    sections.push({ title: "开放问题", lines: fragment.开放问题 });
  }
  return { ok: true, fragment, sections };
}

/** 从片段 JSON 抽出追问→询问卡；自评→评估导语（供验收挂载） */
export function extractFragmentAskSidecar(raw: unknown): {
  questions: QuestionItem[];
  assessment: string;
} {
  let row: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    const parsed = tryParseJsonDoc(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      row = parsed as Record<string, unknown>;
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    row = raw as Record<string, unknown>;
  }
  if (!row) return { questions: [], assessment: "" };

  const looksFragment =
    row.schema === CONTEXT_FRAGMENT_SCHEMA ||
    typeof row.技能 === "string" ||
    (typeof row.brief === "string" &&
      ("正文" in row || "body" in row || "追问" in row));
  if (!looksFragment) return { questions: [], assessment: "" };

  const assessmentParts: string[] = [];
  const selfScore = row.自评;
  if (selfScore && typeof selfScore === "object" && !Array.isArray(selfScore)) {
    const sc = selfScore as Record<string, unknown>;
    const dims = Array.isArray(sc.维度) ? sc.维度 : [];
    for (const d of dims) {
      if (!d || typeof d !== "object") continue;
      const r = d as Record<string, unknown>;
      const name = asString(r.名) ?? asString(r.维度) ?? "?";
      const score = r.分数;
      const note = asString(r.说明);
      const scoreText = formatSelfScoreLabel(score);
      assessmentParts.push(
        note ? `${name} ${scoreText} — ${note}` : `${name} ${scoreText}`,
      );
    }
    const weak = asString(sc.薄弱点);
    if (weak) assessmentParts.push(`薄弱点：${weak}`);
  }

  const probe = row.追问;
  const rawQs: unknown[] = [];
  let lead = "";
  if (probe && typeof probe === "object" && !Array.isArray(probe)) {
    const p = probe as Record<string, unknown>;
    lead = asString(p.导语) ?? "";
    const topics = Array.isArray(p.题目) ? p.题目 : [];
    for (let i = 0; i < topics.length; i++) {
      const t = topics[i];
      if (!t || typeof t !== "object") continue;
      const q = t as Record<string, unknown>;
      const prompt = asString(q.问) ?? asString(q.prompt);
      if (!prompt) continue;
      const opts = Array.isArray(q.建议选项)
        ? q.建议选项
        : Array.isArray(q.options)
          ? q.options
          : [];
      const example = asString(q.示例);
      const optLabels = opts
        .map((o) => {
          if (typeof o === "string") return o.trim();
          if (o && typeof o === "object") {
            const r = o as Record<string, unknown>;
            return asString(r.label) ?? asString(r.文案) ?? asString(r.text) ?? "";
          }
          return String(o ?? "").trim();
        })
        .filter(Boolean);
      // 建议选项 → 选择题；示例并入题干提示，便于 ask 卡展示
      rawQs.push({
        id: `frag-q${i + 1}`,
        prompt: example ? `${prompt}\n示例：${example}` : prompt,
        options: optLabels,
        allowOther: true,
        required: false,
      });
    }
  }
  // 开放问题兜底成无选项追问
  const openQs = asStringList(row.开放问题);
  if (!rawQs.length && openQs.length) {
    for (let i = 0; i < openQs.length; i++) {
      rawQs.push({
        id: `frag-open${i + 1}`,
        prompt: openQs[i],
        allowOther: true,
        required: false,
      });
    }
  }

  const questions = normalizeQuestions(rawQs);
  const assessment = [
    questions.length ? lead : "",
    ...assessmentParts,
  ]
    .filter(Boolean)
    .join("\n");
  return { questions, assessment };
}

function flattenObjectLines(value: unknown, depth: number, maxDepth: number): string[] {
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    if (!value.length) return ["（空）"];
    return value.flatMap((v, i) => {
      if (v == null || typeof v !== "object") return [String(v)];
      const row = v as Record<string, unknown>;
      const title =
        [row.名, row.显示名, row.块id, row.rule_id, row.id, row.映射id, row.段id]
          .find((x) => typeof x === "string" && x.trim()) ?? `#${i + 1}`;
      const nested = flattenObjectLines(v, depth + 1, maxDepth);
      if (depth + 1 >= maxDepth) {
        const summary = Object.entries(row)
          .filter(([, x]) => x != null && x !== "" && typeof x !== "object")
          .slice(0, 4)
          .map(([k, x]) => `${k}=${x}`)
          .join(" · ");
        return [`${title}${summary ? `（${summary}）` : ""}`];
      }
      return [`【${title}】`, ...nested.map((line) => `  ${line}`)];
    });
  }
  if (typeof value === "object" && depth < maxDepth) {
    const out: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v == null || v === "") continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out.push(`${k}：${v}`);
      } else if (Array.isArray(v) || typeof v === "object") {
        out.push(`${k}：`);
        for (const line of flattenObjectLines(v, depth + 1, maxDepth)) {
          out.push(`  ${line}`);
        }
      } else {
        out.push(`${k}：${String(v)}`);
      }
    }
    return out;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    return [`（嵌套 ${keys.length} 键：${keys.slice(0, 8).join("、")}${keys.length > 8 ? "…" : ""}）`];
  }
  return [String(value)];
}
