import { renderIntakePanel } from "./intake-ui.js";
import {
  getActiveQuestions,
  getModuleOpeningPrompt,
  isModuleOpeningWaiting,
  isQuestionCardDismissed,
  renderQuestionsCard,
} from "./questions-ui.js";
import { displayWorkerLabel, formatWorkerDisplayTitle, reviewComposerCopy } from "./display-labels.js";
import {
  PRESENT_SHELL_IDS,
  parsePresentDoc,
  presentFromPlain,
  renderPresentShellHtml,
} from "./present-shells.js";

const HIDE_KINDS = new Set(["worker_stub"]);

/** 中间对话区不展示的内部调度消息（仅出现在左侧「调度」） */
const FEED_HIDDEN_KINDS = new Set([
  "agent_tool",
  "orchestrator_decision",
  "worker_running",
]);

const MSG_CLASS = {
  user_input: "user",
  agent_tool: "agent",
  orchestrator_decision: "agent",
  orchestrator_thinking: "agent",
  orchestrator_prompt: "agent",
  orchestrator_assessment: "agent",
  worker_running: "skill",
  worker_output: "skill",
  worker_questions: "questions",
  error: "error",
};

const MSG_LABEL = {
  user_input: "你",
  agent_tool: "工具",
  orchestrator_decision: "编排器",
  orchestrator_thinking: "编排器 · 思考",
  orchestrator_prompt: "编排器",
  orchestrator_assessment: "编排器 · 内容评价",
  worker_running: "执行单元",
  worker_output: "执行单元",
  worker_questions: "提问",
  error: "错误",
  system_info: "系统",
};

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderThinkingBlock(thinking, { open = false } = {}) {
  const text = (thinking ?? "").trim();
  if (!text) return "";
  return `<details class="msg-thinking"${open ? " open" : ""}>
    <summary>思考过程</summary>
    <pre class="msg-thinking-body">${esc(text)}</pre>
  </details>`;
}

function renderLiveStreamBody(live, view) {
  const thinking = (live?.thinking || view?.agentThinking || "").trim();
  const output = (live?.output ?? "").trim();
  const showOutput =
    Boolean(output) && (view?.lifecycleStage ?? document.body.dataset.lifecycle) === "play";
  const parts = [];
  if (thinking) {
    parts.push(
      `<section class="msg-live-section"><header>思考</header><pre class="msg-live-pre">${esc(thinking)}</pre></section>`,
    );
  }
  if (showOutput) {
    parts.push(
      `<section class="msg-live-section"><header>输出</header><pre class="msg-live-pre">${esc(output)}</pre></section>`,
    );
  }
  return parts.length ? parts.join("") : "…";
}

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function msgLabel(msg) {
  const k = msg.kind ?? (msg.role === "user" ? "user_input" : "system_info");
  if (k.startsWith("worker") && msg.actor) {
    if (k === "worker_questions") return formatWorkerDisplayTitle(msg.actor, "questions");
    if (k === "worker_output") return formatWorkerDisplayTitle(msg.actor, "output");
    if (k === "worker_running") return formatWorkerDisplayTitle(msg.actor, "running");
    return displayWorkerLabel(msg.actor);
  }
  return MSG_LABEL[k] ?? k;
}

function canEditMessage(msg) {
  return msg.role === "user";
}

function canRefreshMessage(msg) {
  if (msg.role === "user") return false;
  const kind = msg.kind ?? "system_info";
  return kind === "worker_questions" || kind === "worker_output";
}

/** ‹ n/total › 进退 + 可重出；后续输入基于当前激活版本 */
function renderVariantNavHtml(msg) {
  if (!msg?.id) return "";
  const total = Math.max(1, Number(msg.branchTotal) || 1);
  const index = Math.min(total, Math.max(1, (msg.branchIndex ?? 0) + 1));
  const refreshable = canRefreshMessage(msg);
  if (total <= 1 && !refreshable) return "";
  const id = esc(msg.id);
  const prevDis = index <= 1 ? " disabled" : "";
  const nextDis = index >= total ? " disabled" : "";
  const refresh = refreshable
    ? `<button type="button" class="msg-action msg-action-primary" data-msg-action="refresh" data-msg-id="${id}" title="重出一版（新版本）">↻</button>`
    : "";
  return `<span class="msg-variant-nav" title="切换版本；在此版本上继续输入">
    <button type="button" class="msg-action" data-msg-action="variant-prev" data-msg-id="${id}"${prevDis} aria-label="上一版">‹</button>
    <span class="msg-variant-count">${index}/${total}</span>
    <button type="button" class="msg-action" data-msg-action="variant-next" data-msg-id="${id}"${nextDis} aria-label="下一版">›</button>
    ${refresh}
  </span>`;
}

/** @deprecated 用 renderVariantNavHtml */
function renderMsgVariantBadge(msg) {
  return renderVariantNavHtml(msg);
}

function hideMsgMenu() {
  const menu = document.getElementById("msg-action-menu");
  if (menu) menu.hidden = true;
  msgMenuState.messageId = null;
  msgMenuState.rollbackMessageId = null;
  msgMenuState.card = null;
}

const msgMenuState = {
  messageId: null,
  rollbackMessageId: null,
  card: null,
  handlers: null,
};

