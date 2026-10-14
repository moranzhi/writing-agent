import { renderMarkdownToHtml } from "./markdown.js";

const TEMP_STORAGE_KEY = "wa-direct-chat-temps-v2";
const MAX_TEMPS = 2;
const EMPTY_SLOTS = {
  systemPrompt: "",
  loreBefore: "",
  seedHistory: "",
  loreAfter: "",
  postTurn: "",
};

const $ = (id) => document.getElementById(id);

const els = {
  pathList: $("chat-path-list"),
  railList: $("chat-rail-list"),
  room: $("chat-room"),
  tempMark: $("chat-temp-mark"),
  arena: $("chat-arena"),
  more: $("chat-more"),
  morePanel: $("chat-more-panel"),
  input: $("chat-input"),
  status: $("chat-status"),
  shellEditor: $("shell-editor"),
  contextSub: $("context-sub"),
  btnNewShell: $("btn-new-shell"),
  btnSaveTemp: $("btn-save-temp"),
  btnNewConv: $("btn-new-conv"),
  btnSend: $("btn-send"),
  btnSaveShell: $("btn-save-shell"),
  shellName: $("shell-name"),
  shellSystem: $("shell-system"),
  shellLoreBefore: $("shell-lore-before"),
  shellSeedHistory: $("shell-seed-history"),
  shellLoreAfter: $("shell-lore-after"),
  shellPostTurn: $("shell-post-turn"),
  dialogPromote: $("dialog-promote"),
  formPromote: $("form-promote"),
  promoteShellName: $("promote-shell-name"),
  promoteConvName: $("promote-conv-name"),
  dialogAddWindow: $("dialog-add-window"),
  formAddWindow: $("form-add-window"),
  addWindowProfile: $("add-window-profile"),
};

/** @type {"root"|"shell"|"conversation"} */
let navLevel = "root";
/** @type {string|null} */
let activeShellId = null;
/** @type {string|null} */
let activeConversationId = null;
/** @type {boolean} */
let activeIsTemp = false;
/** @type {any} */
let activeShell = null;
/** @type {any[]} */
let activeWindows = [];
/** @type {any[]} */
let activeTurns = [];
/** @type {any[]} */
let shells = [];
/** @type {any[]} */
let conversations = [];
/** @type {any[]} */
let profileList = [];
let busy = false;
/** 盲测：藏起模型名，并用另一套左右顺序展示 */
let blindModels = false;
/** @type {string[]} */
let blindOrder = [];
/** @type {Set<string>} */
const expandedCards = new Set();
const MIN_CARD_H = 120;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || res.statusText };
  }
  if (!res.ok) {
    throw new Error(data?.error || res.statusText || `HTTP ${res.status}`);
  }
  return data;
}

function loadTemps() {
  try {
    const raw = localStorage.getItem(TEMP_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeTemp).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeTemp(t) {
  if (!t || typeof t !== "object") return null;
  const windows = Array.isArray(t.windows) ? t.windows : [];
  let turns = Array.isArray(t.turns) ? t.turns : [];
  if (!turns.length && Array.isArray(t.messages) && t.messages.length) {
    turns = migrateFlatMessages(t.messages, windows[0]?.id || "default");
  }
  return {
    id: t.id,
    name: t.name || "临时会话",
    slots: { ...EMPTY_SLOTS, ...(t.slots || {}) },
    windows,
    turns,
    createdAt: t.createdAt || nowIso(),
    updatedAt: t.updatedAt || nowIso(),
  };
}

function migrateFlatMessages(messages, windowId) {
  const turns = [];
  let pending = null;
  for (const m of messages) {
    if (m.role === "user") {
      pending = { content: m.content, createdAt: m.createdAt };
    } else if (m.role === "assistant" && pending) {
      turns.push({
        id: m.id || newId(),
        user: pending,
        replies: [
          {
            windowId,
            content: m.content,
            thinking: m.thinking,
            model: m.model,
            contextTrace: m.contextTrace,
          },
        ],
        createdAt: m.createdAt,
      });
      pending = null;
    }
  }
  return turns;
}

function saveTemps(list) {
  const trimmed = list
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, MAX_TEMPS);
  localStorage.setItem(TEMP_STORAGE_KEY, JSON.stringify(trimmed));
  return trimmed;
}

function upsertTemp(temp) {
  const list = loadTemps().filter((t) => t.id !== temp.id);
  list.unshift(temp);
  return saveTemps(list);
}

function deleteTemp(id) {
  return saveTemps(loadTemps().filter((t) => t.id !== id));
}

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function setStatus(text, isError = false) {
  if (!text) {
    els.status.hidden = true;
    els.status.textContent = "";
    return;
  }
  els.status.hidden = false;
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slotsFromEditor() {
  return {
    systemPrompt: els.shellSystem.value,
    loreBefore: els.shellLoreBefore.value,
    seedHistory: els.shellSeedHistory.value,
    loreAfter: els.shellLoreAfter.value,
    postTurn: els.shellPostTurn.value,
  };
}

function fillEditor(shellLike) {
  const s = shellLike || { name: "", ...EMPTY_SLOTS };
  els.shellName.value = s.name || "";
  els.shellSystem.value = s.systemPrompt || "";
  els.shellLoreBefore.value = s.loreBefore || "";
  els.shellSeedHistory.value = s.seedHistory || "";
  els.shellLoreAfter.value = s.loreAfter || "";
  els.shellPostTurn.value = s.postTurn || "";
}

function setContextEditorEnabled(enabled, subtitle) {
  const fields = [
    els.shellName,
    els.shellSystem,
    els.shellLoreBefore,
    els.shellSeedHistory,
    els.shellLoreAfter,
    els.shellPostTurn,
    els.btnSaveShell,
  ];
  for (const el of fields) el.disabled = !enabled;
  if (els.contextSub) {
    els.contextSub.textContent =
      subtitle || (enabled ? "改完点应用" : "选择或新建后编辑");
  }
}

function syncContextPanel() {
  if (activeIsTemp) {
    fillEditor(activeShell || { name: "临时会话", ...EMPTY_SLOTS });
    setContextEditorEnabled(true, "点应用后写入本机");
    return;
  }
  if (activeShell) {
    fillEditor(activeShell);
    setContextEditorEnabled(true, "持久上下文 · 点应用写入本机");
    return;
  }
  fillEditor({ name: "", ...EMPTY_SLOTS });
  setContextEditorEnabled(false, "选择或新建后编辑");
}

function windowLabel(w) {
  return w.profileName || w.model || w.profileId || "窗口";
}

const BLIND_MARKS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];

function shuffleIds(ids) {
  const next = ids.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = next[i];
    next[i] = next[j];
    next[j] = swap;
  }
  return next;
}

