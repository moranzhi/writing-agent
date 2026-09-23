let state = {
  settings: { activeProfileId: null, activePresetId: null },
  profiles: [],
  presets: [],
  personas: [],
  activePersonaId: null,
  creationDefaultId: null,
};

let editingProfileId = null;
let editingPersonaId = null;
let activeSection = "api";
let lastImportedPresetId = null;
/** presetId → entries API payload */
const expandedPresetEntries = new Map();
/** presetId → 当前展开编辑的 entry id（一次一条） */
const openPresetEntryId = new Map();

const profilesListEl = document.getElementById("profiles-list");
const personasListEl = document.getElementById("personas-list");
const presetsListEl = document.getElementById("presets-list");
const importReportEl = document.getElementById("import-report");
const profileDialog = document.getElementById("profile-dialog");
const profileForm = document.getElementById("profile-form");
const profileDialogTitle = document.getElementById("profile-dialog-title");
const personaDialog = document.getElementById("persona-dialog");
const personaForm = document.getElementById("persona-form");
const personaDialogTitle = document.getElementById("persona-dialog-title");
const presetFileEl = document.getElementById("preset-file");
const panelTitleEl = document.getElementById("panel-title");
const panelSubtitleEl = document.getElementById("panel-subtitle");
const panelActionsEl = document.getElementById("panel-actions");
const sectionApiEl = document.getElementById("section-api");
const sectionPersonaEl = document.getElementById("section-persona");
const sectionPreferenceEl = document.getElementById("section-preference");
const sectionPresetEl = document.getElementById("section-preset");
const sectionStorageEl = document.getElementById("section-storage");
const preferenceCollectEveryEl = document.getElementById("preference-collect-every");
const activeSettingsBarEl = document.getElementById("active-settings-bar");
const settingsToastEl = document.getElementById("settings-toast");
const contextTraceKeepEl = document.getElementById("context-trace-keep");
const probeDialog = document.getElementById("preset-probe-dialog");
const probePresetNameEl = document.getElementById("probe-preset-name");
const probeMessageEl = document.getElementById("probe-message");
const probeLoreBeforeEl = document.getElementById("probe-lore-before");
const probeHistoryEl = document.getElementById("probe-history");
const probeLoreAfterEl = document.getElementById("probe-lore-after");
const probePostTurnEl = document.getElementById("probe-post-turn");
const probeSendEl = document.getElementById("probe-send");
const probeStatusEl = document.getElementById("probe-status");
const probeMessagesEl = document.getElementById("probe-messages");
const probeReplyWrapEl = document.getElementById("probe-reply-wrap");
const probeReplyEl = document.getElementById("probe-reply");

const DEFAULT_PROBE_CONTEXT = {
  message: "我推开门。",
  loreBefore: "写作要求：对本轮输入做忠实扩写；只展开已给出的动作与信息，不另起情节。",
  history: "扩写范围仅限本轮输入，勿补前因后果或无关对话。",
  loreAfter: "",
  postTurn: "",
};

