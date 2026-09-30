/* Apply the conversation workspace theme before first paint, then mount the
 * same theme controls in every secondary-page top bar. */
(function () {
  var themes = [
    { id: "paper", icon: "📖", name: "仿纸暖黄", description: "经典护眼" },
    { id: "modern", icon: "✨", name: "现代清爽", description: "干净明快" },
    { id: "dark", icon: "🌙", name: "夜间暗色", description: "黑底灰字" },
    { id: "green", icon: "🍃", name: "豆沙绿", description: "自然疗愈" },
  ];

  function normalizeTheme(value) {
    return /^(paper|modern|dark|green)$/.test(value || "") ? value : "modern";
  }

  function normalizeScale(value) {
    var legacy = { sm: 88, md: 100, lg: 112, xl: 125 };
    var percent = legacy[value] != null ? legacy[value] : Number(value);
    if (!isFinite(percent)) percent = 100;
    if (percent > 0 && percent <= 2.5) percent = Math.round(percent * 100);
    return Math.min(150, Math.max(80, Math.round(percent / 5) * 5));
  }

  function applyTheme(theme) {
    var next = normalizeTheme(theme);
    document.documentElement.setAttribute("data-color-theme", next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("wa-color-theme", next);
    } catch (_) {}
    return next;
  }

  function applyScale(scale) {
    var next = normalizeScale(scale);
    document.documentElement.setAttribute("data-ui-font-scale", String(next));
    document.documentElement.style.setProperty("--ui-font-scale", String(next / 100));
    try {
      localStorage.setItem("wa-ui-font-scale", String(next));
    } catch (_) {}
    return next;
  }

  try {
    applyTheme(localStorage.getItem("wa-color-theme") || "modern");
    applyScale(localStorage.getItem("wa-ui-font-scale") || "100");
  } catch (_) {
    /* Storage may be unavailable; CSS defaults remain usable. */
  }

  function mountThemeMenu() {
    var top = document.querySelector(".st-top");
    if (!top || top.querySelector(".st-theme-menu")) return;

    var actions = document.createElement("div");
    actions.className = "st-top-actions";
    actions.innerHTML =
      '<details class="st-theme-menu">' +
      '<summary class="st-theme-summary" title="主题与字号" aria-label="主题与字号">' +
      '<span class="st-hamburger" aria-hidden="true"></span>' +
      "</summary>" +
      '<div class="st-theme-panel">' +
      '<div class="st-theme-label">主题</div>' +
      themes
        .map(function (item) {
          return (
            '<button type="button" class="st-theme-item" data-st-theme="' +
            item.id +
            '">' +
            '<span class="st-theme-icon" aria-hidden="true">' +
            item.icon +
            "</span>" +
            '<span class="st-theme-copy"><span class="st-theme-name">' +
            item.name +
            '</span><span class="st-theme-desc">' +
            item.description +
            "</span></span>" +
            "</button>"
          );
        })
        .join("") +
      '<div class="st-theme-separator"></div>' +
      '<div class="st-theme-label">字号</div>' +
      '<div class="st-font-scale" role="group" aria-label="字号">' +
      '<button type="button" data-st-scale="-1" aria-label="缩小字号">−</button>' +
      '<span class="st-font-value" aria-live="polite"></span>' +
      '<button type="button" data-st-scale="1" aria-label="放大字号">＋</button>' +
      "</div></div></details>";
    top.appendChild(actions);

    var menu = actions.querySelector(".st-theme-menu");
    var value = actions.querySelector(".st-font-value");

    function sync() {
      var active = normalizeTheme(
        document.documentElement.getAttribute("data-color-theme"),
      );
      var scale = normalizeScale(
        document.documentElement.getAttribute("data-ui-font-scale"),
      );
      actions.querySelectorAll("[data-st-theme]").forEach(function (button) {
        var selected = button.getAttribute("data-st-theme") === active;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      value.textContent = String(scale);
      var minus = actions.querySelector('[data-st-scale="-1"]');
      var plus = actions.querySelector('[data-st-scale="1"]');
      minus.disabled = scale <= 80;
      plus.disabled = scale >= 150;
    }

    actions.addEventListener("click", function (event) {
      var themeButton = event.target.closest("[data-st-theme]");
      if (themeButton) {
        applyTheme(themeButton.getAttribute("data-st-theme"));
        sync();
        return;
      }
      var scaleButton = event.target.closest("[data-st-scale]");
      if (scaleButton) {
        var current = normalizeScale(
          document.documentElement.getAttribute("data-ui-font-scale"),
        );
        applyScale(current + Number(scaleButton.getAttribute("data-st-scale")) * 5);
        sync();
      }
    });

    document.addEventListener("click", function (event) {
      if (menu.open && !menu.contains(event.target)) menu.removeAttribute("open");
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && menu.open) {
        menu.removeAttribute("open");
        menu.querySelector("summary").focus();
      }
    });
    window.addEventListener("storage", function (event) {
      if (event.key === "wa-color-theme") applyTheme(event.newValue);
      if (event.key === "wa-ui-font-scale") applyScale(event.newValue);
      sync();
    });
    sync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountThemeMenu, { once: true });
  } else {
    mountThemeMenu();
  }
})();
