/**
 * 用户代入名片写在「设计.主角设定」；开场白只留叙事。
 * 旧稿若把名字/简介塞进开场 meta，读取时仍可回退，并建议提升到主角设定节点。
 * 用户选用后只覆盖本局 @玩家 / @人设，不写进全局角色列表。
 */
import type { Blackboard } from "../blackboard/blackboard.js";
import {
  CREATION_PLACEHOLDER_NAME,
  personaForLifecycle,
  type PersonaDirective,
} from "./store.js";
import {
  OPENING_PERSONA_CHOICE_TAG,
  OPENING_PERSONA_TAG,
  OPENING_PRODUCT_FAMILY,
  OPENING_SETUP_ARTIFACT_TAG,
  parseOpeningSealPayload,
  readSealedOpeningPersona,
  splitOpeningDocument,
  type OpeningUserPersona,
} from "../skills/opening-seal.js";
import {
  buildRepeatableProductTag,
  dictateProductFamily,
  dictateProductSlot,
} from "../dictate/repeatable-tags.js";

export const PROTAGONIST_TAG = "设计.主角设定";

/** 对话落盘额外可增殖族（catalog 未标 repeatable 的简化 tag） */
export const DICTATE_OPENING_REPEATABLE_FAMILIES = [
  OPENING_PRODUCT_FAMILY,
  PROTAGONIST_TAG,
] as const;

/** 与开场同槽：设计.开场白#dorm → 设计.主角设定#dorm；无槽则基名 */
export function protagonistTagForOpeningSlot(openingTag: string): string {
  const family = dictateProductFamily(openingTag);
  if (family !== OPENING_PRODUCT_FAMILY && family !== OPENING_SETUP_ARTIFACT_TAG) {
    return PROTAGONIST_TAG;
  }
  const slot = dictateProductSlot(openingTag);
  return slot ? buildRepeatableProductTag(PROTAGONIST_TAG, slot) : PROTAGONIST_TAG;
}

/** 把开场/运行里的名字+简介收成可复制的「主角设定」产物。 */
export function protagonistFragmentFromPersona(
  persona: OpeningUserPersona,
): string {
  const background = persona.description.trim() || "未定";
  return JSON.stringify(
    {
      schema: "context-fragment.v1",
      技能: "主角设定",
      brief: `${persona.name} · 代入名片`,
      mount: ["world-simulator"],
      稳变: "stable",
      正文: {
        名字: persona.name,
        背景: background,
        特殊设定: { 身份: "无", 金手指: "无", 其它: "无" },
      },
      自评: {
        维度: [
          { 名: "可代入", 分数: 8, 说明: "由开场/用户原话收成" },
          { 名: "够用", 分数: 7, 说明: "简介作背景；特殊设定未另钉" },
        ],
        薄弱点: "特殊设定未展开",
      },
      追问: { 导语: "", 题目: [] },
      开放问题: [],
    },
    null,
    2,
  );
}

/** 黑板上尚无该 tag 的主角设定时写入（可指定开场同槽 tag）。 */
export function ensureProtagonistFromPersona(
  board: Blackboard,
  persona: OpeningUserPersona | null | undefined,
  tag: string = PROTAGONIST_TAG,
): boolean {
  if (!persona?.name?.trim()) return false;
  const writeTag = tag.trim() || PROTAGONIST_TAG;
  if (board.getContentByTag(writeTag)?.trim()) return false;
  board.write({
    tag: writeTag,
    content: protagonistFragmentFromPersona(persona),
    source: "runtime",
  });
  return true;
}

export function readProtagonistPersonaAt(
  board: Blackboard,
  tag: string = PROTAGONIST_TAG,
): OpeningUserPersona | null {
  const spec = parseProtagonistSpec(board.getContentByTag(tag));
  if (!spec) return null;
  return {
    name: spec.name,
    description: formatPersonaDescription(spec),
  };
}

