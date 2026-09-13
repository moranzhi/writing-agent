/**
 * Composer 指令高亮：textarea 下叠镜像层，悬停预览替换效果（QQ 式）。
 */

import {
  findDirectiveHits,
  renderDirectiveBackdropHtml,
} from "./directive-parse.js";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureTip() {
  let tip = document.getElementById("directive-preview-tip");
  if (tip) return tip;
  tip = document.createElement("div");
  tip.id = "directive-preview-tip";
  tip.className = "directive-preview-tip";
  tip.hidden = true;
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  return tip;
}

function hideTip() {
  const tip = document.getElementById("directive-preview-tip");
  if (!tip) return;
  tip.hidden = true;
  tip.innerHTML = "";
}

/**
 * @param {HTMLTextAreaElement} input
 * @param {{ getPersona?: () => { name?: string, description?: string } | null }} [opts]
 */
export function wireDirectiveHighlight(input, opts = {}) {
  if (!input || input.dataset.directiveHl === "1") return;
  input.dataset.directiveHl = "1";

  const field = input.closest(".composer-input-field");
  const backdrop = field?.querySelector(".composer-input-backdrop");
  if (!field || !backdrop) return;

  const getPersona = opts.getPersona || (() => null);
  let tipVisible = false;

  function syncEmptyClass() {
    input.classList.toggle("is-empty", !String(input.value ?? ""));
  }

  function refresh() {
    const text = String(input.value ?? "");
    syncEmptyClass();
    const hits = findDirectiveHits(text, { persona: getPersona() });
    backdrop.innerHTML = renderDirectiveBackdropHtml(text, hits, escapeHtml);
    // 末尾换行时 textarea 多出一行高度，镜像补一个 br 对齐
    if (text.endsWith("\n")) {
      backdrop.appendChild(document.createElement("br"));
    }
    backdrop.scrollTop = input.scrollTop;
    backdrop.scrollLeft = input.scrollLeft;
  }

  function showTipFor(mark, clientX, clientY) {
    const tip = ensureTip();
    const title = mark.getAttribute("data-dir-title") || "";
    const body = mark.getAttribute("data-dir-body") || "";
    tip.innerHTML = `<div class="directive-preview-tip-title">${escapeHtml(
      title,
    )}</div><div class="directive-preview-tip-body">${escapeHtml(body)}</div>`;
    tip.hidden = false;
    tipVisible = true;

    const pad = 10;
    const rect = tip.getBoundingClientRect();
    let left = clientX + 12;
    let top = clientY + 14;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, clientX - rect.width - 12);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, clientY - rect.height - 10);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function hitTest(clientX, clientY) {
    const prevTa = input.style.pointerEvents;
    const prevBd = backdrop.style.pointerEvents;
    input.style.pointerEvents = "none";
    backdrop.style.pointerEvents = "auto";
    const el = document.elementFromPoint(clientX, clientY);
    input.style.pointerEvents = prevTa;
    backdrop.style.pointerEvents = prevBd;
    return el?.closest?.("[data-dir-hit]") || null;
  }

  function onMove(e) {
    const mark = hitTest(e.clientX, e.clientY);
    if (mark) showTipFor(mark, e.clientX, e.clientY);
    else if (tipVisible) hideTip();
  }

  function onLeave() {
    if (tipVisible) {
      tipVisible = false;
      hideTip();
    }
  }

  input.addEventListener("input", refresh);
  input.addEventListener("change", refresh);
  input.addEventListener("scroll", () => {
    backdrop.scrollTop = input.scrollTop;
    backdrop.scrollLeft = input.scrollLeft;
  });
  input.addEventListener("mousemove", onMove);
  input.addEventListener("mouseleave", onLeave);
  // 选角色后可外部调用
  input._directiveHighlightRefresh = refresh;

  refresh();
}

/** 角色切换等场景手动刷新预览文案 */
export function refreshDirectiveHighlight(input = document.getElementById("composer-input")) {
  if (input && typeof input._directiveHighlightRefresh === "function") {
    input._directiveHighlightRefresh();
  }
}
