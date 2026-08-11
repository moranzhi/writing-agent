/**
 * 游玩呈现壳渲染（P2 最小适配）
 * 契约：docs/play-presentation-shells.md · present.v1
 */

export const PRESENT_SHELL_IDS = [
  "prose",
  "chat_monitor",
  "turn_panel",
  "chapter_reader",
];

const SHELL_LABELS = {
  prose: "纯散文",
  chat_monitor: "对话+监控",
  turn_panel: "回合面板",
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

function isPresentShellId(v) {
  return typeof v === "string" && PRESENT_SHELL_IDS.includes(v);
}

function shellDefaultRegions(shell) {
  switch (shell) {
    case "chat_monitor":
      return ["monitor", "body", "footer"];
    case "turn_panel":
      return ["monitor", "header", "body", "footer", "aside"];
    case "chapter_reader":
      return ["header", "body", "aside", "footer"];
    default:
      return ["body"];
  }
}

function formatBlockContent(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => `${k}：${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("\n");
  }
  return String(value);
}

function normalizeBlocks(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const k of ["monitor", "header", "body", "footer", "aside", "hidden"]) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  if (out.body === undefined && raw.正文 !== undefined) out.body = raw.正文;
  if (out.monitor === undefined && raw.监控 !== undefined) out.monitor = raw.监控;
  return out;
}

/**
 * @returns {{ ok: boolean, packet: object, fallbackPlain: boolean } | null}
 * null = 不是 present 包（交给其它渲染器）
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

/** 纯文本 → prose 包（供调用方在非 JSON 时使用） */
export function presentFromPlain(text, shell = "prose") {
  return {
    schema: "present.v1",
    shell: isPresentShellId(shell) ? shell : "prose",
    blocks: { body: text ?? "" },
    meta: { suggested_actions: [] },
  };
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
      : shell === "turn_panel";
  const tone =
    typeof tweaks.tone_chrome === "string" && tweaks.tone_chrome.trim()
      ? tweaks.tone_chrome.trim()
      : "default";

  const blocks = packet.blocks ?? {};
  const regions = shellDefaultRegions(shell);
  const parts = [];

  for (const region of regions) {
    if (region === "hidden") continue;
    let text = formatBlockContent(blocks[region]).trim();
    if (!text && emptyStates[region]) text = String(emptyStates[region]);
    if (!text && region !== "body") continue;
    if (!text && region === "body") text = "（暂无正文）";

    const title =
      labels[region] ||
      labels[REGION_LABELS[region]] ||
      REGION_LABELS[region] ||
      region;
    const isBody = region === "body";
    parts.push(`
      <section class="present-region present-region--${esc(region)}" data-region="${esc(region)}">
        ${isBody && shell === "prose" ? "" : `<h4 class="present-region-title">${esc(title)}</h4>`}
        <div class="present-region-body">${esc(text).replace(/\n/g, "<br>")}</div>
      </section>`);
  }

  const actions = showActions ? packet.meta?.suggested_actions ?? [] : [];
  if (actions.length) {
    parts.push(`
      <section class="present-region present-region--actions" data-region="actions">
        <h4 class="present-region-title">建议行动</h4>
        <ul class="present-actions">${actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
      </section>`);
  }

  const shellLabel = SHELL_LABELS[shell] || shell;
  return `
    <div class="present-shell present-shell--${esc(shell)} present-tone--${esc(tone)}" data-shell="${esc(shell)}">
      <div class="present-shell-badge" title="呈现壳">${esc(shellLabel)}</div>
      ${parts.join("")}
    </div>`;
}
