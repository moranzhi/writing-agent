/**
 * 游玩呈现壳渲染（P2）
 * 契约：docs/play-presentation-shells.md · present.v1
 *
 * 信息层级约定（所有壳共用）：
 *   P0 body  — 阅读主轴：字号大于辅助栏，但不做成讲稿大字
 *   P1 actions — 需要决策时醒目，但不压过正文
 *   P2 monitor — 芯片密排，一眼扫完
 *   P3 header / footer / aside — 辅助，紧凑
 */

import { formatBodyHtml, isMarkdownRenderEnabled } from "./markdown.js";

export const PRESENT_SHELL_IDS = [
  "prose",
  "chat_monitor",
  "spotlight",
  "turn_panel",
  "split_board",
  "choice_dock",
  "chapter_reader",
];

const SHELL_LABELS = {
  prose: "纯散文",
  chat_monitor: "对话+监控",
  spotlight: "场面主视",
  turn_panel: "回合面板",
  split_board: "双栏看板",
  choice_dock: "选择坞",
  chapter_reader: "章节阅读",
};

const REGION_LABELS = {
  monitor: "监控",
  header: "抬头",
  body: "正文",
  footer: "文末",
  aside: "侧栏",
  hidden: "隐藏",
};

/** 默认开建议行动的壳 */
const ACTIONS_DEFAULT_ON = new Set(["turn_panel", "choice_dock"]);

function isPresentShellId(v) {
  return typeof v === "string" && PRESENT_SHELL_IDS.includes(v);
}