function syncBlindOrder() {
  const ids = new Set(activeWindows.map((w) => w.id));
  blindOrder = blindOrder.filter((id) => ids.has(id));
  for (const w of activeWindows) {
    if (blindOrder.includes(w.id)) continue;
    const at = Math.floor(Math.random() * (blindOrder.length + 1));
    blindOrder.splice(at, 0, w.id);
  }
}

function displayWindows() {
  if (!blindModels || activeWindows.length < 2) return activeWindows;
  syncBlindOrder();
  const byId = new Map(activeWindows.map((w) => [w.id, w]));
  return blindOrder.map((id) => byId.get(id)).filter(Boolean);
}

function blindLabel(index) {
  const mark = BLIND_MARKS[index] || String(index + 1);
  return `模型${mark}`;
}

function publicWindowLabel(w) {
  if (!blindModels || activeWindows.length < 2) return windowLabel(w);
  const index = displayWindows().findIndex((item) => item.id === w.id);
  return index >= 0 ? blindLabel(index) : "该回复";
}

function toggleBlindModels() {
  if (activeWindows.length < 2) {
    setStatus("至少两个模型才能打乱位置", true);
    return;
  }
  blindModels = !blindModels;
  blindOrder = blindModels ? shuffleIds(activeWindows.map((w) => w.id)) : [];
  setStatus(blindModels ? "已隐藏模型名并打乱位置" : "已恢复模型名和原位置");
  renderArena();
}

function formatBubbleTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function cardExpandKey(turnId, windowId) {
  return `${turnId}:${windowId}`;
}

function replyView(reply) {
  if (!reply) {
    return { cls: "is-pending", empty: true, thinking: "", text: "本轮无回复" };
  }
  if (reply.pending) {
    return { cls: "is-pending", empty: true, thinking: "", text: "回复中…" };
  }
  if (reply.error) {
    return {
      cls: "is-error",
      empty: true,
      thinking: "",
      text: String(reply.error),
    };
  }
  const text = String(reply.content || "");
  const thinking = String(reply.thinking || "");
  if (!text.trim() && !thinking.trim()) {
    return { cls: "is-pending", empty: true, thinking: "", text: "本轮无回复" };
  }
  return { cls: "", empty: false, thinking, text };
}

