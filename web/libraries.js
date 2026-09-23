/**
 * 全局库页：文风库 + 偏好库（列表 CRUD + LLM 提取）
 */

const state = {
  tab: "style", // style | preferences
  stylePacks: [],
  preferences: [],
  messages: [],
  /** @type {{ name: string, content: string, ready: boolean } | null} */
  styleDraft: null,
  /** @type {Array<{ content: string, ready: boolean }>} */
  prefCandidates: [],
  editingId: null,
  busy: false,
};

const $ = (id) => document.getElementById(id);

const panelTitleEl = $("panel-title");
const panelSubtitleEl = $("panel-subtitle");
const entryListEl = $("entry-list");
const toastEl = $("lib-toast");
const extractTitleEl = $("extract-title");
const extractHelpEl = $("extract-help");
const samplesFieldEl = $("samples-field");
const extractSamplesEl = $("extract-samples");
const extractChatEl = $("extract-chat");
const extractInputEl = $("extract-input");
const draftPanelEl = $("draft-panel");
const draftNameFieldEl = $("draft-name-field");
const draftNameEl = $("draft-name");
const draftContentEl = $("draft-content");
const prefCandidatesEl = $("pref-candidates");
const btnSaveDraftEl = $("btn-save-draft");
const draftReadyHintEl = $("draft-ready-hint");
const entryDialog = $("entry-dialog");
const entryForm = $("entry-form");
const entryDialogTitle = $("entry-dialog-title");
const entryNameWrap = $("entry-name-wrap");
const entryNameEl = $("entry-name");
const entryContentEl = $("entry-content");
const entryArchivedEl = $("entry-archived");

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || "请求失败");
  return data;
}

function showToast(msg, isError = false) {
  if (!toastEl) return;
  toastEl.hidden = false;
  toastEl.textContent = msg;
  toastEl.classList.toggle("is-error", Boolean(isError));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.hidden = true;
  }, 3200);
}

function tabFromUrl() {
  const q = new URLSearchParams(location.search).get("tab");
  if (q === "preferences" || q === "preference") return "preferences";
  return "style";
}

function setTab(tab, pushUrl = true) {
  state.tab = tab === "preferences" ? "preferences" : "style";
  document.querySelectorAll(".st-rail-item[data-tab]").forEach((btn) => {
    const on = btn.dataset.tab === state.tab;
    btn.classList.toggle("active", on);
  });
  const isStyle = state.tab === "style";
  panelTitleEl.textContent = isStyle ? "文风库" : "偏好库";
  panelSubtitleEl.textContent = isStyle
    ? "跨卡「怎么写」；对话 + 样本提取 → 叙事指南选用"
    : "跨卡硬约束；对话提取 →「用户需求」节点选用";
  extractTitleEl.textContent = isStyle ? "用 LLM 提取文风" : "用 LLM 提取偏好";
  extractHelpEl.textContent = isStyle
    ? "描述想要的写法，或贴样本；助手整理成可入库草稿。点「入库」写入列表。"
    : "描述禁区、纠偏、默认取向；助手拆成短条目。可逐条收下入库。";
  samplesFieldEl.hidden = !isStyle;
  draftNameFieldEl.hidden = !isStyle;
  extractInputEl.placeholder = isStyle
    ? "说说文风要求，或回答助手的追问…"
    : "说说偏好/禁区要求，或回答助手的追问…";
  resetExtract(false);
  if (pushUrl) {
    const url = new URL(location.href);
    url.searchParams.set("tab", state.tab);
    history.replaceState(null, "", url);
  }
  renderList();
}

function resetExtract(clearSamples = true) {
  state.messages = [];
  state.styleDraft = null;
  state.prefCandidates = [];
  if (clearSamples) extractSamplesEl.value = "";
  extractInputEl.value = "";
  draftNameEl.value = "";
  draftContentEl.value = "";
  renderChat();
  renderDraft();
}

function renderChat() {
  if (!state.messages.length) {
    extractChatEl.innerHTML = `<p class="lib-chat-empty">还没有对话。先发一句要求。</p>`;
    return;
  }
  extractChatEl.innerHTML = state.messages
    .map(
      (m) => `<div class="lib-msg">
      <div class="lib-msg-role">${m.role === "user" ? "你" : "助手"}</div>
      <div class="lib-msg-body">${escapeHtml(m.content)}</div>
    </div>`,
    )
    .join("");
  extractChatEl.scrollTop = extractChatEl.scrollHeight;
}