function showMsgMenu(card, x, y) {
  const menu = document.getElementById("msg-action-menu");
  if (!menu || !card) return;
  const isReview = card.dataset.review === "1";
  const isReadOnly = card.dataset.readOnly === "1";
  const canEdit = !isReview && card.dataset.canEdit === "1";
  const canDelete = !isReview && !isReadOnly && Boolean(card.dataset.messageId);
  const canRollback = !isReview && !isReadOnly && Boolean(card.dataset.rollbackMessageId);
  const hasContext = card.dataset.hasContext === "1";
  const editBtn = document.getElementById("msg-menu-edit");
  const delBtn = document.getElementById("msg-menu-delete");
  const rollbackBtn = document.getElementById("msg-menu-rollback");
  const ctxBtn = document.getElementById("msg-menu-context");
  if (editBtn) editBtn.toggleAttribute("hidden", !canEdit);
  if (delBtn) delBtn.toggleAttribute("hidden", !canDelete);
  if (rollbackBtn) rollbackBtn.toggleAttribute("hidden", !canRollback);
  if (ctxBtn) ctxBtn.toggleAttribute("hidden", !hasContext);
  menu.hidden = false;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  msgMenuState.messageId = card.dataset.messageId ?? null;
  msgMenuState.rollbackMessageId = card.dataset.rollbackMessageId ?? null;
  msgMenuState.card = card;
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`;
  }
}

function wireMsgActionMenu(handlers) {
  const menu = document.getElementById("msg-action-menu");
  if (!menu) return;
  msgMenuState.handlers = handlers;
  if (menu.dataset.wired) return;
  menu.dataset.wired = "1";
  menu.addEventListener("click", async (e) => {
    const action = e.target.closest("[data-msg-menu-action]")?.getAttribute("data-msg-menu-action");
    const messageId = msgMenuState.messageId;
    const rollbackMessageId = msgMenuState.rollbackMessageId;
    const card = msgMenuState.card;
    hideMsgMenu();
    if (!messageId || !action) return;
    const bodyEl = card?.querySelector(".msg-body:not(.msg-body-editing), .coord-text");
    const body = bodyEl?.textContent ?? card?.dataset.originalText ?? "";

    if (action === "copy") {
      try {
        await navigator.clipboard.writeText(body);
      } catch {
        /* ignore */
      }
      return;
    }
    if (action === "view-context") {
      msgMenuState.handlers?.onViewContext?.(messageId);
      return;
    }
    if (action === "edit") {
      startInlineEdit(card, body);
      return;
    }
    if (action === "rollback") {
      if (!rollbackMessageId) return;
      if (!confirm("回退到这条消息？之后的对话和创作状态将被移除。")) return;
      msgMenuState.handlers?.onDeleteMessage?.(rollbackMessageId);
      return;
    }
    if (action === "delete") {
      if (!confirm("从这里重开？这条消息及之后的对话和创作状态将被移除。")) return;
      msgMenuState.handlers?.onDeleteMessage?.(messageId);
    }
  });
}

function wireMessageContextMenu(feed, handlers) {
  if (!feed || feed.dataset.contextWired) return;
  feed.dataset.contextWired = "1";
  wireMsgActionMenu(handlers);
  feed.addEventListener("contextmenu", (e) => {
    const bubble = e.target.closest(".msg-bubble, .workspace-review, .coord-line");
    const card = e.target.closest("[data-message-id]");
    if (!bubble || !card || card.classList.contains("msg-pending")) return;
    e.preventDefault();
    showMsgMenu(card, e.clientX, e.clientY);
  });
  feed.addEventListener("click", (e) => {
    const contextTrigger = e.target.closest("[data-context-trigger]");
    const contextCard = contextTrigger?.closest("[data-message-id]");
    if (contextTrigger && contextCard) {
      e.preventDefault();
      e.stopPropagation();
      handlers?.onViewContext?.(contextCard.dataset.messageId);
      return;
    }
    const trigger = e.target.closest("[data-msg-menu-trigger]");
    const card = trigger?.closest("[data-message-id]");
    if (!trigger || !card) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = trigger.getBoundingClientRect();
    showMsgMenu(card, rect.right, rect.bottom + 4);
  });
}

function startInlineEdit(card, bodyText) {
  if (!card || card.classList.contains("is-editing")) return;
  card.classList.add("is-editing");
  card.dataset.originalText = bodyText;
  card.querySelector(".msg-foot")?.setAttribute("hidden", "");

  const bodyEl = card.querySelector(".msg-body");
  if (!bodyEl) return;

  const messageId = card.dataset.messageId ?? "";
  bodyEl.outerHTML = `
    <div class="msg-body msg-body-editing">
      <textarea class="msg-edit-input" rows="4" aria-label="编辑消息">${esc(bodyText)}</textarea>
      <div class="msg-edit-bar">
        <button type="button" class="btn" data-msg-action="edit-cancel" data-msg-id="${esc(messageId)}">取消</button>
        <button type="button" class="btn btn-primary" data-msg-action="edit-save" data-msg-id="${esc(messageId)}">保存并重新生成</button>
      </div>
      <p class="msg-edit-hint">Ctrl/⌘ + Enter 保存 · Esc 取消</p>
    </div>`;

  const ta = card.querySelector(".msg-edit-input");
  if (ta) {
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
    ta.addEventListener("input", () => {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelInlineEdit(card);
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        card.querySelector("[data-msg-action=edit-save]")?.click();
      }
    });
  }
}

function cancelInlineEdit(card) {
  if (!card) return;
  const original = card.dataset.originalText ?? "";
  card.classList.remove("is-editing");
  delete card.dataset.originalText;
  card.querySelector(".msg-foot")?.removeAttribute("hidden");
  const editing = card.querySelector(".msg-body-editing");
  if (editing) {
    editing.outerHTML = `<div class="msg-body">${esc(original)}</div>`;
  }
}

function wireMessageFeedActions(feed, handlers) {
  if (!feed) return;
  // 每次刷新 handlers（委托仍挂一次；回调走最新）
  feed._msgHandlers = handlers;
  if (feed.dataset.actionsWired) return;
  feed.dataset.actionsWired = "1";
  feed.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-msg-action]");
    if (!btn || btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const action = btn.getAttribute("data-msg-action");
    const messageId = btn.getAttribute("data-msg-id");
    const h = feed._msgHandlers || handlers;
    if (!messageId && action !== "edit-cancel" && action !== "edit-save") return;

    const card = btn.closest("[data-message-id]");
    const bodyEl = card?.querySelector(".msg-body:not(.msg-body-editing)");
    const body = bodyEl?.textContent ?? card?.dataset.originalText ?? "";

    if (action === "copy") {
      const copyText =
        card?.querySelector(".msg-edit-input")?.value ??
        card?.querySelector(".msg-body")?.textContent ??
        body;
      try {
        await navigator.clipboard.writeText(copyText);
      } catch {
        /* ignore */
      }
      return;
    }

    if (action === "edit") {
      startInlineEdit(card, body);
      return;
    }

    if (action === "edit-cancel") {
      cancelInlineEdit(card);
      return;
    }

    if (action === "edit-save") {
      const ta = card?.querySelector(".msg-edit-input");
      const next = ta?.value?.trim() ?? "";
      const original = (card?.dataset.originalText ?? body).trim();
      cancelInlineEdit(card);
      if (!next || next === original) return;
      h.onEditMessage?.(messageId, next);
      return;
    }

    if (action === "refresh") {
      h.onRefreshMessage?.(messageId);
      return;
    }

    if (action === "variant-prev") {
      h.onSwitchVariant?.(messageId, "prev");
      return;
    }

    if (action === "variant-next") {
      h.onSwitchVariant?.(messageId, "next");
    }
  });
}

function msgBody(msg, view) {
  let body = (msg.body ?? msg.text ?? "").trim();
  if (msg.kind === "worker_questions") {
    // 能力默认问题走说话面，侧栏勿显示「提问中 · N 题」空壳索引
    if (isModuleOpeningWaiting(view)) {
      return body || "默认问题（主栏引导中）";
    }
    if (getActiveQuestions(view)) {
      const qs = view.waitingReason?.questions ?? [];
      const n = Array.isArray(qs) ? qs.length : 0;
      return `提问中 · ${n || "?"} 题`;
    }
    if (!body) {
      const wr = view.waitingReason;
      if (wr?.kind === "worker_questions") {
        const qs = wr.questions ?? [];
        const prompts = qs.map((q) =>
          typeof q === "string" ? q : q?.prompt,
        ).filter(Boolean);
        if (prompts.length) body = prompts.map((q) => `- ${q}`).join("\n");
      }
      if (!body) body = "请补充当前 Worker 需要的信息。";
    }
  }
  return body;
}

function formatQuestionsHtml(body) {
  const lines = body
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return `<p class="msg-q-lead">${esc(body)}</p>`;
  }
  return `<ol class="msg-q-list">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>`;
}

/** play 期助手终稿（含已验收的用户展示）用呈现壳渲染 */
function shouldRenderPlayPresent(msg, view) {
  if (view?.lifecycleStage !== "play") return false;
  if (msg.role === "user") return false;
  const kind = msg.kind ?? "";
  if (kind === "worker_questions" || kind === "orchestrator_thinking") return false;
  if (kind === "worker_output") return false; // 已走 formatArtifactBodyHtml
  const actor = String(msg.actor ?? "");
  if (actor === "narrator" || /用户展示|开场白/.test(String(msg.title ?? ""))) {
    return true;
  }
  // 助手可见终稿：无特殊 kind 的长文
  return kind === "system_info" || kind === "worker_stub" || !kind;
}

function formatPlayPresentHtml(body, view) {
  const trimmed = (body || "").trim();
  if (!trimmed) return `<p class="empty-sm">（无正文）</p>`;
  const tweaks = view?.presentationTweaks;
  const fallbackShell =
    tweaks?.shell_id && PRESENT_SHELL_IDS?.includes?.(tweaks.shell_id)
      ? tweaks.shell_id
      : tweaks?.shell_id &&
          [
            "prose",
            "chat_monitor",
            "spotlight",
            "turn_panel",
            "split_board",
            "choice_dock",
            "chapter_reader",
          ].includes(tweaks.shell_id)
        ? tweaks.shell_id
        : "prose";
  const parsed = tryParseJsonDoc(trimmed);
  const presentView = parsed ? parsePresentDoc(parsed, fallbackShell) : null;
  if (presentView) {
    return renderPresentShellHtml(presentView.packet, esc, { tweaks });
  }
  return renderPresentShellHtml(presentFromPlain(trimmed, fallbackShell), esc, {
    tweaks,
  });
}

/** 旧会话 skill 选择提示，新流程不再展示 */
const SKILL_SELECTION_RE = /请选择创作 skill|请选择创作类型/;

/** @deprecated 旧会话可能仍处于 skill_selection；新作品不再展示选包 UI */
export function renderSkillPicker(_view, _onPick) {
  const el = document.getElementById("skill-picker");
  if (!el) return;
  el.hidden = true;
  el.innerHTML = "";
}

let activeRailTab = "books";
/** 用户手动展开侧栏后，在本会话保持展开，直到再点收起 */
let railUserExpanded = false;
/** 创作验收右侧「此前对话」：默认收起，把宽度留给产物 */
let coordRailCollapsed = true;

function syncCoordRailChrome() {
  const rail = document.getElementById("coord-rail");
  const toggle = document.getElementById("btn-coord-toggle");
  document.body.classList.toggle("coord-rail-collapsed", coordRailCollapsed);
  if (toggle) {
    toggle.setAttribute("aria-expanded", coordRailCollapsed ? "false" : "true");
    toggle.title = coordRailCollapsed ? "展开此前对话" : "收起此前对话";
  }
  if (rail) {
    rail.dataset.collapsed = coordRailCollapsed ? "1" : "0";
  }
}

function setCoordRailCollapsed(collapsed) {
  coordRailCollapsed = Boolean(collapsed);
  syncCoordRailChrome();
}

function wireCoordRailChrome() {
  const toggle = document.getElementById("btn-coord-toggle");
  if (toggle && !toggle.dataset.wired) {
    toggle.dataset.wired = "1";
    toggle.addEventListener("click", () => {
      setCoordRailCollapsed(!coordRailCollapsed);
    });
  }
  const collapse = document.getElementById("btn-coord-collapse");
  if (collapse && !collapse.dataset.wired) {
    collapse.dataset.wired = "1";
    collapse.addEventListener("click", () => setCoordRailCollapsed(true));
  }
}

export function setRailTab(tab, { expand = false } = {}) {
  activeRailTab = tab === "log" ? "log" : "books";
  if (expand) railUserExpanded = true;
  document.querySelectorAll(".rail-tab").forEach((btn) => {
    const id = btn.getAttribute("data-rail-tab");
    const active = id === activeRailTab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".rail-tab-panel").forEach((panel) => {
    const id = panel.getAttribute("data-rail-panel");
    const active = id === activeRailTab;
    panel.classList.toggle("active", active);
    panel.toggleAttribute("hidden", !active);
  });
  syncRailCollapse();
}

function wireRailChrome() {
  const tabs = document.getElementById("rail-tabs");
  if (tabs && !tabs.dataset.wired) {
    tabs.dataset.wired = "1";
    tabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".rail-tab");
      if (!btn) return;
      const tab = btn.getAttribute("data-rail-tab") ?? "books";
      const collapsed = document.body.classList.contains("rail-collapsed");
      setRailTab(tab, { expand: collapsed });
    });
  }
  const toggle = document.getElementById("btn-rail-toggle");
  if (toggle && !toggle.dataset.wired) {
    toggle.dataset.wired = "1";
    toggle.addEventListener("click", () => {
      if (document.body.dataset.railCanCollapse !== "1") {
        railUserExpanded = true;
      } else {
        railUserExpanded = !railUserExpanded;
      }
      syncRailCollapse();
    });
  }
}

function hasStartedCreation(view) {
  if (!view?.id) return false;
  if (view.lifecycleStage === "play") return true;
  if (hasUserMessages(view)) return true;
  const reason = view.waitingReason?.kind;
  if (reason && reason !== "intake") return true;
  return Boolean(view.reviewArtifact);
}

function syncRailCollapse(view) {
  if (view) {
    document.body.dataset.railCanCollapse = hasStartedCreation(view) ? "1" : "0";
  }
  const canCollapse = document.body.dataset.railCanCollapse === "1";
  const collapsed = canCollapse && !railUserExpanded;
  document.body.classList.toggle("rail-collapsed", collapsed);
  const toggle = document.getElementById("btn-rail-toggle");
  if (toggle) {
    toggle.title = collapsed ? "展开侧栏" : "收起侧栏";
    toggle.textContent = collapsed ? "›" : "‹";
  }
}

export function resetRailChrome() {
  activeRailTab = "books";
  railUserExpanded = true;
  coordRailCollapsed = true;
  document.body.dataset.railCanCollapse = "0";
  document.body.classList.remove("rail-collapsed", "coord-rail-collapsed");
  const rail = document.getElementById("coord-rail");
  if (rail) {
    rail.hidden = true;
    rail.dataset.collapsed = "1";
  }
  setRailTab("books");
}

function hasUserMessages(view) {
  return (view.messages ?? []).some((m) => m.role === "user");
}

function isSkillSelectionMessage(msg) {
  const body = (msg.body ?? msg.text ?? "").trim();
  return SKILL_SELECTION_RE.test(body);
}

function isStartupPromptMessage(msg, view) {
  if (msg.role === "user") return false;
  const body = (msg.body ?? msg.text ?? "").trim();
  const prompt = (view.intakePrompt ?? "").trim();
  return Boolean(prompt && body === prompt);
}

/** 产物挂载追问的历史空壳（旧会话可能仍有）；追问应跟产物同面，不单开气泡 */
function isReviewSidecarQuestionStub(msg) {
  if ((msg.kind ?? "") !== "worker_questions") return false;
  const text = String(msg.text ?? msg.body ?? "").trim();
  return /^\[Worker\]\s*可选追问/.test(text);
}

function shouldShowInFeed(msg, view) {
  if (msg.role === "user") return true;
  const kind = msg.kind ?? "system_info";
  if (HIDE_KINDS.has(kind)) return false;
  if (FEED_HIDDEN_KINDS.has(kind)) return false;
  if (msg.compressed) return false;
  if (isSkillSelectionMessage(msg)) return false;
  if (isReviewSidecarQuestionStub(msg)) return false;
  if (
    view.waitingReason?.kind === "intake" &&
    !hasUserMessages(view) &&
    isStartupPromptMessage(msg, view)
  ) {
    return false;
  }
  if (kind === "worker_output" && view.waitingReason?.kind === "review_artifact") {
    return false;
  }
  // 创作：编排器思考进「调度」，不占主区；游玩保持原样
  if (kind === "orchestrator_thinking" && view.lifecycleStage !== "play") {
    return false;
  }
  if (kind === "orchestrator_prompt") return false;
  return true;
}

function maybeSyncRail(view) {
  const started = hasStartedCreation(view);
  const wasCollapsible = document.body.dataset.railCanCollapse === "1";
  // 刚进入创作：默认缩进；未开写：展开并停在作品
  if (started && !wasCollapsible) {
    railUserExpanded = false;
  }
  if (!started) {
    railUserExpanded = true;
    if (activeRailTab !== "books") setRailTab("books");
  }
  syncRailCollapse(view);
}

export function renderLifecycle(view) {
  const toggle = document.getElementById("lifecycle-toggle");
  if (!toggle) return;
  const stage = view.lifecycleStage ?? "design";
  document.body.dataset.lifecycle = stage;
  toggle.querySelectorAll("[data-stage]").forEach((btn) => {
    const s = btn.getAttribute("data-stage");
    btn.classList.toggle("active", s === stage);
    if (s === "play") {
      btn.disabled = !view.playReady;
      btn.title = view.playReady
        ? "进入游玩 / 写作"
        : "请先验收 Worker 集（创作定稿）后再切换";
    } else {
      btn.disabled = false;
    }
  });
}

/** @deprecated 设计 Tab 已移除；保留空函数以免外部误调用 */
export function renderSkillGuide(_view) {
  wireRailChrome();
}

function renderTagList(tags, emptyLabel) {
  if (!tags?.length) {
    return `<div class="ws-tag-empty">${esc(emptyLabel)}</div>`;
  }
  return `<ol class="ws-tag-order">${tags
    .map((t, i) => {
      const filled =
        t.filled === true
          ? `<span class="ws-tag-filled" title="已写入黑板">✓</span>`
          : t.filled === false
            ? `<span class="ws-tag-pending" title="待写入">○</span>`
            : "";
      const note = t.note ? `<span class="ws-tag-note">${esc(t.note)}</span>` : "";
      return `<li><code>${esc(t.tag)}</code>${filled}${note}</li>`;
    })
    .join("")}</ol>`;
}

function howLabel(how) {
  if (how === "prompt_body") return "注入正文";
  if (how === "resident") return "常驻挂载";
  return "读入黑板";
}

function formatFocusBodyHtml(body) {
  if (body == null) return `<p class="ws-muted">（本块尚无正文，请在下方对话中补充）</p>`;
  if (typeof body === "string") {
    const t = body.trim();
    return t
      ? formatArtifactBodyHtml(t)
      : `<p class="ws-muted">（本块尚无正文，请在下方对话中补充）</p>`;
  }
  try {
    return formatArtifactBodyHtml(JSON.stringify(body));
  } catch {
    return `<pre class="ws-focus-body-text">${esc(String(body))}</pre>`;
  }
}

function renderFocusUnitBanner(focusUnit, opts = {}) {
  if (!focusUnit) return "";
  const isContext =
    focusUnit.kind === "fixed" ||
    (typeof focusUnit.id === "string" &&
      (focusUnit.id.startsWith("fixed:") || focusUnit.id.startsWith("resident:")));
  const kindLabel =
    focusUnit.kind === "worker"
      ? "创造 Worker"
      : focusUnit.kind === "phase"
        ? "创作阶段"
        : "填充上下文";
  const showBody =
    !opts.omitFocusBody &&
    (isContext || focusUnit.kind === "phase") &&
    focusUnit.body != null &&
    String(focusUnit.body).trim();
  const hint = opts.omitFocusBody
    ? "下方卡片为本次待验收产物。"
    : isContext
      ? "请重点审阅：这是本次要写入 / 验收的上下文。"
      : focusUnit.kind === "worker"
        ? "请重点审阅当前运行规格。"
        : "请重点审阅当前创作单位。";
  const bodyHtml = showBody
    ? `<div class="ws-focus-body">${formatFocusBodyHtml(focusUnit.body)}</div>`
    : "";
  return `<section class="ws-section ws-focus-banner" data-focus-kind="${esc(focusUnit.kind)}" data-focus-id="${esc(focusUnit.id)}">
    <div class="ws-focus-banner-head">
      <span class="ws-focus-mode">${esc(kindLabel)}</span>
      <span class="ws-focus-label">${esc(focusUnit.label)}</span>
      <code class="ws-focus-id">${esc(focusUnit.id)}</code>
    </div>
    <p class="ws-focus-hint">${esc(hint)}</p>
    ${bodyHtml}
  </section>`;
}

function renderContextTagCards(contextTags, opts = {}) {
  if (!contextTags?.length) return "";
  const compact = opts.compact === true;
  const focusId = opts.focusId || "";
  const focusContext = opts.focusContext === true;
  const fixedFirst = [...contextTags].sort((a, b) => {
    const rank = (k) => (k === "fixed" ? 0 : k === "resident" ? 1 : 2);
    return rank(a.kind) - rank(b.kind);
  });
  const cards = fixedFirst
    .filter((c) => (compact ? c.kind !== "board" : true))
    .map((c) => {
      const kindBadge =
        c.kind === "fixed"
          ? `<span class="ws-badge ws-badge-fixed">纲领</span>`
          : c.kind === "resident"
            ? `<span class="ws-badge ws-badge-resident">常驻</span>`
            : `<span class="ws-badge ws-badge-board">黑板</span>`;
      const filled =
        c.filled === true
          ? `<span class="ws-tag-filled" title="已有内容">✓</span>`
          : `<span class="ws-tag-pending" title="待写入">○</span>`;
      const mountChips = (c.mounts || [])
        .slice(0, compact ? 4 : 12)
        .map(
          (m) =>
            `<span class="ws-mount-chip" title="${esc(howLabel(m.how))}"><span class="ws-mount-how">${esc(howLabel(m.how))}</span>${esc(m.workerName)}</span>`,
        )
        .join("");
      const more =
        (c.mounts?.length ?? 0) > (compact ? 4 : 12)
          ? `<span class="ws-muted">+${c.mounts.length - (compact ? 4 : 12)}</span>`
          : "";
      const isFocus =
        focusId &&
        (c.id === focusId ||
          (focusId.startsWith("fixed:aesthetics") && c.id.startsWith("fixed:aesthetics")) ||
          (focusId === "fixed:aesthetics" && c.id.startsWith("fixed:aesthetics:")));
      const dim = focusContext && focusId && !isFocus ? " ws-dimmed" : "";
      const focusCls = isFocus ? " ws-context-focus" : "";
      return `<article class="ws-context-card kind-${esc(c.kind)}${focusCls}${dim}" data-tag-id="${esc(c.id)}">
        <header class="ws-context-card-head">
          <span class="ws-context-card-title">${esc(c.label)}</span>
          ${kindBadge}
          ${filled}
          ${isFocus ? `<span class="ws-badge ws-badge-focus">本次</span>` : ""}
        </header>
        ${c.preview && !compact ? `<p class="ws-context-preview">${esc(c.preview)}</p>` : ""}
        <div class="ws-mount-row">
          <span class="ws-label">塞进</span>
          <span class="ws-mount-summary">${esc(c.mountSummary || "尚未指定 Worker")}</span>
        </div>
        ${mountChips || more ? `<div class="ws-mount-chips">${mountChips}${more}</div>` : ""}
      </article>`;
    })
    .join("");
  if (!cards) return "";
  const sectionCls = focusContext ? " ws-section-focus-context" : "";
  return `<section class="ws-section ws-context-tags${sectionCls}">
    <h4>${focusContext ? "固定上下文 · 本次要填" : "固定上下文"}</h4>
    <p class="ws-muted ws-context-hint">${
      focusContext
        ? "高亮卡片是本次验收对象；其它块仅供对照。"
        : "与 Worker 解耦：先看纲领挂到谁，再看下方分工。同一块可挂多个 Worker。"
    }</p>
    <div class="ws-context-cards">${cards}</div>
  </section>`;
}

function renderWorkerSetUserView(userView, opts = {}) {
  if (!userView) return "";
  if (userView.parseError) {
    return `<div class="review-parse-error" role="alert">
      <div class="review-parse-error-title">规格无法解析</div>
      <p>${esc(userView.parseError)}</p>
      <p class="review-parse-error-hint">Worker 集必须是 JSON 对象。若模型把说明/提问写进了规格字段，请在下方发送修改意见，让它重写后再接受。</p>
    </div>`;
  }

  const compact = opts.compact === true;
  const parts = [];
  const focusUnit = userView.focusUnit;
  const focusId = focusUnit?.id || "";
  const focusContext =
    focusUnit?.kind === "fixed" ||
    (typeof focusId === "string" &&
      (focusId.startsWith("fixed:") || focusId.startsWith("resident:")));
  const focusWorkerRef =
    focusUnit?.kind === "worker" && focusId.startsWith("worker:")
      ? focusId.slice("worker:".length)
      : "";

  // 当前单位横幅；验收卡可 omitFocusBody，避免与下方产物卡重复占位
  const focusBanner = renderFocusUnitBanner(focusUnit, {
    omitFocusBody: opts.omitFocusBody === true,
  });
  if (focusBanner) parts.push(focusBanner);

  if (userView.headline) {
    parts.push(
      `<section class="ws-section ws-headline"><h4>这次体验</h4><p>${esc(userView.headline)}</p></section>`,
    );
  }

  if (userView.interactionParadigm) {
    parts.push(
      `<section class="ws-section"><h4>交互范式</h4><p>${esc(userView.interactionParadigm)}</p></section>`,
    );
  }

  if (userView.coreWorker) {
    parts.push(
      `<section class="ws-section"><h4>核心执行单元</h4><p><code>${esc(userView.coreWorker)}</code> — 负责推剧情并产出本轮实质内容</p></section>`,
    );
  }

  if (userView.playSlots?.length) {
    const chips = userView.playSlots
      .map((s) => {
        const on = s.enabled ? "ws-slot-on" : "ws-slot-off";
        const state = s.enabled ? "开" : "关";
        return `<span class="ws-slot-chip ${on}" title="${esc(s.ref)}">${esc(s.label)} · ${state}</span>`;
      })
      .join("");
    parts.push(
      `<section class="ws-section"><h4>游玩槽位</h4><div class="ws-slot-row">${chips}</div></section>`,
    );
  }

  if (userView.contextOrder?.slots?.length) {
    const editable = opts.editable === true && Boolean(opts.sessionId);
    const orderParts = [];
    if (userView.contextOrder.brief) {
      orderParts.push(`<p>${esc(userView.contextOrder.brief)}</p>`);
    }
    if (userView.contextOrder.synthesized) {
      orderParts.push(
        `<p class="ws-muted ws-order-hint">尚未写入规格；调整顺序将保存为「上下文投影排序」并合并进 Worker 集（若已有）。</p>`,
      );
    } else if (editable) {
      orderParts.push(
        `<p class="ws-muted ws-order-hint">扁平投影序：↑↓ 调整位置；「对话.历史」是可投影标签（改 projection 裁剪长度）；也可移到历史前/后。</p>`,
      );
    }
    for (const slot of userView.contextOrder.slots) {
      const title = slot.label || slot.ref;
      const inserts = Array.isArray(slot.inserts) ? slot.inserts : null;
      if (editable && inserts?.length) {
        const rows = inserts
          .map((ins) => {
            const isHist = Boolean(ins.isHistory) || ins.ref === "对话.历史";
            const histBtns = isHist
              ? ""
              : `<button type="button" class="btn-mini" data-ctx-order="set_anchor" data-anchor="pre_history" title="移到历史前">史前</button>
                <button type="button" class="btn-mini" data-ctx-order="set_anchor" data-anchor="post_history" title="移到历史后">史后</button>`;
            return `<li class="ctx-order-row${isHist ? " ctx-order-history" : ""}" data-slot-ref="${esc(slot.ref)}" data-index="${esc(String(ins.index))}">
              <span class="ctx-order-line">${esc(ins.line || "")}</span>
              <span class="ctx-order-actions">
                <button type="button" class="btn-mini" data-ctx-order="move" data-delta="-1" title="上移">↑</button>
                <button type="button" class="btn-mini" data-ctx-order="move" data-delta="1" title="下移">↓</button>
                ${histBtns}
                <select class="ctx-order-proj" data-ctx-order="set_projection" title="投影级别">
                  ${["fixed", "summary", "fields", "full"]
                    .map(
                      (p) =>
                        `<option value="${p}" ${p === ins.projection ? "selected" : ""}>${p}</option>`,
                    )
                    .join("")}
                </select>
              </span>
            </li>`;
          })
          .join("");
        orderParts.push(
          `<h5 class="ws-subhead">${esc(title)}</h5><ul class="ctx-order-list">${rows}</ul>`,
        );
      } else {
        const lis = (slot.lines || [])
          .map((l) => `<li>${esc(l)}</li>`)
          .join("");
        if (lis) {
          orderParts.push(
            `<h5 class="ws-subhead">${esc(title)}</h5><ul class="artifact-list">${lis}</ul>`,
          );
        }
      }
    }
    if (orderParts.length) {
      parts.push(
        `<section class="ws-section ws-context-order"><h4>上下文投影排序${editable ? " · 可编排" : ""}</h4>${orderParts.join("")}</section>`,
      );
    }
  }

  if (!compact && userView.reasoning) {
    parts.push(
      `<section class="ws-section"><h4>分工推理</h4><p class="ws-reasoning">${esc(userView.reasoning)}</p></section>`,
    );
  }

  if (userView.playModeLabel) {
    parts.push(
      `<section class="ws-section"><h4>游玩方式</h4><p><strong>${esc(userView.playModeLabel)}</strong>${userView.playModeHint ? `<span class="ws-muted"> — ${esc(userView.playModeHint)}</span>` : ""}</p></section>`,
    );
  }

  // 固定上下文独立区（在 worker 之前；填充模式下高亮本次块）
  const contextSection = renderContextTagCards(userView.contextTags, {
    compact,
    focusId,
    focusContext,
  });
  if (contextSection) parts.push(contextSection);

  if (userView.inputProtocol?.length && !userView.contextTags?.some((c) => c.id === "fixed:input_protocol")) {
    const rows = userView.inputProtocol
      .map((p) => `<li><strong>${esc(p.label)}</strong>：${esc(p.value)}</li>`)
      .join("");
    parts.push(`<section class="ws-section"><h4>输入协议</h4><ul class="ws-list">${rows}</ul></section>`);
  }

  if (userView.workers?.length) {
    const cards = userView.workers
      .map((w) => {
        const isFocusWorker = focusWorkerRef && w.id === focusWorkerRef;
        const statusBadge =
          w.status === "gap"
            ? `<span class="ws-badge ws-badge-warn">待补 SKILL</span>`
            : `<span class="ws-badge ws-badge-ok">就绪</span>`;
        const idLine = w.id ? `<code class="ws-worker-id">${esc(w.id)}</code>` : "";
        const roleBadge = w.roleLabel
          ? `<span class="ws-badge ws-badge-role">${esc(w.roleLabel)}</span>`
          : "";
        const acceptBadge = w.acceptanceLabel
          ? `<span class="ws-badge ${w.acceptance === "review" ? "ws-badge-review" : "ws-badge-continue"}">${esc(w.acceptanceLabel)}</span>`
          : "";
        const explicitNote = w.context?.explicit
          ? ""
          : `<div class="ws-inferred">部分读入来自包内默认模板</div>`;
        const rationale = w.rationale
          ? `<div class="ws-row ws-rationale"><span class="ws-label">为何需要</span><span>${esc(w.rationale)}</span></div>`
          : "";
        const merge = w.mergeConsidered
          ? `<div class="ws-row ws-merge"><span class="ws-label">合并考量</span><span>${esc(w.mergeConsidered)}</span></div>`
          : "";
        const reads = w.readsSummary
          ? `<div class="ws-row ws-reads"><span class="ws-label">上下文</span><span>${esc(w.readsSummary)}</span></div>`
          : "";
        const dim =
          focusWorkerRef && !isFocusWorker
            ? " ws-dimmed"
            : focusContext
              ? " ws-dimmed"
              : "";
        const focusCls = isFocusWorker ? " ws-worker-focus" : "";

        return `<article class="ws-worker-card ${w.status}${focusCls}${dim}">
          <header class="ws-worker-head">
            <span class="ws-worker-order">${w.order}</span>
            <span class="ws-worker-name">${esc(w.displayName)}</span>
            ${isFocusWorker ? `<span class="ws-badge ws-badge-focus">本次</span>` : ""}
            ${roleBadge}
            ${acceptBadge}
            ${statusBadge}
          </header>
          ${idLine}
          <div class="ws-row"><span class="ws-label">用来干嘛</span><span>${esc(w.purpose)}</span></div>
          <div class="ws-row"><span class="ws-label">何时调用</span><span>${esc(w.invokeWhen)}</span></div>
          ${rationale}
          ${merge}
          ${reads}
          ${w.gapNote ? `<div class="ws-gap">${esc(w.gapNote)}</div>` : ""}
          <div class="ws-writes">
            <span class="ws-label">写入黑板</span>
            ${w.writes?.length ? w.writes.map((t) => `<code>${esc(t)}</code>`).join(" ") : "—"}
          </div>
          ${explicitNote}
        </article>`;
      })
      .join("");
    parts.push(
      `<section class="ws-section"><h4>游玩 Worker${compact ? "（摘要）" : ""}${focusWorkerRef ? " · 本次规格" : ""}</h4><div class="ws-worker-cards">${cards}</div></section>`,
    );
  }

  if (!compact && userView.tagFlow?.length) {
    const flow = userView.tagFlow
      .map(
        (edge) =>
          `<div class="ws-flow-edge"><span>${edge.from.map((t) => `<code>${esc(t)}</code>`).join(" + ")}</span><span class="ws-flow-arrow">→</span><span>${edge.to.map((t) => `<code>${esc(t)}</code>`).join(" + ")}</span></div>`,
      )
      .join("");
    parts.push(`<section class="ws-section"><h4>数据怎么流</h4><div class="ws-flow">${flow}</div></section>`);
  }

  if (userView.creationUnits?.length) {
    const units = userView.creationUnits
      .map((u) => {
        const kindLabel =
          u.kind === "worker"
            ? "Worker"
            : u.kind === "phase"
              ? "阶段"
              : u.flavor === "resident"
                ? "常驻块"
                : "固定上下文";
        const filled = u.accepted
          ? "已验收"
          : u.current
            ? "进行中"
            : u.filled
              ? "已写"
              : "待谈";
        const weight = u.weighty ? " · 纲领" : "";
        const cls = u.accepted
          ? "ws-task-filled"
          : u.current
            ? "ws-task-planned ws-unit-current"
            : "ws-task-planned";
        return `<li class="ws-task ${cls}"><span class="ws-unit-kind">${esc(kindLabel)}${esc(weight)}</span><span>${esc(u.label)}</span><span class="ws-task-status">${filled}</span>${u.detail ? `<span class="ws-muted"> — ${esc(u.detail)}</span>` : ""}</li>`;
      })
      .join("");
    parts.push(
      `<section class="ws-section"><h4>创作单位</h4><p class="ws-muted" style="margin:0 0 0.5rem">纲领与 Worker 同级；不必先写完 Worker 再填上下文。</p><ul class="ws-task-list">${units}</ul></section>`,
    );
  }

  if (userView.designTasks?.length) {
    const tasks = userView.designTasks
      .map((t) => {
        const cls =
          t.status === "filled"
            ? "ws-task-filled"
            : t.status === "skipped"
              ? "ws-task-skipped"
              : "ws-task-planned";
        const statusLabel =
          t.status === "filled" ? "已填" : t.status === "skipped" ? "跳过" : "待填";
        return `<li class="ws-task ${cls}"><span>${esc(t.label)}</span><code>${esc(t.id)}</code><span class="ws-task-status">${statusLabel}</span>${t.skipReason ? `<span class="ws-muted"> — ${esc(t.skipReason)}</span>` : ""}</li>`;
      })
      .join("");
    parts.push(
      `<section class="ws-section"><h4>设计阶段还需准备</h4><ul class="ws-task-list">${tasks}</ul></section>`,
    );
  }

  if (userView.openQuestions?.length) {
    parts.push(
      `<section class="ws-section ws-open"><h4>待澄清</h4><ul class="ws-list">${userView.openQuestions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></section>`,
    );
  }

  if (userView.notes && !compact) {
    parts.push(`<section class="ws-section"><h4>补充说明</h4><p>${esc(userView.notes)}</p></section>`);
  }

  return `<div class="ws-user-view">${parts.join("")}</div>`;
}

const ARTIFACT_TITLE_KEYS = [
  "名",
  "显示名",
  "块id",
  "段id",
  "rule_id",
  "pool_id",
  "映射id",
  "id",
  "key",
  "字段名",
  "label",
  "ref",
  "title",
];

const ARTIFACT_SKIP_KEYS = new Set(["schema", "schema_version"]);

/** 剥 markdown 代码围栏，便于从验收正文里取出 JSON */
function stripCodeFences(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json|yaml|yml)?\s*\n?/i, "");
  t = t.replace(/\n?```\s*$/i, "");
  return t.trim();
}