function persistActiveSessionMeta() {
  if (activeIsTemp && activeConversationId) {
    const temp = loadTemps().find((t) => t.id === activeConversationId);
    if (!temp) return;
    temp.windows = activeWindows;
    temp.turns = activeTurns;
    temp.slots = { ...EMPTY_SLOTS, ...(temp.slots || {}), ...slotsFromEditor() };
    temp.updatedAt = nowIso();
    upsertTemp(temp);
    return;
  }
  if (!activeIsTemp && activeConversationId) {
    api(
      `/api/direct-chat/conversations/${encodeURIComponent(activeConversationId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          windows: activeWindows,
          turns: activeTurns,
        }),
      },
    ).catch((err) =>
      setStatus(err instanceof Error ? err.message : String(err), true),
    );
  }
}

function renderPath() {
  const items = [];
  items.push(
    navLevel === "root" && !activeIsTemp
      ? `<li class="path-bar-item"><span class="path-bar-current">直聊</span></li>`
      : `<li class="path-bar-item"><button type="button" data-nav="root">直聊</button></li>`,
  );
  if (navLevel === "shell" || (navLevel === "conversation" && !activeIsTemp)) {
    const shellLabel = activeShell?.name || "上下文";
    if (navLevel === "shell") {
      items.push(
        `<li class="path-bar-item"><span class="path-bar-current">${escapeHtml(shellLabel)}</span></li>`,
      );
    } else {
      items.push(
        `<li class="path-bar-item"><button type="button" data-nav="shell">${escapeHtml(shellLabel)}</button></li>`,
      );
      const convLabel =
        conversations.find((c) => c.id === activeConversationId)?.name || "会话";
      items.push(
        `<li class="path-bar-item"><span class="path-bar-current">${escapeHtml(convLabel)}</span></li>`,
      );
    }
  } else if (activeIsTemp) {
    items.push(
      `<li class="path-bar-item"><span class="path-bar-current">临时</span></li>`,
    );
  }
  els.pathList.innerHTML = items.join("");
}

function renderRootRail() {
  const temps = loadTemps();
  const parts = [];
  if (temps.length) {
    parts.push(`<p class="chat-rail-item-meta">快速对话（浏览器）</p>`);
    for (const t of temps) {
      parts.push(
        railItemHtml({
          id: t.id,
          title: t.name || "临时会话",
          meta: `${t.turns?.length || 0} 轮 · 临时`,
          temp: true,
          active: activeIsTemp && activeConversationId === t.id,
        }),
      );
    }
  }
  parts.push(`<p class="chat-rail-item-meta">已保存上下文</p>`);
  if (!shells.length) {
    parts.push(`<p class="chat-rail-item-meta">还没有上下文壳</p>`);
  }
  for (const s of shells) {
    parts.push(
      railItemHtml({
        id: s.id,
        title: s.name,
        meta: `${s.conversationCount} 个会话`,
        temp: false,
        active: !activeIsTemp && activeShellId === s.id,
      }),
    );
  }
  els.railList.innerHTML = parts.join("");
}

function renderRail() {
  if (navLevel === "root" || activeIsTemp) {
    renderRootRail();
    return;
  }
  if (navLevel === "shell") {
    const parts = [];
    if (!conversations.length) {
      parts.push(`<p class="chat-rail-item-meta">还没有会话</p>`);
    }
    for (const c of conversations) {
      parts.push(
        railItemHtml({
          id: c.id,
          title: c.name,
          meta: `${c.messageCount} 条消息`,
          temp: false,
          active: activeConversationId === c.id,
        }),
      );
    }
    els.railList.innerHTML = parts.join("");
    return;
  }
  els.railList.innerHTML = conversations
    .map((c) =>
      railItemHtml({
        id: c.id,
        title: c.name,
        meta: `${c.messageCount} 条消息`,
        temp: false,
        active: activeConversationId === c.id,
      }),
    )
    .join("");
}

function railItemHtml({ id, title, meta, temp, active }) {
  return `<div class="chat-rail-item ${active ? "active" : ""}" data-id="${escapeHtml(id)}" data-temp="${temp ? "1" : "0"}">
    <button type="button" class="chat-rail-item-main" data-action="open">
      <span class="chat-rail-item-title">${escapeHtml(title)}</span>
      <span class="chat-rail-item-meta">${escapeHtml(meta)}</span>
    </button>
    <button type="button" class="chat-rail-item-del" data-action="delete" title="删除">×</button>
  </div>`;
}

function syncTempMark() {
  if (!els.tempMark) return;
  const show = activeIsTemp && navLevel === "conversation" && activeTurns.length === 0;
  els.tempMark.hidden = !show;
}

function syncComposerMenu() {
  if (els.btnSaveTemp) els.btnSaveTemp.hidden = true;
  if (!els.more || !els.morePanel) return;
  const inConv = navLevel === "conversation" && Boolean(activeConversationId);
  els.more.hidden = !inConv;
  if (!inConv) {
    els.more.removeAttribute("open");
    els.morePanel.innerHTML = "";
    return;
  }
  const only = activeWindows.length === 1 ? activeWindows[0] : null;
  const items = [
    `<button type="button" class="chat-more-item" data-action="add-window" role="menuitem">增加模型</button>`,
  ];
  if (only) {
    items.push(
      `<button type="button" class="chat-more-item" data-action="remove-window" data-window-id="${escapeHtml(only.id)}" role="menuitem">移除此模型</button>`,
    );
  }
  if (activeWindows.length > 1) {
    items.push(
      `<button type="button" class="chat-more-item" data-action="blind-models" role="menuitem">${blindModels ? "显示模型名并恢复位置" : "隐藏模型名并打乱位置"}</button>`,
    );
  }
  if (activeIsTemp) {
    items.push(
      `<button type="button" class="chat-more-item" data-action="save-temp" role="menuitem">保存为持久会话</button>`,
    );
  }
  els.morePanel.innerHTML = items.join("");
}

function renderReplyCard(turn, w, multi, displayIndex) {
  const reply = turn
    ? (turn.replies || []).find((r) => r.windowId === w.id)
    : null;
  const body = turn
    ? replyView(reply)
    : { cls: "is-pending", empty: true, thinking: "", text: "在下方输入后同时回复" };
  const selected = Boolean(turn && turn.selectedWindowId === w.id && !body.empty);
  const turnId = turn?.id || "idle";
  const keep =
    turn && multi && !body.empty
      ? `<button type="button" class="chat-select-btn ${selected ? "is-on" : ""}" data-action="select-reply" data-turn-id="${escapeHtml(turn.id)}" data-window-id="${escapeHtml(w.id)}">${selected ? "已保留 · 取消" : "保留此回复"}</button>`
      : turn && selected
        ? `<span class="chat-select-btn is-on">已保留</span>`
        : "";
  const remove =
    activeWindows.length > 1
      ? `<button type="button" class="chat-remove-btn" data-action="remove-window" data-window-id="${escapeHtml(w.id)}" title="移除此模型">移除</button>`
      : "";
  return `<article class="chat-reply-card ${selected ? "is-selected" : ""} ${body.cls === "is-error" ? "is-error" : ""}" data-window-id="${escapeHtml(w.id)}" data-turn-id="${escapeHtml(turnId)}">
    <header class="chat-reply-card-head">
      <div class="chat-reply-card-titles">
        <span class="chat-reply-card-name">${escapeHtml(blindModels && multi ? blindLabel(displayIndex) : windowLabel(w))}</span>
        ${blindModels && multi ? "" : `<span class="chat-reply-card-model">${escapeHtml(w.model || w.profileId || "")}</span>`}
      </div>
      ${remove}
    </header>
    <div class="chat-reply-card-body ${body.cls}" data-empty="${body.empty ? "1" : "0"}">
      <div class="chat-reply-card-text">${replyBodyHtml(body)}</div>
    </div>
    <div class="chat-reply-card-foot">
      <button type="button" class="chat-expand-btn" data-action="expand-card" data-turn-id="${escapeHtml(turnId)}" data-window-id="${escapeHtml(w.id)}" hidden>展开</button>
      ${keep}
    </div>
  </article>`;
}

function replyBodyHtml(body) {
  if (body.empty) return escapeHtml(body.text);
  const thinkingHtml = body.thinking
    ? `<div class="chat-bubble-thinking">${renderMarkdownToHtml(body.thinking)}</div>`
    : "";
  return `${thinkingHtml}${renderMarkdownToHtml(body.text)}`;
}

function renderTurnStrip(turn) {
  const multi = activeWindows.length > 1;
  const count = activeWindows.length;
  const cards = displayWindows()
    .map((w, index) => renderReplyCard(turn, w, multi, index))
    .join("");
  const turnId = turn?.id || "idle";
  const userBlock = turn
    ? (() => {
        const time = formatBubbleTime(turn.user?.createdAt || turn.createdAt);
        return `<div class="chat-user-row">
          <article class="chat-user-bubble">
            <div class="chat-user-body">${escapeHtml(turn.user?.content || "")}</div>
            ${time ? `<time class="chat-bubble-time">${escapeHtml(time)}</time>` : ""}
          </article>
        </div>`;
      })()
    : "";
  const stripBar = multi
    ? `<div class="chat-strip-bar">
      <span class="chat-strip-hint">左右切换，上下阅读</span>
      <div class="chat-strip-nav">
        <button type="button" class="chat-nav-btn" data-action="strip-prev" data-turn-id="${escapeHtml(turnId)}" aria-label="上一组">‹</button>
        <span class="chat-strip-idx" data-strip-idx="${escapeHtml(turnId)}">1 / ${count}</span>
        <button type="button" class="chat-nav-btn" data-action="strip-next" data-turn-id="${escapeHtml(turnId)}" aria-label="下一组">›</button>
      </div>
    </div>`
    : "";
  return `<section class="chat-turn" data-turn-id="${escapeHtml(turnId)}">
    ${userBlock}
    ${stripBar}
    <div class="chat-reply-track" data-turn-id="${escapeHtml(turnId)}" data-count="${count}" tabindex="0">${cards}</div>
  </section>`;
}

function measureTrack(track) {
  const card = track.querySelector(".chat-reply-card");
  const styles = getComputedStyle(track);
  const gap = Number.parseFloat(styles.columnGap || styles.gap || "10") || 10;
  const cardW = card?.offsetWidth || track.clientWidth || 1;
  const step = cardW + (card ? gap : 0);
  const trackW = track.clientWidth || 1;
  const count = track.querySelectorAll(".chat-reply-card").length;
  const visible = Math.max(1, Math.floor((trackW + 1) / Math.max(step, 1)));
  track._geo = { step: Math.max(step, 1), visible, count };
  return track._geo;
}

function cardStep(track) {
  return (track._geo || measureTrack(track)).step;
}

function visibleCardCount(track) {
  return (track._geo || measureTrack(track)).visible;
}

function updateStripIdx(track) {
  const geo = track._geo || measureTrack(track);
  if (!geo.count) return;
  const turnId = track.getAttribute("data-turn-id") || "";
  const idx = els.arena?.querySelector(`[data-strip-idx="${CSS.escape(turnId)}"]`);
  if (!idx) return;
  const start = Math.min(
    Math.max(0, geo.count - geo.visible),
    Math.max(0, Math.round(track.scrollLeft / geo.step)),
  );
  const end = Math.min(geo.count, start + geo.visible);
  const label =
    end > start + 1
      ? `${start + 1}–${end} / ${geo.count}`
      : `${start + 1} / ${geo.count}`;
  if (idx.textContent !== label) idx.textContent = label;
  const prev = els.arena?.querySelector(
    `[data-action="strip-prev"][data-turn-id="${CSS.escape(turnId)}"]`,
  );
  const next = els.arena?.querySelector(
    `[data-action="strip-next"][data-turn-id="${CSS.escape(turnId)}"]`,
  );
  const lastPage = Math.max(0, geo.count - geo.visible);
  if (prev) prev.disabled = start <= 0;
  if (next) next.disabled = start >= lastPage;
}

function scrollTrackToIndex(track, index) {
  const cards = [...track.querySelectorAll(".chat-reply-card")];
  const card = cards[index];
  if (!card) return;
  track.scrollTo({
    left: card.offsetLeft - track.offsetLeft,
    behavior: "smooth",
  });
}

function verticalScrollTarget(from) {
  const card = from?.closest?.(".chat-reply-card");
  const text = card?.querySelector(".chat-reply-card-text");
  if (text && text.scrollHeight > text.clientHeight + 1) return text;
  return els.arena?.querySelector(".chat-arena-stream") || null;
}

const DRAG_SLOP = 8;

function clearTextSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) sel.removeAllRanges();
}

function bindReplyTrack(track) {
  let dragging = false;
  let axis = null;
  let startX = 0;
  let startY = 0;
  let startScroll = 0;
  let vTarget = null;
  let startVScroll = 0;

  track.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    dragging = true;
    axis = null;
    vTarget = null;
    startX = e.clientX;
    startY = e.clientY;
    startScroll = track.scrollLeft;
  });

  track.addEventListener("selectstart", (e) => {
    if (axis) e.preventDefault();
  });

  track.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!axis) {
      if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      track.classList.add("is-dragging");
      track.setPointerCapture(e.pointerId);
      if (e.cancelable) e.preventDefault();
      clearTextSelection();
      if (axis === "y") {
        vTarget = verticalScrollTarget(e.target);
        if (vTarget) {
          startVScroll = vTarget.scrollTop;
          vTarget.classList.add("is-vscroll");
        }
      }
    }
    if (e.cancelable) e.preventDefault();
    if (axis === "x") {
      track.scrollLeft = startScroll - dx;
      return;
    }
    if (vTarget) vTarget.scrollTop = startVScroll - dy;
  });

  const end = () => {
    dragging = false;
    axis = null;
    track.classList.remove("is-dragging");
    vTarget?.classList.remove("is-vscroll");
    vTarget = null;
  };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
  track.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const stream = els.arena?.querySelector(".chat-arena-stream");
      if (!stream) return;
      e.preventDefault();
      stream.scrollTop += e.deltaY;
    },
    { passive: false },
  );
  let scrollFrame = 0;
  track.addEventListener(
    "scroll",
    () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        updateStripIdx(track);
      });
    },
    { passive: true },
  );
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      measureTrack(track);
      updateStripIdx(track);
    });
    observer.observe(track);
  }
  measureTrack(track);
  updateStripIdx(track);
}

function collapseReplyTracks() {
  if (!els.arena) return;
  for (const track of els.arena.querySelectorAll(".chat-reply-track")) {
    const cards = [...track.querySelectorAll(".chat-reply-card")];
    if (cards.length < 2) {
      for (const card of cards) {
        card.style.height = "auto";
        card.classList.remove("is-collapsed");
        const btn = card.querySelector("[data-action='expand-card']");
        if (btn) btn.hidden = true;
      }
      continue;
    }
    const measured = cards.map((card) => {
      card.style.height = "auto";
      const empty = card.querySelector(".chat-reply-card-body")?.dataset.empty === "1";
      return { card, h: card.offsetHeight, empty };
    });
    const substantive = measured.filter((item) => !item.empty).map((item) => item.h);
    const shortest = substantive.length ? Math.min(...substantive) : MIN_CARD_H;
    const target = Math.max(MIN_CARD_H, shortest);
    for (const { card, h } of measured) {
      const turnId = card.getAttribute("data-turn-id") || "";
      const windowId = card.getAttribute("data-window-id") || "";
      const key = cardExpandKey(turnId, windowId);
      const btn = card.querySelector("[data-action='expand-card']");
      if (expandedCards.has(key)) {
        card.style.height = "auto";
        card.classList.remove("is-collapsed");
        if (btn) {
          btn.hidden = false;
          btn.textContent = "收起";
        }
        continue;
      }
      card.style.height = `${target}px`;
      card.classList.add("is-collapsed");
      if (btn) {
        btn.hidden = !(h > target + 1);
        btn.textContent = "展开";
      }
    }
  }
}

function renderArena() {
  if (!els.arena) return;
  const scrollLefts = new Map();
  for (const track of els.arena.querySelectorAll(".chat-reply-track")) {
    scrollLefts.set(track.getAttribute("data-turn-id") || "", track.scrollLeft);
  }
  syncTempMark();
  syncComposerMenu();
  if (!activeWindows.length) {
    els.arena.classList.add("is-empty");
    els.arena.innerHTML = `<button type="button" class="chat-add-card" data-action="add-window" aria-label="增加模型">+</button>`;
    return;
  }
  els.arena.classList.remove("is-empty");

  const body = activeTurns.length
    ? activeTurns.map((turn) => renderTurnStrip(turn)).join("")
    : `<p class="chat-arena-idle">在下方输入，各模型会同时回复同一条消息。</p>${renderTurnStrip(null)}`;

  els.arena.innerHTML = `<div class="chat-arena-stream">${body}</div>`;
  for (const track of els.arena.querySelectorAll(".chat-reply-track")) {
    bindReplyTrack(track);
  }
  const finalize = () => {
    for (const track of els.arena.querySelectorAll(".chat-reply-track")) {
      const left = scrollLefts.get(track.getAttribute("data-turn-id") || "");
      if (left) track.scrollLeft = left;
    }
    collapseReplyTracks();
    for (const track of els.arena.querySelectorAll(".chat-reply-track")) {
      measureTrack(track);
      updateStripIdx(track);
    }
    const stream = els.arena.querySelector(".chat-arena-stream");
    if (stream) stream.scrollTop = stream.scrollHeight;
  };
  // 等 flex 宽度落地后再量卡片与折叠高度
  requestAnimationFrame(() => requestAnimationFrame(finalize));
}

function setComposerEnabled(enabled) {
  els.input.disabled = !enabled;
  els.btnSend.disabled = !enabled;
}

function ensureDraftTemp() {
  const temps = loadTemps();
  if (temps.length) return temps[0];
  const temp = {
    id: newId(),
    name: "临时会话",
    slots: { ...EMPTY_SLOTS },
    windows: [],
    turns: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  upsertTemp(temp);
  return temp;
}

function openDraftTemp() {
  const temp = ensureDraftTemp();
  activeIsTemp = true;
  activeConversationId = temp.id;
  activeShellId = null;
  activeShell = { name: temp.name || "临时会话", ...EMPTY_SLOTS, ...temp.slots };
  activeWindows = Array.isArray(temp.windows) ? temp.windows : [];
  activeTurns = temp.turns || [];
  navLevel = "conversation";
  els.btnSaveTemp.hidden = false;
  els.btnNewConv.hidden = true;
  setComposerEnabled(true);
  syncContextPanel();
  renderArena();
}

function syncRoomChrome() {
  els.btnNewConv.hidden = !(
    navLevel === "shell" ||
    (navLevel === "conversation" && !activeIsTemp)
  );
  syncContextPanel();
  els.room.hidden = false;

  if (navLevel === "shell" && !activeIsTemp) {
    els.btnSaveTemp.hidden = true;
    setComposerEnabled(false);
    activeWindows = [];
    activeTurns = [];
    syncTempMark();
    syncComposerMenu();
    if (els.arena) {
      els.arena.classList.remove("is-empty");
      els.arena.innerHTML =
        `<div class="chat-arena-empty">尚未打开会话。从左侧选会话，或点「新建会话」。</div>`;
    }
    return;
  }

  if (navLevel !== "conversation") {
    openDraftTemp();
    return;
  }

  els.btnSaveTemp.hidden = !activeIsTemp;
  setComposerEnabled(true);
  renderArena();
}

async function refreshShells() {
  const data = await api("/api/direct-chat/shells");
  shells = data.shells || [];
}

async function refreshConversations(shellId) {
  const data = await api(
    `/api/direct-chat/shells/${encodeURIComponent(shellId)}`,
  );
  activeShell = data.shell;
  conversations = data.conversations || [];
  fillEditor(activeShell);
}

async function loadProfiles() {
  try {
    const data = await api("/api/profiles");
    profileList = (data.profiles || []).map((p) => ({
      id: p.id,
      name: p.name,
      model: p.model,
      hasKey: Boolean(String(p.apiKey ?? "").trim()),
    }));
  } catch {
    profileList = [];
  }
}

async function goRoot() {
  activeShellId = null;
  conversations = [];
  await refreshShells();
  openDraftTemp();
  renderPath();
  renderRail();
}

async function openShell(shellId) {
  activeIsTemp = false;
  activeShellId = shellId;
  activeConversationId = null;
  activeTurns = [];
  activeWindows = [];
  navLevel = "shell";
  await refreshConversations(shellId);
  renderPath();
  renderRail();
  syncRoomChrome();
}

async function openConversation(conversationId) {
  const data = await api(
    `/api/direct-chat/conversations/${encodeURIComponent(conversationId)}`,
  );
  activeIsTemp = false;
  activeConversationId = conversationId;
  activeShellId = data.conversation.shellId;
  activeShell = data.shell;
  activeWindows = data.conversation.windows || [];
  activeTurns = data.conversation.turns || [];
  navLevel = "conversation";
  if (activeShellId) {
    const shellData = await api(
      `/api/direct-chat/shells/${encodeURIComponent(activeShellId)}`,
    );
    conversations = shellData.conversations || [];
    activeShell = shellData.shell || activeShell;
  }
  renderPath();
  renderRail();
  syncRoomChrome();
}

function openTemp(tempId) {
  const temp = loadTemps().find((t) => t.id === tempId);
  if (!temp) return;
  activeIsTemp = true;
  activeConversationId = temp.id;
  activeShellId = null;
  activeShell = { name: temp.name || "临时会话", ...EMPTY_SLOTS, ...temp.slots };
  activeWindows = temp.windows || [];
  activeTurns = temp.turns || [];
  navLevel = "conversation";
  renderPath();
  renderRail();
  syncRoomChrome();
}

async function createShellAndOpen() {
  const name = window.prompt("上下文名称", "新上下文");
  if (name == null) return;
  const data = await api("/api/direct-chat/shells", {
    method: "POST",
    body: JSON.stringify({ name: name.trim() || "新上下文", ...EMPTY_SLOTS }),
  });
  await refreshShells();
  await openShell(data.shell.id);
}

async function createConversationUnderShell() {
  if (!activeShellId) return;
  const name = window.prompt("会话名称", "新会话");
  if (name == null) return;
  const data = await api(
    `/api/direct-chat/shells/${encodeURIComponent(activeShellId)}/conversations`,
    {
      method: "POST",
      body: JSON.stringify({
        name: name.trim() || "新会话",
        windows: activeWindows,
        turns: [],
      }),
    },
  );
  await openConversation(data.conversation.id);
}

async function saveShellEditor() {
  const slots = slotsFromEditor();
  const name = els.shellName.value.trim() || "未命名上下文";
  if (activeIsTemp && activeConversationId) {
    if (busy) return;
    const tempId = activeConversationId;
    const temp = loadTemps().find((t) => t.id === tempId);
    if (!temp) return;
    busy = true;
    els.btnSaveShell.disabled = true;
    try {
      const data = await api("/api/direct-chat/promote", {
        method: "POST",
        body: JSON.stringify({
          shell: { name, ...slots },
          conversationName: "会话",
          windows: activeWindows,
          turns: activeTurns,
        }),
      });
      deleteTemp(tempId);
      await openConversation(data.conversation.id);
      setStatus("已保存为持久会话");
    } finally {
      busy = false;
      if (activeIsTemp) syncContextPanel();
    }
    return;
  }
  if (!activeShellId) return;
  const data = await api(
    `/api/direct-chat/shells/${encodeURIComponent(activeShellId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name, ...slots }),
    },
  );
  activeShell = data.shell;
  fillEditor(activeShell);
  await refreshShells();
  renderPath();
  renderRail();
  if (els.contextSub) els.contextSub.textContent = "已保存";
  setStatus("上下文已保存");
}

