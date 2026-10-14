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
  roomTitle: $("chat-room-title"),
  roomSub: $("chat-room-sub"),
  arena: $("chat-arena"),
  input: $("chat-input"),
  status: $("chat-status"),
  shellEditor: $("shell-editor"),
  contextSub: $("context-sub"),
  btnNewShell: $("btn-new-shell"),
  btnSaveTemp: $("btn-save-temp"),
  btnNewConv: $("btn-new-conv"),
  btnAddWindow: $("btn-add-window"),
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
    setContextEditorEnabled(true, "临时上下文 · 仅浏览器");
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

function ensureDefaultWindow() {
  if (activeWindows.length) return;
  const p = profileList.find((x) => x.hasKey) || profileList[0];
  if (!p) return;
  activeWindows = [
    {
      id: newId(),
      profileId: p.id,
      profileName: p.name,
      model: p.model,
    },
  ];
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

function renderArena() {
  if (!els.arena) return;
  if (!activeWindows.length) {
    els.arena.innerHTML = `<div class="chat-arena-empty">还没有对照窗。点右上「新增窗口」加入模型；发送后各列同时回复。</div>`;
    return;
  }

  const multi = activeWindows.length > 1;
  els.arena.innerHTML = activeWindows
    .map((w) => {
      const hasSelection = activeTurns.some((t) => t.selectedWindowId === w.id);
      const messagesHtml = activeTurns.length
        ? activeTurns
            .map((turn) => {
              const reply = turn.replies.find((r) => r.windowId === w.id);
              const selected = turn.selectedWindowId === w.id;
              const userHtml = `<article class="chat-bubble user">
                <div class="chat-bubble-meta"><span>你</span></div>
                <div>${escapeHtml(turn.user.content)}</div>
              </article>`;
              let assistantInner;
              if (!reply) {
                assistantInner = `<p class="chat-rail-item-meta">本轮无回复</p>`;
              } else if (reply.error) {
                assistantInner = `<p class="chat-status error">${escapeHtml(reply.error)}</p>`;
              } else {
                assistantInner = `${
                  reply.thinking
                    ? `<div class="chat-bubble-thinking">${escapeHtml(reply.thinking)}</div>`
                    : ""
                }<div>${escapeHtml(reply.content || "")}</div>`;
              }
              const selectBtn =
                multi && reply && !reply.error
                  ? `<div class="chat-bubble-foot">
                      <button type="button" class="chat-select-btn ${selected ? "is-on" : ""}" data-action="select-reply" data-turn-id="${escapeHtml(turn.id)}" data-window-id="${escapeHtml(w.id)}">
                        ${selected ? "已保留 · 取消" : "保留此回复"}
                      </button>
                    </div>`
                  : selected
                    ? `<div class="chat-bubble-foot"><span class="chat-select-btn is-on">已保留</span></div>`
                    : "";
              return `${userHtml}
                <article class="chat-bubble assistant ${selected ? "is-selected" : ""}">
                  <div class="chat-bubble-meta"><span>助手</span>${reply?.model ? `<span>${escapeHtml(reply.model)}</span>` : ""}</div>
                  ${assistantInner}
                  ${selectBtn}
                </article>`;
            })
            .join("")
        : `<p class="chat-arena-col-empty">在下方输入，各列会同时回复同一条消息。</p>`;

      return `<section class="chat-arena-col ${hasSelection ? "is-selected" : ""}" data-window-id="${escapeHtml(w.id)}">
        <header class="chat-arena-col-head">
          <div class="chat-arena-col-titles">
            <span class="chat-arena-col-name">${escapeHtml(windowLabel(w))}</span>
            <span class="chat-arena-col-model">${escapeHtml(w.model || w.profileId || "")}</span>
          </div>
          <div class="chat-arena-col-actions">
            ${
              activeWindows.length > 1
                ? `<button type="button" class="st-btn" data-action="remove-window" title="移除此列">移除</button>`
                : ""
            }
          </div>
        </header>
        <div class="chat-arena-col-scroll">${messagesHtml}</div>
      </section>`;
    })
    .join("");

  // 各列滚到底
  for (const sc of els.arena.querySelectorAll(".chat-arena-col-scroll")) {
    sc.scrollTop = sc.scrollHeight;
  }
}

function setComposerEnabled(enabled) {
  els.input.disabled = !enabled;
  els.btnSend.disabled = !enabled;
  els.btnAddWindow.disabled = !enabled;
}

function ensureDraftTemp() {
  const temps = loadTemps();
  if (temps.length) return temps[0];
  ensureDefaultWindow();
  const temp = {
    id: newId(),
    name: "临时会话",
    slots: { ...EMPTY_SLOTS },
    windows: activeWindows.length
      ? activeWindows
      : profileList[0]
        ? [
            {
              id: newId(),
              profileId: profileList[0].id,
              profileName: profileList[0].name,
              model: profileList[0].model,
            },
          ]
        : [],
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
  activeWindows = temp.windows?.length ? temp.windows : [];
  ensureDefaultWindow();
  if (!temp.windows?.length && activeWindows.length) {
    temp.windows = activeWindows;
    upsertTemp(temp);
  }
  activeTurns = temp.turns || [];
  navLevel = "conversation";
  els.roomTitle.textContent = temp.name || "临时会话";
  els.roomSub.textContent = "未选存档 · 快速对话（浏览器缓存，最多 2 条）";
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
    els.roomTitle.textContent = activeShell?.name || "上下文";
    els.roomSub.textContent = "从左侧选会话，或点「新建会话」。";
    els.btnSaveTemp.hidden = true;
    setComposerEnabled(false);
    activeWindows = [];
    activeTurns = [];
    if (els.arena) {
      els.arena.innerHTML =
        `<div class="chat-arena-empty">尚未打开会话。从左侧选会话，或点「新建会话」。</div>`;
    }
    return;
  }

  if (navLevel !== "conversation") {
    openDraftTemp();
    return;
  }

  const title = activeIsTemp
    ? loadTemps().find((t) => t.id === activeConversationId)?.name || "临时会话"
    : conversations.find((c) => c.id === activeConversationId)?.name || "会话";
  els.roomTitle.textContent = title;
  els.roomSub.textContent = activeIsTemp
    ? "未选存档 · 快速对话（浏览器缓存，最多 2 条）"
    : `上下文：${activeShell?.name || "—"}`;
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
  ensureDefaultWindow();
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
  ensureDefaultWindow();
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
  ensureDefaultWindow();
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
    const temps = loadTemps();
    const temp = temps.find((t) => t.id === activeConversationId);
    if (!temp) return;
    temp.name = name === "临时" ? temp.name : name;
    temp.slots = slots;
    temp.windows = activeWindows;
    temp.turns = activeTurns;
    temp.updatedAt = nowIso();
    upsertTemp(temp);
    activeShell = { name: temp.name, ...slots };
    if (els.contextSub) els.contextSub.textContent = "已更新（仅浏览器）";
    setStatus("已更新临时上下文（仅浏览器）");
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

async function sendMessage() {
  if (busy) return;
  const text = els.input.value.trim();
  if (!text) return;
  if (navLevel !== "conversation" || !activeConversationId) {
    setStatus("请先打开一个会话", true);
    return;
  }
  ensureDefaultWindow();
  if (!activeWindows.length) {
    setStatus("请先新增至少一个模型窗口", true);
    return;
  }
  busy = true;
  els.btnSend.disabled = true;
  setStatus(
    activeWindows.length > 1
      ? `发送中（${activeWindows.length} 个窗口并行）…`
      : "发送中…",
  );
  try {
    if (activeIsTemp) {
      const temp = loadTemps().find((t) => t.id === activeConversationId);
      if (!temp) throw new Error("临时会话不存在");
      const slots = { ...EMPTY_SLOTS, ...temp.slots };
      const data = await api("/api/direct-chat/ephemeral/complete", {
        method: "POST",
        body: JSON.stringify({
          text,
          ...slots,
          windows: activeWindows,
          turns: activeTurns,
        }),
      });
      const multi = data.multi;
      if (!multi?.turn) throw new Error("未返回回合结果");
      activeTurns = [...activeTurns, multi.turn];
      temp.turns = activeTurns;
      temp.windows = activeWindows;
      temp.slots = slots;
      temp.updatedAt = nowIso();
      upsertTemp(temp);
      els.input.value = "";
      const failed = (multi.results || []).filter((r) => r.error);
      setStatus(
        failed.length
          ? `${failed.length} 个窗口失败，其余已写入`
          : "",
        failed.length > 0,
      );
      renderArena();
      renderRail();
      return;
    }

    const data = await api(
      `/api/direct-chat/conversations/${encodeURIComponent(activeConversationId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ text, windows: activeWindows }),
      },
    );
    activeTurns = data.conversation.turns || [];
    activeWindows = data.conversation.windows || activeWindows;
    activeShell = data.shell;
    els.input.value = "";
    const failed = (data.multi?.results || []).filter((r) => r.error);
    setStatus(
      failed.length ? `${failed.length} 个窗口失败，其余已写入` : "",
      failed.length > 0,
    );
    renderArena();
    if (activeShellId) {
      const shellData = await api(
        `/api/direct-chat/shells/${encodeURIComponent(activeShellId)}`,
      );
      conversations = shellData.conversations || [];
      renderRail();
    }
  } catch (err) {
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
        ? `已保留「${windowLabel(activeWindows.find((w) => w.id === next) || {})}」为后续共用基准`
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
        ? `已保留「${windowLabel(activeWindows.find((w) => w.id === next) || {})}」为后续共用基准`
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
  if (activeWindows.length <= 1) {
    setStatus("至少保留一个窗口", true);
    return;
  }
  activeWindows = activeWindows.filter((w) => w.id !== windowId);
  activeTurns = activeTurns.map((t) => ({
    ...t,
    replies: t.replies.filter((r) => r.windowId !== windowId),
    selectedWindowId:
      t.selectedWindowId === windowId ? null : t.selectedWindowId,
  }));
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
els.btnAddWindow.addEventListener("click", () => openAddWindowDialog());
els.btnSaveTemp.addEventListener("click", () => {
  if (!activeIsTemp || !activeConversationId) return;
  const temp = loadTemps().find((t) => t.id === activeConversationId);
  if (!temp) return;
  els.promoteShellName.value = "临时上下文";
  els.promoteConvName.value = temp.name || "会话";
  els.dialogPromote.showModal();
});
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

els.arena?.addEventListener("click", (e) => {
  const removeBtn = e.target.closest("[data-action='remove-window']");
  if (removeBtn) {
    const col = removeBtn.closest("[data-window-id]");
    const id = col?.getAttribute("data-window-id");
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