function renderDraft() {
  const isStyle = state.tab === "style";
  if (isStyle) {
    prefCandidatesEl.hidden = true;
    prefCandidatesEl.innerHTML = "";
    btnSaveDraftEl.hidden = false;
    draftContentEl.closest("label")?.removeAttribute("hidden");
    const d = state.styleDraft;
    if (!d || (!d.name && !d.content)) {
      draftPanelEl.hidden = true;
      return;
    }
    draftPanelEl.hidden = false;
    draftNameEl.value = d.name || "";
    draftContentEl.value = d.content || "";
    btnSaveDraftEl.disabled = !d.ready || !d.content.trim() || !d.name.trim();
    draftReadyHintEl.textContent = d.ready
      ? "草稿已够入库"
      : "继续对话补齐遣词/示范/禁忌后再入库";
    return;
  }

  draftNameFieldEl.hidden = true;
  const cands = state.prefCandidates;
  if (!cands.length) {
    draftPanelEl.hidden = true;
    return;
  }
  draftPanelEl.hidden = false;
  draftContentEl.closest("label")?.setAttribute("hidden", "");
  draftContentEl.value = "";
  btnSaveDraftEl.hidden = true;
  draftReadyHintEl.textContent = "下方逐条收下入库";
  prefCandidatesEl.hidden = false;
  prefCandidatesEl.innerHTML = cands
    .map(
      (c, i) => `<div class="lib-candidate${c.ready ? " is-ready" : ""}" data-i="${i}">
      <div class="lib-msg-body">${escapeHtml(c.content)}</div>
      <div class="lib-candidate-actions">
        <button type="button" class="btn-primary" data-action="accept-cand" data-i="${i}" ${
          c.ready && c.content.trim() ? "" : "disabled"
        }>收下</button>
      </div>
    </div>`,
    )
    .join("");
}

function renderList() {
  const isStyle = state.tab === "style";
  const items = isStyle ? state.stylePacks : state.preferences;
  if (!items.length) {
    entryListEl.innerHTML = `<p class="empty-hint">${
      isStyle ? "还没有文风包。用手写新建或右侧提取。" : "还没有偏好条目。用手写新建或右侧提取。"
    }</p>`;
    return;
  }
  entryListEl.innerHTML = "";
  for (const p of items) {
    const archived = p.status === "archived";
    const title = isStyle ? p.name || "未命名" : "偏好";
    const text = (p.content || "").trim();
    const card = document.createElement("div");
    card.className = `config-card${archived ? "" : " is-active"}`;
    card.innerHTML = `
      <div class="config-card-head">
        <div>
          <div class="config-card-title">${
            archived ? `<span class="badge">已归档</span> ` : ""
          }${escapeHtml(title)}</div>
          <div class="config-card-meta">${
            text
              ? escapeHtml(text.slice(0, 140)) + (text.length > 140 ? "…" : "")
              : "（空）"
          }</div>
        </div>
      </div>
      <div class="config-card-actions">
        <button type="button" class="btn-secondary" data-action="edit" data-id="${escapeHtml(p.id)}">编辑</button>
        <button type="button" class="btn-secondary" data-action="toggle" data-id="${escapeHtml(p.id)}" data-status="${
          archived ? "active" : "archived"
        }">${archived ? "启用" : "归档"}</button>
        <button type="button" class="btn-secondary danger-outline" data-action="delete" data-id="${escapeHtml(
          p.id,
        )}">删除</button>
      </div>`;
    entryListEl.appendChild(card);
  }
}

async function loadAll() {
  const [styles, prefs] = await Promise.all([
    api("/api/style-packs"),
    api("/api/preferences"),
  ]);
  state.stylePacks = styles.stylePacks ?? [];
  state.preferences = prefs.preferences ?? [];
  renderList();
}

function openEntryDialog(entry = null) {
  const isStyle = state.tab === "style";
  state.editingId = entry?.id ?? null;
  entryDialogTitle.textContent = entry
    ? isStyle
      ? "编辑文风"
      : "编辑偏好"
    : isStyle
      ? "新建文风"
      : "新建偏好";
  entryNameWrap.hidden = !isStyle;
  entryNameEl.required = isStyle;
  entryNameEl.value = isStyle ? entry?.name ?? "" : "";
  entryContentEl.value = entry?.content ?? "";
  entryArchivedEl.checked = entry?.status === "archived";
  entryDialog.showModal();
}