function replyFromWindowResult(result) {
  return {
    windowId: result.windowId,
    content: result.reply || "",
    ...(result.reasoning ? { thinking: result.reasoning } : {}),
    ...(result.model ? { model: result.model } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.contextTrace ? { contextTrace: result.contextTrace } : {}),
  };
}

function makePendingTurn(text) {
  const ts = nowIso();
  return {
    id: newId(),
    pending: true,
    user: { content: text, createdAt: ts },
    replies: activeWindows.map((w) => ({
      windowId: w.id,
      content: "",
      pending: true,
    })),
    createdAt: ts,
  };
}

async function readNdjson(res, onEvent) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("响应无法读取");
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
      nl = buf.indexOf("\n");
    }
  }
  const tail = buf.trim();
  if (tail) onEvent(JSON.parse(tail));
}

async function postMulti(path, body, hooks) {
  const onWindow = hooks.onWindow || (() => {});
  const onDelta = hooks.onDelta || (() => {});
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson, application/json",
    },
    body: JSON.stringify(body),
  });
  const ctype = res.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text || res.statusText };
    }
    if (!res.ok) throw new Error(data?.error || res.statusText || `HTTP ${res.status}`);
    for (const result of data?.multi?.results || []) onWindow(result);
    return data;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText || `HTTP ${res.status}`);
  }
  let done = null;
  await readNdjson(res, (event) => {
    if (event.type === "delta" && event.delta) onDelta(event);
    else if (event.type === "window" && event.result) onWindow(event.result);
    else if (event.type === "done") done = event;
    else if (event.type === "error") throw new Error(event.error || "发送失败");
  });
  if (!done?.multi?.turn) throw new Error("未返回回合结果");
  return done;
}