/** 验收正文常为 `## tag\\n\\n{json}` 多段拼接 */
function splitTaggedArtifactSections(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const re = /^##\s+(.+?)\s*$/gm;
  const hits = [];
  let m;
  while ((m = re.exec(trimmed))) {
    hits.push({ title: m[1].trim(), index: m.index, headerEnd: m.index + m[0].length });
  }
  if (!hits.length) return [{ title: "", content: trimmed }];
  return hits.map((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index : trimmed.length;
    return { title: h.title, content: trimmed.slice(h.headerEnd, end).trim() };
  });
}

/** 轻度修复模型常出的尾逗号，便于友好渲染而不是整墙原文 */
function softenJsonText(s) {
  return String(s || "")
    .replace(/^\uFEFF/, "")
    .replace(/,\s*([\]}])/g, "$1")
    .replace(/\u2026/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function tryParseJsonDoc(text) {
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const cleaned = softenJsonText(stripCodeFences(text));
  let parsed = tryParse(cleaned);
  if (parsed != null) return parsed;
  // 双重编码：整段是 JSON 字符串
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    const inner = tryParse(cleaned);
    if (typeof inner === "string") {
      parsed = tryParse(softenJsonText(inner));
      if (parsed != null) return parsed;
    }
  }
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    parsed = tryParse(cleaned.slice(objStart, objEnd + 1));
    if (parsed != null) return parsed;
    // 截断 JSON：从第一个 { 起尽量补全括号后再试
    parsed = tryParse(repairTruncatedJsonObject(cleaned.slice(objStart)));
    if (parsed != null) return parsed;
  }
  const arrStart = cleaned.indexOf("[");
  const arrEnd = cleaned.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    parsed = tryParse(cleaned.slice(arrStart, arrEnd + 1));
    if (parsed != null) return parsed;
  }
  return null;
}

/** 截断的 {… 补齐引号/括号，便于验收卡仍能出 mosaic */
function repairTruncatedJsonObject(slice) {
  let s = String(slice || "").trim();
  if (!s.startsWith("{")) return s;
  // 去掉末尾半截键值
  s = s.replace(/,\s*"[^"]*$/u, "");
  s = s.replace(/,\s*$/u, "");
  const opens = (s.match(/\{/g) || []).length;
  const closes = (s.match(/\}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length;
  const closeBrackets = (s.match(/\]/g) || []).length;
  // 未闭合字符串：奇数个未转义引号
  const quoteCount = (s.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 === 1) s += '"';
  if (openBrackets > closeBrackets) s += "]".repeat(openBrackets - closeBrackets);
  if (opens > closes) s += "}".repeat(opens - closes);
  return s;
}

const FRAGMENT_HEADER_KEYS = new Set([
  "schema",
  "技能",
  "skill",
  "name",
  "brief",
  "概要",
  "mount",
  "挂载",
  "稳变",
  "稳定",
  "stability",
  "自评",
  "追问",
  "开放问题",
  "open_questions",
  "正文",
  "body",
]);

/** 模型常把正文键摊在根上；验收展示时收进「正文」以便走 mosaic */
function normalizeContextFragmentDoc(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return doc;
  const row = { ...doc };
  const hasBody = row.正文 != null || row.body != null;
  const looksFrag =
    row.schema === "context-fragment.v1" ||
    (typeof row.技能 === "string" && row.技能.trim()) ||
    (typeof row.brief === "string" && typeof row.技能 === "string");
  if (!looksFrag) return doc;
  if (!hasBody) {
    const body = {};
    for (const [k, v] of Object.entries(row)) {
      if (FRAGMENT_HEADER_KEYS.has(k)) continue;
      if (v == null || v === "") continue;
      body[k] = v;
      delete row[k];
    }
    if (Object.keys(body).length) row.正文 = body;
  }
  if (!row.schema) row.schema = "context-fragment.v1";
  return row;
}

function wrapArtifactRawDetails(rawText, opts = {}) {
  const pretty = (() => {
    const parsed = tryParseJsonDoc(rawText);
    if (parsed != null) return JSON.stringify(parsed, null, 2);
    return String(rawText || "").trim();
  })();
  if (!pretty) return "";
  const body = pretty.startsWith("{") || pretty.startsWith("[")
    ? `<code>${highlightJson(pretty)}</code>`
    : esc(pretty);
  const quiet = opts.quiet === true;
  const label = quiet ? "原文" : "原始 JSON";
  return `<details class="artifact-raw${quiet ? " artifact-raw--quiet" : ""}"><summary>${label}</summary><pre class="json-pretty" tabindex="0">${body}</pre></details>`;
}

function isMetaPointerTag(title) {
  const t = String(title || "");
  return /当前步骤|当前单位|已验收单位|创作\.当前/.test(t);
}

function renderCrumbArtifact(title, leafText, rawSlice) {
  const leaf = clampPreviewText(leafText, 120);
  const raw = rawSlice
    ? wrapArtifactRawDetails(rawSlice, { quiet: true })
    : "";
  return `<div class="artifact-crumb">
    <nav class="artifact-crumb-path" aria-label="路径">
      <span class="artifact-crumb-root">${esc(title || "产物")}</span>
      ${
        leaf
          ? `<span class="artifact-crumb-sep" aria-hidden="true">/</span><span class="artifact-crumb-leaf">${esc(leaf)}</span>`
          : ""
      }
    </nav>
    ${raw}
  </div>`;
}

function clampPreviewText(text, max = 140) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 从产物对象抽出卡片预览：标题 / 摘要 / 徽章 / 分数 pill */
function summarizeArtifactDoc(doc, tagTitle = "") {
  if (Array.isArray(doc)) {
    return {
      title: tagTitle || "列表产物",
      brief: `${doc.length} 条记录`,
      chipsHtml: "",
      scoresHtml: "",
    };
  }
  const title =
    tagTitle ||
    (typeof doc.技能 === "string" && doc.技能.trim()) ||
    (typeof doc.brief === "string" && clampPreviewText(doc.brief, 40)) ||
    doc.schema ||
    "产物";
  let brief = "";
  if (typeof doc.brief === "string" && doc.brief.trim()) {
    brief = clampPreviewText(doc.brief, 160);
  } else if (typeof doc.正文 === "string") {
    brief = clampPreviewText(doc.正文, 160);
  } else if (doc.正文 && typeof doc.正文 === "object") {
    const body = doc.正文;
    const kernel = body.美学纲领?.体验内核 || body.体验内核;
    if (typeof kernel === "string") brief = clampPreviewText(kernel, 160);
    else {
      const keys = Object.keys(body).slice(0, 5);
      brief = keys.length ? `含：${keys.join("、")}` : "";
    }
  } else if (Array.isArray(doc.真值)) {
    brief = `真值 ${doc.真值.length} 项` + (doc.side_effects ? ` · 副作用 ${doc.side_effects.length}` : "");
  } else if (doc.play_slots) {
    brief = "游玩槽位配置";
  }

  const chips = [];
  const stability = doc.稳变 || doc.稳定 || doc.stability;
  if (stability) chips.push(`<span class="ws-badge ws-badge-continue">${esc(String(stability))}</span>`);
  if (Array.isArray(doc.mount)) {
    for (const m of doc.mount.slice(0, 3)) {
      chips.push(`<span class="ws-slot-chip ws-slot-on">${esc(String(m))}</span>`);
    }
    if (doc.mount.length > 3) {
      chips.push(`<span class="ws-muted">+${doc.mount.length - 3}</span>`);
    }
  }
  const 自评 = doc.自评;
  let scoresHtml = "";
  if (自评 && typeof 自评 === "object" && Array.isArray(自评.维度)) {
    const pills = 自评.维度
      .map((d) => {
        if (!d || typeof d !== "object") return "";
        const name = d.名 || d.维度 || "?";
        const ten = parseTenScore(d.分数);
        if (ten == null) return "";
        return `<span class="pct-pill tone-${tenTone(ten)}">${esc(String(name))} ${formatTenScore(ten)}/10</span>`;
      })
      .filter(Boolean);
    if (pills.length) scoresHtml = pills.join("");
  }
  return {
    title: String(title),
    brief,
    chipsHtml: chips.join(""),
    scoresHtml,
  };
}

function renderArtifactCompactCard(doc, tagTitle, rawSlice, opts = {}) {
  // 进度指针不是产物：验收区完全隐藏
  if (isMetaPointerTag(tagTitle)) return "";

  const normalized =
    doc && typeof doc === "object" && !Array.isArray(doc)
      ? normalizeContextFragmentDoc(doc)
      : doc;
  const meta = summarizeArtifactDoc(normalized, tagTitle);
  const full =
    renderKnownArtifactHtml(normalized, {
      embed: true,
      hideAskSidecar: opts.hideAskSidecar === true,
      hideScores: opts.hideScores === true || opts.flat === true,
    }) || renderStructuredDocHtml(normalized);
  const raw = rawSlice ? wrapArtifactRawDetails(rawSlice, { quiet: opts.flat === true }) : "";

  // 验收展开态：不要 details 套盒 + 摘要预览再占一层；一条 meta，正文直接上场
  if (opts.flat) {
    const metaBits = [meta.chipsHtml, meta.scoresHtml].filter(Boolean).join("");
    return `<article class="artifact-flat-review">
      <header class="artifact-flat-meta">
        <nav class="artifact-crumb-path artifact-flat-path" aria-label="产物">
          <span class="artifact-crumb-root">${esc(meta.title)}</span>
        </nav>
        ${metaBits ? `<div class="artifact-flat-chips">${metaBits}</div>` : ""}
        ${raw}
      </header>
      <div class="artifact-flat-body">${full}</div>
    </article>`;
  }

  const metaRow = [meta.chipsHtml, meta.scoresHtml].filter(Boolean).join("");
  const openAttr = opts.open ? " open" : "";
  return `<details class="artifact-compact"${openAttr}>
    <summary class="artifact-compact-sum">
      <div class="artifact-compact-row">
        <div class="artifact-compact-main">
          <span class="artifact-compact-title">${esc(meta.title)}</span>
          ${metaRow ? `<div class="artifact-compact-meta">${metaRow}</div>` : ""}
          ${meta.brief ? `<p class="artifact-compact-preview">${esc(meta.brief)}</p>` : ""}
        </div>
        <span class="artifact-compact-toggle" aria-hidden="true"></span>
      </div>
    </summary>
    <div class="artifact-compact-body">${full}${raw}</div>
  </details>`;
}

