/**
 * 游玩辅助 Tab：表格 / 开场与角色 / 对话。
 * 隐藏格默认挡住，点字段才露；手改带格子 rev。
 */
import { parsePresentDoc } from "./present-shells.js";

let playAuxTab = "table";
let revealedHidden = new Set();
let editingKey = null;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function coerceValue(prev, raw) {
  const text = String(raw ?? "").trim();
  if (typeof prev === "boolean") {
    if (text === "true" || text === "是" || text === "1") return true;
    if (text === "false" || text === "否" || text === "0") return false;
    return prev;
  }
  if (typeof prev === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : prev;
  }
  return text;
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

function rowHtml(row, { hidden, revealed, editing, busy }) {
  const shown = !hidden || revealed;
  const val = shown ? formatValue(row.value) : "••••••";
  const edit =
    shown && row.editable && editing
      ? `<form class="play-table-edit" data-table-edit="${esc(row.key)}">
           <input type="text" name="value" value="${esc(formatValue(row.value))}" ${busy ? "disabled" : ""} />
           <button type="submit" class="btn-sm btn-primary" ${busy ? "disabled" : ""}>保存</button>
           <button type="button" class="btn-sm" data-table-cancel>取消</button>
         </form>`
      : "";
  const action =
    shown && row.editable && !editing
      ? `<button type="button" class="play-table-fix" data-table-fix="${esc(row.key)}" ${busy ? "disabled" : ""}>改</button>`
      : "";
  return `<li class="play-table-row${hidden ? " is-secret" : ""}${revealed ? " is-open" : ""}" data-table-key="${esc(row.key)}" data-hidden="${hidden ? "1" : "0"}">
    <button type="button" class="play-table-hit" data-table-reveal="${esc(row.key)}" ${hidden && !revealed ? "" : hidden ? "" : "tabindex='-1'"}>
      <span class="play-table-key">${esc(row.key)}</span>
      <span class="play-table-val">${esc(val)}</span>
    </button>
    ${action}
    ${edit}
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
          .map((row) =>
            rowHtml(row, {
              hidden: false,
              revealed: true,
              editing: editingKey === row.key,
              busy,
            }),
          )
          .join("")}</ul>`
      : `<p class="play-aux-empty">没有可见字段。</p>`;
  const hid = hidden.length
    ? `<details class="play-table-secrets">
         <summary>不可见 ${hidden.length}</summary>
         <ul class="play-table-list">${hidden
           .map((row) =>
             rowHtml(row, {
               hidden: true,
               revealed: revealedHidden.has(row.key),
               editing: editingKey === row.key,
               busy,
             }),
           )
           .join("")}</ul>
       </details>`
    : "";
  return `<div class="play-table" data-table-tag="${esc(table.tag)}">${vis}${hid}</div>`;
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
      fillPlayAux(view, handlers, extra);
    };
  }
  if (title) title.textContent = "游玩";
  if (drawerCount) drawerCount.textContent = "";

  const busy = Boolean(extra.busy);
  if (playAuxTab === "table") {
    drawerBody.innerHTML = tablePanelHtml(aux?.table, busy);
    wireTable(drawerBody, aux?.table, handlers, busy, () =>
      fillPlayAux(view, handlers, extra),
    );
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

function wireTable(root, table, handlers, busy, rerender) {
  root.querySelectorAll("[data-table-reveal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-table-reveal");
      const row = btn.closest(".play-table-row");
      if (!key || !row) return;
      if (row.getAttribute("data-hidden") === "1" && !revealedHidden.has(key)) {
        revealedHidden.add(key);
        rerender?.();
      }
    });
  });
  root.querySelectorAll("[data-table-fix]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      editingKey = btn.getAttribute("data-table-fix");
      rerender?.();
    });
  });
  root.querySelectorAll("[data-table-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingKey = null;
      rerender?.();
    });
  });
  root.querySelectorAll("[data-table-edit]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy) return;
      const key = form.getAttribute("data-table-edit");
      const row = table?.rows?.find((r) => r.key === key);
      if (!key || !row) return;
      const next = coerceValue(
        row.value,
        form.querySelector("input[name=value]")?.value,
      );
      editingKey = null;
      handlers.onPatchTable?.(table.tag, [
        { key, value: next, expectedRev: row.rev },
      ]);
    });
  });
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
