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

function formatMoney(money) {
  if (!money || money.amount == null || Number.isNaN(Number(money.amount))) return "—";
  const amount = Number(money.amount);
  const currency = money.currency || "USD";
  const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : `${currency} `;
  const abs = Math.abs(amount);
  let digits = 2;
  if (abs > 0 && abs < 0.01) digits = 6;
  else if (abs < 1) digits = 4;
  const body = amount.toFixed(digits).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  const shown = body.includes(".") ? body : `${body}.00`;
  return `${symbol}${shown}`;
}

function formatCostTotal(total, byCurrency) {
  if (total) return formatMoney(total);
  const entries = Object.entries(byCurrency || {});
  if (!entries.length) return "—";
  return entries.map(([currency, amount]) => formatMoney({ amount, currency })).join(" + ");
}

function setStatus(text, state = "idle") {
  const status = document.getElementById("status");
  status.textContent = text;
  status.dataset.state = state;
}

function setPricingStatus(text, state = "idle") {
  const el = document.getElementById("pricing-status");
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    el.dataset.state = "idle";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.dataset.state = state;
}

function setRangeActive(id) {
  for (const btn of document.querySelectorAll(".stats-range .btn-secondary")) {
    btn.classList.toggle("is-active", btn.id === id);
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
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
    renderModels(data.summary?.byModel || data.cost?.byModel || []);
    renderRows(records);
    const totalCalls = data.summary?.totalCalls ?? 0;
    const unpriced = data.summary?.unpricedCalls ?? data.cost?.unpricedCalls ?? 0;
    const extra = unpriced
      ? ` · ${formatNum(unpriced)} 次无报价`
      : "";
    setStatus(
      `共 ${formatNum(totalCalls)} 次调用 · 显示 ${formatNum(records.length)} 条${extra}`,
      "idle",
    );
  } catch (err) {
    renderSummary(null);
    renderModels([]);
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
  const costValue = formatCostTotal(summary.estimatedCost, summary.byCurrency);
  const costNote = summary.unpricedCalls
    ? `${formatNum(summary.unpricedCalls)} 次无报价`
    : summary.estimatedCost
      ? "按官方文档估算"
      : "未配置价目";
  const metrics = [
    ["调用次数", formatNum(summary.totalCalls ?? 0), null, null],
    ["估算花销", costValue, "cost", costNote],
    ["总 token", formatNum(summary.totalTokens ?? 0), "total", null],
    ["prompt", formatNum(summary.promptTokens ?? 0), null, null],
    ["completion", formatNum(summary.completionTokens ?? 0), null, null],
    ["cached", formatNum(summary.totalCached ?? 0), null, null],
  ];
  el.innerHTML = metrics
    .map(
      ([label, value, emphasis, note]) =>
        `<div class="stats-metric"${emphasis ? ` data-emphasis="${emphasis}"` : ""}>
          <span class="stats-metric-label">${label}</span>
          <strong class="stats-metric-value">${value}</strong>
          ${note ? `<span class="stats-metric-note">${escapeHtml(note)}</span>` : ""}
        </div>`,
    )
    .join("");
}

function renderModels(rows) {
  const tbody = document.getElementById("model-rows");
  const empty = document.getElementById("model-empty");
  const table = document.getElementById("model-table");
  if (!rows.length) {
    tbody.innerHTML = "";
    table.hidden = true;
    empty.hidden = false;
    return;
  }
  table.hidden = false;
  empty.hidden = true;
  tbody.innerHTML = rows
    .map((r) => {
      const cost = r.unmatched || !r.cost
        ? `<span class="stats-unpriced">无报价</span>`
        : formatMoney(r.cost);
      const source = r.unmatched
        ? "—"
        : escapeHtml(r.sourceName || "官方文档");
      return `<tr>
        <td class="col-model" title="${escapeHtml(r.model || "")}">${escapeHtml(r.model || "—")}</td>
        <td class="num">${formatNum(r.calls ?? 0)}</td>
        <td class="num">${formatNum(r.promptTokens ?? 0)}</td>
        <td class="num">${formatNum(r.completionTokens ?? 0)}</td>
        <td class="num">${formatNum(r.cachedTokens ?? 0)}</td>
        <td class="num col-total">${cost}</td>
        <td class="col-caller" title="${source}">${source}</td>
      </tr>`;
    })
    .join("");
}

function renderRows(records) {
  const tbody = document.getElementById("rows");
  const empty = document.getElementById("empty");
  const table = document.getElementById("call-table") || tbody.closest("table");

  if (!records.length) {
    tbody.innerHTML = "";
    if (table) table.hidden = true;
    empty.hidden = false;
    return;
  }

  if (table) table.hidden = false;
  empty.hidden = true;
  tbody.innerHTML = records
    .map((r) => {
      const cost = r.unmatchedRate || !r.estimatedCost
        ? `<span class="stats-unpriced">—</span>`
        : formatMoney(r.estimatedCost);
      return `<tr>
      <td class="col-time">${formatAt(r.at)}</td>
      <td class="col-caller" title="${escapeHtml(r.caller || "")}">${escapeHtml(r.caller || "—")}</td>
      <td class="col-model" title="${escapeHtml(r.model || "")}">${escapeHtml(r.model || "—")}</td>
      <td class="num">${formatNum(r.promptTokens ?? 0)}</td>
      <td class="num">${formatNum(r.completionTokens ?? 0)}</td>
      <td class="num col-total">${formatNum(r.totalTokens ?? 0)}</td>
      <td class="num">${r.cachedTokens == null ? "—" : formatNum(r.cachedTokens)}</td>
      <td class="num">${cost}</td>
    </tr>`;
    })
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

async function loadPricing() {
  try {
    const data = await api("/api/stats/pricing");
    renderSuggested(data.suggested || [], data.sources || []);
    renderSources(data.sources || []);
  } catch (err) {
    setPricingStatus(
      `价目来源加载失败：${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
  }
}

function renderSuggested(items, sources = []) {
  const el = document.getElementById("pricing-suggested");
  const used = new Set((sources || []).map((s) => s.url));
  const remaining = items.filter((s) => !used.has(s.url));
  if (!remaining.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = items
    .map(
      (s) =>
        `<button type="button" class="stats-suggest" data-url="${escapeHtml(s.url)}">${escapeHtml(s.name)}</button>`,
    )
    .join("");
}

function renderSources(sources) {
  const el = document.getElementById("pricing-sources");
  if (!sources.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = sources
    .map((s) => {
      const when = s.fetchedAt ? formatAt(s.fetchedAt) : "尚未拉取";
      const sub = s.fetchError
        ? s.fetchError
        : `${formatNum(s.modelCount ?? 0)} 个型号 · ${when}`;
      const state = s.fetchError ? "error" : "idle";
      return `<li class="stats-pricing-item" data-id="${escapeHtml(s.id)}">
        <div class="stats-pricing-meta">
          <div class="stats-pricing-name">${escapeHtml(s.name)}</div>
          <a class="stats-pricing-url" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.url)}</a>
          <p class="stats-pricing-sub" data-state="${state}">${escapeHtml(sub)}</p>
        </div>
        <div class="stats-pricing-actions">
          <button type="button" class="btn-secondary" data-action="refresh">更新</button>
          <button type="button" class="btn-danger" data-action="delete">移除</button>
        </div>
      </li>`;
    })
    .join("");
}

function setPricingBusy(busy) {
  document.getElementById("btn-add-pricing").disabled = busy;
  for (const btn of document.querySelectorAll(".stats-pricing-actions button, .stats-suggest")) {
    btn.disabled = busy;
  }
}

async function addPricingSource(url, name) {
  const trimmed = (url || "").trim();
  if (!trimmed) {
    setPricingStatus("请填写官方价目文档 URL", "error");
    return;
  }
  setPricingBusy(true);
  setPricingStatus("正在拉取并解析官方文档…", "idle");
  try {
    const data = await api("/api/stats/pricing/sources", {
      method: "POST",
      body: JSON.stringify({ url: trimmed, name }),
    });
    document.getElementById("pricing-url").value = "";
    if (data.source?.fetchError) {
      setPricingStatus(data.source.fetchError, "error");
    } else {
      setPricingStatus("已按文档更新单价", "idle");
    }
    await loadPricing();
    await loadStats();
  } catch (err) {
    setPricingStatus(err instanceof Error ? err.message : String(err), "error");
    await loadPricing();
  } finally {
    setPricingBusy(false);
  }
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

document.getElementById("pricing-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  addPricingSource(document.getElementById("pricing-url").value);
});

document.getElementById("pricing-suggested").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".stats-suggest");
  if (!btn) return;
  addPricingSource(btn.dataset.url, btn.textContent);
});

document.getElementById("pricing-sources").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-action]");
  if (!btn) return;
  const item = btn.closest(".stats-pricing-item");
  const id = item?.dataset.id;
  if (!id) return;
  const action = btn.dataset.action;
  setPricingBusy(true);
  try {
    if (action === "refresh") {
      setPricingStatus("正在重新拉取官方文档…", "idle");
      const data = await api(`/api/stats/pricing/sources/${encodeURIComponent(id)}/refresh`, {
        method: "POST",
      });
      if (data.source?.fetchError) {
        setPricingStatus(data.source.fetchError, "error");
      } else {
        setPricingStatus("已按文档更新单价", "idle");
      }
    } else if (action === "delete") {
      await api(`/api/stats/pricing/sources/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setPricingStatus("已移除价目来源", "idle");
    }
    await loadPricing();
    await loadStats();
  } catch (err) {
    setPricingStatus(err instanceof Error ? err.message : String(err), "error");
    await loadPricing();
  } finally {
    setPricingBusy(false);
  }
});

(() => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  setRange(start, now);
  setRangeActive("btn-today");
  loadPricing();
  loadStats();
})();