function renderPlainCompactCard(title, content, opts = {}) {
  if (isMetaPointerTag(title)) {
    return "";
  }
  const preview = clampPreviewText(content, 160);
  if (opts.flat) {
    return `<article class="artifact-flat-review">
      <header class="artifact-flat-meta">
        <nav class="artifact-crumb-path artifact-flat-path" aria-label="产物">
          <span class="artifact-crumb-root">${esc(title || "产物")}</span>
        </nav>
      </header>
      <div class="artifact-flat-body">
        <p class="ws-muted artifact-parse-hint">未能解析为可展示产物。</p>
        <pre class="review-feed-plain">${esc(content)}</pre>
      </div>
    </article>`;
  }
  const openAttr = opts.open ? " open" : "";
  const looksJson = /^\s*[{\[]/.test(String(content || ""));
  const body = looksJson
    ? `<p class="ws-muted artifact-parse-hint">未能解析为 JSON，以下为原文（可展开原始块排查）。</p><pre class="review-feed-plain">${esc(content)}</pre>`
    : `<pre class="review-feed-plain">${esc(content)}</pre>`;
  return `<details class="artifact-compact"${openAttr}>
    <summary class="artifact-compact-sum">
      <div class="artifact-compact-row">
        <div class="artifact-compact-main">
          <span class="artifact-compact-title">${esc(title || "产物")}</span>
          ${preview ? `<p class="artifact-compact-preview">${esc(preview)}</p>` : ""}
        </div>
        <span class="artifact-compact-toggle" aria-hidden="true"></span>
      </div>
    </summary>
    <div class="artifact-compact-body">${body}</div>
  </details>`;
}

/** 紧凑卡片：预览 + 展开详情；多 tag 各一张。opts.defaultOpen / flat：验收时扁平直出 */
function formatArtifactBodyHtml(body, opts = {}) {
  const trimmed = (body || "").trim();
  if (!trimmed) {
    return `<p class="empty-sm">（无正文）</p>`;
  }
  const cardOpts = {
    open: opts.defaultOpen === true,
    flat: opts.flat === true,
    hideAskSidecar: opts.hideAskSidecar === true,
    hideScores: opts.hideScores === true,
  };

  const sections = splitTaggedArtifactSections(trimmed);
  const hasTagHeaders = sections.length > 1 || (sections.length === 1 && sections[0].title);

  if (hasTagHeaders) {
    const cards = sections
      .filter((sec) => !isMetaPointerTag(sec.title))
      .map((sec) => {
      const parsed = tryParseJsonDoc(sec.content);
      if (parsed != null && typeof parsed === "object") {
        return renderArtifactCompactCard(parsed, sec.title, sec.content, cardOpts);
      }
      const presentTag =
        /用户展示|开场白/.test(sec.title || "") || opts.asPresentFallback;
      if (presentTag) {
        return `<div class="artifact-compact-list">${renderPresentShellHtml(
          presentFromPlain(sec.content, "prose"),
          esc,
        )}</div>`;
      }
      return renderPlainCompactCard(sec.title || "产物", sec.content, cardOpts);
    })
      .filter(Boolean);
    return `<div class="artifact-compact-list">${cards.join("")}</div>`;
  }

  const parsed = tryParseJsonDoc(trimmed);
  if (parsed != null && typeof parsed === "object") {
    return `<div class="artifact-compact-list">${renderArtifactCompactCard(parsed, "", trimmed, cardOpts)}</div>`;
  }

  if (opts.asPresentFallback) {
    return renderPresentShellHtml(presentFromPlain(trimmed, "prose"), esc);
  }

  return `<div class="artifact-compact-list">${renderPlainCompactCard("产物", trimmed, cardOpts)}</div>`;
}

/** 已知产物 → 分节卡片；未知对象走通用结构化渲染 */
function renderKnownArtifactHtml(doc, opts = {}) {
  if (Array.isArray(doc)) {
    return `<div class="artifact-friendly">${renderStructuredValueHtml(doc, 0)}</div>`;
  }
  const schema = doc.schema;
  const presentView = parsePresentDoc(doc);
  if (presentView) {
    return renderPresentShellHtml(presentView.packet, esc, {
      tweaks: opts.shellTweaks,
    });
  }
  if (schema === "settlement.v1" || isSettlementLike(doc)) {
    return renderSettlementSectionsHtml(doc);
  }
  if (schema === "context-fragment.v1" || isContextFragmentLike(doc)) {
    return renderContextFragmentHtml(doc, opts);
  }
  if (schema === "context-order.v1" || Array.isArray(doc.slots)) {
    const orderHtml = renderContextOrderHtml(doc);
    if (orderHtml) return orderHtml;
  }
  if (Array.isArray(doc.真值) || Array.isArray(doc.side_effects) || doc.维护语句约定) {
    return renderVariableDesignHtml(doc);
  }
  if (doc.play_slots && typeof doc.play_slots === "object") {
    return renderPlaySlotsHtml(doc);
  }
  return null;
}

function renderPlaySlotsHtml(doc) {
  const slotLabels = {
    auditor: "旁观维护",
    gm: "主世界层",
    "world-simulator": "主世界层",
    narrator: "叙事转述",
    perspective: "角色视角",
    chance: "机遇裁定",
  };
  const slots = doc.play_slots;
  const keys = Object.keys(slots);
  const chips = keys
    .map((k) => {
      const on = Boolean(slots[k]);
      const label = slotLabels[k] || k;
      return `<span class="ws-slot-chip ${on ? "ws-slot-on" : "ws-slot-off"}">${esc(label)}</span>`;
    })
    .join("");
  const parts = [];
  if (doc.brief) {
    parts.push(`<section class="ws-section"><h4>概要</h4><p>${esc(String(doc.brief))}</p></section>`);
  }
  parts.push(
    `<section class="ws-section"><h4>游玩槽位</h4><div class="ws-slot-row">${chips}</div></section>`,
  );
  const rest = { ...doc };
  delete rest.play_slots;
  delete rest.brief;
  delete rest.schema;
  const extra = Object.keys(rest).filter((k) => rest[k] != null && rest[k] !== "");
  if (extra.length) {
    parts.push(
      `<section class="ws-section"><h4>其它</h4>${renderStructuredValueHtml(rest, 0)}</section>`,
    );
  }
  return `<div class="artifact-friendly artifact-play-slots">${parts.join("")}</div>`;
}

function isContextFragmentLike(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  if (doc.schema === "context-fragment.v1") return true;
  return (
    typeof doc.brief === "string" &&
    (doc.正文 != null ||
      doc.body != null ||
      typeof doc.技能 === "string") &&
    (typeof doc.技能 === "string" || doc.schema === "context-fragment.v1")
  );
}

function renderContextFragmentHtml(doc, opts = {}) {
  const frag = normalizeContextFragmentDoc(doc);
  const parts = [];
  // 紧凑卡外层已展示 brief/挂载，展开内不再重复头区
  if (!opts.embed) {
    const metaChips = [];
    if (frag.技能) metaChips.push(`<span class="ws-badge ws-badge-review">${esc(String(frag.技能))}</span>`);
    const stability = frag.稳变 || frag.稳定 || frag.stability;
    if (stability) metaChips.push(`<span class="ws-badge ws-badge-continue">${esc(String(stability))}</span>`);
    if (Array.isArray(frag.mount) && frag.mount.length) {
      for (const m of frag.mount) {
        metaChips.push(`<span class="ws-slot-chip ws-slot-on">${esc(String(m))}</span>`);
      }
    } else if (typeof frag.mount === "string" && frag.mount.trim()) {
      metaChips.push(`<span class="ws-slot-chip ws-slot-on">${esc(frag.mount.trim())}</span>`);
    }
    if (frag.brief || metaChips.length) {
      parts.push(`<header class="artifact-hero">
      ${metaChips.length ? `<div class="artifact-chip-row">${metaChips.join("")}</div>` : ""}
      ${frag.brief ? `<p class="artifact-brief">${esc(String(frag.brief))}</p>` : ""}
    </header>`);
    }
  }

  const body = frag.正文 != null ? frag.正文 : frag.body;
  if (typeof body === "string" && body.trim()) {
    parts.push(
      `<section class="artifact-block"><h4>正文</h4>${renderProseHtml(body)}</section>`,
    );
  } else if (body && typeof body === "object") {
    const specialty = renderSpecialtyBodyHtml(body, frag.技能);
    if (specialty) {
      parts.push(specialty);
    } else {
      parts.push(
        `<section class="artifact-block artifact-body-root"><h4>正文</h4>${renderStructuredValueHtml(body, 0)}</section>`,
      );
    }
  }

  // 自评/追问已挂询问卡时：产物内保留评分条，追问不重复展示
  const hideAsk = opts.hideAskSidecar === true;
  const scoreHtml = opts.hideScores ? "" : renderSelfScoreHtml(frag.自评);
  if (scoreHtml) parts.push(scoreHtml);

  if (!hideAsk) {
    const probeHtml = renderProbeHtml(frag.追问);
    if (probeHtml) parts.push(probeHtml);

    const openQs = Array.isArray(frag.开放问题) ? frag.开放问题 : [];
    if (openQs.length) {
      parts.push(
        `<section class="artifact-block"><h4>开放问题</h4><ul class="artifact-list">${openQs
          .map((l) => `<li>${esc(String(l))}</li>`)
          .join("")}</ul></section>`,
      );
    }
  }
  if (!parts.length) return null;
  return `<div class="artifact-friendly artifact-context-fragment">${parts.join("")}</div>`;
}

/** 按技能分流正文视图；无专用模板则返回 ""（调用方走通用结构化） */
function renderSpecialtyBodyHtml(body, skill) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const skillName = typeof skill === "string" ? skill : "";

  if (
    body.rules != null ||
    body.必要性判断 != null ||
    skillName.includes("生成规则")
  ) {
    const html = renderGenerationRulesBodyHtml(body);
    if (html) return html;
  }
  if (
    body.社会结构 != null ||
    body.世界状况 != null ||
    skillName.includes("舞台骨架")
  ) {
    const html = renderWorldBlueprintBodyHtml(body);
    if (html) return html;
  }
  if (
    body.支撑点 != null ||
    (Array.isArray(body.依据的核心体验) && body.覆盖检验 != null) ||
    skillName.includes("实现机制")
  ) {
    const html = renderMechanismBodyHtml(body);
    if (html) return html;
  }
  if (
    body.风格与写法 != null ||
    body.推进与决策 != null ||
    skillName.includes("叙事指南")
  ) {
    const html = renderNarrativeBodyHtml(body);
    if (html) return html;
  }

  const looksAesthetics =
    body.设定逻辑 != null ||
    body.交互范式 != null ||
    body.美学纲领 != null ||
    skillName.includes("美学");
  if (!looksAesthetics) return "";

  // 左右约定（验收卡通用意向）：
  //   左 = 最终会插入的游玩契约（美学纲领 + 交互范式）
  //   右 = 评估/诊断（设定逻辑里的完备度、待探、区域化等）
  // 注意：当前黑板仍存整份正文；full 投影时右栏也会进模型——布局先对齐「该审什么」。
  const productKeys = [
    {
      key: "美学纲领",
      hint: "体验内核与呈现要点",
      missing: "（未写美学纲领）",
    },
    {
      key: "交互范式",
      hint: "人称、描写权限、后果与等待",
      missing: "（未写交互范式）",
    },
  ];
  const evalKeys = [
    {
      key: "设定逻辑",
      hint: "变造定位 + 参与/内容维度诊断（完备度、依据、待探）",
      missing: "（未写设定逻辑）",
    },
  ];
  const used = new Set([...productKeys, ...evalKeys].map((b) => b.key));

  const renderBlock = (b, cls) => {
    const inner =
      body[b.key] != null
        ? renderAestheticsNodeHtml(body[b.key], b.key, 0)
        : `<p class="ws-muted">${esc(b.missing)}</p>`;
    const ok = body[b.key] != null;
    return `<section class="af-block ${cls}" data-af-block="${esc(b.key)}">
      <header class="af-block-head">
        <h3 class="af-block-title">${esc(b.key)}${ok ? "" : `<span class="af-block-miss">缺</span>`}</h3>
        <p class="af-block-hint">${esc(b.hint)}</p>
      </header>
      <div class="af-block-body">${inner}</div>
    </section>`;
  };

  const productHtml = productKeys.map((b) => renderBlock(b, "af-block--product")).join("");
  const evalHtml = evalKeys.map((b) => renderBlock(b, "af-block--eval")).join("");
  const extra = Object.entries(body)
    .filter(([k, v]) => !used.has(k) && v != null && v !== "")
    .map(
      ([k, v]) =>
        `<section class="af-block af-block--extra" data-af-block="${esc(k)}">
      <header class="af-block-head"><h3 class="af-block-title">${esc(k)}</h3></header>
      <div class="af-block-body">${renderStructuredValueHtml(v, 0)}</div>
    </section>`,
    )
    .join("");

  return `<div class="af-split">
    <div class="af-split-banner" role="note">
      <span><b>左</b>游玩契约（插入意向）</span>
      <span><b>右</b>设定诊断 / 评估</span>
      <span class="af-split-banner-note">存盘仍是整份正文；默认 full 时两侧都会注入</span>
    </div>
    <div class="af-split-grid">
      <div class="af-split-product" aria-label="游玩契约">
        ${productHtml || `<p class="ws-muted">（契约块为空）</p>`}
      </div>
      <aside class="af-split-eval" aria-label="评估诊断">
        ${evalHtml}
        ${extra}
      </aside>
    </div>
  </div>`;
}

/** 叙事指南 · 一份全文结构化卡（不强调双投影裁剪） */
function renderNarrativeBodyHtml(body) {
  const order = [
    "依据的体验",
    "叙事纲领",
    "风格与遣词",
    "笔墨焦点",
    "禁忌与不偏好",
    "情境备用",
    "推进与决策",
    "内容与表达",
    "风格与写法",
  ];
  const used = new Set();
  const parts = [];
  // 若仍是旧的「风格与写法 / 推进与决策」两大包，整块展示
  if (body.风格与写法 != null || body.推进与决策 != null) {
    if (Array.isArray(body.依据的体验) && body.依据的体验.length) {
      parts.push(
        `<section class="af-panel"><h4>依据的体验</h4>${skillProseList(body.依据的体验)}</section>`,
      );
      used.add("依据的体验");
    }
    if (body.风格与写法 != null) {
      parts.push(
        `<section class="af-panel af-panel-wide"><h4>风格与写法</h4>${renderStructuredValueHtml(body.风格与写法, 0)}</section>`,
      );
      used.add("风格与写法");
    }
    if (body.推进与决策 != null) {
      parts.push(
        `<section class="af-panel af-panel-wide"><h4>推进与决策</h4>${renderStructuredValueHtml(body.推进与决策, 0)}</section>`,
      );
      used.add("推进与决策");
    }
  } else {
    for (const key of order) {
      if (body[key] == null) continue;
      used.add(key);
      const wide = key === "风格与遣词" || key === "推进与决策";
      parts.push(
        `<section class="af-panel${wide ? " af-panel-wide" : ""}"><h4>${esc(key)}</h4>${renderStructuredValueHtml(body[key], 0)}</section>`,
      );
    }
  }
  for (const [k, v] of Object.entries(body)) {
    if (used.has(k) || v == null || v === "") continue;
    parts.push(
      `<section class="af-panel"><h4>${esc(k)}</h4>${renderStructuredValueHtml(v, 0)}</section>`,
    );
  }
  return parts.length ? `<div class="af-mosaic af-narrative">${parts.join("")}</div>` : "";
}

function skillSection(title, inner, cls = "") {
  if (!inner) return "";
  return `<section class="skill-card-section${cls ? ` ${cls}` : ""}"><h4>${esc(title)}</h4>${inner}</section>`;
}

function skillChipRow(items) {
  const chips = (items || []).filter(Boolean).map((t) => `<span class="ws-badge ws-badge-continue">${esc(String(t))}</span>`);
  return chips.length ? `<div class="artifact-chip-row">${chips.join("")}</div>` : "";
}

function skillProseList(arr) {
  if (!Array.isArray(arr) || !arr.length) return "";
  return `<ul class="artifact-list">${arr.map((x) => `<li>${esc(String(x))}</li>`).join("")}</ul>`;
}

function skillKvBlock(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  const entries = (keys && keys.length ? keys.map((k) => [k, obj[k]]) : Object.entries(obj)).filter(
    ([, v]) => v != null && v !== "",
  );
  if (!entries.length) return "";
  return `<div class="skill-kv">${entries
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `<div class="skill-kv-row"><span class="skill-kv-key">${esc(String(k))}</span><div class="skill-kv-val">${skillProseList(v)}</div></div>`;
      }
      if (v && typeof v === "object") {
        return `<div class="skill-kv-row"><span class="skill-kv-key">${esc(String(k))}</span><div class="skill-kv-val">${renderStructuredValueHtml(v, 1)}</div></div>`;
      }
      return `<div class="skill-kv-row"><span class="skill-kv-key">${esc(String(k))}</span><div class="skill-kv-val">${renderProseHtml(String(v))}</div></div>`;
    })
    .join("")}</div>`;
}

/** 生成规则 · 专用正文卡 */
function renderGenerationRulesBodyHtml(body) {
  const parts = [];
  if (body.本步参数 && typeof body.本步参数 === "object") {
    const p = body.本步参数;
    parts.push(
      skillSection(
        "本步参数",
        skillChipRow([
          p.target && `对象：${p.target}`,
          p.rule_id && `rule_id：${p.rule_id}`,
          p.lifecycle_intent && `生命周期：${p.lifecycle_intent}`,
        ]) || skillKvBlock(p),
      ),
    );
  }
  if (body.必要性判断 && typeof body.必要性判断 === "object") {
    const n = body.必要性判断;
    const verdict = n.结论 != null ? String(n.结论) : "";
    const tone = /无需|跳过/.test(verdict) ? "warn" : "ok";
    parts.push(
      skillSection(
        "必要性判断",
        `${verdict ? `<p class="skill-verdict tone-${tone}">${esc(verdict)}</p>` : ""}${skillKvBlock(n, [
          "生成对象",
          "对游玩的重要性",
          "基础生成的不足",
        ])}`,
      ),
    );
  }

  const rules = Array.isArray(body.rules) ? body.rules : [];
  if (rules.length) {
    const cards = rules.map((rule, i) => renderOneGenerationRuleCard(rule, i)).filter(Boolean);
    parts.push(skillSection("规则", `<div class="skill-rule-stack">${cards.join("")}</div>`));
  } else if (body.必要性判断) {
    parts.push(skillSection("规则", `<p class="ws-muted">本步未建立专门规则（rules 为空）</p>`));
  }

  if (body.增量说明 != null && String(body.增量说明).trim()) {
    parts.push(skillSection("增量说明", renderProseHtml(String(body.增量说明))));
  }

  const used = new Set(["本步参数", "必要性判断", "rules", "增量说明"]);
  for (const [k, v] of Object.entries(body)) {
    if (used.has(k) || v == null || v === "") continue;
    parts.push(skillSection(k, renderStructuredValueHtml(v, 0)));
  }
  return parts.length ? `<div class="skill-view skill-view-generation-rules">${parts.join("")}</div>` : "";
}

function renderOneGenerationRuleCard(rule, index) {
  if (!rule || typeof rule !== "object") return "";
  const title = rule.对象 || rule.rule_id || `规则 ${index + 1}`;
  const head = `<header class="skill-rule-head">
    <div class="skill-rule-title">${esc(String(title))}</div>
    ${skillChipRow([
      rule.rule_id && `id · ${rule.rule_id}`,
      rule.生命周期 && String(rule.生命周期),
    ])}
  </header>`;

  const blocks = [];
  if (rule.上下文策略 && typeof rule.上下文策略 === "object") {
    const flags = Object.entries(rule.上下文策略)
      .map(([k, v]) => `<span class="ws-slot-chip ${v ? "ws-slot-on" : "ws-slot-off"}">${esc(k)}</span>`)
      .join("");
    blocks.push(`<div class="skill-sub"><div class="skill-sub-title">上下文策略</div><div class="ws-slot-row">${flags}</div></div>`);
  }
  if (rule.数量 != null) {
    blocks.push(`<div class="skill-sub"><div class="skill-sub-title">数量</div>${skillKvBlock(typeof rule.数量 === "object" ? rule.数量 : { 值: rule.数量 })}</div>`);
  }
  if (rule.生成与描写 && typeof rule.生成与描写 === "object") {
    const g = rule.生成与描写;
    const methodKeys = ["依据", "方法", "硬约束", "字段间约束", "变化维度", "禁止项", "去重规则", "校验"];
    blocks.push(
      `<div class="skill-sub"><div class="skill-sub-title">生成与描写</div>${methodKeys
        .filter((k) => Array.isArray(g[k]) && g[k].length)
        .map(
          (k) =>
            `<div class="skill-method"><span class="skill-method-label">${esc(k)}</span>${skillProseList(g[k])}</div>`,
        )
        .join("")}</div>`,
    );
  }
  if (rule.产物格式 && typeof rule.产物格式 === "object") {
    blocks.push(renderProductSchemaCard(rule.产物格式));
  }
  const pools = Array.isArray(rule.池) ? rule.池 : [];
  if (pools.length) {
    blocks.push(
      `<div class="skill-sub"><div class="skill-sub-title">池（${pools.length}）</div><div class="skill-pool-grid">${pools
        .map((p) => {
          if (!p || typeof p !== "object") return "";
          const n = Array.isArray(p.条目) ? p.条目.length : 0;
          return `<article class="skill-pool-card">
            <div class="skill-pool-name">${esc(String(p.名称 || p.pool_id || "池"))}</div>
            ${skillChipRow([
              p.绑定字段 && `绑 · ${p.绑定字段}`,
              p.用途 && String(p.用途),
              n ? `${n} 条` : "",
            ])}
            ${p.说明 ? `<p class="skill-pool-desc">${esc(clampPreviewText(String(p.说明), 120))}</p>` : ""}
          </article>`;
        })
        .join("")}</div></div>`,
    );
  }

  return `<article class="skill-rule-card">${head}${blocks.join("")}</article>`;
}

function renderProductSchemaCard(fmt) {
  const schema = fmt.schema && typeof fmt.schema === "object" ? fmt.schema : null;
  const fields = schema
    ? Object.entries(schema)
        .map(([name, spec]) => {
          if (!spec || typeof spec !== "object") {
            return `<tr><td>${esc(name)}</td><td colspan="3">${esc(String(spec))}</td></tr>`;
          }
          const type = spec.type != null ? String(spec.type) : "—";
          const req = spec.required === true ? "必填" : spec.required === false ? "可选" : "—";
          const desc = spec.description != null ? clampPreviewText(String(spec.description), 80) : "";
          const extra = [];
          if (Array.isArray(spec.allowed_values) && spec.allowed_values.length) {
            extra.push(
              `枚举 ${spec.allowed_values
                .slice(0, 6)
                .map((x) => (x && typeof x === "object" ? x.value : x))
                .map(String)
                .join("/")}${spec.allowed_values.length > 6 ? "…" : ""}`,
            );
          }
          if (spec.minimum != null || spec.maximum != null) {
            extra.push(`[${spec.minimum ?? "…"}, ${spec.maximum ?? "…"}]`);
          }
          return `<tr>
            <td><code>${esc(name)}</code></td>
            <td>${esc(type)}</td>
            <td>${esc(req)}</td>
            <td>${esc(desc)}${extra.length ? `<div class="ws-muted">${esc(extra.join(" · "))}</div>` : ""}</td>
          </tr>`;
        })
        .join("")
    : "";

  return `<div class="skill-sub">
    <div class="skill-sub-title">产物格式</div>
    ${skillChipRow([fmt.格式 && String(fmt.格式), fmt.批量时 && `批量 · ${fmt.批量时}`])}
    ${
      fields
        ? `<div class="skill-table-wrap"><table class="skill-field-table"><thead><tr><th>字段</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>${fields}</tbody></table></div>`
        : ""
    }
    ${
      fmt.示例形状 && typeof fmt.示例形状 === "object"
        ? `<details class="skill-example"><summary>示例形状</summary><pre class="json-pretty"><code>${highlightJson(JSON.stringify(fmt.示例形状, null, 2))}</code></pre></details>`
        : ""
    }
  </div>`;
}

/** 舞台骨架 · 专用正文卡 */
function renderWorldBlueprintBodyHtml(body) {
  const parts = [];
  if (Array.isArray(body.依据的体验) && body.依据的体验.length) {
    parts.push(skillSection("依据的体验", skillProseList(body.依据的体验)));
  }
  if (body.舞台尺度) {
    parts.push(skillSection("舞台尺度", skillKvBlock(body.舞台尺度)));
  }
  if (body.基底与变造) {
    parts.push(skillSection("基底与变造", skillKvBlock(body.基底与变造)));
  }

  const social = Array.isArray(body.社会结构) ? body.社会结构 : [];
  if (social.length) {
    parts.push(
      skillSection(
        "社会结构",
        `<div class="skill-entity-grid">${social
          .map((s) => {
            if (!s || typeof s !== "object") return "";
            return `<article class="skill-entity-card">
              <div class="skill-entity-name">${esc(String(s.名称 || "?"))}</div>
              ${skillChipRow([s.性质, s.细化程度])}
              ${s.在舞台上的位置 ? `<p>${esc(clampPreviewText(String(s.在舞台上的位置), 140))}</p>` : ""}
              ${s.服务体验 ? `<p class="ws-muted">服务：${esc(clampPreviewText(String(s.服务体验), 100))}</p>` : ""}
            </article>`;
          })
          .join("")}</div>`,
      ),
    );
  }

  const status = Array.isArray(body.世界状况) ? body.世界状况 : [];
  if (status.length) {
    parts.push(
      skillSection(
        "世界状况",
        `<div class="skill-entity-grid">${status
          .map((s) => {
            if (!s || typeof s !== "object") return "";
            return `<article class="skill-entity-card">
              <div class="skill-entity-name">${esc(String(s.名称 || "?"))}</div>
              ${skillChipRow([s.性质, s.作用范围, s.节奏或触发])}
              ${s.是什么 ? `<p>${esc(clampPreviewText(String(s.是什么), 140))}</p>` : ""}
              ${s.如何影响运转 ? `<p class="ws-muted">${esc(clampPreviewText(String(s.如何影响运转), 120))}</p>` : ""}
            </article>`;
          })
          .join("")}</div>`,
      ),
    );
  }

  const zones = Array.isArray(body.关键舞台区) ? body.关键舞台区 : [];
  if (zones.length) {
    parts.push(
      skillSection(
        "关键舞台区",
        `<div class="skill-entity-grid">${zones
          .map((z) => {
            if (!z || typeof z !== "object") return "";
            return `<article class="skill-entity-card">
              <div class="skill-entity-name">${esc(String(z.名称 || "?"))}</div>
              ${z.是什么 ? `<p>${esc(clampPreviewText(String(z.是什么), 120))}</p>` : ""}
              ${z.为何需要 ? `<p class="ws-muted">${esc(clampPreviewText(String(z.为何需要), 100))}</p>` : ""}
              ${Array.isArray(z.格局要点) && z.格局要点.length ? skillProseList(z.格局要点) : ""}
            </article>`;
          })
          .join("")}</div>`,
      ),
    );
  }

  if (Array.isArray(body.未展开范围) && body.未展开范围.length) {
    parts.push(skillSection("未展开范围", skillProseList(body.未展开范围)));
  }
  if (body.覆盖检验 && typeof body.覆盖检验 === "object") {
    parts.push(skillSection("覆盖检验", skillKvBlock(body.覆盖检验)));
  }

  const used = new Set([
    "依据的体验",
    "舞台尺度",
    "基底与变造",
    "社会结构",
    "世界状况",
    "关键舞台区",
    "未展开范围",
    "覆盖检验",
  ]);
  for (const [k, v] of Object.entries(body)) {
    if (used.has(k) || v == null || v === "") continue;
    parts.push(skillSection(k, renderStructuredValueHtml(v, 0)));
  }
  return parts.length ? `<div class="skill-view skill-view-world-blueprint">${parts.join("")}</div>` : "";
}

/** 实现机制 · 专用正文卡 */
function renderMechanismBodyHtml(body) {
  const parts = [];
  if (Array.isArray(body.依据的核心体验) && body.依据的核心体验.length) {
    parts.push(skillSection("依据的核心体验", skillProseList(body.依据的核心体验)));
  }
  const points = Array.isArray(body.支撑点) ? body.支撑点 : [];
  if (points.length) {
    parts.push(
      skillSection(
        "支撑点",
        `<div class="skill-entity-grid">${points
          .map((p) => {
            if (!p || typeof p !== "object") return "";
            const pct = parseCompleteness(p.完备度);
            const mini = pct != null ? renderMiniPctHtml(pct) : "";
            const morph = p.切面形态 && typeof p.切面形态 === "object" ? p.切面形态 : null;
            return `<article class="skill-entity-card">
              <header class="skill-entity-head"><div class="skill-entity-name">${esc(String(p.名称 || "?"))}</div>${mini}</header>
              ${skillChipRow([p.归属元素, p.支撑切面])}
              ${morph?.概述 ? `<p>${esc(clampPreviewText(String(morph.概述), 140))}</p>` : ""}
              ${p.如何支撑 ? `<p class="ws-muted">${esc(clampPreviewText(String(p.如何支撑), 120))}</p>` : ""}
              ${p.缺失后果 ? `<p class="artifact-fact pending">缺失：${esc(clampPreviewText(String(p.缺失后果), 100))}</p>` : ""}
            </article>`;
          })
          .join("")}</div>`,
      ),
    );
  }
  const rels = Array.isArray(body.支撑点关系) ? body.支撑点关系 : [];
  if (rels.length) {
    parts.push(
      skillSection(
        "支撑点关系",
        `<ul class="artifact-list">${rels
          .map((r) => {
            if (!r || typeof r !== "object") return "";
            const who = Array.isArray(r.涉及) ? r.涉及.join(" · ") : "";
            return `<li><strong>${esc(String(r.关系 || "关系"))}</strong>${who ? ` · ${esc(who)}` : ""}${
              r.体验作用 ? `<div class="ws-muted">${esc(String(r.体验作用))}</div>` : ""
            }</li>`;
          })
          .join("")}</ul>`,
      ),
    );
  }
  if (body.覆盖检验 && typeof body.覆盖检验 === "object") {
    parts.push(skillSection("覆盖检验", skillKvBlock(body.覆盖检验)));
  }
  const used = new Set(["依据的核心体验", "支撑点", "支撑点关系", "覆盖检验"]);
  for (const [k, v] of Object.entries(body)) {
    if (used.has(k) || v == null || v === "") continue;
    parts.push(skillSection(k, renderStructuredValueHtml(v, 0)));
  }
  return parts.length ? `<div class="skill-view skill-view-mechanism">${parts.join("")}</div>` : "";
}

/**
 * 完备度等：0–100 百分制（正文诊断块仍用 %）。
 * 自评维度请用 parseTenScore。
 */
function parseCompleteness(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v < 0 || v > 100) return null;
    return v;
  }
  const s = String(v).trim();
  if (!s) return null;
  const withPct = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (withPct) return Math.max(0, Math.min(100, Number(withPct[1])));
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) {
    const n = Number(bare[1]);
    if (n >= 0 && n <= 100) return n;
  }
  return null;
}