const streamingPaints = new Set();

function paintStreamingReply(turn, windowId) {
  const card = els.arena?.querySelector(
    `.chat-reply-card[data-turn-id="${CSS.escape(turn.id)}"][data-window-id="${CSS.escape(windowId)}"]`,
  );
  const reply = (turn.replies || []).find((r) => r.windowId === windowId);
  if (!card || !reply) {
    renderArena();
    return;
  }
  const body = replyView(reply);
  const bodyEl = card.querySelector(".chat-reply-card-body");
  const textEl = card.querySelector(".chat-reply-card-text");
  if (!bodyEl || !textEl) return;
  bodyEl.classList.toggle("is-pending", body.cls === "is-pending");
  bodyEl.classList.toggle("is-error", body.cls === "is-error");
  bodyEl.dataset.empty = body.empty ? "1" : "0";
  textEl.innerHTML = replyBodyHtml(body);
  card.style.height = "auto";
  card.classList.remove("is-collapsed");
  const stream = els.arena?.querySelector(".chat-arena-stream");
  if (stream) {
    const gap = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
    if (gap < 80) stream.scrollTop = stream.scrollHeight;
  }
}

function scheduleStreamingPaint(turn, windowId) {
  if (streamingPaints.has(windowId)) return;
  streamingPaints.add(windowId);
  requestAnimationFrame(() => {
    streamingPaints.delete(windowId);
    paintStreamingReply(turn, windowId);
  });
}

