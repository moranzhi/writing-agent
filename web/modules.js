const SECTION_LABELS = {
  meta: "元数据",
  opening: "默认开场",
  task: "任务",
  principles: "原则",
  probe: "追问",
  output: "产物形状",
  checklist: "自检",
  examples: "示例",
};

const SECTION_ORDER = [
  "meta",
  "opening",
  "task",
  "principles",
  "probe",
  "output",
  "checklist",
  "examples",
];

const STATUS_LABELS = {
  ready: "已写",
  partial: "部分",
  skeleton: "骨架",
  missing: "缺文件",
};

/** @type {Array<any>} */
let modulesCache = [];
let activeId = "";
let statusFilter = "";
let searchQuery = "";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setError(msg) {
  const el = document.getElementById("mod-error");
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function filteredModules() {
  const q = searchQuery.trim().toLowerCase();
  return modulesCache.filter((m) => {
    if (statusFilter && m.status !== statusFilter) return false;
    if (!q) return true;
    const hay = `${m.name} ${m.id} ${m.declaration} ${m.artifact}`.toLowerCase();
    return hay.includes(q);
  });
}

function renderList() {
  const list = document.getElementById("mod-list");
  const items = filteredModules();
  if (items.length === 0) {
    list.innerHTML = `<p class="mod-empty" style="padding:8px">无匹配项</p>`;
    return;
  }
  list.innerHTML = items
    .map(
      (m) => `<button type="button" class="mod-item${m.id === activeId ? " active" : ""}" data-id="${escapeHtml(m.id)}">
        <span class="mod-item-name">
          <span>${escapeHtml(m.name)}</span>
          <span class="mod-dot ${escapeHtml(m.status)}" title="${escapeHtml(STATUS_LABELS[m.status] ?? m.status)}"></span>
        </span>
        <p class="mod-item-decl">${escapeHtml(m.declaration)}</p>
      </button>`,
    )
    .join("");
}

function metaField(meta, key) {
  if (!meta || meta[key] == null) return "";
  const v = meta[key];
  return typeof v === "string" ? v.trim() : String(v);
}

function renderDetail(detail) {
  const title = document.getElementById("panel-title");
  const sub = document.getElementById("panel-subtitle");
  const badge = document.getElementById("status-badge");
  const metaBar = document.getElementById("meta-bar");
  const host = document.getElementById("mod-detail");

  title.textContent = detail.name;
  sub.textContent = `${detail.id} · ${detail.artifact}`;

  badge.hidden = false;
  badge.className = `mod-badge ${detail.status}`;
  badge.textContent = STATUS_LABELS[detail.status] ?? detail.status;

  const when = metaField(detail.meta, "when");
  const whenNot = metaField(detail.meta, "when_not");
  const boundary = metaField(detail.meta, "boundary");
  metaBar.hidden = !(when || whenNot || boundary);
  if (!metaBar.hidden) {
    const bits = [];
    if (when) bits.push(`<strong>何时选用</strong> ${escapeHtml(when).replace(/\n/g, "<br>")}`);
    if (whenNot) bits.push(`<strong>何时不选</strong> ${escapeHtml(whenNot).replace(/\n/g, "<br>")}`);
    if (boundary) bits.push(`<strong>边界</strong> ${escapeHtml(boundary).replace(/\n/g, "<br>")}`);
    metaBar.innerHTML = bits.join("<hr style='border:none;border-top:1px solid var(--st-border);margin:10px 0'>");
  }

  const present = SECTION_ORDER.filter((id) => detail.sections?.[id]);
  const nav =
    present.length > 0
      ? `<nav class="mod-section-nav">${present
          .map(
            (id) =>
              `<a href="#sec-${id}">${escapeHtml(SECTION_LABELS[id] ?? id)}</a>`,
          )
          .join("")}</nav>`
      : "";

  const sectionsHtml = present
    .map((id) => {
      const open = id === "task" || id === "output" || id === "opening" ? " open" : "";
      return `<details class="mod-section"${open} id="sec-${id}">
        <summary>${escapeHtml(SECTION_LABELS[id] ?? id)}</summary>
        <div class="mod-section-body"><pre>${escapeHtml(detail.sections[id])}</pre></div>
      </details>`;
    })
    .join("");

  host.innerHTML = `
    <div class="mod-summary">
      <p class="mod-decl">${escapeHtml(detail.declaration)}</p>
      <dl>
        <dt>产物 tag</dt><dd><code>${escapeHtml(detail.artifact)}</code></dd>
        <dt>已有块</dt><dd>${present.map((id) => SECTION_LABELS[id] ?? id).join(" · ") || "—"}</dd>
      </dl>
    </div>
    ${nav}
    ${sectionsHtml || `<p class="mod-empty">尚无可切割的方法块（可能仍是骨架）。</p>`}
    <button type="button" class="mod-raw-toggle" id="btn-raw">显示原始 prompt.md</button>
    <pre class="mod-raw" id="raw-view" hidden></pre>
  `;

  const btn = document.getElementById("btn-raw");
  const raw = document.getElementById("raw-view");
  btn.addEventListener("click", () => {
    const showing = !raw.hidden;
    raw.hidden = showing;
    if (!showing) {
      raw.textContent = detail.raw || "（空）";
      btn.textContent = "隐藏原始 prompt.md";
    } else {
      btn.textContent = "显示原始 prompt.md";
    }
  });
}

async function selectModule(id) {
  if (!id) return;
  activeId = id;
  renderList();
  setError("");
  const host = document.getElementById("mod-detail");
  host.innerHTML = `<p class="mod-empty">加载中…</p>`;
  try {
    const res = await fetch(`/api/modules/${encodeURIComponent(id)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const detail = await res.json();
    renderDetail(detail);
    history.replaceState(null, "", `#${encodeURIComponent(id)}`);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
    host.innerHTML = `<p class="mod-empty">加载失败</p>`;
  }
}

async function boot() {
  setError("");
  try {
    const res = await fetch("/api/modules");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    modulesCache = data.modules || [];
    document.getElementById("pack-label").textContent =
      `导演包 · ${data.skillPackId || "—"} · ${modulesCache.length} 项`;
    renderList();

    const fromHash = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    const initial =
      (fromHash && modulesCache.find((m) => m.id === fromHash)?.id) ||
      modulesCache.find((m) => m.status === "ready")?.id ||
      modulesCache[0]?.id;
    if (initial) await selectModule(initial);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
    document.getElementById("pack-label").textContent = "加载失败";
  }
}

document.getElementById("mod-list").addEventListener("click", (e) => {
  const btn = e.target.closest(".mod-item");
  if (!btn) return;
  selectModule(btn.dataset.id);
});

document.getElementById("mod-search").addEventListener("input", (e) => {
  searchQuery = e.target.value || "";
  renderList();
});

document.getElementById("status-filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".mod-chip");
  if (!chip) return;
  statusFilter = chip.dataset.status || "";
  for (const c of document.querySelectorAll(".mod-chip")) {
    c.classList.toggle("active", c === chip);
  }
  renderList();
});

boot();