/** 自评分数：0–10；兼容旧百分数（>10…100 → /10） */
function parseTenScore(v) {
  if (v == null) return null;
  const fromNumber = (n) => {
    if (!Number.isFinite(n) || n < 0) return null;
    if (n <= 10) return Math.round(n * 10) / 10;
    if (n <= 100) return Math.round((n / 10) * 10) / 10;
    return null;
  };
  if (typeof v === "number") return fromNumber(v);
  const s = String(v).trim();
  if (!s) return null;
  const slash = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*10$/i);
  if (slash) return fromNumber(Number(slash[1]));
  const withPct = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (withPct) return fromNumber(Number(withPct[1]));
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return fromNumber(Number(bare[1]));
  return null;
}

function formatTenScore(ten) {
  if (ten == null || !Number.isFinite(ten)) return "?";
  return Number.isInteger(ten) ? String(ten) : String(Math.round(ten * 10) / 10);
}

function tenTone(ten) {
  if (ten < 4) return "low";
  if (ten < 7) return "mid";
  return "high";
}

function pctTone(pct) {
  if (pct < 40) return "low";
  if (pct < 70) return "mid";
  return "high";
}

/** 行内完备度：染色百分比，不单开卡片 */
function renderInlinePctHtml(pct, label) {
  if (pct == null || !Number.isFinite(pct)) return "";
  const n = Math.max(0, Math.min(100, Math.round(pct)));
  const tone = pctTone(n);
  const lab = label
    ? `<span class="pct-inline-label">${esc(label)}</span>`
    : "";
  return `<span class="pct-inline tone-${tone}" title="${esc(label || "完备度")} ${n}%">${lab}<b class="pct-inline-value">${n}%</b></span>`;
}

/** @deprecated 卡片条已弃用；统一走行内百分比 */
function renderPctMeterHtml(pct, label = "完备度") {
  return renderInlinePctHtml(pct, label);
}

/** 自评十分制：同行染色数字 */
function renderTenMeterHtml(ten, label = "评分") {
  if (ten == null || !Number.isFinite(ten)) return "";
  const score = Math.max(0, Math.min(10, ten));
  const tone = tenTone(score);
  const shown = formatTenScore(score);
  const lab = label
    ? `<span class="pct-inline-label">${esc(label)}</span>`
    : "";
  return `<span class="pct-inline tone-${tone}" title="${esc(label)} ${shown}/10">${lab}<b class="pct-inline-value">${shown}/10</b></span>`;
}

/** 标题旁迷你百分比 */
function renderMiniPctHtml(pct) {
  return renderInlinePctHtml(pct);
}

function extractNodePct(value) {
  if (!value || typeof value !== "object") return null;
  return parseCompleteness(value.完备度 ?? value.分数);
}

/** 短诊断块（结论/完备度/已知待探）适合瓷砖；散文对象必须通栏 */
function isDiagnosticNode(value) {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value.结论 != null ||
      value.完备度 != null ||
      value.已知 != null ||
      value.待探 != null)
  );
}

/** 评价维度块：小标题 + 旁路完备度；结论/依据为从属行 */
function renderDiagnosticDimHtml(title, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `<span class="ws-muted">—</span>`;
  }
  const pct = extractNodePct(value);
  const head = `<header class="af-dim-head">
    <h5 class="af-dim-title">${esc(title || "项")}</h5>
    ${pct != null ? renderInlinePctHtml(pct) : ""}
  </header>`;
  const skipKey = (k) =>
    isPctFieldKey(k) || /^(完备度|完成度|分数|覆盖度)$/.test(String(k).trim());
  const preferred = ["结论", "依据", "已知", "待探", "焦点位置", "满足来源", "内容维度", "核心感觉"];
  const keys = Object.keys(value).filter(
    (k) => !skipKey(k) && value[k] != null && value[k] !== "",
  );
  keys.sort((a, b) => {
    const ia = preferred.indexOf(a);
    const ib = preferred.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return 0;
  });
  const rows = keys.map((k) => {
    const v = value[k];
    if (typeof v === "object") {
      return `<div class="af-dim-row af-dim-row--block"><span class="af-dim-k">${esc(k)}</span><div class="af-dim-v">${
        isDiagnosticNode(v)
          ? renderDiagnosticDimHtml(k, v)
          : renderAestheticsNodeHtml(v, k, 2)
      }</div></div>`;
    }
    return `<div class="af-dim-row"><span class="af-dim-k">${esc(k)}</span><span class="af-dim-v">${esc(String(v))}</span></div>`;
  });
  return `<section class="af-dim">${head}${rows.length ? `<div class="af-dim-body">${rows.join("")}</div>` : ""}</section>`;
}

function isProseHeavyObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (isDiagnosticNode(value)) return false;
  const vals = Object.values(value).filter((x) => x != null && x !== "");
  if (!vals.length) return false;
  let prose = 0;
  for (const x of vals) {
    if (typeof x === "string" && (x.length > 36 || x.includes("\n"))) prose += 1;
    else if (Array.isArray(x)) prose += 1;
    else if (typeof x === "object" && !isDiagnosticNode(x)) prose += 1;
  }
  return prose >= Math.ceil(vals.length / 2);
}

function renderAfTile(title, value) {
  // 诊断块统一走维度标题样式（不再用厚瓷砖+完备度条）
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value.结论 != null || value.完备度 != null || value.已知 != null || value.待探 != null)
  ) {
    return renderDiagnosticDimHtml(title, value);
  }
  const pct = extractNodePct(value);
  const mini = pct != null ? renderMiniPctHtml(pct) : "";
  let body = "";
  if (value == null) {
    body = `<span class="ws-muted">—</span>`;
  } else if (typeof value !== "object") {
    body = `<p class="af-tile-text">${esc(clampPreviewText(String(value), 100))}</p>`;
  } else {
    return `<div class="af-group af-group-wide"><div class="af-group-title">${esc(title)}${mini}</div>${renderAestheticsNodeHtml(value, title, 1)}</div>`;
  }
  return `<article class="af-tile"><header class="af-tile-head"><span class="af-tile-name">${esc(title)}</span>${mini}</header>${body}</article>`;
}

function isPctFieldKey(key) {
  if (!key) return false;
  return /完备度|分数|覆盖度|充分度|克制度|承重度|可维护|必要性|属性妥当|格式准确|契约符合|同真相|可开玩|完整度|进度/.test(
    String(key),
  );
}

function renderScalarOrPctHtml(value, keyHint) {
  if (typeof value === "boolean") {
    return `<span class="artifact-scalar">${value ? "是" : "否"}</span>`;
  }
  if (isPctFieldKey(keyHint) || (typeof value === "string" && /^\d+(\.\d+)?\s*%$/.test(value.trim()))) {
    const pct = parseCompleteness(value);
    if (pct != null) return renderPctMeterHtml(pct, keyHint || "完备度");
  }
  if (typeof value === "number" && isPctFieldKey(keyHint)) {
    const pct = parseCompleteness(value);
    if (pct != null) return renderPctMeterHtml(pct, keyHint);
  }
  if (typeof value === "string" || typeof value === "number") {
    return renderProseHtml(String(value));
  }
  return `<span class="artifact-scalar">${esc(String(value))}</span>`;
}

