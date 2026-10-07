/** 游玩主列：非主世界层 LLM 气泡（旁观 / 其它执行单元）显示偏好 */

const AUX_LLM_STORAGE_KEY = "wa-play-aux-llm-bubbles";
const AUX_LLM_ATTR = "data-play-aux-llm-bubbles";

/** @type {boolean | null} */
let auxLlmMemory = null;

export function getStoredPlayAuxLlmBubbles() {
  if (auxLlmMemory != null) return auxLlmMemory;
  try {
    return localStorage.getItem(AUX_LLM_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isPlayAuxLlmBubblesEnabled() {
  if (auxLlmMemory != null) return auxLlmMemory;
  if (typeof document !== "undefined") {
    const attr = document.documentElement?.getAttribute(AUX_LLM_ATTR);
    if (attr === "1" || attr === "0") return attr === "1";
  }
  return getStoredPlayAuxLlmBubbles();
}

export function applyPlayAuxLlmBubbles(enabled) {
  const on = Boolean(enabled);
  auxLlmMemory = on;
  if (typeof document !== "undefined") {
    document.documentElement?.setAttribute(AUX_LLM_ATTR, on ? "1" : "0");
  }
  try {
    localStorage.setItem(AUX_LLM_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  return on;
}

export function initPlayAuxLlmBubbles() {
  auxLlmMemory = null;
  return applyPlayAuxLlmBubbles(getStoredPlayAuxLlmBubbles());
}

function isPlayView(view) {
  return Boolean(view?.playLayerActive || view?.lifecycleStage === "play");
}

function isPlayHousekeepingMessage(msg) {
  const title = String(msg?.title ?? "");
  const text = String(msg?.text ?? msg?.body ?? "").trim();
  if (title === "上下文已压缩" || title === "阶段机") return true;
  if (/^\[上下文已压缩\]/.test(text)) return true;
  if (/^\[裁决合并\]/.test(text)) return true;
  if (/^\[旁观维护\]/.test(text)) return true;
  if (/归档\s*\d+\s*个过程 tag/.test(text)) return true;
  return false;
}

function shouldRenderPlayPresent(msg, view) {
  if (!isPlayView(view)) return false;
  if (msg?.role === "user") return false;
  const kind = msg?.kind ?? "";
  if (kind === "worker_questions" || kind === "orchestrator_thinking") return false;
  if (isPlayHousekeepingMessage(msg)) return false;
  const actor = String(msg?.actor ?? "");
  const title = String(msg?.title ?? "");
  return (
    actor === "narrator" ||
    actor === "round-present" ||
    actor === "world-simulator" ||
    /用户展示|开场白/.test(title)
  );
}

function isMainWorldPlayActor(actor) {
  const id = String(actor ?? "").trim();
  return id === "world-simulator" || id === "gm";
}

/** 主世界层以外的游玩 LLM 产出（旁观维护等），可进主列气泡查上下文 / 原文 */
export function isPlayAuxLlmOutput(msg, view) {
  if (!isPlayView(view) || msg?.role === "user") return false;
  if (isPlayHousekeepingMessage(msg)) return false;
  if (shouldRenderPlayPresent(msg, view)) return false;
  const kind = msg?.kind ?? "";
  if (kind === "worker_output") {
    return !isMainWorldPlayActor(msg.actor);
  }
  if (msg?.contextTrace || msg?.requestOutlines?.length) {
    return !isMainWorldPlayActor(msg.actor);
  }
  return false;
}
