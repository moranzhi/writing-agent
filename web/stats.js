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
  return d.toLocaleString();
}

async function loadStats() {
  const from = localInputToIso(document.getElementById("from").value);
  const to = localInputToIso(document.getElementById("to").value);
  const limit = Number(document.getElementById("limit").value) || 200;
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  qs.set("limit", String(limit));

  const status = document.getElementById("status");
  status.textContent = "加载中…";
  try {
    const res = await fetch(`/api/stats/tokens?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderSummary(data.summary);
    renderRows(data.records || []);
    status.textContent = `共 ${data.summary?.totalCalls ?? 0} 次调用 · 显示 ${(data.records || []).length} 条`;
  } catch (err) {
    status.textContent = `加载失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

function renderSummary(summary) {
  const el = document.getElementById("summary");
  if (!summary) {
    el.innerHTML = "";
    return;
  }
  const metrics = [
    ["调用次数", summary.totalCalls],
    ["总 token", summary.totalTokens],
    ["prompt", summary.promptTokens],
    ["completion", summary.completionTokens],
    ["cached", summary.totalCached],
  ];
  el.innerHTML = metrics
    .map(
      ([label, value]) =>
        `<div class="stats-metric"><span class="stats-muted">${label}</span><strong>${value ?? 0}</strong></div>`,
    )
    .join("");
}

function renderRows(records) {
  const tbody = document.getElementById("rows");
  tbody.innerHTML = records
    .map(
      (r) => `<tr>
      <td>${formatAt(r.at)}</td>
      <td>${escapeHtml(r.caller || "")}</td>
      <td>${escapeHtml(r.model || "")}</td>
      <td>${r.promptTokens ?? 0}</td>
      <td>${r.completionTokens ?? 0}</td>
      <td>${r.totalTokens ?? 0}</td>
      <td>${r.cachedTokens ?? "—"}</td>
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

document.getElementById("btn-load").addEventListener("click", () => loadStats());
document.getElementById("btn-today").addEventListener("click", () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  setRange(start, now);
  loadStats();
});
document.getElementById("btn-7d").addEventListener("click", () => {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  setRange(start, now);
  loadStats();
});

// 默认：今天
(() => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  setRange(start, now);
  loadStats();
})();
