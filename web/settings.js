let state = {
  settings: { activeProfileId: null, activePresetId: null },
  profiles: [],
  presets: [],
};

let editingProfileId = null;
let activeSection = "api";
let lastImportedPresetId = null;
const expandedPresetEntries = new Map();

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
const activeSettingsBarEl = document.getElementById("active-settings-bar");
const settingsToastEl = document.getElementById("settings-toast");

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
  document.querySelectorAll(".sidebar-nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.section === section);
  });
  sectionApiEl.classList.toggle("hidden", section !== "api");
  sectionPresetEl.classList.toggle("hidden", section !== "preset");
  renderPanelHeader();
}

function renderPanelHeader() {
  panelActionsEl.innerHTML = "";
  if (activeSection === "api") {
    panelTitleEl.textContent = "API 配置";
    panelSubtitleEl.textContent = "保存后点击「选用」或「保存并选用」立即生效";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-primary";
    btn.textContent = "新增配置";
    btn.addEventListener("click", () => openProfileDialog());
    panelActionsEl.appendChild(btn);
  } else {
    panelTitleEl.textContent = "预设 Preset";
    panelSubtitleEl.textContent = "导入后点击「选用此预设」注入所有 LLM 请求";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-primary";
    btn.textContent = "导入 JSON";
    btn.addEventListener("click", () => presetFileEl.click());
    panelActionsEl.appendChild(btn);
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
            ${escapeHtml(p.source)} · 启用 ${p.enabledCount} 条
            · 注入 ${p.injectingCount ?? "?"} 条
            · ${escapeHtml(p.importedAt?.slice(0, 10) ?? "")}
          </div>
        </div>
      </div>
      <div class="config-card-actions">
        ${activateButtonHtml(active, p.id, "activate-preset")}
        <button type="button" data-action="toggle-preset-entries" data-id="${p.id}">
          ${expanded ? "收起条目" : "查看启用条目"}
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

  const entriesHtml = data.entries
    .map((entry, idx) => {
      const roleClass = `role-${entry.role}`;
      const status = entry.willInject
        ? ""
        : entry.marker
          ? '<span class="entry-skip">marker · 无内容</span>'
          : '<span class="entry-skip">空内容 · 不注入</span>';
      return `
        <article class="preset-entry ${entry.willInject ? "injecting" : "skipped"}">
          <header class="preset-entry-head">
            <span class="entry-index">${idx + 1}</span>
            <span class="entry-role ${roleClass}">${escapeHtml(entry.role)}</span>
            <span class="entry-name">${escapeHtml(entry.name)}</span>
            ${status}
          </header>
          ${entry.content
            ? `<pre class="preset-entry-content">${escapeHtml(entry.content)}</pre>`
            : `<p class="preset-entry-empty">（无文本内容）</p>`}
        </article>`;
    })
    .join("");

  panel.innerHTML = `
    <div class="preset-entries-inner">
      ${genLines.length ? `<div class="preset-gen-params"><strong>生成参数</strong> ${escapeHtml(genLines.join(" · "))}</div>` : ""}
      <p class="preset-entries-summary">共 ${data.entries.length} 条启用顺序，${data.injectingCount} 条会注入请求</p>
      ${entriesHtml || '<p class="empty-hint">无启用条目</p>'}
    </div>`;
}

async function togglePresetEntries(presetId) {
  if (expandedPresetEntries.has(presetId)) {
    expandedPresetEntries.delete(presetId);
    renderPresets();
    return;
  }
  const data = await api(`/api/presets/${encodeURIComponent(presetId)}/entries`);
  expandedPresetEntries.set(presetId, data);
  renderPresets();
}

async function loadAll() {
  const data = await api("/api/settings");
  state.settings = data.settings;
  state.profiles = data.profiles;
  state.presets = data.presets;
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

document.querySelectorAll(".sidebar-nav-item").forEach((btn) => {
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
      await loadAll();
      showToast("已删除");
    }
  } catch (err) {
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

renderPanelHeader();
loadAll().catch((err) => {
  showToast(`加载设置失败: ${err.message}`, true);
});
