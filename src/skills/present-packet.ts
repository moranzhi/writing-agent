/**
 * 游玩呈现包 present.v1 + 从「设计.正文组成」解析壳适配。
 * 规范：docs/play-presentation-shells.md
 */
import { extractJsonObjectText } from "./worker-set-parse.js";

export const PRESENT_SCHEMA = "present.v1" as const;
export const PRESENT_TAG = "输出.用户展示";

export const PRESENT_SHELL_IDS = [
  "prose",
  "chat_monitor",
  "spotlight",
  "turn_panel",
  "split_board",
  "choice_dock",
  "chapter_reader",
] as const;

export type PresentShellId = (typeof PRESENT_SHELL_IDS)[number];

export type PresentRegionId =
  | "monitor"
  | "header"
  | "body"
  | "footer"
  | "aside"
  | "hidden";

export type PresentShellTweaks = {
  tone_chrome?: string;
  show_suggested_actions?: boolean;
  block_labels?: Record<string, string>;
  empty_states?: Record<string, string>;
};

export type ShellAdaptation = {
  shell_id: PresentShellId;
  why?: string;
  tweaks: PresentShellTweaks;
};

export type PresentBlocks = Partial<
  Record<PresentRegionId, string | Record<string, unknown> | unknown[]>
>;

export type PresentPacket = {
  schema: typeof PRESENT_SCHEMA;
  shell: PresentShellId;
  blocks: PresentBlocks;
  meta?: {
    suggested_actions?: string[];
    hide?: string[];
  };
};

export type PresentPacketView = {
  ok: boolean;
  parseError?: string;
  packet: PresentPacket;
  /** 原文不是 JSON 时回退为 prose body */
  fallbackPlain: boolean;
};

const SHELL_SET = new Set<string>(PRESENT_SHELL_IDS);

export function isPresentShellId(v: unknown): v is PresentShellId {
  return typeof v === "string" && SHELL_SET.has(v);
}

export function defaultShellTweaks(
  shell: PresentShellId,
): PresentShellTweaks {
  return {
    tone_chrome: "default",
    show_suggested_actions: shell === "turn_panel" || shell === "choice_dock",
    block_labels: {},
    empty_states: {},
  };
}

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function asStringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => asString(x)).filter((x): x is string => Boolean(x));
  return out.length ? out : undefined;
}

function asStringMap(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const key = k.trim();
    const s = asString(val);
    if (key && s) out[key] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

export function normalizePresentShellId(
  raw: unknown,
  fallback: PresentShellId = "prose",
): PresentShellId {
  if (isPresentShellId(raw)) return raw;
  const s = asString(raw);
  if (s && isPresentShellId(s)) return s;
  return fallback;
}

function normalizeBlocks(raw: unknown): PresentBlocks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  const out: PresentBlocks = {};
  const keys: PresentRegionId[] = [
    "monitor",
    "header",
    "body",
    "footer",
    "aside",
    "hidden",
  ];
  for (const k of keys) {
    if (row[k] !== undefined) out[k] = row[k] as PresentBlocks[typeof k];
  }
  // 兼容中文键
  if (out.body === undefined && row.正文 !== undefined) out.body = row.正文 as string;
  if (out.monitor === undefined && row.监控 !== undefined) {
    out.monitor = row.监控 as PresentBlocks["monitor"];
  }
  if (typeof out.body === "string") {
    out.body = stripPresentSourceFences(out.body);
  }
  return out;
}

export function normalizePresentPacket(
  row: Record<string, unknown>,
  fallbackShell: PresentShellId = "prose",
): PresentPacket {
  const shell = normalizePresentShellId(
    row.shell ?? row.shell_id ?? row.呈现壳,
    fallbackShell,
  );
  return {
    schema: PRESENT_SCHEMA,
    shell,
    blocks: normalizeBlocks(row.blocks ?? row.区域),
    meta: {
      suggested_actions: asStringList(
        row.meta && typeof row.meta === "object"
          ? (row.meta as Record<string, unknown>).suggested_actions ??
              (row.meta as Record<string, unknown>).建议行动
          : row.suggested_actions,
      ),
      hide: asStringList(
        row.meta && typeof row.meta === "object"
          ? (row.meta as Record<string, unknown>).hide
          : undefined,
      ),
    },
  };
}

export function presentFromPlainText(
  text: string,
  shell: PresentShellId = "prose",
): PresentPacket {
  return {
    schema: PRESENT_SCHEMA,
    shell,
    blocks: { body: stripPresentSourceFences(text) },
  };
}