let probingPresetId = null;
let probeBusy = false;

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
  const persona = state.personas.find((p) => p.id === state.activePersonaId);

  activeSettingsBarEl.innerHTML = `
    <span class="label">当前生效</span>
    <span class="active-tag ${profile ? "" : "missing"}">
      API: ${profile ? escapeHtml(`${profile.name} · ${profile.model}`) : "未选用"}
    </span>
    <span class="active-tag ${persona ? "" : "missing"}">
      角色: ${persona ? escapeHtml(persona.name) : "未选用"}
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
  sectionPersonaEl?.classList.toggle("hidden", section !== "persona");
  sectionPreferenceEl?.classList.toggle("hidden", section !== "preference");
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
  } else if (activeSection === "persona") {
    panelTitleEl.textContent = "用户角色";
    panelSubtitleEl.textContent =
      "游玩用当前选用；创作用「创作默认」（建议名为 @玩家）";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-primary";
    btn.textContent = "新增";
    btn.addEventListener("click", () => openPersonaDialog());
    panelActionsEl.appendChild(btn);
  } else if (activeSection === "preference") {
    panelTitleEl.textContent = "用户偏好";
    panelSubtitleEl.textContent = "采集间隔；条目在「库 · 偏好库」管理";
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

function capabilityBadge(caps) {
  if (!caps || !caps.testedAt) {
    return `<div class="config-card-meta cap-unknown">能力：未探测（选用前建议点「探测」）</div>`;
  }
  const bit = (label, status) => {
    const cls =
      status === "ok" ? "cap-ok" : status === "fail" ? "cap-fail" : "cap-unk";
    return `<span class="cap-chip ${cls}">${escapeHtml(label)}:${escapeHtml(status)}</span>`;
  };
  const mode =
    caps.jsonSchema === "ok"
      ? "JSON Schema"
      : caps.forcedTool === "ok"
        ? "强制 Tool"
        : caps.jsonObject === "ok"
          ? "JSON Object"
          : "纯文本";
  return `<div class="config-card-meta cap-row">
    投递：<strong>${escapeHtml(mode)}</strong>
    ${bit("schema", caps.jsonSchema)}
    ${bit("tool", caps.forcedTool)}
    ${bit("json", caps.jsonObject)}
  </div>`;
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
          <div class="config-card-meta">Key: ${escapeHtml(maskKey(p.apiKey))}${
            p.reasoningEffort
              ? ` · 思考: ${escapeHtml(p.reasoningEffort)}`
              : ""
          }</div>
          ${capabilityBadge(p.capabilities)}
        </div>
      </div>
      <div class="config-card-actions">
        ${activateButtonHtml(active, p.id, "activate-profile")}
        <button type="button" data-action="edit-profile" data-id="${p.id}">编辑</button>
        <button type="button" data-action="probe-capabilities" data-id="${p.id}">探测</button>
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
        <button type="button" data-action="probe-preset" data-id="${p.id}">试跑</button>
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

const GENERATION_FIELDS = [
  { key: "temperature", label: "temperature", step: "0.01", placeholder: "如 1" },
  { key: "topP", label: "top P", step: "0.01", placeholder: "如 0.95" },
  { key: "topK", label: "top K", step: "1", placeholder: "可选" },
  { key: "minP", label: "min P", step: "0.01", placeholder: "可选" },
  {
    key: "frequencyPenalty",
    label: "frequency penalty",
    step: "0.01",
    placeholder: "可选",
  },
  {
    key: "presencePenalty",
    label: "presence penalty",
    step: "0.01",
    placeholder: "可选",
  },
  {
    key: "repetitionPenalty",
    label: "repetition penalty",
    step: "0.01",
    placeholder: "可选",
  },
  {
    key: "maxContextTokens",
    label: "最大上下文",
    step: "1",
    placeholder: "输入预算",
  },
  {
    key: "maxOutputTokens",
    label: "最大输出",
    step: "1",
    placeholder: "如 60000",
  },
  { key: "seed", label: "seed", step: "1", placeholder: "可选" },
  {
    key: "variants",
    label: "n / variants",
    step: "1",
    placeholder: "可选",
  },
];

function generationFieldValue(gen, key) {
  const v = gen?.[key];
  return v === undefined || v === null ? "" : String(v);
}

function renderGenerationForm(gen) {
  const g = gen ?? {};
  const numberFields = GENERATION_FIELDS.map(
    (f) => `
      <label class="entry-field gen-field">
        ${escapeHtml(f.label)}
        <input
          type="number"
          class="entry-name-input"
          data-gen-field="${escapeHtml(f.key)}"
          step="${escapeHtml(f.step)}"
          placeholder="${escapeHtml(f.placeholder)}"
          value="${escapeHtml(generationFieldValue(g, f.key))}"
        />
      </label>`,
  ).join("");

  return `
    <div class="preset-gen-editor">
      <div class="preset-gen-head">
        <strong>生成参数</strong>
        <span class="preset-gen-hint">上半 · 采样与容量；空字段表示不发送</span>
      </div>
      <div class="preset-gen-grid">
        ${numberFields}
        <label class="entry-field gen-field">
          reasoning effort
          <input
            type="text"
            class="entry-name-input"
            data-gen-field="reasoningEffort"
            placeholder="如 low / medium / high"
            value="${escapeHtml(generationFieldValue(g, "reasoningEffort"))}"
          />
        </label>
        <label class="entry-field gen-field">
          verbosity
          <input
            type="text"
            class="entry-name-input"
            data-gen-field="verbosity"
            placeholder="可选"
            value="${escapeHtml(generationFieldValue(g, "verbosity"))}"
          />
        </label>
        <label class="entry-field gen-field gen-field-check">
          <span>stream</span>
          <input
            type="checkbox"
            data-gen-field="stream"
            ${g.stream === true ? "checked" : ""}
          />
        </label>
      </div>
      <div class="preset-gen-actions">
        <button type="button" class="btn-primary" data-action="save-generation">保存生成参数</button>
      </div>
    </div>`;
}

function collectGenerationFromPanel(panel) {
  const generation = {};
  for (const input of panel.querySelectorAll("[data-gen-field]")) {
    const key = input.dataset.genField;
    if (!key) continue;
    if (input.type === "checkbox") {
      if (input.checked) generation.stream = true;
      continue;
    }
    const raw = input.value.trim();
    if (!raw) continue;
    if (key === "reasoningEffort" || key === "verbosity") {
      generation[key] = raw;
    } else {
      const n = Number(raw);
      if (Number.isFinite(n)) generation[key] = n;
    }
  }
  return generation;
}

function renderPresetEntriesPanel(presetId, data) {
  const panel = document.getElementById(`preset-entries-${presetId}`);
  if (!panel || !data) return;

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
      ${renderGenerationForm(data.generation)}
      <p class="preset-entries-summary">下半 · 共 ${data.entries.length} 条 · 启用 ${data.enabledCount ?? 0} · 注入 ${data.injectingCount ?? 0}。点条目展开编辑；启用开关即时保存。</p>
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

async function patchPresetGeneration(presetId, generation) {
  const data = await api(`/api/presets/${encodeURIComponent(presetId)}/entries`, {
    method: "PATCH",
    body: JSON.stringify({ generation }),
  });
  expandedPresetEntries.set(presetId, data);
  renderPresets();
  const n = data.reloadedSessions ?? 0;
  showToast(
    n > 0
      ? `生成参数已保存，并热更新 ${n} 个会话`
      : "生成参数已保存（选用此预设后才会进入请求）",
  );
  return data;
}

async function loadAll() {
  const data = await api("/api/settings");
  state.settings = data.settings;
  state.profiles = data.profiles;
  state.presets = data.presets;
  try {
    const personasData = await api("/api/personas");
    state.personas = personasData.personas ?? [];
    state.activePersonaId = personasData.activeId ?? null;
    state.creationDefaultId = personasData.creationDefaultId ?? null;
  } catch {
    state.personas = [];
    state.activePersonaId = null;
  }
  try {
    const prefData = await api("/api/preferences");
    if (preferenceCollectEveryEl) {
      preferenceCollectEveryEl.value = String(
        prefData.preferenceCollectEveryTurns ??
          state.settings.preferenceCollectEveryTurns ??
          10,
      );
    }
  } catch {
    /* ignore */
  }
  if (contextTraceKeepEl) {
    contextTraceKeepEl.value = String(
      state.settings.contextTraceKeepLatest ?? 5,
    );
  }
  renderActiveBar();
  renderProfiles();
  renderPersonas();
  renderPresets();
}

function renderPersonas() {
  if (!personasListEl) return;
  personasListEl.innerHTML = "";
  if (!state.personas.length) {
    personasListEl.innerHTML =
      `<div class="empty-hint">还没有用户角色。点右上角「新增」。</div>`;
    return;
  }
  for (const p of state.personas) {
    const active = p.id === state.activePersonaId;
    const creationDefault = p.id === state.creationDefaultId;
    const card = document.createElement("div");
    card.className = `config-card persona-config-card${active ? " is-active" : ""}`;
    const desc = (p.description || "").trim();
    card.innerHTML = `
      <div class="config-card-head">
        <div>
          <div class="config-card-title">${escapeHtml(p.name)}${
            creationDefault ? `<span class="badge">创作默认</span>` : ""
          }</div>
          <div class="config-card-meta">${
            desc
              ? escapeHtml(desc.slice(0, 80)) + (desc.length > 80 ? "…" : "")
              : "（无人设正文）"
          }</div>
        </div>
        ${activateButtonHtml(active, p.id, "activate-persona")}
      </div>
      <div class="config-card-actions">
        <label class="persona-card-check">
          <input type="checkbox" data-action="creation-default" data-id="${escapeHtml(p.id)}"${
            creationDefault ? " checked" : ""
          } />
          创作默认
        </label>
        <button type="button" class="btn-secondary" data-action="edit-persona" data-id="${escapeHtml(p.id)}">编辑</button>
        <button type="button" class="btn-secondary danger-outline" data-action="delete-persona" data-id="${escapeHtml(p.id)}">删除</button>
      </div>`;
    personasListEl.appendChild(card);
  }
}

function openPersonaDialog(persona = null) {
  editingPersonaId = persona?.id ?? null;
  personaDialogTitle.textContent = persona ? "编辑用户角色" : "新增用户角色";
  personaForm.name.value = persona?.name ?? "";
  personaForm.description.value = persona?.description ?? "";
  personaForm.creationDefault.checked = persona
    ? persona.id === state.creationDefaultId
    : false;
  personaDialog.showModal();
}

async function savePersona() {
  const payload = {
    name: personaForm.name.value,
    description: personaForm.description.value,
    activate: true,
    creationDefault: Boolean(personaForm.creationDefault?.checked),
  };
  if (editingPersonaId) {
    await api(`/api/personas/${encodeURIComponent(editingPersonaId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    await api(`/api/personas/${encodeURIComponent(editingPersonaId)}/activate`, {
      method: "POST",
    });
  } else {
    await api("/api/personas", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
  personaDialog.close();
  await loadAll();
  showToast("用户角色已保存");
}

function openProfileDialog(profile = null) {
  editingProfileId = profile?.id ?? null;
  profileDialogTitle.textContent = profile ? "编辑 API 配置" : "新增 API 配置";
  profileForm.name.value = profile?.name ?? "";
  profileForm.baseUrl.value = profile?.baseUrl ?? "https://api.deepseek.com";
  profileForm.apiKey.value = profile?.apiKey ?? "";
  profileForm.model.value = profile?.model ?? "deepseek-v4-pro";
  profileForm.reasoningEffort.value = profile?.reasoningEffort ?? "";
  profileDialog.showModal();
}

async function saveProfile(activate) {
  const payload = {
    name: profileForm.name.value,
    baseUrl: profileForm.baseUrl.value,
    model: profileForm.model.value,
    reasoningEffort: profileForm.reasoningEffort.value,
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

document.getElementById("persona-cancel")?.addEventListener("click", () => {
  personaDialog?.close();
});

document.getElementById("btn-save-pref-every")?.addEventListener("click", async () => {
  try {
    const n = Number(preferenceCollectEveryEl?.value ?? 10);
    const data = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ preferenceCollectEveryTurns: n }),
    });
    state.settings = data.settings;
    if (preferenceCollectEveryEl) {
      preferenceCollectEveryEl.value = String(
        data.settings.preferenceCollectEveryTurns ?? 10,
      );
    }
    showToast(
      `已保存：每隔 ${data.settings.preferenceCollectEveryTurns} 回合采集偏好`,
    );
  } catch (err) {
    showToast(err.message, true);
  }
});

personaForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await savePersona();
  } catch (err) {
    showToast(err.message, true);
  }
});

personasListEl?.addEventListener("change", async (e) => {
  const input = e.target.closest("input[data-action='creation-default']");
  if (!input) return;
  const id = input.dataset.id;
  try {
    await api(`/api/personas/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ creationDefault: Boolean(input.checked) }),
    });
    await loadAll();
    showToast(input.checked ? "已设为创作默认" : "已取消创作默认");
  } catch (err) {
    showToast(err.message, true);
    await loadAll();
  }
});

personasListEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  if (btn.matches("input[data-action='creation-default']")) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  try {
    if (action === "activate-persona") {
      await api(`/api/personas/${encodeURIComponent(id)}/activate`, {
        method: "POST",
      });
      await loadAll();
      showToast("用户角色已选用");
    } else if (action === "edit-persona") {
      openPersonaDialog(state.personas.find((p) => p.id === id));
    } else if (action === "delete-persona") {
      if (!confirm("删除这个用户角色？")) return;
      await api(`/api/personas/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadAll();
      showToast("已删除");
    }
  } catch (err) {
    showToast(err.message, true);
  }
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
    } else if (action === "probe-capabilities") {
      const el = document.getElementById(`test-${id}`);
      el.textContent = "探测中（含连通性，会打几次短请求）…";
      el.className = "test-result";
      const result = await api(`/api/profiles/${id}/probe-capabilities`, {
        method: "POST",
      });
      await loadAll();
      const caps = result.profile?.capabilities;
      const chatOk = caps?.chat === "ok";
      const note = !chatOk
        ? `连接失败${caps?.notes?.[0] ? `：${caps.notes[0]}` : ""}`
        : result.deliveryModeLabel
          ? `连接正常 · 投递将用：${result.deliveryModeLabel}`
          : "探测完成";
      const refreshed = document.getElementById(`test-${id}`);
      if (refreshed) {
        refreshed.textContent = note;
        refreshed.className = `test-result ${chatOk ? "ok" : "fail"}`;
      }
      showToast(note, !chatOk);
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
    } else if (action === "probe-preset") {
      openProbeDialog(id);
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
    } else if (action === "save-generation") {
      const panel = btn.closest(".preset-entries-inner");
      const presetId = panel?.dataset.presetId;
      if (!presetId) return;
      await patchPresetGeneration(presetId, collectGenerationFromPanel(panel));
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

function resetProbeForm() {
  probeMessageEl.value = DEFAULT_PROBE_CONTEXT.message;
  probeLoreBeforeEl.value = DEFAULT_PROBE_CONTEXT.loreBefore;
  probeHistoryEl.value = DEFAULT_PROBE_CONTEXT.history;
  probeLoreAfterEl.value = DEFAULT_PROBE_CONTEXT.loreAfter;
  probePostTurnEl.value = DEFAULT_PROBE_CONTEXT.postTurn;
  probeStatusEl.hidden = true;
  probeStatusEl.textContent = "";
  probeReplyWrapEl.hidden = true;
  probeReplyEl.textContent = "";
  probeMessagesEl.innerHTML =
    '<p class="probe-empty">发送后显示实际拼进请求的消息。</p>';
}

function openProbeDialog(presetId) {
  const preset = state.presets.find((p) => p.id === presetId);
  probingPresetId = presetId;
  probePresetNameEl.textContent = preset?.name ?? presetId;
  resetProbeForm();
  probeDialog.showModal();
  probeMessageEl.focus();
  probeMessageEl.select();
}

function renderProbeMessages(messages) {
  if (!messages?.length) {
    probeMessagesEl.innerHTML =
      '<p class="probe-empty">这次没有拼出任何消息。</p>';
    return;
  }
  probeMessagesEl.innerHTML = messages
    .map(
      (m, i) => `
      <article class="probe-msg">
        <header>
          <span class="probe-role ${escapeHtml(m.role)}">${escapeHtml(m.role)}</span>
          <span class="probe-index">#${i + 1}</span>
        </header>
        <pre>${escapeHtml(m.content)}</pre>
      </article>`,
    )
    .join("");
}

function setProbeBusy(busy) {
  probeBusy = busy;
  probeSendEl.disabled = busy;
  probeSendEl.textContent = busy ? "发送中…" : "发送一轮";
}

async function sendProbe() {
  if (probeBusy || !probingPresetId) return;
  const message = probeMessageEl.value.trim();
  if (!message) {
    probeStatusEl.hidden = false;
    probeStatusEl.textContent = "请填写本轮输入";
    probeMessageEl.focus();
    return;
  }

  setProbeBusy(true);
  probeStatusEl.hidden = false;
  probeStatusEl.textContent = "正在拼装上下文…";
  probeReplyWrapEl.hidden = true;

  try {
    const result = await api(`/api/presets/${probingPresetId}/probe`, {
      method: "POST",
      body: JSON.stringify({
        message,
        loreBefore: probeLoreBeforeEl.value,
        history: probeHistoryEl.value,
        loreAfter: probeLoreAfterEl.value,
        postTurn: probePostTurnEl.value,
      }),
    });
    renderProbeMessages(result.messages);
    if (result.reply) {
      probeReplyWrapEl.hidden = false;
      probeReplyEl.textContent = result.reasoning
        ? `${result.reasoning}\n\n——\n\n${result.reply}`
        : result.reply;
    }
    if (result.error) {
      probeStatusEl.textContent = `上下文已拼装，生成失败：${result.error}`;
    } else if (result.skipReason) {
      probeStatusEl.textContent = result.skipReason;
    } else if (result.completed) {
      probeStatusEl.textContent = `已发送 ${result.messages.length} 条`;
    } else {
      probeStatusEl.textContent = `已拼装 ${result.messages.length} 条`;
    }
  } catch (err) {
    probeStatusEl.textContent = err.message;
  } finally {
    setProbeBusy(false);
  }
}

document.getElementById("probe-close")?.addEventListener("click", () => {
  probeDialog.close();
});

probeSendEl?.addEventListener("click", () => {
  sendProbe().catch((err) => showToast(err.message, true));
});

probeMessageEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendProbe().catch((err) => showToast(err.message, true));
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
