/**
 * 游玩辅助 Tab：表格 / 开场与角色。
 * 隐藏格默认挡住，点字段才露。
 * 可改格直接改本地草稿；只有点保存并确认后才写入。
 */
import { parsePresentDoc } from "./present-shells.js";

let playAuxTab = "table";
let revealedHidden = new Set();
let secretsOpen = false;
let draftsTag = "";
/** @type {Map<string, string>} */
let tableDrafts = new Map();
/** @type {{ key: string, start: number | null, end: number | null } | null} */
let tableFocus = null;
let tableSaving = false;
let ignoreNextCapture = false;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cssAttr(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

export function coerceTableValue(value) {
  if (typeof value !== "string") return value;
  const t = value.trim();
  if (t.length < 2) return value;
  const start = t[0];
  const end = t[t.length - 1];
  if ((start === "{" && end === "}") || (start === "[" && end === "]")) {
    try {
      return JSON.parse(t);
    } catch {
      return value;
    }
  }
  return value;
}

export function formatTableValue(value) {
  const normalized = coerceTableValue(value);
  if (normalized === null || normalized === undefined) return "";
  if (typeof normalized === "object") {
    try {
      const compact = JSON.stringify(normalized);
      if (compact.length <= 42) return compact;
      return JSON.stringify(normalized, null, 2);
    } catch {
      return String(normalized);
    }
  }
  return String(normalized);
}

function previewChange(value) {
  const flat = formatTableValue(value).replace(/\s+/g, " ").trim();
  if (!flat) return "空";
  if (flat.length <= 42) return flat;
  return `${flat.slice(0, 42)}…`;
}

function sameValue(a, b) {
  const left = coerceTableValue(a);
  const right = coerceTableValue(b);
  if (Object.is(left, right)) return true;
  if (typeof left === "object" || typeof right === "object") {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }
  return false;
}

/** @returns {{ ok: true, value: unknown } | { ok: false, error: string }} */
export function parseTableDraft(prev, raw) {
  const text = String(raw ?? "");
  const trimmed = text.trim();
  const baseline = coerceTableValue(prev);
  if (typeof baseline === "boolean") {
    if (trimmed === "true" || trimmed === "是" || trimmed === "1") return { ok: true, value: true };
    if (trimmed === "false" || trimmed === "否" || trimmed === "0") return { ok: true, value: false };
    return { ok: false, error: "填是或否" };
  }
  if (typeof baseline === "number") {
    if (!trimmed) return { ok: false, error: "需要数字" };
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return { ok: false, error: "不是数字" };
    return { ok: true, value: n };
  }
  if (baseline !== null && typeof baseline === "object") {
    if (!trimmed) return { ok: false, error: "需要 JSON" };
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch {
      return { ok: false, error: "JSON 不合法" };
    }
  }
  // 原文是 JSON 字符串时，保存为结构化对象，避免继续塞一坨字
  if (typeof prev === "string" && coerceTableValue(prev) !== prev) {
    if (!trimmed) return { ok: false, error: "需要 JSON" };
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch {
      return { ok: false, error: "JSON 不合法" };
    }
  }
  return { ok: true, value: trimmed };
}

function rowOpen(row) {
  return row.visibility !== "hidden" || revealedHidden.has(row.key);
}

function isStructuredValue(value) {
  const normalized = coerceTableValue(value);
  return normalized !== null && typeof normalized === "object";
}

function stacked(row) {
  if (typeof coerceTableValue(row.value) === "boolean") return false;
  if (isStructuredValue(row.value)) return true;
  const text = formatTableValue(row.value);
  return text.includes("\n") || [...text].length > 28;
}

function draftText(row) {
  if (tableDrafts.has(row.key)) return tableDrafts.get(row.key) ?? "";
  const normalized = coerceTableValue(row.value);
  if (typeof normalized === "boolean") return normalized ? "true" : "false";
  return formatTableValue(row.value);
}

function leafText(value) {
  if (value === null || value === undefined) return "空";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function matrixColumns(rows) {
  const cols = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      cols.push(key);
    }
  }
  return cols;
}

