const SECTION_LABELS = {
  meta: "元数据",
  opening: "默认开场",
  task: "任务",
  principles: "原则",
  probe: "追问",
  output: "产物形状",
  score: "评分",
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
  "score",
  "checklist",
  "examples",
];

const STATUS_LABELS = {
  ready: "已写",
  partial: "部分",
  skeleton: "骨架",
  missing: "缺文件",
};

const PRESENT_LABELS = {
  message: "普通楼层",
  zero_layer: "0 层卡",
};

const LAYER_LABELS = {
  intermediate: "中间产物",
  final: "最终产物",
};

/** @type {Array<any>} */
let modulesCache = [];
/** @type {Array<{id: string, label: string, hint: string}>} */
let groupsCache = [];
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

function rowTags(module) {
  const tags = [];
  const mode = PRESENT_LABELS[module.presentMode];
  if (mode) tags.push(mode);
  if (module.repeatable) tags.push("可反复");
  if (module.closer) tags.push("收口");
  if (module.priorArtifact) tags.push("先验产物");
  return tags;
}

function renderList() {
  const list = document.getElementById("mod-list");
  const items = filteredModules();
  const count = document.getElementById("pack-label");
  count.textContent =
    items.length === modulesCache.length
      ? `${modulesCache.length} 个节点`
      : `显示 ${items.length} / ${modulesCache.length}`;

  if (items.length === 0) {
    list.innerHTML = `<p class="mod-empty">没有符合条件的节点</p>`;
    return;
  }

  const byGroup = new Map(groupsCache.map((group) => [group.id, []]));
  for (const module of items) {
    const bucket = byGroup.get(module.group);
    if (bucket) bucket.push(module);
  }

  list.innerHTML = groupsCache
    .map((group) => {
      const rows = byGroup.get(group.id) ?? [];
      if (rows.length === 0) return "";
      const buttons = rows
        .map((module) => {
          const tags = rowTags(module);
          const tagHtml = tags.length
            ? `<span class="mod-item-tags">${tags
                .map((tag) => `<span class="mod-tag">${escapeHtml(tag)}</span>`)
                .join("")}</span>`
            : "";
          return `<button type="button" class="mod-item${module.id === activeId ? " active" : ""}" data-id="${escapeHtml(module.id)}">
        <span class="mod-item-name">
          <span>${escapeHtml(module.name)}</span>
          <span class="mod-dot ${escapeHtml(module.status)}" title="${escapeHtml(STATUS_LABELS[module.status] ?? module.status)}"></span>
        </span>
        <p class="mod-item-decl">${escapeHtml(module.declaration)}</p>
        ${tagHtml}
      </button>`;
        })
        .join("");
      return `<section class="mod-group" aria-labelledby="grp-${escapeHtml(group.id)}">
        <h2 class="mod-group-label" id="grp-${escapeHtml(group.id)}">${escapeHtml(group.label)}</h2>
        <p class="mod-group-hint">${escapeHtml(group.hint)}</p>
        ${buttons}
      </section>`;
    })
    .join("");
}

function metaField(meta, key) {
  if (!meta || meta[key] == null) return "";
  const v = meta[key];
  return typeof v === "string" ? v.trim() : String(v);
}

function groupLabel(id) {
  return groupsCache.find((group) => group.id === id)?.label ?? "";
}

function renderDetail(detail) {
  const title = document.getElementById("panel-title");
  const sub = document.getElementById("panel-subtitle");
  const badge = document.getElementById("status-badge");
  const metaBar = document.getElementById("meta-bar");
  const host = document.getElementById("mod-detail");

  title.textContent = detail.name;
  const group = groupLabel(detail.group);
  sub.textContent = group ? `${group} · ${detail.artifact}` : detail.artifact;

  badge.hidden = false;
  badge.className = `mod-badge ${detail.status}`;
  badge.textContent = STATUS_LABELS[detail.status] ?? detail.status;

  const when = metaField(detail.meta, "when");
  const whenNot = metaField(detail.meta, "when_not");
  const boundary = metaField(detail.meta, "boundary");
  metaBar.hidden = !(when || whenNot || boundary);
  if (!metaBar.hidden) {
    const bits = [];
    if (when) bits.push(["何时选用", when]);
    if (whenNot) bits.push(["何时不选", whenNot]);
    if (boundary) bits.push(["边界", boundary]);
    metaBar.innerHTML = bits
      .map(
        ([label, text]) =>
          `<div class="mod-meta-row"><strong>${escapeHtml(label)}</strong><p>${escapeHtml(text).replace(/\n/g, "<br>")}</p></div>`,
      )
      .join("");
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

  const facts = [
    ["产物", `<code>${escapeHtml(detail.artifact)}</code>`],
    ["节点", `<code>${escapeHtml(detail.id)}</code>`],
  ];
  if (LAYER_LABELS[detail.layer]) facts.push(["产物层", escapeHtml(LAYER_LABELS[detail.layer])]);
  const tags = rowTags(detail);
  if (detail.programSide) tags.push("程序编译");
  if (tags.length) facts.push(["标记", escapeHtml(tags.join(" · "))]);
  if (detail.libraries?.length) {
    facts.push(["绑定库", escapeHtml(detail.libraries.join("、"))]);
  }
  if (detail.land) facts.push(["落盘", escapeHtml(detail.land)]);
  facts.push([
    "已有块",
    escapeHtml(present.map((id) => SECTION_LABELS[id] ?? id).join(" · ") || "—"),
  ]);

  host.innerHTML = `
    <div class="mod-summary">
      <p class="mod-decl">${escapeHtml(detail.declaration)}</p>
      <dl>
        ${facts.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`).join("")}
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
    groupsCache = data.groups || [];
    renderList();

    const fromHash = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    const initial =
      (fromHash && modulesCache.find((m) => m.id === fromHash)?.id) ||
      modulesCache.find((m) => m.group === "content" && m.status === "ready")?.id ||
      modulesCache.find((m) => m.group === "content")?.id ||
      modulesCache[0]?.id;
    if (initial) await selectModule(initial);
    else document.getElementById("pack-label").textContent = "没有节点";
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
    document.getElementById("pack-label").textContent = "加载失败";
    document.getElementById("mod-list").innerHTML =
      `<p class="mod-empty">节点目录没有加载出来</p>`;
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