let rememberTimer = 0;

function writeStreamingTurn() {
  if (!activeIsTemp || !activeConversationId) return;
  const temp = loadTemps().find((t) => t.id === activeConversationId);
  if (!temp) return;
  temp.turns = activeTurns.map((t) => ({
    ...t,
    replies: (t.replies || []).map((r) => {
      const { pending: _pending, ...rest } = r;
      return rest;
    }),
  }));
  temp.windows = activeWindows;
  temp.updatedAt = nowIso();
  upsertTemp(temp);
}

function rememberStreamingTurn() {
  if (!activeIsTemp || !activeConversationId) return;
  if (rememberTimer) return;
  rememberTimer = window.setTimeout(() => {
    rememberTimer = 0;
    writeStreamingTurn();
  }, 400);
}

function finishSendStatus(results) {
  const failed = (results || []).filter((r) => r.error);
  setStatus(
    failed.length ? `${failed.length} 个窗口失败，其余已写入` : "",
    failed.length > 0,
  );
}

async function sendMessage() {
  if (busy) return;
  const text = els.input.value.trim();
  if (!text) return;
  if (navLevel !== "conversation" || !activeConversationId) {
    setStatus("请先打开一个会话", true);
    return;
  }
  if (!activeWindows.length) {
    setStatus("请先新增至少一个模型窗口", true);
    return;
  }
  const total = activeWindows.length;
  const priorTurns = activeTurns.slice();
  const pending = makePendingTurn(text);
  let arrived = 0;
  let sawText = false;
  busy = true;
  els.btnSend.disabled = true;
  els.input.value = "";
  activeTurns = [...priorTurns, pending];
  setStatus(total > 1 ? `回复中 0/${total}` : "回复中…");
  renderArena();
  const onDelta = (event) => {
    let reply = pending.replies.find((r) => r.windowId === event.windowId);
    if (!reply) {
      reply = { windowId: event.windowId, content: "", thinking: "" };
      pending.replies.push(reply);
    }
    reply.pending = false;
    if (event.field === "thinking") {
      reply.thinking = `${reply.thinking || ""}${event.delta}`;
    } else {
      reply.content = `${reply.content || ""}${event.delta}`;
    }
    sawText = true;
    scheduleStreamingPaint(pending, event.windowId);
    rememberStreamingTurn();
  };
  const onWindow = (result) => {
    const idx = pending.replies.findIndex((r) => r.windowId === result.windowId);
    const reply = replyFromWindowResult(result);
    if (idx >= 0) pending.replies[idx] = reply;
    else pending.replies.push(reply);
    if (reply.content || reply.thinking) sawText = true;
    arrived += 1;
    setStatus(total > 1 ? `回复中 ${arrived}/${total}` : "回复中…");
    rememberStreamingTurn();
    renderArena();
  };
  const hooks = { onDelta, onWindow };
  try {
    if (activeIsTemp) {
      const temp = loadTemps().find((t) => t.id === activeConversationId);
      if (!temp) throw new Error("临时会话不存在");
      const slots = { ...EMPTY_SLOTS, ...temp.slots };
      const data = await postMulti(
        "/api/direct-chat/ephemeral/complete",
        {
          text,
          ...slots,
          windows: activeWindows,
          turns: priorTurns,
        },
        hooks,
      );
      const multi = data.multi;
      activeTurns = [...priorTurns, multi.turn];
      temp.turns = activeTurns;
      temp.windows = activeWindows;
      temp.slots = slots;
      temp.updatedAt = nowIso();
      upsertTemp(temp);
      finishSendStatus(multi.results);
      renderArena();
      renderRail();
      return;
    }

    const data = await postMulti(
      `/api/direct-chat/conversations/${encodeURIComponent(activeConversationId)}/messages`,
      { text, windows: activeWindows },
      hooks,
    );
    activeTurns = data.conversation?.turns || [...priorTurns, data.multi.turn];
    activeWindows = data.conversation?.windows || activeWindows;
    if (data.shell) activeShell = data.shell;
    finishSendStatus(data.multi?.results);
    renderArena();
    if (activeShellId) {
      const shellData = await api(
        `/api/direct-chat/shells/${encodeURIComponent(activeShellId)}`,
      );
      conversations = shellData.conversations || [];
      renderRail();
    }
  } catch (err) {
    if (!sawText && arrived === 0) {
      activeTurns = priorTurns;
      els.input.value = text;
      renderArena();
    } else {
      for (const reply of pending.replies) {
        if (reply.pending) {
          reply.pending = false;
          reply.error = "未返回";
        }
      }
      if (rememberTimer) {
        clearTimeout(rememberTimer);
        rememberTimer = 0;
      }
      writeStreamingTurn();
      renderArena();
    }
    setStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    busy = false;
    els.btnSend.disabled = false;
  }
}