/** 某条开场绑定的名片：同槽主角设定 → 基名主角设定 → 开场旧 meta */
export function personaBoundToOpening(
  board: Blackboard,
  openingTag: string,
  openingContent: string,
): OpeningUserPersona | null {
  const slotted = readProtagonistPersonaAt(
    board,
    protagonistTagForOpeningSlot(openingTag),
  );
  if (slotted) return slotted;
  if (dictateProductSlot(openingTag)) {
    const base = readProtagonistPersonaAt(board, PROTAGONIST_TAG);
    if (base) return base;
  }
  return splitOpeningDocument(openingContent).persona;
}

const RESERVED_NAMES = new Set(["@玩家", "用户", "主角", CREATION_PLACEHOLDER_NAME]);

export type ProtagonistSpec = {
  name: string;
  background: string;
  identity: string;
  cheat: string;
  extra: string;
};

export type SessionProtagonist = {
  name: string;
  description: string;
  summary: string;
};

export function parseProtagonistSpec(
  raw: string | null | undefined,
): ProtagonistSpec | null {
  const text = raw?.trim() ?? "";
  if (!text) return null;
  const fromJson = parseFromJson(text);
  if (fromJson) return fromJson;
  return parseFromProse(text);
}

export function readSessionProtagonist(
  board: Blackboard,
): SessionProtagonist | null {
  const sealed = readSealedOpeningPersona(
    board.getContentByTag(OPENING_PERSONA_TAG),
  );
  if (sealed) {
    return {
      name: sealed.name,
      description: sealed.description,
      summary: firstSentence(sealed.description),
    };
  }
  const spec = parseProtagonistSpec(board.getContentByTag(PROTAGONIST_TAG));
  if (spec) {
    return {
      name: spec.name,
      description: formatPersonaDescription(spec),
      summary: formatProtagonistSummary(spec),
    };
  }
  const fromOpening =
    parseOpeningSealPayload(board.getContentByTag("设计.开场白与开场变量"))
      ?.persona ??
    splitOpeningDocument(board.getContentByTag("设计.开场白")).persona;
  if (fromOpening) {
    return {
      name: fromOpening.name,
      description: fromOpening.description,
      summary: firstSentence(fromOpening.description),
    };
  }
  return null;
}

export function formatPersonaDescription(spec: ProtagonistSpec): string {
  const special: string[] = [];
  if (spec.identity && spec.identity !== "无") special.push(`身份：${spec.identity}`);
  if (spec.cheat && spec.cheat !== "无") special.push(`金手指：${spec.cheat}`);
  if (spec.extra && spec.extra !== "无") special.push(spec.extra);
  const parts: string[] = [];
  if (spec.background && spec.background !== "未定") {
    parts.push(`背景：${spec.background}`);
  }
  if (special.length) parts.push(`特殊设定：${special.join("；")}`);
  return parts.join("\n").trim();
}

export function formatProtagonistSummary(spec: ProtagonistSpec): string {
  const bits = [spec.identity, spec.cheat, spec.background]
    .map((s) => firstSentence(s))
    .filter((s) => s && s !== "无" && s !== "未定");
  return bits.slice(0, 2).join(" · ");
}

/** 用户选用开场预设后，用开场里的名字+简介替换 @玩家 / @人设。 */
export function overlayPlayPersona(
  stage: "design" | "play",
  board: Blackboard | null | undefined,
): PersonaDirective | null {
  const base = personaForLifecycle(stage);
  if (stage !== "play" || !board || !base) return base;
  const choice = board.getContentByTag(OPENING_PERSONA_CHOICE_TAG)?.trim();
  if (choice === "global") return base;
  const preset = readSessionProtagonist(board);
  if (!preset) return base;
  if (choice === "opening") {
    return {
      name: preset.name,
      description: preset.description || base.description,
    };
  }
  return base;
}