function nestedMatrixHtml(rows, nameKey) {
  const cols = matrixColumns(rows);
  if (!cols.length) return `<pre class="play-table-json">${esc(formatTableValue(rows))}</pre>`;
  const head = cols.map((col) => `<th>${esc(col)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = cols
        .map((col) => {
          const raw = row && typeof row === "object" ? row[col] : "";
          const nested = coerceTableValue(raw);
          if (nested !== null && typeof nested === "object") {
            return `<td>${nestedValueHtml(nested, 1)}</td>`;
          }
          return `<td>${esc(leafText(raw))}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<div class="play-table-nested"${nameKey ? ` data-matrix="${esc(nameKey)}"` : ""}><table class="play-nested-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function namedMatrixHtml(map) {
  const rows = Object.entries(map).map(([name, stats]) => {
    if (stats && typeof stats === "object" && !Array.isArray(stats)) {
      return { name, ...stats };
    }
    return { name, value: stats };
  });
  return nestedMatrixHtml(rows);
}

function objectTreeHtml(value, depth = 0) {
  const entries = Object.entries(value);
  if (!entries.length) return `<span class="play-table-val">{}</span>`;
  const items = entries
    .map(([key, child]) => {
      const nested = coerceTableValue(child);
      if (nested !== null && typeof nested === "object" && depth < 2) {
        return `<div class="play-nested-pair"><span class="play-nested-key">${esc(key)}</span>${nestedValueHtml(nested, depth + 1)}</div>`;
      }
      return `<div class="play-nested-pair"><span class="play-nested-key">${esc(key)}</span><span class="play-nested-leaf">${esc(leafText(nested))}</span></div>`;
    })
    .join("");
  return `<div class="play-table-tree">${items}</div>`;
}

function nestedValueHtml(value, depth = 0) {
  const normalized = coerceTableValue(value);
  if (normalized === null || normalized === undefined) {
    return `<span class="play-table-val">空</span>`;
  }
  if (typeof normalized !== "object") {
    return `<span class="play-table-val">${esc(String(normalized))}</span>`;
  }
  if (Array.isArray(normalized)) {
    if (
      normalized.length &&
      normalized.every((item) => item && typeof item === "object" && !Array.isArray(item))
    ) {
      return nestedMatrixHtml(normalized);
    }
    return `<pre class="play-table-json">${esc(JSON.stringify(normalized, null, 2))}</pre>`;
  }
  const entries = Object.entries(normalized);
  if (
    entries.length &&
    entries.every(([, child]) => child && typeof child === "object" && !Array.isArray(child))
  ) {
    return namedMatrixHtml(normalized);
  }
  return objectTreeHtml(normalized, depth);
}

function caretOf(el) {
  try {
    if (typeof el.selectionStart !== "number" || typeof el.selectionEnd !== "number") {
      return { start: null, end: null };
    }
    return { start: el.selectionStart, end: el.selectionEnd };
  } catch {
    return { start: null, end: null };
  }
}

function readControl(el) {
  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    return el.checked ? "true" : "false";
  }
  return el.value;
}

function bindTableTag(tag) {
  const next = tag || "";
  if (draftsTag === next) return;
  draftsTag = next;
  tableDrafts = new Map();
  tableFocus = null;
  tableSaving = false;
}

function pruneDrafts(table, focusedKey) {
  const keys = new Set((table?.rows ?? []).map((row) => row.key));
  for (const key of [...tableDrafts.keys()]) {
    if (!keys.has(key)) tableDrafts.delete(key);
  }
  for (const row of table?.rows ?? []) {
    if (!tableDrafts.has(row.key)) continue;
    const text = tableDrafts.get(row.key) ?? "";
    const baseline = coerceTableValue(row.value);
    const canonical =
      typeof baseline === "boolean" ? (baseline ? "true" : "false") : formatTableValue(row.value);
    if (text === canonical) {
      tableDrafts.delete(row.key);
      continue;
    }
    if (row.key === focusedKey) continue;
    const parsed = parseTableDraft(row.value, text);
    if (parsed.ok && sameValue(parsed.value, row.value)) tableDrafts.delete(row.key);
  }
}

/** 整页重绘会先清掉侧栏。丢掉 DOM 之前把草稿和光标记下来。 */
export function capturePlayTableEdits(root) {
  if (ignoreNextCapture) {
    ignoreNextCapture = false;
    return;
  }
  const scope = root ?? document.getElementById("coord-drawer-body");
  if (!scope) return;
  const secrets = scope.querySelector(".play-table-secrets");
  if (secrets) secretsOpen = secrets.open;
  const fields = scope.querySelectorAll("[data-table-input]");
  // 侧栏已经被清掉时不要抹掉上一轮记下来的光标
  if (!fields.length) return;
  const active = document.activeElement;
  let sawField = false;
  fields.forEach((el) => {
    const key = el.getAttribute("data-table-input");
    if (!key) return;
    tableDrafts.set(key, readControl(el));
    if (el === active) {
      sawField = true;
      tableFocus = { key, ...caretOf(el) };
    }
  });
  if (!sawField && active && !scope.contains(active)) tableFocus = null;
}

