function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function formatAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatNum(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("zh-CN");
}

function setStatus(text, state = "idle") {
  const status = document.getElementById("status");
  status.textContent = text;
  status.dataset.state = state;
}

function setRangeActive(id) {
  for (const btn of document.querySelectorAll(".stats-range .btn-secondary")) {
    btn.classList.toggle("is-active", btn.id === id);
  }
}

async function loadStats() {
  const from = localInputToIso(document.getElementById("from").value);
  const to = localInputToIso(document.getElementById("to").value);
  const limit = Number(document.getElementById("limit").value) || 200;
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  qs.set("limit", String(limit));

  setStatus("加载中…", "loading");
  try {
    const res = await fetch(`/api/stats/tokens?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const records = data.records || [];
    renderSummary(data.summary);
    renderRows(records);
    const totalCalls = data.summary?.totalCalls ?? 0;
    setStatus(
      `共 ${formatNum(totalCalls)} 次调用 · 显示 ${formatNum(records.length)} 条`,
      "idle",
    );
  } catch (err) {
    renderSummary(null);
    renderRows([]);
    setStatus(
      `加载失败：${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
  }
}

function renderSummary(summary) {
  const el = document.getElementById("summary");
  if (!summary) {
    el.innerHTML = "";
    return;
  }
  const metrics = [
    ["调用次数", summary.totalCalls, null],
    ["总 token", summary.totalTokens, "total"],
    ["prompt", summary.promptTokens, null],
    ["completion", summary.completionTokens, null],
    ["cached", summary.totalCached, null],
  ];
  el.innerHTML = metrics
    .map(
      ([label, value, emphasis]) =>
        `<div class="stats-metric"${emphasis ? ` data-emphasis="${emphasis}"` : ""}>
          <span class="stats-metric-label">${label}</span>
          <strong class="stats-metric-value">${formatNum(value ?? 0)}</strong>
        </div>`,
    )
    .join("");
}

function renderRows(records) {
  const tbody = document.getElementById("rows");
  const empty = document.getElementById("empty");
  const table = tbody.closest("table");

  if (!records.length) {
    tbody.innerHTML = "";
    if (table) table.hidden = true;
    empty.hidden = false;
    return;
  }

  if (table) table.hidden = false;
  empty.hidden = true;
  tbody.innerHTML = records
    .map(
      (r) => `<tr>
      <td class="col-time">${formatAt(r.at)}</td>
      <td class="col-caller" title="${escapeHtml(r.caller || "")}">${escapeHtml(r.caller || "—")}</td>
      <td class="col-model" title="${escapeHtml(r.model || "")}">${escapeHtml(r.model || "—")}</td>
      <td class="num">${formatNum(r.promptTokens ?? 0)}</td>
      <td class="num">${formatNum(r.completionTokens ?? 0)}</td>
      <td class="num col-total">${formatNum(r.totalTokens ?? 0)}</td>
      <td class="num">${r.cachedTokens == null ? "—" : formatNum(r.cachedTokens)}</td>
    </tr>`,
    )
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setRange(fromDate, toDate) {
  document.getElementById("from").value = toLocalInputValue(fromDate);
  document.getElementById("to").value = toLocalInputValue(toDate);
}

document.getElementById("btn-load").addEventListener("click", () => {
  setRangeActive("");
  loadStats();
});
document.getElementById("btn-today").addEventListener("click", () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  setRange(start, now);
  setRangeActive("btn-today");
  loadStats();
});
document.getElementById("btn-7d").addEventListener("click", () => {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  setRange(start, now);
  setRangeActive("btn-7d");
  loadStats();
});

document.getElementById("from").addEventListener("change", () => setRangeActive(""));
document.getElementById("to").addEventListener("change", () => setRangeActive(""));

// 默认：今天
(() => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  setRange(start, now);
  setRangeActive("btn-today");
  loadStats();
})();