export function shellDefaultRegions(shell) {
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

function formatBlockContent(value) {
  let text = "";
  if (value === undefined || value === null) return "";
  if (typeof value === "string") text = value;
  else if (Array.isArray(value)) {
    text = value
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .filter(Boolean)
      .join("\n");
  } else if (typeof value === "object") {
    text = Object.entries(value)
      .map(([k, v]) => `${k}：${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("\n");
  } else text = String(value);
  return text.replace(/\n{3,}/g, "\n\n");
}

/** 模型常把 tag 名写进正文开头；展示前剥掉 */
export function stripPresentSourceFences(raw) {
  let s = String(raw ?? "").trim();
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

function normalizeBlocks(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const k of ["monitor", "header", "body", "footer", "aside", "hidden"]) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  if (out.body === undefined && raw.正文 !== undefined) out.body = raw.正文;
  if (out.monitor === undefined && raw.监控 !== undefined) out.monitor = raw.监控;
  if (typeof out.body === "string") out.body = stripPresentSourceFences(out.body);
  return out;
}

function renderChipsHtml(value, esc) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(([k]) => k != null && String(k).trim());
  if (!entries.length) return null;
  return `<div class="present-chips" role="list">${entries
    .map(
      ([k, v]) =>
        `<span class="present-chip" role="listitem"><span class="present-chip-k">${esc(k)}</span><span class="present-chip-v">${esc(
          typeof v === "string" ? v : JSON.stringify(v),
        )}</span></span>`,
    )
    .join("")}</div>`;
}

function regionInnerHtml(region, rawValue, esc) {
  if (region === "monitor") {
    const chips = renderChipsHtml(rawValue, esc);
    if (chips) return chips;
  }
  if (region === "aside" && rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    const chips = renderChipsHtml(rawValue, esc);
    if (chips) return chips;
  }
  const text = formatBlockContent(rawValue).trim();
  if (!text) return `<div class="present-region-body"></div>`;
  if (isMarkdownRenderEnabled()) {
    return `<div class="present-region-body">${formatBodyHtml(text)}</div>`;
  }
  const paras = text.split(/\n\n+/).filter(Boolean);
  const inner = paras
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div class="present-region-body">${inner}</div>`;
}

/**
 * @returns {{ ok: boolean, packet: object, fallbackPlain: boolean } | null}
 */
export function parsePresentDoc(doc, fallbackShell = "prose") {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const looks =
    doc.schema === "present.v1" ||
    (isPresentShellId(doc.shell) && doc.blocks != null) ||
    (isPresentShellId(doc.shell_id) && doc.blocks != null);
  if (!looks) return null;

  const shell = isPresentShellId(doc.shell)
    ? doc.shell
    : isPresentShellId(doc.shell_id)
      ? doc.shell_id
      : fallbackShell;
  const meta =
    doc.meta && typeof doc.meta === "object" && !Array.isArray(doc.meta)
      ? doc.meta
      : {};
  return {
    ok: true,
    fallbackPlain: false,
    packet: {
      schema: "present.v1",
      shell,
      blocks: normalizeBlocks(doc.blocks ?? doc.区域),
      meta: {
        suggested_actions: Array.isArray(meta.suggested_actions)
          ? meta.suggested_actions.filter((x) => typeof x === "string")
          : Array.isArray(doc.suggested_actions)
            ? doc.suggested_actions.filter((x) => typeof x === "string")
            : [],
      },
    },
  };
}

export function presentFromPlain(text, shell = "prose") {
  return {
    schema: "present.v1",
    shell: isPresentShellId(shell) ? shell : "prose",
    blocks: { body: stripPresentSourceFences(text ?? "") },
    meta: { suggested_actions: [] },
  };
}

function regionTitle(region, labels, _shell) {
  // 正文默认不挂标题（面积留给文字）；创作填了 block_labels.body 才显示
  if (region === "body") {
    return labels.body || labels["正文"] || null;
  }
  return (
    labels[region] ||
    labels[REGION_LABELS[region]] ||
    REGION_LABELS[region] ||
    region
  );
}

function renderRegion(region, rawValue, esc, { labels, emptyStates, shell }) {
  let hasContent =
    rawValue !== undefined &&
    rawValue !== null &&
    (typeof rawValue === "string"
      ? rawValue.trim()
      : Array.isArray(rawValue)
        ? rawValue.length
        : typeof rawValue === "object"
          ? Object.keys(rawValue).length
          : true);

  let displayRaw = rawValue;
  if (!hasContent && emptyStates[region]) {
    displayRaw = String(emptyStates[region]);
    hasContent = true;
  }
  if (!hasContent && region !== "body") return "";
  if (!hasContent && region === "body") displayRaw = "（暂无正文）";

  const title = regionTitle(region, labels, shell);
  const titleHtml = title
    ? `<h4 class="present-region-title">${esc(title)}</h4>`
    : "";

  return `
    <section class="present-region present-region--${esc(region)}" data-region="${esc(region)}">
      ${titleHtml}
      ${regionInnerHtml(region, displayRaw, esc)}
    </section>`;
}

function renderActionsHtml(actions, esc) {
  if (!actions.length) return "";
  return `
    <section class="present-region present-region--actions" data-region="actions">
      <h4 class="present-region-title">建议行动</h4>
      <div class="present-action-row" role="list">${actions
        .map(
          (a) =>
            `<span class="present-action" role="listitem">${esc(a)}</span>`,
        )
        .join("")}</div>
    </section>`;
}

/**
 * @param {object} packet present.v1
 * @param {(s: string) => string} esc
 * @param {{ tweaks?: object }} [opts]
 */
export function renderPresentShellHtml(packet, esc, opts = {}) {
  if (!packet || typeof packet !== "object") return "";
  const shell = isPresentShellId(packet.shell) ? packet.shell : "prose";
  const tweaks = opts.tweaks ?? {};
  const labels = {
    ...(tweaks.block_labels && typeof tweaks.block_labels === "object"
      ? tweaks.block_labels
      : {}),
  };
  const emptyStates =
    tweaks.empty_states && typeof tweaks.empty_states === "object"
      ? tweaks.empty_states
      : {};
  const showActions =
    typeof tweaks.show_suggested_actions === "boolean"
      ? tweaks.show_suggested_actions
      : ACTIONS_DEFAULT_ON.has(shell);
  let tone =
    typeof tweaks.tone_chrome === "string" && tweaks.tone_chrome.trim()
      ? tweaks.tone_chrome.trim()
      : "default";
  // 用户「选壳」菜单已移除；气质跟呈现壳 / tweaks 本身，不再读全局 data-present-chrome

  const blocks = packet.blocks ?? {};
  const regions = shellDefaultRegions(shell);
  const ctx = { labels, emptyStates, shell };

  const by = {};
  for (const r of regions) {
    by[r] = renderRegion(r, blocks[r], esc, ctx);
  }

  const actions = showActions ? packet.meta?.suggested_actions ?? [] : [];
  const actionsHtml = renderActionsHtml(actions, esc);

  let layoutHtml = "";
  switch (shell) {
    case "chat_monitor":
      layoutHtml = `
        <div class="present-stack">
          ${by.monitor || ""}
          <div class="present-stage">${by.body || ""}</div>
          ${by.footer || ""}
          ${actionsHtml}
        </div>`;
      break;
    case "spotlight":
      layoutHtml = `
        <div class="present-stack present-stack--spotlight">
          ${by.monitor || ""}
          <div class="present-stage present-stage--hero">${by.body || ""}</div>
          ${by.footer || ""}
          ${actionsHtml}
        </div>`;
      break;
    case "turn_panel": {
      const boardSide = `${by.aside || ""}${by.footer || ""}`;
      layoutHtml = `
        <div class="present-board">
          <div class="present-board-top">${by.monitor || ""}${by.header || ""}</div>
          <div class="present-board-mid${boardSide ? "" : " is-solo"}">
            <div class="present-stage">${by.body || ""}</div>
            ${boardSide ? `<div class="present-board-side">${boardSide}</div>` : ""}
          </div>
          ${actionsHtml}
        </div>`;
      break;
    }
    case "split_board":
      layoutHtml = `
        <div class="present-split${by.aside ? "" : " is-solo"}">
          <div class="present-split-main">
            ${by.header || ""}
            <div class="present-stage">${by.body || ""}</div>
            ${by.footer || ""}
          </div>
          ${by.aside ? `<div class="present-split-side">${by.aside}</div>` : ""}
          ${actionsHtml}
        </div>`;
      break;
    case "choice_dock":
      layoutHtml = `
        <div class="present-stack present-stack--dock">
          ${by.monitor || ""}
          <div class="present-stage">${by.body || ""}</div>
          ${by.footer || ""}
          <div class="present-dock">${actionsHtml}</div>
        </div>`;
      break;
    case "chapter_reader":
      layoutHtml = `
        <div class="present-reader${by.aside ? "" : " is-solo"}">
          <div class="present-reader-main">
            ${by.header || ""}
            <div class="present-stage present-stage--read">${by.body || ""}</div>
            ${by.footer || ""}
          </div>
          ${by.aside ? `<div class="present-reader-aside">${by.aside}</div>` : ""}
        </div>`;
      break;
    case "prose":
    default:
      layoutHtml = `
        <div class="present-stack present-stack--prose">
          <div class="present-stage present-stage--read">${by.body || ""}</div>
          ${by.footer || ""}
          ${actionsHtml}
        </div>`;
      break;
  }

  const shellLabel = SHELL_LABELS[shell] || shell;
  return `
    <div class="present-shell present-shell--${esc(shell)} present-tone--${esc(tone)}" data-shell="${esc(shell)}">
      <div class="present-shell-badge" title="呈现壳">${esc(shellLabel)}</div>
      ${layoutHtml}
    </div>`;
}

export { SHELL_LABELS, REGION_LABELS, isPresentShellId };