function restoreTableFocus(root) {
  if (!tableFocus) return;
  const active = document.activeElement;
  const focusFree =
    !active ||
    active === document.body ||
    active === document.documentElement ||
    root.contains(active);
  if (!focusFree) return;
  const saved = tableFocus;
  const el = root.querySelector(`[data-table-input="${cssAttr(saved.key)}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (typeof el.setSelectionRange === "function" && saved.start != null && saved.end != null) {
    try {
      el.setSelectionRange(saved.start, saved.end);
    } catch {
      /* 某些控件没有可选区 */
    }
  }
  tableFocus = saved;
}

function fitTextarea(el) {
  el.style.height = "auto";
  const cap = el.classList.contains("is-code") ? 280 : 148;
  const next = Math.min(Math.max(el.scrollHeight, 32), cap);
  el.style.height = `${next}px`;
}

function fitInput(el) {
  if (el.tagName !== "INPUT" || el.type === "checkbox") return;
  const row = el.closest(".play-table-row");
  if (!row || row.classList.contains("is-stack")) return;
  row.classList.remove("is-wide");
  const sample = el.value || el.placeholder || "";
  const len = Math.min(28, Math.max(3, [...sample].length));
  el.style.width = `${len + 1.5}ch`;
  if (el.scrollWidth > el.clientWidth + 1) {
    row.classList.add("is-wide");
    el.style.width = "100%";
  }
}

function noteTitle(row) {
  const note = String(row.note ?? "").trim();
  return note ? ` title="${esc(note)}"` : "";
}

function fieldHtml(row, { busy }) {
  const text = draftText(row);
  const disabled = busy ? "disabled" : "";
  const structured = isStructuredValue(row.value);
  const code = structured ? " is-code" : "";
  const baseline = coerceTableValue(row.value);
  if (typeof baseline === "boolean") {
    const checked = text === "true" || text === "是" || text === "1" ? "checked" : "";
    return `<label class="play-table-field">
      <span class="play-table-key"${noteTitle(row)}>${esc(row.key)}</span>
      <input type="checkbox" class="play-table-input" data-table-input="${esc(row.key)}" ${checked} ${disabled} />
      <span class="play-table-field-error" data-table-error hidden></span>
    </label>`;
  }
  if (stacked(row)) {
    return `<label class="play-table-field">
      <span class="play-table-key"${noteTitle(row)}>${esc(row.key)}</span>
      <textarea class="play-table-input${code}" data-table-input="${esc(row.key)}" rows="1" spellcheck="false" autocomplete="off" ${disabled}>${esc(text)}</textarea>
      <span class="play-table-field-error" data-table-error hidden></span>
    </label>`;
  }
  const inputMode = typeof baseline === "number" ? ' inputmode="decimal"' : "";
  const placeholder = typeof baseline === "number" ? "数字" : "空";
  return `<label class="play-table-field">
    <span class="play-table-key"${noteTitle(row)}>${esc(row.key)}</span>
    <input type="text" class="play-table-input" data-table-input="${esc(row.key)}" value="${esc(text)}" placeholder="${placeholder}" spellcheck="false" autocomplete="off"${inputMode} ${disabled} />
    <span class="play-table-field-error" data-table-error hidden></span>
  </label>`;
}

function readonlyHtml(row, { hidden, revealed }) {
  const shown = !hidden || revealed;
  const structured = shown && isStructuredValue(row.value);
  const stack = shown && (structured || stacked(row));
  if (hidden && !revealed) {
    return `<li class="play-table-row is-secret" data-table-key="${esc(row.key)}" data-hidden="1" data-editing="0">
      <button type="button" class="play-table-reveal" data-table-reveal="${esc(row.key)}" aria-label="显示 ${esc(row.key)}">
        <span class="play-table-key">${esc(row.key)}</span>
        <span class="play-table-val">••••</span>
      </button>
    </li>`;
  }
  const valueHtml = structured
    ? nestedValueHtml(row.value)
    : `<span class="play-table-val">${esc(formatTableValue(row.value) || "空")}</span>`;
  return `<li class="play-table-row${stack ? " is-stack" : " is-inline"}${hidden ? " is-secret is-open" : ""}" data-table-key="${esc(row.key)}" data-hidden="${hidden ? "1" : "0"}" data-editing="0">
    <div class="play-table-field">
      <span class="play-table-key"${noteTitle(row)}>${esc(row.key)}</span>
      ${valueHtml}
    </div>
  </li>`;
}

function rowHtml(row, { hidden, revealed, busy }) {
  const shown = !hidden || revealed;
  if (!shown || !row.editable) return readonlyHtml(row, { hidden, revealed });
  const stack = stacked(row);
  return `<li class="play-table-row${stack ? " is-stack" : " is-inline"}${hidden ? " is-secret is-open" : ""}" data-table-key="${esc(row.key)}" data-hidden="${hidden ? "1" : "0"}" data-editing="1">
    ${fieldHtml(row, { busy })}
  </li>`;
}

function tablePanelHtml(table, busy) {
  if (!table?.rows?.length) {
    return `<p class="play-aux-empty">本局没有状态表。</p>`;
  }
  const visible = table.rows.filter((r) => r.visibility !== "hidden");
  const hidden = table.rows.filter((r) => r.visibility === "hidden");
  const vis =
    visible.length > 0
      ? `<ul class="play-table-list">${visible
          .map((row) => rowHtml(row, { hidden: false, revealed: true, busy }))
          .join("")}</ul>`
      : `<p class="play-aux-empty">没有可见字段。</p>`;
  const hid = hidden.length
    ? `<details class="play-table-secrets"${secretsOpen ? " open" : ""}>
         <summary>不可见 ${hidden.length}</summary>
         <ul class="play-table-list">${hidden
           .map((row) =>
             rowHtml(row, {
               hidden: true,
               revealed: revealedHidden.has(row.key),
               busy,
             }),
           )
           .join("")}</ul>
       </details>`
    : "";
  const editable = table.rows.some((row) => row.editable);
  const bar = editable
    ? `<div class="play-table-bar" hidden>
         <span class="play-table-bar-note" data-table-dirty-note></span>
         <button type="button" class="btn-sm" data-table-revert>还原</button>
         <button type="button" class="btn-sm btn-primary" data-table-save>保存</button>
       </div>`
    : "";
  return `<div class="play-table" data-table-tag="${esc(table.tag)}">${vis}${hid}${bar}</div>`;
}

function previewOpening(text) {
  let source = String(text || "").trim();
  if (source.startsWith("{")) {
    try {
      const view = parsePresentDoc(JSON.parse(source));
      const body = view?.packet?.blocks?.body;
      if (typeof body === "string" && body.trim()) source = body.trim();
    } catch {
      /* 保持原文 */
    }
  }
  const flat = source.replace(/\s+/g, " ").trim();
  if (flat.length <= 72) return flat;
  return `${flat.slice(0, 72)}…`;
}

function openingPanelHtml(aux) {
  const openings = aux?.openings ?? [];
  if (!openings.length) {
    return `<p class="play-aux-empty">没有可选开场。使用当前用户角色卡。</p>`;
  }
  const cards = openings
    .map((item) => {
      const selected = item.index === aux.selectedOpeningIndex;
      const persona = item.persona;
      return `<article class="play-open-card${selected ? " is-selected" : ""}" data-opening-index="${item.index}" tabindex="0" role="button">
        ${item.slot ? `<p class="play-open-slot">${esc(item.slot)}</p>` : ""}
        <p class="play-open-text">${esc(previewOpening(item.text))}</p>
        ${
          persona
            ? `<p class="play-open-persona"><strong>${esc(persona.name)}</strong>${
                persona.description
                  ? ` · ${esc(persona.description)}`
                  : ""
              }</p>`
            : `<p class="play-open-persona muted">无预设角色</p>`
        }
      </article>`;
    })
    .join("");
  const usingOpening = aux.openingPersonaChoice === "opening";
  return `<div class="play-open">
    ${cards}
    <button type="button" class="btn-sm play-open-refuse"${usingOpening ? "" : " disabled"}>不用预设角色</button>
  </div>`;
}

function tabBtn(id, label, current) {
  return `<button type="button" class="play-aux-tab${current === id ? " is-current" : ""}" data-play-aux-tab="${id}" ${current === id ? 'aria-current="page"' : ""}>${esc(label)}</button>`;
}

export function fillPlayAux(view, handlers = {}, extra = {}) {
  const rail = document.getElementById("coord-rail");
  const drawerBody = document.getElementById("coord-drawer-body");
  const title = document.getElementById("coord-rail-title");
  const drawerCount = document.getElementById("coord-drawer-count");
  if (!rail || !drawerBody) return;
  rail.hidden = false;
  capturePlayTableEdits(drawerBody);

  const aux = view.playAux;

  const head = rail.querySelector(".coord-rail-head");
  if (head) {
    let tabs = head.querySelector(".play-aux-tabs");
    if (!tabs) {
      tabs = document.createElement("nav");
      tabs.className = "play-aux-tabs";
      tabs.setAttribute("aria-label", "游玩辅助");
      const collapse = head.querySelector(".coord-rail-collapse");
      if (collapse) head.insertBefore(tabs, collapse);
      else head.appendChild(tabs);
    }
    tabs.hidden = false;
    tabs.innerHTML = [
      tabBtn("table", "表格", playAuxTab),
      tabBtn("opening", "开场", playAuxTab),
    ].join("");
    tabs.onclick = (e) => {
      const btn = e.target.closest("[data-play-aux-tab]");
      if (!btn) return;
      const id = btn.getAttribute("data-play-aux-tab");
      if (!id || id === playAuxTab) return;
      playAuxTab = id;
      tableFocus = null;
      fillPlayAux(view, handlers, extra);
    };
  }
  if (title) title.textContent = "游玩";
  if (drawerCount) drawerCount.textContent = "";

  const busy = Boolean(extra.busy);
  if (playAuxTab === "table") {
    bindTableTag(aux?.table?.tag || "");
    pruneDrafts(aux?.table, tableFocus?.key);
    tableSaving = false;
    drawerBody.innerHTML = tablePanelHtml(aux?.table, busy);
    wireTable(drawerBody, aux?.table, handlers, busy, () =>
      fillPlayAux(view, handlers, extra),
    );
    restoreTableFocus(drawerBody);
    return;
  }
  if (playAuxTab === "opening") {
    drawerBody.innerHTML = openingPanelHtml(aux);
    wireOpening(drawerBody, handlers, busy);
  }
}

export function currentPlayAuxTab() {
  return playAuxTab;
}

export function hidePlayAuxTabs() {
  const tabs = document.querySelector(".play-aux-tabs");
  if (tabs) tabs.hidden = true;
}

function syncDirtyUi(root, table, busy) {
  let dirty = 0;
  let invalid = 0;
  let firstInvalid = null;
  for (const row of table?.rows ?? []) {
    if (!row.editable || !rowOpen(row)) continue;
    const li = root.querySelector(`[data-table-key="${cssAttr(row.key)}"]`);
    if (!li || li.getAttribute("data-editing") !== "1") continue;
    const text = draftText(row);
    const canonical =
      typeof row.value === "boolean" ? (row.value ? "true" : "false") : formatTableValue(row.value);
    const changed = text !== canonical;
    const parsed = changed ? parseTableDraft(row.value, text) : { ok: true, value: row.value };
    const bad = changed && !parsed.ok;
    li.classList.toggle("is-dirty", changed);
    li.classList.toggle("is-invalid", bad);
    const err = li.querySelector("[data-table-error]");
    if (err) {
      err.hidden = !bad;
      err.textContent = bad ? parsed.error : "";
    }
    if (changed) dirty += 1;
    if (bad) {
      invalid += 1;
      firstInvalid ??= li.querySelector("[data-table-input]");
    }
  }
  const bar = root.querySelector(".play-table-bar");
  if (!bar) return { dirty, invalid, firstInvalid };
  bar.hidden = dirty === 0;
  const note = bar.querySelector("[data-table-dirty-note]");
  if (note) {
    note.textContent = invalid ? `${invalid} 项还不能保存` : `${dirty} 项未保存`;
  }
  const save = bar.querySelector("[data-table-save]");
  if (save) save.disabled = busy || tableSaving || dirty === 0 || invalid > 0;
  const revert = bar.querySelector("[data-table-revert]");
  if (revert) revert.disabled = busy || tableSaving || dirty === 0;
  return { dirty, invalid, firstInvalid };
}

function wireTable(root, table, handlers, busy, rerender) {
  root.querySelectorAll("textarea.play-table-input").forEach((el) => fitTextarea(el));
  root.querySelectorAll("input.play-table-input").forEach((el) => fitInput(el));
  root.querySelector(".play-table-secrets")?.addEventListener("toggle", (e) => {
    secretsOpen = Boolean(e.currentTarget?.open);
  });
  root.querySelectorAll("[data-table-reveal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-table-reveal");
      if (!key || revealedHidden.has(key)) return;
      revealedHidden.add(key);
      secretsOpen = true;
      tableFocus = { key, start: null, end: null };
      rerender?.();
    });
  });

  const remember = (el) => {
    const key = el.getAttribute("data-table-input");
    if (!key) return;
    tableDrafts.set(key, readControl(el));
    tableFocus = { key, ...caretOf(el) };
    if (el.tagName === "TEXTAREA") fitTextarea(el);
    else fitInput(el);
    syncDirtyUi(root, table, busy);
  };

  root.querySelectorAll("[data-table-input]").forEach((el) => {
    el.addEventListener("input", () => remember(el));
    el.addEventListener("change", () => remember(el));
    el.addEventListener("focus", () => remember(el));
    el.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const key = el.getAttribute("data-table-input");
      if (!key) return;
      if (e.key === "Escape") {
        e.preventDefault();
        const row = table?.rows?.find((item) => item.key === key);
        const canonical = row
          ? typeof row.value === "boolean"
            ? row.value
              ? "true"
              : "false"
            : formatTableValue(row.value)
          : "";
        tableDrafts.delete(key);
        if (el.type === "checkbox") el.checked = canonical === "true";
        else el.value = canonical;
        tableFocus = { key, start: canonical.length, end: canonical.length };
        syncDirtyUi(root, table, busy);
        return;
      }
      const commit =
        (e.key === "Enter" && el.tagName !== "TEXTAREA") ||
        (e.key === "Enter" && (e.metaKey || e.ctrlKey));
      if (!commit) return;
      e.preventDefault();
      requestSave();
    });
  });

  root.querySelector("[data-table-revert]")?.addEventListener("click", () => {
    if (busy || tableSaving) return;
    ignoreNextCapture = true;
    tableDrafts = new Map();
    tableFocus = null;
    rerender?.();
  });
  root.querySelector("[data-table-save]")?.addEventListener("click", () => {
    requestSave();
  });
  syncDirtyUi(root, table, busy);

  function requestSave() {
    if (busy || tableSaving || !table) return;
    capturePlayTableEdits(root);
    const pending = [];
    let firstInvalid = null;
    for (const row of table.rows) {
      if (!row.editable || !rowOpen(row)) continue;
      const text = draftText(row);
      const canonical =
        typeof row.value === "boolean" ? (row.value ? "true" : "false") : formatTableValue(row.value);
      if (text === canonical) continue;
      const parsed = parseTableDraft(row.value, text);
      if (!parsed.ok) {
        firstInvalid ??= row.key;
        continue;
      }
      if (sameValue(parsed.value, row.value)) {
        tableDrafts.delete(row.key);
        continue;
      }
      pending.push({ row, value: parsed.value });
    }
    const state = syncDirtyUi(root, table, busy);
    if (state.invalid > 0 || firstInvalid) {
      const el =
        state.firstInvalid ||
        root.querySelector(`[data-table-input="${cssAttr(firstInvalid || "")}"]`);
      el?.focus();
      return;
    }
    if (!pending.length) {
      ignoreNextCapture = true;
      rerender?.();
      return;
    }
    const lines = pending.map(
      (item) =>
        `${item.row.key}：${previewChange(item.row.value)} → ${previewChange(item.value)}`,
    );
    const shown = lines.slice(0, 8);
    if (lines.length > 8) shown.push(`另有 ${lines.length - 8} 项`);
    const head =
      pending.length === 1
        ? `保存对「${pending[0].row.key}」的修改？`
        : `保存 ${pending.length} 项修改？`;
    if (!confirm(`${head}\n\n${shown.join("\n")}`)) return;
    tableSaving = true;
    syncDirtyUi(root, table, busy);
    handlers.onPatchTable?.(
      table.tag,
      pending.map((item) => ({
        key: item.row.key,
        value: item.value,
        expectedRev: item.row.rev,
      })),
    );
  }
}

function wireOpening(root, handlers, busy) {
  root.querySelectorAll("[data-opening-index]").forEach((card) => {
    const go = () => {
      if (busy) return;
      const index = Number(card.getAttribute("data-opening-index"));
      if (!Number.isFinite(index)) return;
      const hasPersona = Boolean(card.querySelector(".play-open-persona strong"));
      handlers.onSelectOpening?.(index, hasPersona ? true : undefined);
    };
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  });
  root.querySelector(".play-open-refuse")?.addEventListener("click", () => {
    if (busy) return;
    handlers.onRefuseOpeningPersona?.();
  });
}
