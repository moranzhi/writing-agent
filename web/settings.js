let state = {
  settings: { activeProfileId: null, activePresetId: null },
  profiles: [],
  presets: [],
};

let editingProfileId = null;
let activeSection = "api";
let lastImportedPresetId = null;
/** presetId → entries API payload */
const expandedPresetEntries = new Map();
/** presetId → 当前展开编辑的 entry id（一次一条） */
const openPresetEntryId = new Map();

const profilesListEl = document.getElementById("profiles-list");
const presetsListEl = document.getElementById("presets-list");
const importReportEl = document.getElementById("import-report");
const profileDialog = document.getElementById("profile-dialog");
const profileForm = document.getElementById("profile-form");
const profileDialogTitle = document.getElementById("profile-dialog-title");
const presetFileEl = document.getElementById("preset-file");
const panelTitleEl = document.getElementById("panel-title");
const panelSubtitleEl = document.getElementById("panel-subtitle");
const panelActionsEl = document.getElementById("panel-actions");
const sectionApiEl = document.getElementById("section-api");
const sectionPresetEl = document.getElementById("section-preset");
const sectionStorageEl = document.getElementById("section-storage");
const activeSettingsBarEl = document.getElementById("active-settings-bar");
const settingsToastEl = document.getElementById("settings-toast");
const contextTraceKeepEl = document.getElementById("context-trace-keep");

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function maskKey(key) {
  if (!key) return "（未设置）";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

let toastTimer = null;

function showToast(message, isError = false) {
  settingsToastEl.hidden = false;
  settingsToastEl.textContent = message;
  settingsToastEl.classList.toggle("error", isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    settingsToastEl.hidden = true;
  }, 4000);
}

function renderActiveBar() {
  const profile = state.profiles.find(
    (p) => p.id === state.settings.activeProfileId,
  );
  const preset = state.presets.find(
    (p) => p.id === state.settings.activePresetId,
  );

  activeSettingsBarEl.innerHTML = `
    <span class="label">当前生效</span>
    <span class="active-tag ${profile ? "" : "missing"}">
      API: ${profile ? escapeHtml(`${profile.name} · ${profile.model}`) : "未选用"}
    </span>
    <span class="active-tag ${preset ? "" : "missing"}">
      预设: ${preset ? escapeHtml(preset.name) : "未选用"}
    </span>`;
}

function switchSection(section) {
  activeSection = section;
  document.querySelectorAll(".st-rail-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.section === section);
  });
  sectionApiEl.classList.toggle("hidden", section !== "api");
  sectionPresetEl.classList.toggle("hidden", section !== "preset");
  sectionStorageEl?.classList.toggle("hidden", section !== "storage");
  renderPanelHeader();
}

function renderPanelHeader() {
  panelActionsEl.innerHTML = "";
  if (activeSection === "api") {
    panelTitleEl.textContent = "API";
    panelSubtitleEl.textContent = "保存后点「选用」才会用于对话";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-primary";
    btn.textContent = "新增";
    btn.addEventListener("click", () => openProfileDialog());
    panelActionsEl.appendChild(btn);
  } else if (activeSection === "preset") {
    panelTitleEl.textContent = "预设";
    panelSubtitleEl.textContent =
      "导入后可启用/编辑条目；选用后注入全部 LLM 请求";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-primary";
    btn.textContent = "导入 JSON";
    btn.addEventListener("click", () => presetFileEl.click());
    panelActionsEl.appendChild(btn);
  } else {
    panelTitleEl.textContent = "上下文";
    panelSubtitleEl.textContent = "控制每个对话保留多少条完整 prompt 痕迹";
  }
}

function activateButtonHtml(active, id, action) {
  if (active) {
    return `<button type="button" class="btn-active-label" disabled>✓ 使用中</button>`;
  }
  return `<button type="button" class="btn-activate" data-action="${action}" data-id="${id}">选用并生效</button>`;
}