async function selectReply(turnId, windowId) {
  const turn = activeTurns.find((t) => t.id === turnId);
  if (!turn) return;
  const next =
    turn.selectedWindowId === windowId ? null : windowId;
  turn.selectedWindowId = next;
  activeTurns = activeTurns.map((t) =>
    t.id === turnId ? { ...t, selectedWindowId: next } : t,
  );
  renderArena();

  if (activeIsTemp) {
    persistActiveSessionMeta();
    setStatus(
      next
        ? `已保留「${publicWindowLabel(activeWindows.find((w) => w.id === next) || {})}」为后续共用基准`
        : "已取消保留，各窗口继续用各自回复",
    );
    return;
  }
  try {
    const data = await api(
      `/api/direct-chat/conversations/${encodeURIComponent(activeConversationId)}/turns/${encodeURIComponent(turnId)}/select`,
      {
        method: "POST",
        body: JSON.stringify({ windowId: next }),
      },
    );
    activeTurns = data.conversation.turns || activeTurns;
    renderArena();
    setStatus(
      next
        ? `已保留「${publicWindowLabel(activeWindows.find((w) => w.id === next) || {})}」为后续共用基准`
        : "已取消保留，各窗口继续用各自回复",
    );
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

function openAddWindowDialog() {
  const used = new Set(activeWindows.map((w) => w.profileId));
  const available = profileList.filter((p) => p.hasKey && !used.has(p.id));
  if (!available.length) {
    setStatus(
      used.size
        ? "没有更多可用的 API 配置"
        : "请先在设置里配置带 Key 的 API",
      true,
    );
    return;
  }
  els.addWindowProfile.innerHTML = available
    .map(
      (p) =>
        `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} · ${escapeHtml(p.model)}</option>`,
    )
    .join("");
  els.dialogAddWindow.showModal();
}

els.formAddWindow.addEventListener("submit", (e) => {
  const submitter = e.submitter;
  if (submitter?.value === "cancel") return;
  e.preventDefault();
  const profileId = els.addWindowProfile.value;
  const p = profileList.find((x) => x.id === profileId);
  if (!p) return;
  if (activeWindows.some((w) => w.profileId === profileId)) {
    setStatus("该配置已在窗口中", true);
    return;
  }
  activeWindows = [
    ...activeWindows,
    {
      id: newId(),
      profileId: p.id,
      profileName: p.name,
      model: p.model,
    },
  ];
  persistActiveSessionMeta();
  els.dialogAddWindow.close();
  renderArena();
  setStatus(`已新增窗口：${p.name}`);
});

function removeWindow(windowId) {
  activeWindows = activeWindows.filter((w) => w.id !== windowId);
  activeTurns = activeTurns.map((t) => ({
    ...t,
    replies: t.replies.filter((r) => r.windowId !== windowId),
    selectedWindowId:
      t.selectedWindowId === windowId ? null : t.selectedWindowId,
  }));
  for (const key of [...expandedCards]) {
    if (key.endsWith(`:${windowId}`)) expandedCards.delete(key);
  }
  persistActiveSessionMeta();
  renderArena();
}

els.formPromote.addEventListener("submit", async (e) => {
  const submitter = e.submitter;
  if (submitter?.value === "cancel") return;
  e.preventDefault();
  if (!activeIsTemp || !activeConversationId) return;
  const temp = loadTemps().find((t) => t.id === activeConversationId);
  if (!temp) return;
  try {
    const data = await api("/api/direct-chat/promote", {
      method: "POST",
      body: JSON.stringify({
        shell: {
          name: els.promoteShellName.value.trim() || "临时上下文",
          ...(temp.slots || EMPTY_SLOTS),
        },
        conversationName: els.promoteConvName.value.trim() || "会话",
        windows: temp.windows || activeWindows,
        turns: temp.turns || activeTurns,
      }),
    });
    deleteTemp(temp.id);
    els.dialogPromote.close();
    await openConversation(data.conversation.id);
    setStatus("已保存为持久会话");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
});

async function deleteRailItem(id, isTemp) {
  if (!window.confirm("确定删除？")) return;
  try {
    if (isTemp) {
      deleteTemp(id);
      if (activeConversationId === id) await goRoot();
      else {
        renderRail();
        renderPath();
      }
      return;
    }
    if (navLevel === "root" || activeIsTemp) {
      await api(`/api/direct-chat/shells/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (activeShellId === id) await goRoot();
      else
        await refreshShells().then(() => {
          renderRail();
        });
      return;
    }
    await api(`/api/direct-chat/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (activeConversationId === id) {
      if (activeShellId) await openShell(activeShellId);
      else await goRoot();
    } else if (activeShellId) {
      await refreshConversations(activeShellId);
      renderRail();
    }
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

// events
els.btnNewShell.addEventListener("click", () => {
  createShellAndOpen().catch((err) =>
    setStatus(err instanceof Error ? err.message : String(err), true),
  );
});
els.btnNewConv.addEventListener("click", () => {
  createConversationUnderShell().catch((err) =>
    setStatus(err instanceof Error ? err.message : String(err), true),
  );
});
els.btnSaveShell.addEventListener("click", () => {
  saveShellEditor().catch((err) =>
    setStatus(err instanceof Error ? err.message : String(err), true),
  );
});
function openPromoteDialog() {
  if (!activeIsTemp || !activeConversationId) return;
  const temp = loadTemps().find((t) => t.id === activeConversationId);
  if (!temp) return;
  els.promoteShellName.value = "临时上下文";
  els.promoteConvName.value = temp.name || "会话";
  els.dialogPromote.showModal();
}

els.btnSaveTemp.addEventListener("click", () => openPromoteDialog());
els.btnSend.addEventListener("click", () => {
  sendMessage().catch((err) =>
    setStatus(err instanceof Error ? err.message : String(err), true),
  );
});
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage().catch((err) =>
      setStatus(err instanceof Error ? err.message : String(err), true),
    );
  }
});

els.pathList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-nav]");
  if (!btn) return;
  const nav = btn.getAttribute("data-nav");
  if (nav === "root") {
    goRoot().catch((err) =>
      setStatus(err instanceof Error ? err.message : String(err), true),
    );
  } else if (nav === "shell" && activeShellId) {
    openShell(activeShellId).catch((err) =>
      setStatus(err instanceof Error ? err.message : String(err), true),
    );
  }
});

els.railList.addEventListener("click", (e) => {
  const del = e.target.closest("[data-action='delete']");
  const open = e.target.closest("[data-action='open']");
  const row = e.target.closest(".chat-rail-item");
  if (!row) return;
  const id = row.getAttribute("data-id");
  const isTemp = row.getAttribute("data-temp") === "1";
  if (del) {
    deleteRailItem(id, isTemp).catch((err) =>
      setStatus(err instanceof Error ? err.message : String(err), true),
    );
    return;
  }
  if (!open) return;
  if (isTemp) {
    openTemp(id);
    return;
  }
  if (activeIsTemp || navLevel === "root") {
    openShell(id).catch((err) =>
      setStatus(err instanceof Error ? err.message : String(err), true),
    );
    return;
  }
  openConversation(id).catch((err) =>
    setStatus(err instanceof Error ? err.message : String(err), true),
  );
});

els.morePanel?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-action");
  els.more?.removeAttribute("open");
  if (action === "add-window") {
    openAddWindowDialog();
    return;
  }
  if (action === "save-temp") {
    openPromoteDialog();
    return;
  }
  if (action === "blind-models") {
    toggleBlindModels();
    return;
  }
  if (action === "remove-window") {
    const id = btn.getAttribute("data-window-id");
    if (id) removeWindow(id);
  }
});