function renderAestheticsNodeHtml(value, keyHint, depth) {
  if (value == null || value === "") return `<span class="ws-muted">—</span>`;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return renderScalarOrPctHtml(value, keyHint);
  }
  if (Array.isArray(value)) return renderStructuredValueHtml(value, depth);

  // 单点诊断：维度标题 + 行内完备度
  if (value.结论 != null || value.完备度 != null) {
    return renderDiagnosticDimHtml(keyHint || "项", value);
  }
  if (value.已知 != null || value.待探 != null) {
    return renderDiagnosticDimHtml(keyHint || "项", value);
  }

  // 美学纲领：体验内核通栏；诊断块可瓷砖；呈现要点等散文块通栏堆叠
  if (keyHint === "美学纲领" || value.体验内核 != null) {
    const parts = [];
    if (value.体验内核 != null) {
      parts.push(
        `<div class="artifact-kernel qcard-assessment"><div class="artifact-aside-label">体验内核</div>${renderProseHtml(String(value.体验内核))}</div>`,
      );
    }
    const rest = { ...value };
    delete rest.体验内核;
    const restEntries = Object.entries(rest).filter(([, v]) => v != null && v !== "");
    if (restEntries.length) {
      const tiles = restEntries.filter(([, v]) => isDiagnosticNode(v));
      const prose = restEntries.filter(([, v]) => !isDiagnosticNode(v));
      if (tiles.length) {
        parts.push(
          `<div class="af-tile-grid">${tiles.map(([k, v]) => renderAfTile(k, v)).join("")}</div>`,
        );
      }
      if (prose.length) {
        parts.push(
          `<div class="af-stack">${prose
            .map(([k, v]) => {
              if (v && typeof v === "object" && !Array.isArray(v)) {
                return `<div class="af-group af-group-wide"><div class="af-group-title">${esc(k)}</div>${renderAestheticsNodeHtml(v, k, depth + 1)}</div>`;
              }
              return `<div class="af-group af-group-wide"><div class="af-group-title">${esc(k)}</div>${renderScalarOrPctHtml(v, k)}</div>`;
            })
            .join("")}</div>`,
        );
      }
    }
    return parts.join("");
  }

  // 呈现要点 / 交互范式子树：定键长文，统一自适应定义列表（不按字数硬切换行）
  if (
    keyHint === "呈现要点" ||
    keyHint === "交互范式" ||
    keyHint === "前置配置" ||
    keyHint === "叙事视角" ||
    keyHint === "描写权限" ||
    keyHint === "后果与叙事控制" ||
    isProseHeavyObject(value)
  ) {
    return renderObjectKvHtml(value, depth);
  }

  if (depth > 4) return renderStructuredValueHtml(value, depth);

  const entries = Object.entries(value).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return `<span class="ws-muted">（空）</span>`;

  // 同构评价维度：用标题切开，不用瓷砖墙
  const allDiagnostic = entries.every(([, v]) => isDiagnosticNode(v));
  if (allDiagnostic && entries.length >= 2) {
    return `<div class="af-dim-stack">${entries.map(([k, v]) => renderDiagnosticDimHtml(k, v)).join("")}</div>`;
  }

  // 混合：大标题分组 + 维度块
  const nestedGroups = entries.filter(
    ([, v]) =>
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      !isDiagnosticNode(v),
  );
  if (nestedGroups.length >= 1 && depth < 3) {
    return `<div class="af-stack">${entries
      .map(([k, v]) => {
        if (isDiagnosticNode(v)) {
          return renderDiagnosticDimHtml(k, v);
        }
        if (v && typeof v === "object" && !Array.isArray(v)) {
          return `<section class="af-section"><h4 class="af-section-title">${esc(k)}</h4>${renderAestheticsNodeHtml(v, k, depth + 1)}</section>`;
        }
        return `<section class="af-section"><h4 class="af-section-title">${esc(k)}</h4>${renderScalarOrPctHtml(v, k)}</section>`;
      })
      .join("")}</div>`;
  }

  const allLeaf = entries.every(
    ([, v]) => v == null || typeof v !== "object" || Array.isArray(v),
  );
  if (allLeaf) {
    return renderObjectKvHtml(value, depth);
  }
  return renderObjectKvHtml(value, depth);
}

function renderSelfScoreHtml(自评) {
  if (!自评 || typeof 自评 !== "object") return "";
  const dims = Array.isArray(自评.维度) ? 自评.维度 : [];
  const bars = dims
    .map((d) => {
      if (!d || typeof d !== "object") return "";
      const name = d.名 || d.维度 || d.name || "?";
      const ten = parseTenScore(d.分数);
      const note = d.说明
        ? `<p class="artifact-score-note">${esc(clampPreviewText(String(d.说明), 80))}</p>`
        : "";
      if (ten == null) {
        return `<div class="artifact-score"><span class="af-dim-k">${esc(String(name))}</span> <span class="ws-muted">未评分</span>${note}</div>`;
      }
      return `<div class="artifact-score">${renderTenMeterHtml(ten, String(name))}${note}</div>`;
    })
    .filter(Boolean);
  let weak = "";
  if (自评.薄弱点) {
    weak = `<p class="artifact-weak"><span class="ws-badge ws-badge-warn">薄弱点</span> ${esc(String(自评.薄弱点))}</p>`;
  }
  if (!bars.length && !weak) return "";
  return `<section class="artifact-block artifact-scores-block"><h4>自评</h4><div class="artifact-scores">${bars.join("")}</div>${weak}</section>`;
}

function renderProbeHtml(追问) {
  if (!追问 || typeof 追问 !== "object") return "";
  const qs = Array.isArray(追问.题目) ? 追问.题目 : [];
  const cards = [];
  if (追问.导语) {
    cards.push(`<p class="artifact-probe-lead">${esc(String(追问.导语))}</p>`);
  }
  qs.forEach((q, i) => {
    if (!q || typeof q !== "object") return;
    const letter = String.fromCharCode(65 + (i % 26));
    const opts =
      Array.isArray(q.建议选项) && q.建议选项.length
        ? `<ul class="qcard-options artifact-probe-opts">${q.建议选项
            .map((o, j) => {
              const L = String.fromCharCode(65 + (j % 26));
              return `<li class="qcard-opt"><span class="qcard-letter" aria-hidden="true">${L}</span><span class="qcard-label">${esc(String(o))}</span></li>`;
            })
            .join("")}</ul>`
        : "";
    const ex = q.示例 ? `<p class="qcard-optional-note">示例：${esc(String(q.示例))}</p>` : "";
    cards.push(
      `<div class="artifact-probe-q"><div class="qcard-prompt"><span class="artifact-q-idx">${letter}</span>${esc(String(q.问 || "?"))}</div>${opts}${ex}</div>`,
    );
  });
  if (!cards.length) return "";
  return `<section class="artifact-block artifact-probe-block"><h4>追问</h4>${cards.join("")}</section>`;
}

function renderContextOrderHtml(doc) {
  if (!Array.isArray(doc.slots) || !doc.slots.length) return null;
  const parts = [];
  if (doc.brief) {
    parts.push(
      `<section class="ws-section ws-headline"><h4>概要</h4><p>${esc(String(doc.brief))}</p></section>`,
    );
  }
  for (const slot of doc.slots) {
    if (!slot || typeof slot !== "object") continue;
    const title = slot.label || slot.ref || "槽";
    const inserts = Array.isArray(slot.inserts) ? slot.inserts : [];
    if (!inserts.length && Array.isArray(slot.order)) {
      // 扁平序：直接是条目列表
      const rows = slot.order
        .map((i, idx) => renderContextInsertRow(i, idx))
        .filter(Boolean);
      if (rows.length) {
        parts.push(
          `<section class="ws-section"><h4>${esc(String(title))}</h4><ol class="artifact-order-list">${rows.join("")}</ol></section>`,
        );
      }
      continue;
    }
    const rows = inserts
      .slice()
      .sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0))
      .map((i, idx) => renderContextInsertRow(i, idx))
      .filter(Boolean);
    if (rows.length) {
      parts.push(
        `<section class="ws-section"><h4>${esc(String(title))}</h4><ol class="artifact-order-list">${rows.join("")}</ol></section>`,
      );
    }
  }
  // 顶层扁平 slots 即 inserts
  if (!parts.length && doc.slots.every((s) => s && (s.ref || s.anchor != null))) {
    const rows = doc.slots.map((i, idx) => renderContextInsertRow(i, idx)).filter(Boolean);
    if (rows.length) {
      parts.push(
        `<section class="ws-section"><h4>投影序</h4><ol class="artifact-order-list">${rows.join("")}</ol></section>`,
      );
    }
  }
  if (!parts.length) return null;
  return `<div class="artifact-friendly artifact-context-order">${parts.join("")}</div>`;
}

function renderContextInsertRow(item, idx) {
  if (item == null) return "";
  if (typeof item !== "object") {
    return `<li><span class="artifact-order-idx">${idx + 1}</span> ${esc(String(item))}</li>`;
  }
  const isHistory = item.ref === "对话.历史" || item.ref === "history";
  const anchor =
    item.anchor === "post_history" || item.anchor === "历史后"
      ? "历史后"
      : item.anchor === "pre_history" || item.anchor === "历史前"
        ? "历史前"
        : item.anchor
          ? String(item.anchor)
          : "";
  const proj =
    item.projection && item.projection !== "full" ? String(item.projection) : "";
  const note = item.note ? String(item.note) : "";
  const ref = item.ref || item.label || "?";
  const meta = [anchor, proj].filter(Boolean).map((t) => `<span class="artifact-chip muted">${esc(t)}</span>`).join("");
  return `<li class="${isHistory ? "is-history" : ""}"><span class="artifact-order-idx">${item.order ?? idx + 1}</span><span class="artifact-order-ref">${esc(String(ref))}</span>${meta}${note ? `<span class="ws-muted"> — ${esc(note)}</span>` : ""}</li>`;
}

function renderStructuredDocHtml(doc) {
  if (Array.isArray(doc)) {
    return `<div class="artifact-friendly">${renderStructuredValueHtml(doc, 0)}</div>`;
  }
  const parts = [];
  if (typeof doc.brief === "string" && doc.brief.trim()) {
    parts.push(
      `<section class="ws-section ws-headline"><h4>概要</h4><p>${esc(doc.brief)}</p></section>`,
    );
  }
  const body = { ...doc };
  delete body.brief;
  delete body.schema;
  if (body.自评) {
    const score = renderSelfScoreHtml(body.自评);
    delete body.自评;
    const rest = renderObjectSectionsHtml(body, 0);
    if (rest) parts.push(rest);
    if (score) parts.push(score);
  } else {
    const rest = renderObjectSectionsHtml(body, 0);
    if (rest) parts.push(rest);
  }
  if (!parts.length) {
    parts.push(renderStructuredValueHtml(doc, 0));
  }
  return `<div class="artifact-friendly">${parts.join("")}</div>`;
}

function renderObjectSectionsHtml(obj, depth) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
  const entries = Object.entries(obj).filter(
    ([k, v]) => !ARTIFACT_SKIP_KEYS.has(k) && v != null && v !== "",
  );
  if (!entries.length) return "";
  // 浅层：每键一节；深层：kv
  if (depth === 0) {
    return entries
      .map(([k, v]) => {
        if (k === "自评") return renderSelfScoreHtml(v);
        if (k === "追问") return renderProbeHtml(v);
        return `<section class="ws-section"><h4>${esc(k)}</h4>${renderStructuredValueHtml(v, depth + 1)}</section>`;
      })
      .join("");
  }
  return renderStructuredValueHtml(obj, depth);
}

function renderStructuredValueHtml(value, depth) {
  if (value == null || value === "") return `<span class="ws-muted">—</span>`;
  if (typeof value === "string") return renderProseHtml(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return `<span class="artifact-scalar">${esc(String(value))}</span>`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return `<span class="ws-muted">（空）</span>`;
    const allScalar = value.every(
      (v) => v == null || ["string", "number", "boolean"].includes(typeof v),
    );
    if (allScalar) {
      return `<ul class="artifact-list">${value
        .map((v) => `<li>${esc(String(v))}</li>`)
        .join("")}</ul>`;
    }
    return `<div class="artifact-cards af-tile-grid">${value
      .map((item, i) => renderArrayItemCard(item, i, depth))
      .join("")}</div>`;
  }
  if (typeof value === "object") {
    if (depth > 5) {
      return `<details class="artifact-raw nested"><summary>嵌套对象</summary><pre class="json-pretty"><code>${highlightJson(JSON.stringify(value, null, 2))}</code></pre></details>`;
    }
    // 结论/完备度块：走维度小标题，避免 KV 再拆出「完备度」行
    if (isDiagnosticNode(value)) {
      return renderDiagnosticDimHtml("项", value);
    }
    return renderObjectKvHtml(value, depth);
  }
  return `<span class="artifact-scalar">${esc(String(value))}</span>`;
}

function renderProseHtml(text) {
  const t = String(text);
  if (!t.trim()) return `<span class="ws-muted">—</span>`;
  if (t.includes("\n") || t.length > 160) {
    return `<div class="artifact-prose">${esc(t).replace(/\n/g, "<br>")}</div>`;
  }
  return `<p class="artifact-inline">${esc(t)}</p>`;
}

function pickArtifactTitle(obj, fallbackIndex) {
  if (!obj || typeof obj !== "object") return `#${fallbackIndex + 1}`;
  for (const k of ARTIFACT_TITLE_KEYS) {
    if (obj[k] != null && String(obj[k]).trim()) return String(obj[k]);
  }
  const first = Object.keys(obj)[0];
  if (first && typeof obj[first] !== "object") return `${first}：${obj[first]}`;
  return `#${fallbackIndex + 1}`;
}

function renderArrayItemCard(item, index, depth) {
  if (item == null || typeof item !== "object") {
    return `<div class="artifact-card"><div class="artifact-card-body">${esc(String(item))}</div></div>`;
  }
  const title = pickArtifactTitle(item, index);
  const rest = { ...item };
  for (const k of ARTIFACT_TITLE_KEYS) delete rest[k];
  // 保留标题键若还有其它信息价值：名/类型等同屏展示
  const keepMeta = {};
  for (const k of ["类型", "顺序", "生命周期", "填充方", "内容形态", "用途", "通道"]) {
    if (item[k] != null && item[k] !== "") keepMeta[k] = item[k];
  }
  const metaBits = Object.entries(keepMeta)
    .map(([k, v]) => {
      if (typeof v === "object") return "";
      return `<span class="artifact-chip muted">${esc(k)}：${esc(String(v))}</span>`;
    })
    .filter(Boolean)
    .join("");
  for (const k of Object.keys(keepMeta)) delete rest[k];
  const body = Object.keys(rest).length
    ? renderObjectKvHtml(rest, depth + 1)
    : "";
  return `<div class="artifact-card"><div class="artifact-card-title">${esc(title)}</div>${metaBits ? `<div class="artifact-chip-row">${metaBits}</div>` : ""}${body}</div>`;
}

function renderObjectKvHtml(obj, depth) {
  if (isDiagnosticNode(obj)) {
    return renderDiagnosticDimHtml("项", obj);
  }
  const entries = Object.entries(obj).filter(
    ([k, v]) => !ARTIFACT_SKIP_KEYS.has(k) && v != null && v !== "",
  );
  if (!entries.length) return `<span class="ws-muted">（空）</span>`;

  // 全是评价维度 → 小标题栈
  if (
    entries.length >= 1 &&
    entries.every(([, v]) => isDiagnosticNode(v))
  ) {
    return `<div class="af-dim-stack">${entries
      .map(([k, v]) => renderDiagnosticDimHtml(k, v))
      .join("")}</div>`;
  }

  const rows = entries
    .map(([k, v]) => {
      const isComplex = v != null && typeof v === "object";
      if (isComplex && isDiagnosticNode(v)) {
        return renderDiagnosticDimHtml(k, v);
      }
      if (!isComplex) {
        if (isPctFieldKey(k) && parseCompleteness(v) != null) {
          return renderAdaptiveDefHtml(k, renderInlinePctHtml(parseCompleteness(v)));
        }
        return renderAdaptiveDefHtml(k, renderScalarOrPctHtml(v, k));
      }
      // 嵌套对象：小节标题 + 内部继续自适应，不跟叶子混用两套换行规则
      return `<section class="af-section">
        <h4 class="af-section-title">${esc(k)}</h4>
        ${renderStructuredValueHtml(v, depth + 1)}
      </section>`;
    })
    .join("");
  return `<div class="af-def-list artifact-kv artifact-kv--adaptive">${rows}</div>`;
}

/** 标签+内容：CSS 自适应并排/折行，禁止按字数猜换行 */
function renderAdaptiveDefHtml(key, valueHtml) {
  return `<div class="af-def">
    <div class="af-def-k">${esc(key)}</div>
    <div class="af-def-v">${valueHtml}</div>
  </div>`;
}

function isSettlementLike(doc) {
  const keys = ["player_action", "visible_now", "resolved", "npc_moves", "variable_changes"];
  let hits = 0;
  for (const k of keys) if (k in doc) hits += 1;
  return hits >= 2;
}

function renderSettlementSectionsHtml(doc) {
  const sections = [];
  const push = (title, lines) => {
    if (!lines || !lines.length) return;
    sections.push(
      `<section class="ws-section"><h4>${esc(title)}</h4><ul class="artifact-list">${lines
        .map((l) => `<li>${esc(String(l))}</li>`)
        .join("")}</ul></section>`,
    );
  };
  const pushHtml = (title, html) => {
    if (!html) return;
    sections.push(`<section class="ws-section"><h4>${esc(title)}</h4>${html}</section>`);
  };
  if (doc.player_action) push("玩家行动", [doc.player_action]);
  if (Array.isArray(doc.resolved) && doc.resolved.length) push("已落地", doc.resolved);
  if (doc.visible_now) push("可见现状", [doc.visible_now]);
  if (Array.isArray(doc.npc_moves) && doc.npc_moves.length) {
    pushHtml("角色动作", renderStructuredValueHtml(doc.npc_moves, 0));
  }
  if (Array.isArray(doc.variable_changes) && doc.variable_changes.length) {
    pushHtml("变量变更", renderStructuredValueHtml(doc.variable_changes, 0));
  }
  if (doc.tone_hint) push("语气", [doc.tone_hint]);
  if (Array.isArray(doc.do_not_say) && doc.do_not_say.length) {
    push("勿写入正文", doc.do_not_say);
  }
  if (Array.isArray(doc.suggested_actions) && doc.suggested_actions.length) {
    push("建议行动", doc.suggested_actions);
  }
  if (!sections.length) return null;
  return `<div class="artifact-friendly artifact-settlement">${sections.join("")}</div>`;
}

