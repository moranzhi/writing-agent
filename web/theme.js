/** Color themes + UI font scale — aligned with llm_workflow_engine ThemeToggle. */

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

/** 全局字号：百分比（100 = 默认），+/- 步进调节 */
export const UI_FONT_SCALE_MIN = 80;
export const UI_FONT_SCALE_MAX = 150;
export const UI_FONT_SCALE_STEP = 5;
export const UI_FONT_SCALE_DEFAULT = 100;

const LEGACY_FONT_SCALE_IDS = {
  sm: 88,
  md: 100,
  lg: 112,
  xl: 125,
};

/**
 * @deprecated 选壳已从主题菜单移除；壳气质跟呈现壳本身。保留常量以免旧引用报错。
 */
export const PRESENT_CHROMES = [
  { id: "default", name: "默认", description: "跟随壳本身" },
  { id: "messenger", name: "讯息", description: "气泡对话感" },
  { id: "book", name: "书页", description: "阅读排版感" },
  { id: "terminal", name: "终端", description: "等宽终端感" },
];

const STORAGE_KEY = "wa-color-theme";
const FONT_SCALE_STORAGE_KEY = "wa-ui-font-scale";
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

function clampFontPercent(n) {
  const stepped = Math.round(n / UI_FONT_SCALE_STEP) * UI_FONT_SCALE_STEP;
  return Math.min(
    UI_FONT_SCALE_MAX,
    Math.max(UI_FONT_SCALE_MIN, stepped),
  );
}

/** 解析为百分比整数；兼容旧档 sm/md/lg/xl 与 0.x～2 倍缩放 */
export function normalizeUiFontScalePercent(raw) {
  if (raw == null) return UI_FONT_SCALE_DEFAULT;
  const key = String(raw).trim();
  if (Object.prototype.hasOwnProperty.call(LEGACY_FONT_SCALE_IDS, key)) {
    return LEGACY_FONT_SCALE_IDS[key];
  }
  let n = Number(key);
  if (!Number.isFinite(n)) return UI_FONT_SCALE_DEFAULT;
  if (n > 0 && n <= 2.5) n = Math.round(n * 100);
  return clampFontPercent(n);
}

export function getStoredUiFontScale() {
  try {
    return normalizeUiFontScalePercent(localStorage.getItem(FONT_SCALE_STORAGE_KEY));
  } catch {
    return UI_FONT_SCALE_DEFAULT;
  }
}

/** @deprecated 用 getStoredUiFontScale / applyUiFontScale(percent) */
export function fontScaleById(id) {
  const percent = normalizeUiFontScalePercent(id);
  return { id: String(percent), scale: percent / 100, name: `${percent}`, description: "" };
}

export function applyUiFontScale(raw) {
  const percent = normalizeUiFontScalePercent(raw);
  const root = document.documentElement;
  root.setAttribute("data-ui-font-scale", String(percent));
  root.style.setProperty("--ui-font-scale", String(percent / 100));
  try {
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(percent));
  } catch {
    /* ignore */
  }
  return percent;
}

export function bumpUiFontScale(deltaSteps) {
  const cur = getStoredUiFontScale();
  const steps = Number(deltaSteps);
  const delta = Number.isFinite(steps) ? steps : 0;
  return applyUiFontScale(cur + delta * UI_FONT_SCALE_STEP);
}

export function initUiFontScale() {
  return applyUiFontScale(getStoredUiFontScale());
}

/** @deprecated */
export function normalizePresentChrome(id) {
  const v = String(id || "").trim();
  return CHROME_IDS.has(v) ? v : DEFAULT_CHROME;
}

/** @deprecated */
export function getStoredPresentChrome() {
  try {
    return normalizePresentChrome(localStorage.getItem(CHROME_STORAGE_KEY));
  } catch {
    return DEFAULT_CHROME;
  }
}

/** @deprecated */
export function chromeById(id) {
  const cid = normalizePresentChrome(id);
  return PRESENT_CHROMES.find((t) => t.id === cid) || PRESENT_CHROMES[0];
}

/** @deprecated 菜单已移除；调用仍把属性钉为 default，避免旧存档残留 */
export function applyPresentChrome(_id) {
  const chrome = DEFAULT_CHROME;
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

/** @deprecated */
export function initPresentChrome() {
  return applyPresentChrome(DEFAULT_CHROME);
}