els.arena?.addEventListener("click", (e) => {
  if (e.target.closest("[data-action='add-window']")) {
    openAddWindowDialog();
    return;
  }
  const expandBtn = e.target.closest("[data-action='expand-card']");
  if (expandBtn) {
    const turnId = expandBtn.getAttribute("data-turn-id") || "";
    const windowId = expandBtn.getAttribute("data-window-id") || "";
    const key = cardExpandKey(turnId, windowId);
    if (expandedCards.has(key)) expandedCards.delete(key);
    else expandedCards.add(key);
    collapseReplyTracks();
    return;
  }
  const stripBtn = e.target.closest(
    "[data-action='strip-prev'], [data-action='strip-next']",
  );
  if (stripBtn) {
    const turnId = stripBtn.getAttribute("data-turn-id") || "";
    const track = els.arena.querySelector(
      `.chat-reply-track[data-turn-id="${CSS.escape(turnId)}"]`,
    );
    if (!track) return;
    const visible = visibleCardCount(track);
    const step = cardStep(track);
    const i = Math.round(track.scrollLeft / step);
    const lastPage = Math.max(
      0,
      track.querySelectorAll(".chat-reply-card").length - visible,
    );
    const nextIndex =
      stripBtn.getAttribute("data-action") === "strip-next"
        ? Math.min(lastPage, i + 1)
        : Math.max(0, i - 1);
    scrollTrackToIndex(track, nextIndex);
    return;
  }
  const removeBtn = e.target.closest("[data-action='remove-window']");
  if (removeBtn) {
    const id =
      removeBtn.getAttribute("data-window-id") ||
      removeBtn.closest("[data-window-id]")?.getAttribute("data-window-id");
    if (id) removeWindow(id);
    return;
  }
  const selectBtn = e.target.closest("[data-action='select-reply']");
  if (!selectBtn) return;
  const turnId = selectBtn.getAttribute("data-turn-id");
  const windowId = selectBtn.getAttribute("data-window-id");
  if (turnId && windowId) {
    selectReply(turnId, windowId).catch((err) =>
      setStatus(err instanceof Error ? err.message : String(err), true),
    );
  }
});

loadProfiles()
  .then(() => goRoot())
  .catch((err) =>
    setStatus(err instanceof Error ? err.message : String(err), true),
  );