function renderVariableDesignHtml(doc) {
  const parts = [];
  if (doc.brief) {
    parts.push(
      `<section class="ws-section ws-headline"><h4>概要</h4><p>${esc(String(doc.brief))}</p></section>`,
    );
  }
  const body = doc.正文 && typeof doc.正文 === "object" ? doc.正文 : doc;
  const keys = [
    "依据的体验",
    "真值",
    "Data映射索引",
    "维护语句约定",
    "side_effects",
    "旁观汇总意图",
    "不立变量的理由",
  ];
  const used = new Set();
  for (const k of keys) {
    if (body[k] == null) continue;
    used.add(k);
    parts.push(
      `<section class="ws-section"><h4>${esc(k)}</h4>${renderStructuredValueHtml(body[k], 0)}</section>`,
    );
  }
  if (body === doc) {
    for (const [k, v] of Object.entries(doc)) {
      if (used.has(k) || ARTIFACT_SKIP_KEYS.has(k) || k === "brief" || k === "正文") continue;
      if (v == null || v === "") continue;
      if (k === "自评") {
        const s = renderSelfScoreHtml(v);
        if (s) parts.push(s);
        continue;
      }
      parts.push(
        `<section class="ws-section"><h4>${esc(k)}</h4>${renderStructuredValueHtml(v, 0)}</section>`,
      );
    }
  } else {
    for (const [k, v] of Object.entries(body)) {
      if (used.has(k) || v == null || v === "") continue;
      parts.push(
        `<section class="ws-section"><h4>${esc(k)}</h4>${renderStructuredValueHtml(v, 0)}</section>`,
      );
    }
  }
  if (!parts.length) return null;
  return `<div class="artifact-friendly artifact-variable-design">${parts.join("")}</div>`;
}

/** 极简 JSON 着色（仅 key / string / 其它） */
function highlightJson(pretty) {
  return pretty
    .split("\n")
    .map((line) => {
      const m = /^(\s*)("(?:\\.|[^"\\])*")(\s*:\s*)(.*)$/.exec(line);
      if (m) {
        const [, indent, key, colon, rest] = m;
        let valueHtml = esc(rest);
        if (/^"/.test(rest.trim())) {
          valueHtml = `<span class="json-str">${esc(rest)}</span>`;
        } else if (/^(true|false|null)\b/.test(rest.trim())) {
          valueHtml = `<span class="json-lit">${esc(rest)}</span>`;
        } else if (/^-?\d/.test(rest.trim())) {
          valueHtml = `<span class="json-num">${esc(rest)}</span>`;
        }
        return `${indent}<span class="json-key">${esc(key)}</span>${esc(colon)}${valueHtml}`;
      }
      return esc(line);
    })
    .join("\n");
}

function renderCreationFlowView(flowView) {
  if (!flowView) return "";
  if (flowView.parseError) {
    return `<div class="review-parse-error" role="alert">
      <div class="review-parse-error-title">流程无法解析</div>
      <p>${esc(flowView.parseError)}</p>
      <p class="review-parse-error-hint">需要 JSON：steps 数组，每步含 name（与可选 id）、depends_on、可选 params；可含 status=open|closed。</p>
    </div>`;
  }
  if (!flowView.steps?.length) return "";

  const brief = flowView.brief
    ? `<p class="flow-brief">${esc(flowView.brief)}</p>`
    : "";
  const statusLabel =
    flowView.status === "open"
      ? "可继续追加"
      : flowView.status === "closed"
        ? "已收口"
        : "";
  const statusHtml = statusLabel
    ? `<p class="flow-status">${esc(statusLabel)}</p>`
    : "";
  const rows = flowView.steps
    .map((s) => {
      const deps =
        s.depends_on?.length > 0
          ? s.depends_on.map((d) => esc(d)).join("、")
          : "无";
      const occ =
        s.occurrence && s.occurrence > 1
          ? `<span class="flow-occ">第 ${esc(String(s.occurrence))} 次</span>`
          : s.repeatable
            ? `<span class="flow-occ">可反复</span>`
            : "";
      const nameLabel =
        s.id && s.id !== s.name
          ? `${esc(s.name)} <span class="flow-id">(${esc(s.id)})</span>`
          : esc(s.name);
      const paramsText = formatFlowParams(s.params);
      const paramsMissing =
        s.paramsMissing?.length > 0
          ? `<span class="flow-params-missing">缺参：${esc(s.paramsMissing.join("、"))}</span>`
          : "";
      const paramsHtml = paramsText
        ? `<span class="flow-params">${esc(paramsText)}</span>`
        : "";
      const runState = s.runState === "done" || s.runState === "current" ? s.runState : "pending";
      const runLabel =
        runState === "done" ? "已执行" : runState === "current" ? "将要执行" : "未执行";
      const currentAttr = runState === "current" ? ' aria-current="step"' : "";
      return `<li class="flow-step" data-run="${esc(runState)}"${currentAttr}>
        <span class="flow-order">${esc(String(s.order))}</span>
        <span class="flow-run">${esc(runLabel)}</span>
        <span class="flow-name">${nameLabel}${occ}</span>
        ${paramsHtml}
        ${paramsMissing}
        <span class="flow-deps">依赖：${deps}</span>
      </li>`;
    })
    .join("");

  return `<section class="ws-section ws-creation-flow">
    ${brief}
    ${statusHtml}
    <ol class="flow-steps">${rows}</ol>
  </section>`;
}

function formatFlowParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return "";
  const parts = Object.entries(params)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return parts.length ? parts.join(" · ") : "";
}

function wireContextOrderEditor(root, sessionId) {
  if (!root || !sessionId) return;
  const post = (body) =>
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "编排失败");
        window.dispatchEvent(new CustomEvent("wa:session-updated", { detail: data }));
      })
      .catch((err) => alert(err.message || String(err)));

  root.querySelectorAll("[data-ctx-order]").forEach((el) => {
    const action = el.getAttribute("data-ctx-order");
    const row = el.closest(".ctx-order-row");
    if (!row || !action) return;
    const slotRef = row.getAttribute("data-slot-ref");
    const index = Number(row.getAttribute("data-index"));
    if (!slotRef || !Number.isFinite(index)) return;

    if (el.tagName === "SELECT") {
      el.addEventListener("change", () => {
        void post({
          action: "set_projection",
          slotRef,
          index,
          projection: el.value,
        });
      });
      return;
    }

    el.addEventListener("click", () => {
      if (action === "move") {
        const delta = Number(el.getAttribute("data-delta"));
        if (delta !== 1 && delta !== -1) return;
        void post({ action: "move", slotRef, index, delta });
        return;
      }
      if (action === "set_anchor") {
        const anchor = el.getAttribute("data-anchor");
        if (anchor !== "pre_history" && anchor !== "post_history") return;
        void post({ action: "set_anchor", slotRef, index, anchor });
      }
    });
  });
}

function renderReviewWorkspace(review, opts = {}) {
  const flowHtml = review.creationFlowView
    ? renderCreationFlowView(review.creationFlowView)
    : "";
  // 模块产物直接出产物卡；完整 Worker 集 / 流程才展开规格视图
  const wsHint = `${review.summary || ""} ${review.workerId || ""}`;
  const showFullWorkerSet =
    Boolean(review.workerSetView) &&
    /worker集|refine|worker-spec|游玩拓扑|细化终稿/i.test(wsHint);
  let structured = "";
  if (flowHtml) {
    structured = flowHtml;
  } else if (showFullWorkerSet && review.workerSetView) {
    structured = renderWorkerSetUserView(review.workerSetView, {
      editable: false,
      compact: true,
      omitFocusBody: true,
    });
  }
  const hasStructured = Boolean(structured);
  const artifactHtml = formatArtifactBodyHtml(review.body, {
    defaultOpen: !hasStructured,
    flat: !hasStructured,
    hideAskSidecar: opts.hideAskSidecar === true,
    asPresentFallback:
      review.workerId === "narrator" ||
      review.workerId === "opening-generator" ||
      /用户展示|开场白/.test(review.body || ""),
  });
  const contextId = review.sourceMessageId || review.id || "";
  const hasContext = review.contextTrace ? "1" : "0";
  const label = displayWorkerLabel(review.workerId) || "产物";
  const copy = reviewComposerCopy(review.workerId);
  const sourceMsg =
    opts.sourceMessage ||
    (review.sourceMessageId
      ? { id: review.sourceMessageId, kind: "worker_output", branchIndex: 0, branchTotal: 1 }
      : null);
  // 有源消息时尽量用真实 branch 元数据；至少给出可重出入口
  const navMsg = opts.sourceMessage
    ? {
        ...opts.sourceMessage,
        kind: opts.sourceMessage.kind || "worker_output",
      }
    : sourceMsg
      ? { ...sourceMsg, kind: "worker_output" }
      : null;
  const variantNav = navMsg ? renderVariantNavHtml(navMsg) : "";

  return `
    <section class="workspace-review" data-review="1" data-review-kind="${esc(copy.kind)}" data-message-id="${esc(contextId)}" data-can-edit="0" data-has-context="${hasContext}">
      <header class="workspace-review-head workspace-review-head--slim">
        <div class="workspace-review-titles">
          <span class="workspace-review-kicker">${esc(copy.kicker)}</span>
          <h2 class="workspace-review-title">${esc(label)}</h2>
        </div>
        ${variantNav ? `<div class="workspace-review-nav">${variantNav}</div>` : ""}
      </header>
      ${structured ? `<div class="review-worker-set">${structured}</div>` : ""}
      <div class="workspace-review-body review-json-block">
        ${
          hasStructured
            ? `<details class="workspace-raw-details">
        <summary>原始产物</summary>
        <div class="workspace-raw-body">${artifactHtml}</div>
      </details>`
            : artifactHtml
        }
      </div>
    </section>`;
}

/** @deprecated 验收已迁入 workspace-stage */
function renderReviewFeedCard(review, opts = {}) {
  return renderReviewWorkspace(review, opts);
}

/** @deprecated 验收已在主对话；无侧栏面板 */
export function renderReviewPanel(_view, _handlers = {}) {}

export function renderAgentPanel(view, loading) {
  wireRailChrome();
  maybeSyncRail(view);

  const focusEl = document.getElementById("agent-focus");
  const traceEl = document.getElementById("tool-trace");
  const timelineEl = document.getElementById("agent-timeline");
  const badgeEl = document.getElementById("burst-badge");
  if (!focusEl || !timelineEl) return;

  const f = view.focus;
  if (f) {
    focusEl.innerHTML = `
      <div class="agent-focus-who">${esc(f.actorLabel)}</div>
      <div class="agent-focus-action">${esc(loading ? "处理中…" : f.action)}</div>
      ${f.detail ? `<div class="agent-focus-detail">${esc(f.detail)}</div>` : ""}`;
  } else {
    focusEl.innerHTML = `<div class="agent-focus-detail">待命</div>`;
  }

  if (badgeEl && view.burst) {
    const show = view.burst.count > 0 || view.phase === "running";
    badgeEl.hidden = !show;
    badgeEl.textContent = `${view.burst.count}/${view.burst.max}`;
    badgeEl.title = `burst ${view.burst.count}/${view.burst.max}`;
  }

  if (traceEl) {
    const trace = view.toolTrace ?? [];
    if (!trace.length) {
      traceEl.hidden = true;
      traceEl.innerHTML = "";
    } else {
      traceEl.hidden = false;
      traceEl.innerHTML = trace
        .map(
          (t) => `
        <div class="tool-trace-item">
          <span class="tool-trace-name">${esc(t.name)}</span>
          <span style="float:right;color:var(--muted)">${fmtTime(t.at)}</span>
          <div>${esc(t.summary || "—")}</div>
        </div>`,
        )
        .join("");
    }
  }

  const items = [];
  for (const msg of view.messages ?? []) {
    if (msg.role === "user") {
      items.push({ kind: "user_input", title: "你", body: msg.text, at: msg.createdAt });
      continue;
    }
    const kind = msg.kind ?? "system_info";
    if (HIDE_KINDS.has(kind)) continue;
    if (isSkillSelectionMessage(msg)) continue;
    if (isReviewSidecarQuestionStub(msg)) continue;
    items.push({
      kind,
      title: msg.title ?? msgLabel(msg),
      body: msgBody(msg, view).slice(0, 160),
      at: msg.createdAt,
    });
  }
  if (loading && f) {
    const live = view.liveStream;
    items.push({
      kind: "pending",
      title: live?.label ?? f.action,
      body: [live?.thinking, live?.output].filter(Boolean).join("\n").slice(0, 200) || (f.detail ?? ""),
      at: "",
    });
  }
  if (!items.length) {
    timelineEl.innerHTML = `<p class="timeline-empty">调度记录将出现在这里</p>`;
    return;
  }
  timelineEl.innerHTML = items
    .map(
      (it) => `
    <div class="timeline-item">
      <strong>${esc(it.title)}</strong>
      <span style="color:var(--muted);margin-left:6px">${fmtTime(it.at)}</span>
      <div style="margin-top:2px;color:var(--muted)">${esc(it.body)}</div>
    </div>`,
    )
    .join("");
  timelineEl.scrollTop = timelineEl.scrollHeight;
}

function renderCoordLine(msg, view, opts = {}) {
  const isUser = msg.role === "user";
  const kind = msg.kind ?? (isUser ? "user_input" : "system_info");
  const who = isUser ? "你" : msgLabel(msg);
  const raw = msgBody(msg, view).replace(/\s+/g, " ").trim();
  const text = raw.length > 320 ? `${raw.slice(0, 320)}…` : raw;
  const nav = renderVariantNavHtml(msg);
  const allMessages = view.messages ?? [];
  const messageIndex = allMessages.findIndex((item) => item.id === msg.id);
  const rollbackMessageId = messageIndex >= 0 ? allMessages[messageIndex + 1]?.id : null;
  const rollbackAttr = rollbackMessageId
    ? ` data-rollback-message-id="${esc(rollbackMessageId)}"`
    : "";
  const contextAttr = msg.contextTrace ? ` data-has-context="1"` : "";
  const readOnlyAttr = opts.traceOnly ? ` data-read-only="1"` : "";
  const trace = msg.contextTrace;
  const traceMeta = trace
    ? `<button type="button" class="coord-context-trigger" data-context-trigger aria-label="查看 ${esc(who)} 的完整请求上下文">
        <span class="coord-context-label">保留上下文</span>
        <span>${trace.messages?.length ?? 0} 段</span>
        <span>${((trace.charCount ?? 0) / 1024).toFixed(1)} KB</span>
      </button>
      <div class="coord-trace-meta">
        <span title="调用方">${esc(trace.caller || msg.tokenUsage?.caller || "unknown")}</span>
        <span title="模型">${esc(trace.model || msg.tokenUsage?.model || "model?")}</span>
        ${msg.tokenUsage?.totalTokens ? `<span title="本次调用 Token">${Number(msg.tokenUsage.totalTokens).toLocaleString("zh-CN")} tok</span>` : ""}
      </div>`
    : "";
  const traceClass = trace ? " coord-line--trace" : "";
  return `<div class="coord-line ${isUser ? "coord-user" : "coord-agent"}${traceClass}" data-message-id="${esc(msg.id)}" data-kind="${esc(kind)}"${rollbackAttr}${contextAttr}${readOnlyAttr}>
    <button type="button" class="coord-line-menu" data-msg-menu-trigger aria-label="打开这条消息的操作菜单" title="更多操作">⋯</button>
    <div class="coord-who"><span>${esc(who)}</span><span class="coord-kind">${esc(kind)}</span><span class="coord-time">${fmtTime(msg.createdAt)}</span>${nav}</div>
    <div class="coord-text">${esc(text || "（空）")}</div>
    ${traceMeta}
  </div>`;
}

function getRollbackMessageId(messages, messageId) {
  const messageIndex = messages.findIndex((item) => item.id === messageId);
  return messageIndex >= 0 ? messages[messageIndex + 1]?.id ?? null : null;
}

/** @returns {"speak"|"answer"|"review"|"busy"|null} */
function resolveDesignSurface(view, loading) {
  if (view.lifecycleStage === "play") return null;
  if (view.phase === "done") return null;
  const busy = Boolean(loading || (view.phase === "running" && !view.waitingReason));
  if (busy) return "busy";
  if (view.phase === "error") return "speak";
  if (view.waitingReason?.kind === "review_artifact" && view.reviewArtifact) {
    return "review";
  }
  // 能力默认问题：说话面 + openingGuide（勿进空答题壳）
  if (isModuleOpeningWaiting(view)) return "speak";
  // 本轮题已收起时不排答题面，否则主区只剩空壳
  if (
    getActiveQuestions(view)?.questions?.length &&
    !isQuestionCardDismissed(view)
  ) {
    return "answer";
  }
  if (
    view.phase === "waiting_user" ||
    view.waitingReason ||
    view.phase === "idle"
  ) {
    // 已打开作品、等人开口或补充
    if (view.bookId || view.waitingReason) return "speak";
  }
  return null;
}

function ensureQuestionsHostIn(parent) {
  const host = document.getElementById("questions-card-host");
  if (!host || !parent) return host;
  if (host.parentElement !== parent) parent.appendChild(host);
  return host;
}

function proposedOutputCopy(proposed) {
  const params = proposed?.params;
  const target =
    params && typeof params === "object"
      ? params.target ?? params.object ?? params["对象"] ?? params["生成对象"]
      : null;
  const targetText =
    typeof target === "string" || typeof target === "number"
      ? String(target).trim()
      : "";
  if (targetText) {
    return `将生成「${targetText}」的${proposed.name}。`;
  }
  return `接下来将生成：${proposed?.name || "下一项内容"}。`;
}