async function saveEntry() {
  const isStyle = state.tab === "style";
  const status = entryArchivedEl.checked ? "archived" : "active";
  if (isStyle) {
    const payload = {
      name: entryNameEl.value,
      content: entryContentEl.value,
      status,
    };
    if (state.editingId) {
      await api(`/api/style-packs/${encodeURIComponent(state.editingId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await api("/api/style-packs", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
  } else {
    const payload = { content: entryContentEl.value, status };
    if (state.editingId) {
      await api(`/api/preferences/${encodeURIComponent(state.editingId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await api("/api/preferences", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
  }
  entryDialog.close();
  await loadAll();
  showToast("已保存");
}

async function sendExtract() {
  if (state.busy) return;
  const text = extractInputEl.value.trim();
  if (!text) {
    showToast("请先输入内容", true);
    return;
  }
  state.messages.push({ role: "user", content: text });
  extractInputEl.value = "";
  renderChat();
  state.busy = true;
  $("btn-extract-send").disabled = true;
  try {
    if (state.tab === "style") {
      const result = await api("/api/style-packs/extract", {
        method: "POST",
        body: JSON.stringify({
          messages: state.messages,
          samples: extractSamplesEl.value,
          draftName: state.styleDraft?.name ?? "",
          draftContent: state.styleDraft?.content ?? "",
        }),
      });
      state.messages.push({ role: "assistant", content: result.reply || "…" });
      state.styleDraft = result.draft ?? { name: "", content: "", ready: false };
      btnSaveDraftEl.hidden = false;
    } else {
      const result = await api("/api/preferences/extract", {
        method: "POST",
        body: JSON.stringify({
          messages: state.messages,
          draftCandidates: state.prefCandidates,
        }),
      });
      state.messages.push({ role: "assistant", content: result.reply || "…" });
      state.prefCandidates = Array.isArray(result.candidates)
        ? result.candidates
        : [];
    }
    renderChat();
    renderDraft();
  } catch (err) {
    state.messages.pop();
    renderChat();
    showToast(err.message || String(err), true);
  } finally {
    state.busy = false;
    $("btn-extract-send").disabled = false;
  }
}

async function saveStyleDraft() {
  const name = draftNameEl.value.trim();
  const content = draftContentEl.value.trim();
  if (!name || !content) {
    showToast("名称与正文不能为空", true);
    return;
  }
  await api("/api/style-packs", {
    method: "POST",
    body: JSON.stringify({
      name,
      content,
      samples: extractSamplesEl.value.trim() || undefined,
      status: "active",
    }),
  });
  await loadAll();
  showToast("文风已入库");
  resetExtract(false);
}

document.querySelectorAll(".st-rail-item[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

$("btn-new-entry")?.addEventListener("click", () => openEntryDialog());
$("entry-cancel")?.addEventListener("click", () => entryDialog.close());
entryForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await saveEntry();
  } catch (err) {
    showToast(err.message, true);
  }
});

$("btn-extract-send")?.addEventListener("click", () => {
  sendExtract().catch((err) => showToast(err.message, true));
});
$("btn-extract-reset")?.addEventListener("click", () => resetExtract(true));
$("btn-save-draft")?.addEventListener("click", () => {
  saveStyleDraft().catch((err) => showToast(err.message, true));
});

draftNameEl?.addEventListener("input", () => {
  if (state.styleDraft) state.styleDraft.name = draftNameEl.value;
});
draftContentEl?.addEventListener("input", () => {
  if (state.styleDraft) state.styleDraft.content = draftContentEl.value;
});

prefCandidatesEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action=accept-cand]");
  if (!btn) return;
  const i = Number(btn.dataset.i);
  const c = state.prefCandidates[i];
  if (!c?.content?.trim()) return;
  try {
    await api("/api/preferences", {
      method: "POST",
      body: JSON.stringify({ content: c.content, status: "active" }),
    });
    state.prefCandidates.splice(i, 1);
    renderDraft();
    await loadAll();
    showToast("偏好已入库");
  } catch (err) {
    showToast(err.message, true);
  }
});

entryListEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const isStyle = state.tab === "style";
  const items = isStyle ? state.stylePacks : state.preferences;
  const entry = items.find((x) => x.id === id);
  try {
    if (action === "edit") {
      openEntryDialog(entry);
    } else if (action === "toggle") {
      const status = btn.dataset.status === "archived" ? "archived" : "active";
      const path = isStyle
        ? `/api/style-packs/${encodeURIComponent(id)}`
        : `/api/preferences/${encodeURIComponent(id)}`;
      await api(path, { method: "PUT", body: JSON.stringify({ status }) });
      await loadAll();
      showToast(status === "archived" ? "已归档" : "已启用");
    } else if (action === "delete") {
      if (!confirm(isStyle ? "删除这个文风包？" : "删除这条偏好？")) return;
      const path = isStyle
        ? `/api/style-packs/${encodeURIComponent(id)}`
        : `/api/preferences/${encodeURIComponent(id)}`;
      await api(path, { method: "DELETE" });
      await loadAll();
      showToast("已删除");
    }
  } catch (err) {
    showToast(err.message, true);
  }
});

extractInputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendExtract().catch((err) => showToast(err.message, true));
  }
});

setTab(tabFromUrl(), false);
loadAll().catch((err) => showToast(err.message, true));

