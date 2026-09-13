/**
 * 客户端指令识别（与 src/directives/expand.ts 匹配规则对齐）。
 * 仅用于输入框高亮 / 预览，不真正掷骰或替换。
 */

const NAME_ALIASES = ["玩家", "user"];
const DESC_ALIASES = ["人设", "persona"];
/** 与 expand.ts 同一规则：指令名全等；仅 ASCII 词符算续写。 */
const DICE_AT_RE =
  /^@r(\d*)d(\d+)([+-]\d+)?(?:\s+(\d+))?(?![A-Za-z0-9_])/i;
const TOKEN_TAIL = /^[@A-Za-z0-9_]/;

/**
 * @typedef {{ name?: string, description?: string } | null | undefined} DirectivePersona
 * @typedef {{
 *   start: number,
 *   end: number,
 *   raw: string,
 *   kind: "persona_name" | "persona_desc" | "dice" | "st_user",
 *   previewTitle: string,
 *   previewBody: string,
 * }} DirectiveHitView
 */

function personaName(persona) {
  const name = persona?.name?.trim();
  return name || "玩家";
}

function personaDesc(persona) {
  const d = persona?.description?.trim();
  if (d) return d;
  const name = persona?.name?.trim();
  return name ? `姓名：${name}` : "（当前无人设）";
}

function truncate(text, max = 80) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * @param {string} input
 * @param {{ persona?: DirectivePersona }} [ctx]
 * @returns {DirectiveHitView[]}
 */
export function findDirectiveHits(input, ctx = {}) {
  const persona = ctx.persona;
  /** @type {DirectiveHitView[]} */
  const hits = [];
  let i = 0;

  while (i < input.length) {
    if (input[i] === "@") {
      const rest = input.slice(i);
      let matched = null;

      for (const alias of NAME_ALIASES) {
        const token = `@${alias}`;
        if (rest.startsWith(token) && !TOKEN_TAIL.test(rest.slice(token.length))) {
          const name = personaName(persona);
          matched = {
            start: i,
            end: i + token.length,
            raw: token,
            kind: "persona_name",
            previewTitle: token,
            previewBody: `发送时 → ${name}`,
          };
          break;
        }
      }

      if (!matched) {
        for (const alias of DESC_ALIASES) {
          const token = `@${alias}`;
          if (rest.startsWith(token) && !TOKEN_TAIL.test(rest.slice(token.length))) {
            matched = {
              start: i,
              end: i + token.length,
              raw: token,
              kind: "persona_desc",
              previewTitle: token,
              previewBody: `发送时 → ${truncate(personaDesc(persona))}`,
            };
            break;
          }
        }
      }

      if (!matched) {
        const m = rest.match(DICE_AT_RE);
        if (m) {
          const count = m[1] ? m[1] : "1";
          const sides = m[2];
          const mod = m[3] ?? "";
          const target = m[4];
          const expression = `${count}d${sides}${mod}`;
          const raw = m[0];
          const targetPart = target !== undefined ? `，目标 ${target}` : "";
          matched = {
            start: i,
            end: i + raw.length,
            raw,
            kind: "dice",
            previewTitle: raw.trim(),
            previewBody: `发送时掷 ${expression}${targetPart}（点数届时生成）`,
          };
        }
      }

      if (matched) {
        hits.push(matched);
        i = matched.end;
        continue;
      }
    }

    if (input.startsWith("{{user}}", i)) {
      const name = personaName(persona);
      hits.push({
        start: i,
        end: i + 8,
        raw: "{{user}}",
        kind: "st_user",
        previewTitle: "{{user}}",
        previewBody: `发送时 → ${name}`,
      });
      i += 8;
      continue;
    }

    i += 1;
  }

  return hits;
}

/**
 * @param {string} text
 * @param {DirectiveHitView[]} hits
 * @param {(s: string) => string} escapeHtml
 */
export function renderDirectiveBackdropHtml(text, hits, escapeHtml) {
  if (!text) return "";
  if (!hits.length) return escapeHtml(text);

  let html = "";
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) {
      html += escapeHtml(text.slice(cursor, hit.start));
    }
    const kindClass =
      hit.kind === "dice"
        ? " dir-hit--dice"
        : hit.kind === "persona_desc"
          ? " dir-hit--desc"
          : " dir-hit--name";
    html += `<mark class="dir-hit${kindClass}" data-dir-hit="1" data-dir-title="${escapeHtml(
      hit.previewTitle,
    )}" data-dir-body="${escapeHtml(hit.previewBody)}">${escapeHtml(hit.raw)}</mark>`;
    cursor = hit.end;
  }
  if (cursor < text.length) {
    html += escapeHtml(text.slice(cursor));
  }
  return html;
}
