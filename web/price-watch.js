const DISMISS_KEY = "wa-price-watch-dismissed";

function money(amount, currency) {
  if (amount == null || Number.isNaN(Number(amount))) return "—";
  const symbol = currency === "CNY" ? "¥" : "$";
  const value = Number(amount);
  const digits = value >= 1 ? 2 : 4;
  const body = value.toFixed(digits).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  return `${symbol}${body.includes(".") ? body : `${body}.00`}`;
}

function itemLine(item) {
  if (item.status === "changed" && item.previous && item.current) {
    const currency = item.current.currency || "USD";
    return `${item.model} 变了：输入 ${money(item.previous.input, currency)} → ${money(item.current.input, currency)}，输出 ${money(item.previous.output, currency)} → ${money(item.current.output, currency)} / 百万 token`;
  }
  if (item.status === "unchanged" && item.current) {
    const currency = item.current.currency || "USD";
    return `${item.model} 没变（输入 ${money(item.current.input, currency)}，输出 ${money(item.current.output, currency)}）`;
  }
  if (item.status === "baseline") return `${item.model} 第一次记下单价，下次启动再比`;
  return `${item.model} 这次价目里没有`;
}

function showNotice(notice) {
  const host = document.getElementById("price-watch");
  if (!host || !notice) return;
  try {
    if (sessionStorage.getItem(DISMISS_KEY) === notice.at) return;
  } catch {
    /* ignore */
  }
  if (!notice.error && !notice.items?.length) return;
  const changed = notice.items?.some((item) => item.status === "changed");
  host.hidden = false;
  host.dataset.state = notice.error ? "error" : changed ? "changed" : "idle";
  const text = notice.error
    ? `OpenRouter 价格没拉下来：${notice.error}。上次的价目还在。`
    : notice.items.map((item) => itemLine(item)).join("\n");
  host.innerHTML = `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p><button type="button">知道了</button>`;
  host.querySelector("button")?.addEventListener("click", () => {
    host.hidden = true;
    try {
      sessionStorage.setItem(DISMISS_KEY, notice.at);
    } catch {
      /* ignore */
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function poll(tries = 0) {
  try {
    const res = await fetch("/api/stats/pricing/notice");
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === "pulling" || data.status === "idle") {
      if (tries < 12) {
        window.setTimeout(() => poll(tries + 1), 1500);
        return;
      }
    }
    showNotice(data.notice);
  } catch {
    /* 页面离线时不打扰 */
  }
}

poll();
