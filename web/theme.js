/** Color themes + present chrome — aligned with llm_workflow_engine ThemeToggle. */

export const COLOR_THEMES = [
  {
    id: "paper",
    name: "仿纸暖黄",
    description: "经典护眼，像 Kindle",
    icon: "📖",
  },
  {
    id: "modern",
    name: "现代清爽",
    description: "干净明快，适合网文",
    icon: "✨",
  },
  {
    id: "dark",
    name: "夜间暗色",
    description: "黑底灰字，夜间必备",
    icon: "🌙",
  },
  {
    id: "green",
    name: "豆沙绿",
    description: "自然疗愈，绿色经典",
    icon: "🍃",
  },
];

/** 呈现壳气质（tone_chrome），与色主题同属「主题」菜单 */
export const PRESENT_CHROMES = [
  { id: "default", name: "默认", description: "跟随壳本身" },
  { id: "messenger", name: "讯息", description: "气泡对话感" },
  { id: "book", name: "书页", description: "阅读排版感" },
  { id: "terminal", name: "终端", description: "等宽终端感" },
];

const STORAGE_KEY = "wa-color-theme";
const CHROME_STORAGE_KEY = "wa-present-chrome";
const THEME_IDS = new Set(COLOR_THEMES.map((t) => t.id));
const CHROME_IDS = new Set(PRESENT_CHROMES.map((t) => t.id));
const DEFAULT_THEME = "modern";
const DEFAULT_CHROME = "default";

export function normalizeColorTheme(id) {
  const v = String(id || "").trim();
  return THEME_IDS.has(v) ? v : DEFAULT_THEME;
}

export function getStoredColorTheme() {
  try {
    return normalizeColorTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function themeById(id) {
  const tid = normalizeColorTheme(id);
  return COLOR_THEMES.find((t) => t.id === tid) || COLOR_THEMES[1];
}

export function applyColorTheme(id) {
  const theme = normalizeColorTheme(id);
  document.documentElement.setAttribute("data-color-theme", theme);
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore quota / private mode */
  }
  return theme;
}

export function initColorTheme() {
  return applyColorTheme(getStoredColorTheme());
}

export function normalizePresentChrome(id) {
  const v = String(id || "").trim();
  return CHROME_IDS.has(v) ? v : DEFAULT_CHROME;
}

export function getStoredPresentChrome() {
  try {
    return normalizePresentChrome(localStorage.getItem(CHROME_STORAGE_KEY));
  } catch {
    return DEFAULT_CHROME;
  }
}

export function chromeById(id) {
  const cid = normalizePresentChrome(id);
  return PRESENT_CHROMES.find((t) => t.id === cid) || PRESENT_CHROMES[0];
}

export function applyPresentChrome(id) {
  const chrome = normalizePresentChrome(id);
  document.documentElement.setAttribute("data-present-chrome", chrome);
  try {
    localStorage.setItem(CHROME_STORAGE_KEY, chrome);
  } catch {
    /* ignore */
  }
  document.querySelectorAll(".present-shell").forEach((el) => {
    for (const cls of [...el.classList]) {
      if (cls.startsWith("present-tone--")) el.classList.remove(cls);
    }
    el.classList.add(`present-tone--${chrome}`);
  });
  return chrome;
}

export function initPresentChrome() {
  return applyPresentChrome(getStoredPresentChrome());
}