function renderProfiles() {
  profilesListEl.innerHTML = "";
  if (!state.profiles.length) {
    profilesListEl.innerHTML =
      '<p class="empty-hint">暂无配置，点击右上角「新增配置」。</p>';
    return;
  }

  for (const p of state.profiles) {
    const active = p.id === state.settings.activeProfileId;
    const card = document.createElement("div");
    card.className = `config-card${active ? " active" : ""}`;
    card.innerHTML = `
      <div class="config-card-head">
        <div class="config-card-icon api">${escapeHtml(p.name.charAt(0).toUpperCase())}</div>
        <div class="config-card-info">
          <div class="config-card-title">
            ${escapeHtml(p.name)}
            ${active ? '<span class="badge">当前</span>' : ""}
          </div>
          <div class="config-card-meta">${escapeHtml(p.model)} · ${escapeHtml(p.baseUrl)}</div>
          <div class="config-card-meta">Key: ${escapeHtml(maskKey(p.apiKey))}</div>
        </div>
      </div>
      <div class="config-card-actions">
        ${activateButtonHtml(active, p.id, "activate-profile")}
        <button type="button" data-action="edit-profile" data-id="${p.id}">编辑</button>
        <button type="button" data-action="test-profile" data-id="${p.id}">测试连接</button>
        <button type="button" class="btn-danger" data-action="delete-profile" data-id="${p.id}">删除</button>
      </div>
      <div class="test-result" id="test-${p.id}"></div>`;
    profilesListEl.appendChild(card);
  }
}

function renderPresets() {
  presetsListEl.innerHTML = "";
  if (!state.presets.length) {
    presetsListEl.innerHTML =
      '<p class="empty-hint">暂无预设，点击右上角「导入 JSON」。</p>';
    return;
  }

  for (const p of state.presets) {
    const active = p.id === state.settings.activePresetId;
    const expanded = expandedPresetEntries.get(p.id);
    const card = document.createElement("div");
    card.className = `config-card${active ? " active" : ""}`;
    card.innerHTML = `
      <div class="config-card-head">
        <div class="config-card-icon preset">P</div>
        <div class="config-card-info">
          <div class="config-card-title">
            ${escapeHtml(p.name)}
            ${active ? '<span class="badge">当前</span>' : ""}
          </div>
          <div class="config-card-meta">
            ${escapeHtml(p.source)} · 共 ${p.entryCount ?? "?"} 条
            · 启用 ${p.enabledCount} · 注入 ${p.injectingCount ?? "?"}
            · ${escapeHtml(p.importedAt?.slice(0, 10) ?? "")}
          </div>
        </div>
      </div>
      <div class="config-card-actions">
        ${activateButtonHtml(active, p.id, "activate-preset")}
        <button type="button" data-action="toggle-preset-entries" data-id="${p.id}">
          ${expanded ? "收起条目" : "编辑条目"}
        </button>
        <button type="button" class="btn-danger" data-action="delete-preset" data-id="${p.id}">删除</button>
      </div>
      <div class="preset-entries-panel" id="preset-entries-${p.id}" ${expanded ? "" : "hidden"}></div>`;
    presetsListEl.appendChild(card);
    if (expanded) {
      renderPresetEntriesPanel(p.id, expanded);
    }
  }
}

