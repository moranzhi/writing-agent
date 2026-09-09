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
  "用户可见正文（主世界层：纯 Markdown；转述：present.v1 的 blocks.body，或纯 Markdown 主读）默认 **1000～2000 字**（按汉字计）；以「设计.监控栏／回复呈现」已钉字数为准。",
  "采用完整长自然段叙述，不要单句成段。",
  "不要写成几句气泡短信就结束，除非用户明确要求极短。",
  "禁止把 tag 名（如「输出.用户展示」）、压缩摘要、过程日志写进正文。",
].join("\n");

/**
 * 游玩期走 present.v1 结构化投递的执行单元（转述 / 回合陈述）。
 * 主世界层不在此列：始终自由写 Markdown 正文。
 */
export function isPlayPresentWorker(workerId: string): boolean {
  const id = workerId.trim();
  return id === "narrator" || id === "round-present";
}

/**
 * 本轮最终用户可见正文的执行单元（写入对话.历史 / 空产物兜底）。
 * 无转述：主世界层；有转述：转述（主世界草稿可被覆盖，不进历史）。
 */
export function isPlayFinalVisibleWorker(
  workerId: string,
  opts?: { narratorEnabled?: boolean },
): boolean {
  const id = workerId.trim();
  if (id === "narrator" || id === "round-present") return true;
  if (id === "world-simulator" && opts?.narratorEnabled !== true) return true;
  return false;
}

/** 游玩主世界层：自由 Markdown 正文（程序可事后落入 present 壳，模型不交 JSON） */
export function isPlayGmBodyWorker(workerId: string): boolean {
  return workerId.trim() === "world-simulator";
}

/** 按能力探测走 json_schema / forced_tool 时用的 present.v1 形状（全 required，可 strict） */
export const PRESENT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schema", "shell", "blocks", "meta"],
  properties: {
    schema: { type: "string" },
    shell: { type: "string" },
    blocks: {
      type: "object",
      additionalProperties: false,
      required: ["body", "monitor", "header", "footer", "aside"],
      properties: {
        body: { type: "string" },
        monitor: { type: "string" },
        header: { type: "string" },
        footer: { type: "string" },
        aside: { type: "string" },
      },
    },
    meta: {
      type: "object",
      additionalProperties: false,
      required: ["suggested_actions"],
      properties: {
        suggested_actions: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
};

/** 游玩主世界层：直接写 Markdown，禁止 JSON 裁决包 */
export function playGmBodyOutputInstruction(): string {
  return `

---

## 运行时输出协议（主世界正文）

直接输出本轮 **Markdown / 自然语言故事正文**（写入「输出.用户展示」）。
不要输出 JSON、不要交 settlement/裁决包、不要套 present.v1 外壳。
重心在场面推进与人物扮演；残稿也可以交，有转述时会再处理。
不要写追问、askUser、自评或「可验收产物」。`;
}

/** 游玩转述：按探测到的 structured 投递写出 present.v1，不要创作追问 */
export function playPresentOutputInstruction(shell: PresentShellId): string {
  return `

---

## 运行时输出协议（游玩终稿）

本步读主世界层已写正文，产出给用户看的终稿。程序按已探测的模型能力用 schema / tool / json_object 投递，你输出 **一个 present.v1 对象**：

{"schema":"present.v1","shell":"${shell}","blocks":{"body":"用户可读正文","monitor":"","header":"","footer":"","aside":""},"meta":{"suggested_actions":[]}}

\`shell\` 必须是 \`${shell}\`。只填该壳已有区域，没有的键留空字符串。
prose 壳也可直接输出 Markdown，程序会落入 body。
可补全残缺叙述与版式，但不得改剧情事实。不要写追问、askUser、自评或「可验收产物」。`;
}

export function stringifyPresentPacket(packet: PresentPacket): string {
  return JSON.stringify(packet);
}

export function presentOutputFromFallback(
  text: string,
  shell: PresentShellId = "prose",
): string {
  const body = stripPresentSourceFences(text).trim() || "（本轮场面未写完）";
  return stringifyPresentPacket(presentFromPlainText(body, shell));
}

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