/** 模型常把 tag 名写进正文开头；展示前剥掉 */
export function stripPresentSourceFences(raw: string): string {
  let s = raw.trim();
  for (let i = 0; i < 3; i += 1) {
    const next = s
      .replace(/^(#{1,6}\s*)?输出[.:：]?\s*(用户展示|开场白)(?:\s*\n+|\s*$)/u, "")
      .replace(/^【\s*输出[.:：]?\s*(用户展示|开场白)\s*】(?:\s*\n+|\s*$)/u, "")
      .trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

export const PLAY_VISIBLE_BODY_INSTRUCTION = [
  "用户可见正文（present.v1 的 blocks.body，或纯 Markdown 主读）默认 **500～2000 字**（按汉字计）。",
  "不要写成几句气泡短信就结束，除非用户明确要求极短。",
  "禁止把 tag 名（如「输出.用户展示」）、压缩摘要、过程日志写进正文。",
].join("\n");

export function parsePresentPacket(
  raw: string | undefined | null,
  fallbackShell: PresentShellId = "prose",
): PresentPacketView {
  const text = stripPresentSourceFences(raw?.trim() ?? "");
  if (!text) {
    return {
      ok: true,
      packet: presentFromPlainText("", fallbackShell),
      fallbackPlain: true,
    };
  }

  const jsonText =
    extractJsonObjectText(text) ?? (text.startsWith("{") ? text : null);
  if (!jsonText) {
    return {
      ok: true,
      packet: presentFromPlainText(text, fallbackShell),
      fallbackPlain: true,
    };
  }

  try {
    const doc = JSON.parse(jsonText) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      return {
        ok: true,
        packet: presentFromPlainText(text, fallbackShell),
        fallbackPlain: true,
      };
    }
    const row = doc as Record<string, unknown>;
    // 明确 present 或带 blocks/shell 的展示包
    const looksPresent =
      row.schema === PRESENT_SCHEMA ||
      row.blocks != null ||
      isPresentShellId(row.shell) ||
      isPresentShellId(row.shell_id);
    if (!looksPresent && row.schema) {
      // 其它 schema（如 settlement）不当作 present
      return {
        ok: true,
        packet: presentFromPlainText(text, fallbackShell),
        fallbackPlain: true,
      };
    }
    const packet = normalizePresentPacket(row, fallbackShell);
    if (
      packet.blocks.body === undefined &&
      !packet.blocks.monitor &&
      !packet.blocks.header
    ) {
      // JSON 但无区域 → 整段当 body 说明
      if (!looksPresent) {
        return {
          ok: true,
          packet: presentFromPlainText(text, fallbackShell),
          fallbackPlain: true,
        };
      }
    }
    return { ok: true, packet, fallbackPlain: false };
  } catch (err) {
    return {
      ok: false,
      parseError: err instanceof Error ? err.message : "present JSON 解析失败",
      packet: presentFromPlainText(text, fallbackShell),
      fallbackPlain: true,
    };
  }
}

export function isPresentLikeObject(doc: unknown): boolean {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  const row = doc as Record<string, unknown>;
  if (row.schema === PRESENT_SCHEMA) return true;
  if (isPresentShellId(row.shell) && row.blocks != null) return true;
  return false;
}

/**
 * 从「设计.正文组成」context-fragment 解析壳适配。
 */
export function parseShellAdaptationFromReplyFormat(
  raw: string | undefined | null,
): ShellAdaptation | undefined {
  if (!raw?.trim()) return undefined;
  const jsonText =
    extractJsonObjectText(raw) ?? (raw.trim().startsWith("{") ? raw.trim() : null);
  if (!jsonText) return undefined;
  try {
    const doc = JSON.parse(jsonText) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return undefined;
    const row = doc as Record<string, unknown>;
    const body =
      row.正文 && typeof row.正文 === "object" && !Array.isArray(row.正文)
        ? (row.正文 as Record<string, unknown>)
        : row;
    const shellBox =
      body.呈现壳 && typeof body.呈现壳 === "object" && !Array.isArray(body.呈现壳)
        ? (body.呈现壳 as Record<string, unknown>)
        : body.shell && typeof body.shell === "object"
          ? (body.shell as Record<string, unknown>)
          : body;

    const shellId = normalizePresentShellId(
      shellBox.shell_id ?? shellBox.shellId ?? body.shell_id ?? body.shell,
      "prose",
    );
    // 若正文组成完全没提壳，且也不是明确 prose 局，仍返回 prose 默认
    const tweaksRaw =
      shellBox.微调 && typeof shellBox.微调 === "object"
        ? (shellBox.微调 as Record<string, unknown>)
        : shellBox.tweaks && typeof shellBox.tweaks === "object"
          ? (shellBox.tweaks as Record<string, unknown>)
          : {};
    const base = defaultShellTweaks(shellId);
    return {
      shell_id: shellId,
      why: asString(shellBox.为何选它 ?? shellBox.why),
      tweaks: {
        tone_chrome:
          asString(tweaksRaw.tone_chrome) ?? base.tone_chrome,
        show_suggested_actions:
          typeof tweaksRaw.show_suggested_actions === "boolean"
            ? tweaksRaw.show_suggested_actions
            : base.show_suggested_actions,
        block_labels:
          asStringMap(tweaksRaw.block_labels) ?? base.block_labels,
        empty_states:
          asStringMap(tweaksRaw.empty_states) ?? base.empty_states,
      },
    };
  } catch {
    return undefined;
  }
}

/** 区域是否应在该壳默认展示（无内容时可按 empty_states 显示） */
export function shellDefaultRegions(
  shell: PresentShellId,
): PresentRegionId[] {
  switch (shell) {
    case "chat_monitor":
      return ["monitor", "body", "footer"];
    case "spotlight":
      return ["monitor", "body", "footer"];
    case "turn_panel":
      return ["monitor", "header", "body", "aside", "footer"];
    case "split_board":
      return ["header", "body", "aside", "footer"];
    case "choice_dock":
      return ["monitor", "body", "footer"];
    case "chapter_reader":
      return ["header", "body", "aside", "footer"];
    case "prose":
    default:
      return ["body", "footer"];
  }
}

export function formatPresentBlockContent(
  value: string | Record<string, unknown> | unknown[] | undefined,
): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .filter(Boolean)
      .join("\n");
  }
  // 监控键值 → 短行
  return Object.entries(value)
    .map(([k, v]) => `${k}：${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
}