function parseFromJson(text: string): ProtagonistSpec | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced ? [fenced[1].trim(), text] : [text];
  for (const candidate of candidates) {
    let doc: unknown;
    try {
      doc = JSON.parse(candidate);
    } catch {
      continue;
    }
    const spec = specFromUnknown(doc);
    if (spec) return spec;
  }
  return null;
}

function specFromUnknown(doc: unknown): ProtagonistSpec | null {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const row = doc as Record<string, unknown>;
  const body =
    row.正文 && typeof row.正文 === "object" && !Array.isArray(row.正文)
      ? (row.正文 as Record<string, unknown>)
      : row;
  const name = readName(body.名字 ?? body.name);
  if (!name) return null;
  const special = body.特殊设定;
  const specialObj =
    special && typeof special === "object" && !Array.isArray(special)
      ? (special as Record<string, unknown>)
      : null;
  const specialText = typeof special === "string" ? special.trim() : "";
  return {
    name,
    background: readText(body.背景 ?? body.background) || "未定",
    identity:
      readText(specialObj?.身份 ?? specialObj?.identity ?? body.身份) ||
      (specialText && !specialObj ? specialText : "") ||
      "无",
    cheat: readText(specialObj?.金手指 ?? specialObj?.cheat ?? body.金手指) || "无",
    extra: readText(specialObj?.其它 ?? specialObj?.extra ?? body.其它) || "无",
  };
}

function parseFromProse(text: string): ProtagonistSpec | null {
  const name = extractName(
    matchField(text, "名字") ||
      matchField(text, "姓名") ||
      matchField(text, "name"),
  );
  if (!name) return null;
  const cheat =
    matchField(text, "金手指") || matchField(text, "能做什么") || "无";
  const background =
    matchField(text, "背景") || matchField(text, "关键背景") || "未定";
  return {
    name,
    background,
    identity: matchField(text, "身份") || "无",
    cheat,
    extra: matchField(text, "其它") || matchField(text, "特殊设定") || "无",
  };
}

function readName(raw: unknown): string | null {
  return extractName(readText(raw));
}

function extractName(raw: string): string | null {
  const stripped = stripMd(raw).trim();
  if (!stripped) return null;
  const firstLine = stripped.split(/\n/)[0]?.trim() ?? "";
  const clause = firstLine.split(/[。！？；.!?;]/)[0]?.trim() ?? "";
  const noQuote = clause.replace(/^[「『“"']|[」』”"']$/g, "").trim();
  const noParen = noQuote.replace(/[（(].*$/, "").trim();
  const candidate = noParen || noQuote;
  if (!usableName(candidate)) return null;
  if (candidate.length > 16) return null;
  return candidate;
}

function usableName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (RESERVED_NAMES.has(n)) return false;
  if (n.includes("@玩家")) return false;
  if (/^（?待/.test(n)) return false;
  return true;
}

function readText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim();
}

function stripMd(text: string): string {
  return text.replace(/\*\*/g, "").replace(/^#+\s*/, "").trim();
}

function firstSentence(text: string): string {
  const flat = stripMd(text).replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const clause = flat.split(/[。！？\n]/)[0]?.trim() ?? "";
  if (clause.length <= 36) return clause;
  return `${clause.slice(0, 36)}…`;
}

function matchField(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sameLine = text.match(new RegExp(`${escaped}[：:]\\s*([^\\n]+)`));
  if (sameLine?.[1]?.trim()) return sameLine[1].trim();
  return markdownSection(text, escaped);
}

function markdownSection(text: string, escapedTitle: string): string {
  const re = new RegExp(
    `^#{1,3}\\s*${escapedTitle}(?=\\s|[（(:：]|$)[^\\n]*$`,
    "im",
  );
  const m = re.exec(text);
  if (!m) return "";
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^#{1,3}\s+/m);
  const body = (next >= 0 ? rest.slice(0, next) : rest).trim();
  return body.split(/\n---\s*\n/)[0]?.trim() ?? "";
}
