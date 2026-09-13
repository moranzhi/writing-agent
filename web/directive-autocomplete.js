/**
 * 输入框 `@` 指令自动补全。
 * 展开仍由服务端匹配替换；此处只负责插入文本。
 */

const DEFAULT_CATALOG = [
  { insert: "@玩家", label: "玩家", hint: "当前用户角色名" },
  { insert: "@user", label: "user", hint: "同 @玩家" },
  { insert: "@人设", label: "人设", hint: "当前用户角色人设" },
  { insert: "@rd100 ", label: "rd100", hint: "百面骰；可接目标 @rd100 30" },
  { insert: "@r1d20", label: "r1d20", hint: "二十面骰" },
  { insert: "@r3d10", label: "r3d10", hint: "3 个十面骰" },
];

let cachedCatalog = null;

export async function loadDirectiveCatalog() {
  if (cachedCatalog) return cachedCatalog;
  try {
    const res = await fetch("/api/directives/catalog");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.items) && data.items.length) {
        cachedCatalog = data.items;
        return cachedCatalog;
      }
    }
  } catch {
    /* fallback */
  }
  cachedCatalog = DEFAULT_CATALOG;
  return cachedCatalog;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {HTMLTextAreaElement} input
 * @param {{ getCatalog?: () => Promise<Array<{insert:string,label:string,hint:string}>> }} [opts]
 */
export function wireDirectiveAutocomplete(input, opts = {}) {
  if (!input || input.dataset.directiveAc === "1") return;
  input.dataset.directiveAc = "1";

  const getCatalog = opts.getCatalog || loadDirectiveCatalog;
  let popup = null;
  let items = [];
  let activeIndex = 0;
  let triggerStart = -1;

  function close() {
    popup?.remove();
    popup = null;
    items = [];
    triggerStart = -1;
  }

  function applyItem(item) {
    if (triggerStart < 0) return;
    const val = input.value;
    const cursor = input.selectionStart ?? val.length;
    const before = val.slice(0, triggerStart);
    const after = val.slice(cursor);
    input.value = `${before}${item.insert}${after}`;
    const pos = before.length + item.insert.length;
    input.setSelectionRange(pos, pos);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    close();
    input.focus();
  }

  function renderPopup() {
    if (!popup) {
      popup = document.createElement("div");
      popup.className = "directive-ac-popup";
      popup.setAttribute("role", "listbox");
      const shell = input.closest(".composer-input-shell") || input.parentElement;
      shell?.appendChild(popup);
    }
    popup.innerHTML = items
      .map(
        (it, i) => `<button type="button" class="directive-ac-item${
          i === activeIndex ? " is-active" : ""
        }" data-ac-index="${i}" role="option" aria-selected="${
          i === activeIndex ? "true" : "false"
        }">
        <code>${escapeHtml(it.insert.trim())}</code>
        <span class="directive-ac-hint">${escapeHtml(it.hint || it.label)}</span>
      </button>`,
      )
      .join("");
    popup.querySelectorAll("[data-ac-index]").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const idx = Number(btn.getAttribute("data-ac-index"));
        if (items[idx]) applyItem(items[idx]);
      });
    });
  }

  async function refresh() {
    const val = input.value;
    const cursor = input.selectionStart ?? 0;
    const before = val.slice(0, cursor);
    const m = before.match(/@([A-Za-z0-9_\u4e00-\u9fff]*)$/);
    if (!m) {
      close();
      return;
    }
    triggerStart = cursor - m[0].length;
    const q = (m[1] || "").toLowerCase();
    const catalog = await getCatalog();
    items = catalog.filter((it) => {
      const key = `${it.insert} ${it.label} ${it.hint}`.toLowerCase();
      return !q || key.includes(q) || it.insert.toLowerCase().includes(`@${q}`);
    });
    if (!items.length) {
      close();
      return;
    }
    activeIndex = 0;
    renderPopup();
  }

  input.addEventListener("input", () => {
    void refresh();
  });
  input.addEventListener("keydown", (e) => {
    if (!popup || !items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      renderPopup();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      renderPopup();
    } else if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
      // Enter 仍交给发送；仅 Tab 插入补全，避免抢发送
      if (e.key === "Tab") {
        e.preventDefault();
        applyItem(items[activeIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  input.addEventListener("blur", () => {
    setTimeout(close, 120);
  });
}
