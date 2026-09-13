/**
 * `@` 指令展开：匹配已注册指令即替换；未注册保留原文。
 * 身份类可复用于预设/开场白；骰子类仅在发送/进游玩时展开。
 */

import { executeChance } from "../skills/chance-tools.js";

export type DirectivePersona = {
  name: string;
  description?: string;
};

export type DirectiveContext = {
  persona?: DirectivePersona | null;
};

export type ExpandOptions = {
  /** 默认 true。预设装配时关掉，避免每次请求重掷。 */
  allowDice?: boolean;
};

export type DirectiveHit = {
  raw: string;
  kind: "persona_name" | "persona_desc" | "dice" | "st_user";
  replacement: string;
};

export type ExpandResult = {
  text: string;
  hits: DirectiveHit[];
  changed: boolean;
};

const NAME_ALIASES = new Set(["玩家", "user"]);
const DESC_ALIASES = new Set(["人设", "persona"]);

/** `@r` + 可选个数 + `d` + 面数 + 可选加减 + 可选目标 */
const DICE_AT_RE =
  /^@r(\d*)d(\d+)([+-]\d+)?(?:\s+(\d+))?(?![A-Za-z0-9_])/i;

/** 仅 ASCII 词符算续写；汉字紧跟仍是完整指令（全等匹配 `@玩家` 等）。 */
const TOKEN_CONTINUATION = /^[@A-Za-z0-9_]/;

function personaName(ctx: DirectiveContext): string {
  const name = ctx.persona?.name?.trim();
  return name || "玩家";
}

function personaDesc(ctx: DirectiveContext): string {
  const d = ctx.persona?.description?.trim();
  if (d) return d;
  const name = ctx.persona?.name?.trim();
  return name ? `姓名：${name}` : "";
}

function formatDiceWithTarget(
  expression: string,
  target: number | undefined,
): string {
  const result = executeChance({ op: "roll", expression });
  if (!result.ok) {
    return result.summary;
  }
  const total = Number(result.detail.total);
  const dice = Array.isArray(result.detail.dice)
    ? (result.detail.dice as number[])
    : [];
  const expr = String(result.detail.expression ?? expression);
  if (target === undefined || !Number.isFinite(target)) {
    if (dice.length <= 1) {
      return `投掷结果为 ${total}（${expr}）`;
    }
    return `投掷结果为 ${dice.join("+")} = ${total}（${expr}）`;
  }
  const success = total <= target;
  const verdict = success ? "成功" : "失败";
  return `投掷结果为 ${total}，目标 ${target}（${verdict}）`;
}

function tryExpandAt(
  rest: string,
  ctx: DirectiveContext,
  allowDice: boolean,
): { raw: string; hit: DirectiveHit } | null {
  if (rest[0] !== "@") return null;

  for (const alias of NAME_ALIASES) {
    const token = `@${alias}`;
    if (
      rest.startsWith(token) &&
      !TOKEN_CONTINUATION.test(rest.slice(token.length))
    ) {
      const replacement = personaName(ctx);
      return {
        raw: token,
        hit: { raw: token, kind: "persona_name", replacement },
      };
    }
  }

  for (const alias of DESC_ALIASES) {
    const token = `@${alias}`;
    if (
      rest.startsWith(token) &&
      !TOKEN_CONTINUATION.test(rest.slice(token.length))
    ) {
      const replacement = personaDesc(ctx);
      return {
        raw: token,
        hit: { raw: token, kind: "persona_desc", replacement },
      };
    }
  }

  if (allowDice) {
    const m = rest.match(DICE_AT_RE);
    if (m) {
      const count = m[1] ? m[1] : "1";
      const sides = m[2]!;
      const mod = m[3] ?? "";
      const target = m[4] !== undefined ? Number(m[4]) : undefined;
      const expression = `${count}d${sides}${mod}`;
      const raw = m[0]!;
      const replacement = formatDiceWithTarget(expression, target);
      return {
        raw,
        hit: { raw, kind: "dice", replacement },
      };
    }
  }

  return null;
}

/**
 * 展开文本中的 `@` 指令；可选兼容酒馆 `{{user}}`。
 */
export function expandAtDirectives(
  input: string,
  ctx: DirectiveContext = {},
  options: ExpandOptions = {},
): ExpandResult {
  const allowDice = options.allowDice !== false;
  const hits: DirectiveHit[] = [];
  let i = 0;
  let out = "";

  while (i < input.length) {
    if (input[i] === "@") {
      const tried = tryExpandAt(input.slice(i), ctx, allowDice);
      if (tried) {
        out += tried.hit.replacement;
        hits.push(tried.hit);
        i += tried.raw.length;
        continue;
      }
    }

    // 兼容 SillyTavern {{user}}
    if (input.startsWith("{{user}}", i)) {
      const replacement = personaName(ctx);
      out += replacement;
      hits.push({ raw: "{{user}}", kind: "st_user", replacement });
      i += "{{user}}".length;
      continue;
    }

    out += input[i];
    i += 1;
  }

  return {
    text: out,
    hits,
    changed: hits.length > 0,
  };
}

/** 仅身份类（预设装配用，不掷骰）。 */
export function expandIdentityDirectives(
  input: string,
  ctx: DirectiveContext = {},
): ExpandResult {
  return expandAtDirectives(input, ctx, { allowDice: false });
}

export type DirectiveCatalogItem = {
  insert: string;
  label: string;
  hint: string;
};

/** 输入补全目录（静态）。 */
export function listDirectiveCatalog(): DirectiveCatalogItem[] {
  return [
    { insert: "@玩家", label: "玩家", hint: "当前用户角色名" },
    { insert: "@user", label: "user", hint: "同 @玩家" },
    { insert: "@人设", label: "人设", hint: "当前用户角色人设正文" },
    { insert: "@rd100 ", label: "rd100", hint: "百面骰；可接目标如 @rd100 30" },
    { insert: "@r1d20", label: "r1d20", hint: "二十面骰" },
    { insert: "@r3d10", label: "r3d10", hint: "3 个十面骰" },
  ];
}