function renderPresetEntriesPanel(presetId, data) {
  const panel = document.getElementById(`preset-entries-${presetId}`);
  if (!panel || !data) return;

  const gen = data.generation ?? {};
  const genLines = Object.entries(gen)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`);

  const openId = openPresetEntryId.get(presetId) ?? null;

  const entriesHtml = data.entries
    .map((entry, idx) => {
      const roleClass = `role-${entry.role}`;
      const open = openId === entry.id;
      const preview = (entry.content || "").trim();
      const previewText = preview
        ? preview.length > 72
          ? `${preview.slice(0, 72)}…`
          : preview
        : entry.marker
          ? "（marker · 无正文）"
          : "（空）";
      const status = entry.enabled
        ? entry.willInject
          ? '<span class="entry-skip ok">将注入</span>'
          : '<span class="entry-skip">已启用 · 不注入</span>'
        : '<span class="entry-skip">未启用</span>';

      return `
        <article class="preset-entry ${entry.enabled ? "" : "disabled"} ${open ? "is-open" : ""}" data-entry-id="${escapeHtml(entry.id)}">
          <header class="preset-entry-head" data-action="expand-entry" data-id="${escapeHtml(entry.id)}" role="button" tabindex="0" aria-expanded="${open}">
            <label class="entry-enable" title="启用后才会注入请求" data-stop-expand>
              <input type="checkbox" data-action="toggle-entry" data-id="${escapeHtml(entry.id)}" ${entry.enabled ? "checked" : ""} />
              <span>启用</span>
            </label>
            <span class="entry-index">${idx + 1}</span>
            <span class="entry-role ${roleClass}">${escapeHtml(entry.role)}</span>
            <span class="entry-name">${escapeHtml(entry.name)}</span>
            ${status}
            <span class="entry-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
          </header>
          ${open
            ? ""
            : `<p class="entry-preview" data-action="expand-entry" data-id="${escapeHtml(entry.id)}">${escapeHtml(previewText)}</p>`}
          <div class="preset-entry-body" ${open ? "" : "hidden"}>
            <label class="entry-field">
              名称
              <input class="entry-name-input" type="text" data-field="name" value="${escapeHtml(entry.name)}" />
            </label>
            <label class="entry-field">
              正文
              <textarea class="preset-entry-editor" data-field="content" rows="${Math.min(14, Math.max(4, (entry.content || "").split("\n").length + 1))}" placeholder="空则即使启用也不注入">${escapeHtml(entry.content || "")}</textarea>
            </label>
            <div class="preset-entry-actions">
              <button type="button" class="btn-secondary" data-action="collapse-entry" data-id="${escapeHtml(entry.id)}">收起</button>
              <button type="button" class="btn-primary" data-action="save-entry" data-id="${escapeHtml(entry.id)}">保存此条</button>
            </div>
          </div>
        </article>`;
    })
    .join("");

  panel.innerHTML = `
    <div class="preset-entries-inner" data-preset-id="${escapeHtml(presetId)}">
      ${genLines.length ? `<div class="preset-gen-params"><strong>生成参数</strong> ${escapeHtml(genLines.join(" · "))}</div>` : ""}
      <p class="preset-entries-summary">共 ${data.entries.length} 条 · 启用 ${data.enabledCount ?? 0} · 注入 ${data.injectingCount ?? 0}。点条目展开编辑；启用开关即时保存。</p>
      ${entriesHtml || '<p class="empty-hint">无条目</p>'}
    </div>`;
}

async function refreshPresetEntries(presetId) {
  const data = await api(`/api/presets/${encodeURIComponent(presetId)}/entries`);
  expandedPresetEntries.set(presetId, data);
  // 同步卡片上的计数
  const cardMeta = state.presets.find((p) => p.id === presetId);
  if (cardMeta) {
    cardMeta.enabledCount = data.enabledCount;
    cardMeta.injectingCount = data.injectingCount;
    cardMeta.entryCount = data.entries?.length;
  }
  renderPresets();
}

async function togglePresetEntries(presetId) {
  if (expandedPresetEntries.has(presetId)) {
    expandedPresetEntries.delete(presetId);
    openPresetEntryId.delete(presetId);
    renderPresets();
    return;
  }
  await refreshPresetEntries(presetId);
}

async function patchPresetEntry(presetId, patch) {
  const data = await api(`/api/presets/${encodeURIComponent(presetId)}/entries`, {
    method: "PATCH",
    body: JSON.stringify({ entry: patch }),
  });
  expandedPresetEntries.set(presetId, data);
  const cardMeta = state.presets.find((p) => p.id === presetId);
  if (cardMeta) {
    cardMeta.enabledCount = data.enabledCount;
    cardMeta.injectingCount = data.injectingCount;
    cardMeta.entryCount = data.entries?.length;
  }
  renderPresets();
  const n = data.reloadedSessions ?? 0;
  showToast(
    n > 0
      ? `已保存，并热更新 ${n} 个会话`
      : "已保存（选用此预设后才会进入请求）",
  );
  return data;
}

async function loadAll() {
  const data = await api("/api/settings");
  state.settings = data.settings;
  state.profiles = data.profiles;
  state.presets = data.presets;
  if (contextTraceKeepEl) {
    contextTraceKeepEl.value = String(
      state.settings.contextTraceKeepLatest ?? 5,
    );
  }
  renderActiveBar();
  renderProfiles();
  renderPresets();
}

function openProfileDialog(profile = null) {
  editingProfileId = profile?.id ?? null;
  profileDialogTitle.textContent = profile ? "编辑 API 配置" : "新增 API 配置";
  profileForm.name.value = profile?.name ?? "";
  profileForm.baseUrl.value = profile?.baseUrl ?? "https://api.deepseek.com";
  profileForm.apiKey.value = profile?.apiKey ?? "";
  profileForm.model.value = profile?.model ?? "deepseek-v4-pro";
  profileDialog.showModal();
}

async function saveProfile(activate) {
  const payload = {
    name: profileForm.name.value,
    baseUrl: profileForm.baseUrl.value,
    model: profileForm.model.value,
    activate,
  };
  const apiKey = profileForm.apiKey.value.trim();
  if (apiKey || !editingProfileId) {
    payload.apiKey = apiKey;
  }

  let result;
  if (editingProfileId) {
    result = await api(`/api/profiles/${editingProfileId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (activate) {
      result = await api(`/api/profiles/${editingProfileId}/activate`, {
        method: "POST",
      });
    }
  } else {
    result = await api("/api/profiles", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  profileDialog.close();
  await loadAll();

  if (activate) {
    const n = result.reloadedSessions ?? 0;
    showToast(`已选用并生效${n > 0 ? `，已更新 ${n} 个活跃会话` : ""}`);
  } else {
    showToast("已保存。点击「选用并生效」后才会用于 LLM 请求。");
  }
}

async function activateProfile(id) {
  const result = await api(`/api/profiles/${id}/activate`, { method: "POST" });
  await loadAll();
  const n = result.reloadedSessions ?? 0;
  showToast(`API 配置已生效${n > 0 ? `（${n} 个会话已更新）` : ""}`);
}

async function activatePreset(id) {
  const result = await api(`/api/presets/${id}/activate`, { method: "POST" });
  await loadAll();
  const n = result.reloadedSessions ?? 0;
  showToast(`预设已生效${n > 0 ? `（${n} 个会话已更新）` : ""}`);
}

document.querySelectorAll(".st-rail-item").forEach((btn) => {
  btn.addEventListener("click", () => switchSection(btn.dataset.section));
});

document.getElementById("profile-cancel").addEventListener("click", () => {
  profileDialog.close();
});

document.getElementById("profile-save").addEventListener("click", () => {
  saveProfile(false).catch((err) => showToast(err.message, true));
});

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await saveProfile(true);
  } catch (err) {
    showToast(err.message, true);
  }
});

profilesListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  try {
    if (action === "activate-profile") {
      await activateProfile(id);
    } else if (action === "edit-profile") {
      openProfileDialog(state.profiles.find((p) => p.id === id));
    } else if (action === "test-profile") {
      const el = document.getElementById(`test-${id}`);
      el.textContent = "测试中…";
      el.className = "test-result";
      const result = await api(`/api/profiles/${id}/test`, { method: "POST" });
      el.textContent = result.message;
      el.className = `test-result ${result.ok ? "ok" : "fail"}`;
    } else if (action === "delete-profile") {
      if (!confirm("确定删除此 API 配置？")) return;
      await api(`/api/profiles/${id}`, { method: "DELETE" });
      await loadAll();
      showToast("已删除");
    }
  } catch (err) {
    showToast(err.message, true);
  }
});

presetsListEl.addEventListener("click", async (e) => {
  if (e.target.closest("[data-stop-expand]")) return;

  const expandHead = e.target.closest('[data-action="expand-entry"]');
  if (expandHead) {
    const panel = expandHead.closest(".preset-entries-inner");
    const presetId = panel?.dataset.presetId;
    const entryId = expandHead.dataset.id;
    if (!presetId || !entryId) return;
    const cur = openPresetEntryId.get(presetId);
    if (cur === entryId) openPresetEntryId.delete(presetId);
    else openPresetEntryId.set(presetId, entryId);
    const data = expandedPresetEntries.get(presetId);
    if (data) renderPresetEntriesPanel(presetId, data);
    return;
  }

  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  try {
    if (action === "activate-preset") {
      await activatePreset(id);
    } else if (action === "toggle-preset-entries") {
      await togglePresetEntries(id);
    } else if (action === "delete-preset") {
      if (!confirm("确定删除此预设？")) return;
      await api(`/api/presets/${id}`, { method: "DELETE" });
      expandedPresetEntries.delete(id);
      openPresetEntryId.delete(id);
      await loadAll();
      showToast("已删除");
    } else if (action === "collapse-entry") {
      const panel = btn.closest(".preset-entries-inner");
      const presetId = panel?.dataset.presetId;
      if (!presetId) return;
      openPresetEntryId.delete(presetId);
      const data = expandedPresetEntries.get(presetId);
      if (data) renderPresetEntriesPanel(presetId, data);
    } else if (action === "save-entry") {
      const article = btn.closest(".preset-entry");
      const panel = btn.closest(".preset-entries-inner");
      const presetId = panel?.dataset.presetId;
      if (!article || !presetId) return;
      const name = article.querySelector('[data-field="name"]')?.value ?? "";
      const content = article.querySelector('[data-field="content"]')?.value ?? "";
      openPresetEntryId.set(presetId, id);
      await patchPresetEntry(presetId, { id, name, content });
    }
  } catch (err) {
    showToast(err.message, true);
  }
});

presetsListEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const head = e.target.closest?.('[data-action="expand-entry"]');
  if (!head) return;
  e.preventDefault();
  head.click();
});

presetsListEl.addEventListener("change", async (e) => {
  const input = e.target.closest('input[data-action="toggle-entry"]');
  if (!input) return;
  const article = input.closest(".preset-entry");
  const panel = input.closest(".preset-entries-inner");
  const presetId = panel?.dataset.presetId;
  const id = input.dataset.id;
  if (!presetId || !id) return;
  try {
    await patchPresetEntry(presetId, { id, enabled: input.checked });
  } catch (err) {
    input.checked = !input.checked;
    showToast(err.message, true);
  }
});

presetFileEl.addEventListener("change", async () => {
  const file = presetFileEl.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const raw = JSON.parse(text);
    const name = file.name.replace(/\.json$/i, "");
    const report = await api("/api/presets/import", {
      method: "POST",
      body: JSON.stringify({ raw, name }),
    });
    lastImportedPresetId = report.preset.id;
    importReportEl.hidden = false;
    importReportEl.innerHTML = `
      <div>${[
        `已导入: ${report.preset.name}`,
        `条目: ${report.promptCount}，启用: ${report.enabledCount}`,
        report.warnings.length ? `警告: ${report.warnings.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("<br>")}</div>
      <div class="import-report-actions">
        <button type="button" class="btn-activate" id="activate-imported-preset">选用此预设并生效</button>
      </div>`;
    document
      .getElementById("activate-imported-preset")
      ?.addEventListener("click", async () => {
        try {
          await activatePreset(lastImportedPresetId);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    await loadAll();
    showToast("预设已导入，请点击「选用此预设并生效」");
  } catch (err) {
    showToast(err.message, true);
  } finally {
    presetFileEl.value = "";
  }
});

document.getElementById("btn-save-context-keep")?.addEventListener("click", async () => {
  try {
    const n = Number(contextTraceKeepEl?.value ?? 5);
    const data = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ contextTraceKeepLatest: n }),
    });
    state.settings = data.settings;
    if (contextTraceKeepEl) {
      contextTraceKeepEl.value = String(data.settings.contextTraceKeepLatest ?? 5);
    }
    showToast(`已保存：每个对话保留最新 ${data.settings.contextTraceKeepLatest} 条上下文`);
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById("btn-prune-context")?.addEventListener("click", async () => {
  try {
    const r = await api("/api/settings/context-traces/prune", { method: "POST" });
    showToast(
      `已修剪 ${r.sessions} 个会话：保留 ${r.kept} 条痕迹，清除 ${r.cleared} 条`,
    );
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById("btn-clear-context")?.addEventListener("click", async () => {
  if (!confirm("清除所有已打开会话中保存的 LLM 请求上下文？消息正文不受影响。")) {
    return;
  }
  try {
    const r = await api("/api/settings/context-traces/clear", { method: "POST" });
    showToast(`已清除 ${r.sessions} 个会话中的 ${r.cleared} 条上下文痕迹`);
  } catch (err) {
    showToast(err.message, true);
  }
});

renderPanelHeader();
loadAll().catch((err) => {
  showToast(`加载设置失败: ${err.message}`, true);
});