function renderSpeakWorkspace(view) {
  const wr = view.waitingReason;
  const guide = view.openingGuide;
  const moduleOpening = isModuleOpeningWaiting(view);
  const openingText = moduleOpening
    ? (guide?.text || getModuleOpeningPrompt(view) || "").trim()
    : guide?.text &&
        !hasUserMessages(view) &&
        view.lifecycleStage !== "play"
      ? String(guide.text).trim()
      : "";
  const showOpening = Boolean(openingText);

  let title = "继续说";
  let hint = "在底栏输入你的想法。";
  let guideHtml = "";

  if (showOpening) {
    title = guide?.stepName || (moduleOpening ? "按引导先说几句" : "开局");
    hint = moduleOpening
      ? "按下面几点先说几句即可，不必整齐；写完发送后继续产出。"
      : "按下面几点先说几句即可，不必整齐。";
    guideHtml = `<div class="workspace-opening-guide">${esc(openingText)}</div>`;
  } else if (moduleOpening) {
    // 兜底：waiting 已识别为默认问题，但题干缺失
    title = guide?.stepName || "按引导先说几句";
    hint = "想到什么写什么，写完发送即可。";
  } else if (view.phase === "error") {
    title = "说明后重试";
    hint = view.hints?.[0] ?? "说明问题或直接发送继续。";
  } else if (wr?.kind === "intake") {
    const hasUser = hasUserMessages(view);
    title = hasUser ? "继续补充" : "描述你想创作什么";
    hint = hasUser
      ? "继续说细节；信息齐后可确认。"
      : "用几句话说明题材、玩法或爽点即可。";
  } else if (wr?.kind === "revision") {
    title = "说明修改意见";
    hint = "写清楚要改哪里；发送后在现有产物上修改。";
  } else if (wr?.kind === "next_intent") {
    title = "下一步想写什么";
    hint = "说说接下来想做什么；可留空，发送后会展示下一节点供确认。";
  } else if (wr?.kind === "approve_step") {
    title = view.proposedNextStep?.name
      ? `接下来生成 · ${view.proposedNextStep.name}`
      : "确认下一步";
    hint = view.proposedNextStep
      ? proposedOutputCopy(view.proposedNextStep)
      : view.focus?.detail || "确认执行，或在底栏说明意见。";
  } else if (wr?.kind === "input") {
    title = "继续说";
    hint = view.hints?.[0] || wr.message || "直接输入你的想法或补充。";
  } else if (view.uiPrompt && !hasUserMessages(view)) {
    title = "描述你想创作什么";
    hint = String(view.uiPrompt).trim().slice(0, 280);
  }
  const recipe =
    view.selectedRecipe?.name && !hasUserMessages(view)
      ? `<p class="workspace-intent-meta">配方：${esc(view.selectedRecipe.name)}</p>`
      : "";
  const intake =
    wr?.kind === "intake" && view.intake?.fields?.length && hasUserMessages(view)
      ? `<div class="intake-panel">${renderIntakePanel(view.intake, { variant: "feed" })}</div>`
      : "";
  return `<section class="workspace-intent">
    <span class="workspace-surface-kicker">说话</span>
    <h2 class="workspace-intent-title">${esc(title)}</h2>
    <p class="workspace-intent-hint">${esc(hint)}</p>
    ${recipe}
    ${guideHtml}
    ${intake}
  </section>`;
}

function renderAnswerWorkspaceShell() {
  return `<section class="workspace-answer" id="workspace-answer-slot">
    <header class="workspace-answer-head workspace-answer-head--slim">
      <span class="workspace-surface-kicker">答题</span>
      <p class="workspace-answer-hint">点字母选中，文案可改；点卡片展开，点顶条收起。</p>
    </header>
  </section>`;
}

function fillCoordRail(visible, view, handlers) {
  const coordRail = document.getElementById("coord-rail");
  const drawerBody = document.getElementById("coord-drawer-body");
  const drawerCount = document.getElementById("coord-drawer-count");
  if (!coordRail) return;
  const visibleIds = new Set(visible.map((message) => message.id));
  const history = (view.messages ?? []).filter((message) => {
    if (isReviewSidecarQuestionStub(message)) return false;
    return visibleIds.has(message.id) || Boolean(message.contextTrace);
  });
  const traceCount = history.filter((message) => message.contextTrace).length;
  coordRail.hidden = false;
  if (drawerBody) {
    drawerBody.innerHTML = history.length
      ? history
          .map((m) => renderCoordLine(m, view, { traceOnly: !visibleIds.has(m.id) }))
          .join("")
      : `<p class="coord-empty">暂无对话摘要</p>`;
    wireMessageFeedActions(drawerBody, handlers);
    wireMessageContextMenu(drawerBody, handlers);
  }
  if (drawerCount) {
    drawerCount.textContent = history.length ? String(history.length) : "";
    drawerCount.title = traceCount ? `${traceCount} 条保留了完整请求上下文` : "";
  }
  syncCoordRailChrome();
}

function resolveReviewSourceMessage(view) {
  const id = view?.reviewArtifact?.sourceMessageId;
  if (!id) return null;
  const found = (view.messages ?? []).find((m) => m.id === id);
  if (found) return found;
  return {
    id,
    role: "system",
    kind: "worker_output",
    branchIndex: 0,
    branchTotal: 1,
  };
}

function mountReviewWorkspace(stage, view, handlers, opts = {}) {
  if (!stage || !view.reviewArtifact) return;
  stage.hidden = false;
  const askSlot = opts.mountAskCard
    ? `<div class="workspace-review-ask" id="workspace-review-ask" aria-label="基于本产物的追问"></div>`
    : "";
  stage.innerHTML =
    renderReviewWorkspace(view.reviewArtifact, {
      hideAskSidecar: opts.hideAskSidecar === true,
      sourceMessage: resolveReviewSourceMessage(view),
    }) + askSlot;
  wireMessageFeedActions(stage, handlers);
  wireMessageContextMenu(stage, handlers);
  if (opts.mountAskCard) {
    const askHost = document.getElementById("workspace-review-ask");
    if (askHost) ensureQuestionsHostIn(askHost);
  }
}

export function renderMessageFeed(view, loading, handlers = {}) {
  const feed = document.getElementById("message-feed");
  if (!feed) return;

  if (feed.querySelector(".msg.is-editing")) {
    return;
  }

  wireCoordRailChrome();

  const stage = document.getElementById("workspace-stage");
  const panelFeed = document.getElementById("panel-feed");
  const coordRail = document.getElementById("coord-rail");
  const surface = resolveDesignSurface(view, loading);
  const designWorkspace = surface != null;
  const reviewingNow =
    view.waitingReason?.kind === "review_artifact" && Boolean(view.reviewArtifact);

  document.body.classList.toggle("is-reviewing", reviewingNow);
  document.body.classList.toggle("design-workspace", designWorkspace);
  if (reviewingNow) {
    document.body.dataset.reviewKind = reviewComposerCopy(
      view.reviewArtifact?.workerId,
    ).kind;
  } else {
    delete document.body.dataset.reviewKind;
  }
  if (designWorkspace) {
    document.body.dataset.designSurface = surface;
    syncCoordRailChrome();
  } else {
    document.body.classList.remove("coord-rail-collapsed");
    delete document.body.dataset.designSurface;
  }

  const intake =
    view.waitingReason?.kind === "intake" && view.intake?.fields?.length;
  const activeQuestions = getActiveQuestions(view);

  feed.innerHTML = "";
  if (stage) {
    stage.hidden = true;
    stage.innerHTML = "";
  }
  if (coordRail) {
    coordRail.hidden = true;
    const drawerBody = document.getElementById("coord-drawer-body");
    const drawerCount = document.getElementById("coord-drawer-count");
    if (drawerBody) drawerBody.innerHTML = "";
    if (drawerCount) drawerCount.textContent = "";
  }
  // 默认把询问卡停回主列底部槽位
  if (panelFeed) ensureQuestionsHostIn(panelFeed);

  const showIntake = intake && hasUserMessages(view);
  if (showIntake && !designWorkspace) {
    const box = document.createElement("div");
    box.className = "intake-panel";
    box.innerHTML = renderIntakePanel(view.intake, { variant: "feed" });
    feed.appendChild(box);
  }

  const visible = (view.messages ?? []).filter((m) => shouldShowInFeed(m, view));

  // —— 创作伪 0 层：主柱随任务换，历史进右侧 ——
  if (designWorkspace) {
    fillCoordRail(visible, view, handlers);

    if (!stage) return;

    if (surface === "busy" || loading) {
      stage.hidden = false;
      const live = view.liveStream;
      const label = live?.label ?? view.focus?.action ?? "处理中";
      stage.innerHTML = `
        <div class="workspace-pending" id="msg-live-pending">
          <header class="workspace-pending-head">
            <span class="msg-tag">${esc(label)}</span>
            <span class="msg-live-indicator">流式输出中</span>
          </header>
          <div class="msg-body msg-live-body">${renderLiveStreamBody(live, view)}</div>
        </div>`;
      return;
    }

    if (surface === "review" && view.reviewArtifact) {
      const hasHungAsk = Boolean(activeQuestions?.questions?.length);
      mountReviewWorkspace(stage, view, handlers, {
        hideAskSidecar: hasHungAsk,
        mountAskCard: hasHungAsk,
      });
      // 无挂载追问时询问卡停回主列底部；有则已嵌在产物下方
      if (!hasHungAsk && panelFeed) ensureQuestionsHostIn(panelFeed);
      return;
    }

    if (surface === "answer") {
      stage.hidden = false;
      stage.innerHTML = renderAnswerWorkspaceShell();
      const slot = document.getElementById("workspace-answer-slot");
      if (slot) ensureQuestionsHostIn(slot);
      return;
    }

    // speak（含 approve / intake / revision / error）
    stage.hidden = false;
    stage.innerHTML = renderSpeakWorkspace(view);
    if (panelFeed) ensureQuestionsHostIn(panelFeed);
    return;
  }

  // —— 游玩：保持原对话流 ——
  if (!visible.length && !loading) {
    const p = document.createElement("p");
    p.className = "empty";
    if (view.lifecycleStage === "play") {
      p.textContent = "游玩模式：Agent 将按 Worker 集调度，推进世界与叙事。";
    } else if (view.uiPrompt) {
      const recipeLine = view.selectedRecipe?.name
        ? `\n\n已选配方：${view.selectedRecipe.name}`
        : view.recipes?.length
          ? "\n\n（请先在新建作品时选定配方）"
          : "";
      p.textContent = `${view.uiPrompt}${recipeLine}`;
      p.classList.add("empty-intake");
    } else if (view.waitingReason?.kind === "worker_questions") {
      p.textContent = "在下方回答提问。";
    } else if (intake) {
      p.textContent = "在下方描述你想创作什么；Agent 会收成 Worker 集供你验收。";
    } else {
      p.textContent = "在下方继续对话。";
    }
    p.classList.add("empty-intake");
    feed.appendChild(p);
    return;
  }

  for (const msg of visible) {
    const isUser = msg.role === "user";
    const kind = msg.kind ?? (isUser ? "user_input" : "system_info");
    const body = msgBody(msg, view);
    const card = document.createElement("article");
    card.className = `msg ${MSG_CLASS[kind] ?? "system"}${isUser ? " msg-user-row" : " msg-assistant-row"}`;
    card.dataset.messageId = msg.id;
    const rollbackMessageId = getRollbackMessageId(view.messages ?? [], msg.id);
    if (rollbackMessageId) card.dataset.rollbackMessageId = rollbackMessageId;

    const label = msgLabel(msg);
    const subtitle = (msg.title ?? "").trim();
    const showSubtitle =
      !isUser &&
      kind !== "orchestrator_thinking" &&
      subtitle.length > 0 &&
      !label.includes(subtitle) &&
      subtitle !== label;
    const headInner = isUser
      ? `<span class="msg-time">${fmtTime(msg.createdAt)}</span>${renderMsgVariantBadge(msg)}`
      : `<div class="msg-head-main">
          <span class="msg-tag">${esc(label)}</span>
          ${showSubtitle ? `<span class="msg-subtitle">${esc(subtitle)}</span>` : ""}
        </div>
        ${renderMsgVariantBadge(msg)}
        <span class="msg-time">${fmtTime(msg.createdAt)}</span>`;
    const menuTrigger = `<button type="button" class="msg-menu-trigger" data-msg-menu-trigger aria-label="打开这条消息的操作菜单" title="更多操作">⋯</button>`;

    card.dataset.canEdit = canEditMessage(msg) ? "1" : "0";
    card.dataset.hasContext = msg.contextTrace ? "1" : "0";
    card.dataset.originalText = body;

    const questionsActive = kind === "worker_questions" && Boolean(activeQuestions);
    const showThinking =
      !isUser && msg.thinking && view.lifecycleStage === "play";
    const bodyHtml = questionsActive
      ? `<p class="msg-q-index">${esc(body)}</p>`
      : kind === "worker_questions"
        ? formatQuestionsHtml(body)
        : kind === "worker_output"
          ? formatArtifactBodyHtml(body)
          : shouldRenderPlayPresent(msg, view)
            ? formatPlayPresentHtml(body, view)
            : esc(body);

    card.innerHTML = `
      <div class="msg-bubble${questionsActive ? " msg-bubble-index" : ""}">
        ${isUser ? "" : `<header class="msg-head">${headInner}${menuTrigger}</header>`}
        ${showThinking ? renderThinkingBlock(msg.thinking) : ""}
        <div class="msg-body">${bodyHtml}</div>
        ${isUser ? `<footer class="msg-foot">${headInner}${menuTrigger}</footer>` : ""}
      </div>`;
    feed.appendChild(card);
  }

  wireMessageFeedActions(feed, handlers);
  wireMessageContextMenu(feed, handlers);

  if (reviewingNow && view.reviewArtifact && !loading && stage) {
    const hasHungAsk = Boolean(activeQuestions?.questions?.length);
    mountReviewWorkspace(stage, view, handlers, {
      hideAskSidecar: hasHungAsk,
      mountAskCard: hasHungAsk,
    });
  }

  if (loading) {
    const pending = document.createElement("article");
    pending.className = "msg agent msg-assistant-row msg-pending";
    pending.id = "msg-live-pending";
    const live = view.liveStream;
    const label = live?.label ?? view.focus?.action ?? "处理中";
    pending.innerHTML = `
      <div class="msg-bubble">
        <header class="msg-head"><span class="msg-tag">${esc(label)}</span><span class="msg-live-indicator">流式输出中</span></header>
        <div class="msg-body msg-live-body">${renderLiveStreamBody(live, view)}</div>
      </div>`;
    feed.appendChild(pending);
  }

  feed.scrollTop = feed.scrollHeight;
  if (stage && !stage.hidden) stage.scrollTop = 0;
}

/** 轮询时仅更新流式 pending 卡片，避免整页重绘 */
export function updateLiveStreamPanel(view) {
  const pending = document.getElementById("msg-live-pending");
  if (!pending) return;
  const body = pending.querySelector(".msg-live-body");
  if (!body) return;
  const live = view.liveStream;
  const labelEl = pending.querySelector(".msg-tag");
  if (labelEl && live?.label) labelEl.textContent = live.label;
  const next = renderLiveStreamBody(live, view);
  const hadThinking = Boolean(body.querySelector(".msg-live-pre"));
  if (next === "…" && hadThinking) return;
  body.innerHTML = next;
  const pre = body.querySelector(".msg-live-pre:last-of-type");
  if (pre) pre.scrollTop = pre.scrollHeight;
  const feed = document.getElementById("message-feed");
  if (feed && !document.body.classList.contains("design-workspace")) {
    feed.scrollTop = feed.scrollHeight;
  }
}

export function renderBoardPanel(view) {
  const panel = document.getElementById("board-panel");
  if (!panel) return;
  const board = view.boardPanel;
  if (!board) {
    panel.innerHTML = `<p class="empty-sm">尚无黑板条目。Worker 写入 tag 后会出现在这里。</p>`;
    return;
  }

  const tagRow = (row, badge) => `
    <li class="board-tag-item" data-board-tag="${esc(row.tag)}">
      <div class="board-tag-head">
        <code>${esc(row.tag)}</code>
        <span class="board-badge">${badge}</span>
        <button type="button" class="btn-sm board-edit-btn" data-edit-tag="${esc(row.tag)}" title="编辑">改</button>
      </div>
      <div class="board-tag-meta">${esc(row.source)} · ${esc(String(row.updatedAt).slice(0, 19))}</div>
      <div class="board-tag-preview">${esc(row.preview)}</div>
    </li>`;

  const finals = (board.finals ?? []).map((r) => tagRow(r, "定稿")).join("");
  const active = (board.active ?? []).map((r) => tagRow(r, "进行中")).join("");

  panel.innerHTML = `
    <div class="board-section">
      <h4>定稿摘要（给下一 Worker）</h4>
      ${
        board.brief
          ? `<pre class="board-brief">${esc(board.brief)}</pre>`
          : `<p class="empty-sm">验收产物后生成。下一 Worker 会自动读到此处。</p>`
      }
    </div>
    <div class="board-section">
      <h4>终产物 tag ${board.finals?.length ? `(${board.finals.length})` : ""}</h4>
      ${finals ? `<ul class="board-tag-list">${finals}</ul>` : `<p class="empty-sm">暂无</p>`}
    </div>
    <div class="board-section">
      <h4>当前活跃 tag ${board.active?.length ? `(${board.active.length})` : ""}</h4>
      ${active ? `<ul class="board-tag-list">${active}</ul>` : `<p class="empty-sm">暂无</p>`}
    </div>
    ${
      board.archivedCount
        ? `<p class="board-archived">已压缩归档 ${board.archivedCount} 个过程 tag（默认不进入后续 Worker 取数）</p>`
        : ""
    }
  `;

  panel.querySelectorAll("[data-edit-tag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tag = btn.getAttribute("data-edit-tag");
      if (!tag || !view.id) return;
      const current =
        [...(board.finals ?? []), ...(board.active ?? [])].find((r) => r.tag === tag)
          ?.preview ?? "";
      const next = prompt(`编辑黑板「${tag}」\n（完整内容请从导出或后续增强编辑器查看；此处为预览级修改）`, current);
      if (next == null) return;
      void fetch(`/api/sessions/${encodeURIComponent(view.id)}/board`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, content: next }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "写入失败");
          window.dispatchEvent(new CustomEvent("wa:session-updated", { detail: data }));
        })
        .catch((err) => alert(err.message));
    });
  });
}

export function renderWorkspace(view, loading, _onPickSkill, handlers = {}) {
  renderLifecycle(view);
  renderSkillPicker(view);
  // 先铺主柱（可能把询问卡移进答题槽），再渲染卡
  renderMessageFeed(view, loading, handlers);
  const qHost = document.getElementById("questions-card-host");
  if (qHost) {
    renderQuestionsCard(qHost, view, {
      onSkipQuestions: () => handlers.onSkipQuestions?.(),
      onAnswersChange: () => handlers.onQuestionAnswersChange?.(),
      onCardEnter: () => handlers.onQuestionCardEnter?.(),
    });
  }
  renderAgentPanel(view, loading);
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#msg-action-menu")) hideMsgMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideMsgMenu();
});
document.addEventListener("scroll", hideMsgMenu, true);
