import { renderIntakePanel } from "./intake-ui.js";
import { getActiveQuestions, renderQuestionsCard } from "./questions-ui.js";
import { displayWorkerLabel, formatWorkerDisplayTitle } from "./display-labels.js";

const HIDE_KINDS = new Set(["worker_stub"]);

/** 中间对话区不展示的内部调度消息（仅出现在右侧「历史」） */
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
  orchestrator_decision: "导演",
  orchestrator_thinking: "导演 · 思考",
  orchestrator_prompt: "导演",
  orchestrator_assessment: "导演 · 内容评价",
  worker_running: "Worker",
  worker_output: "Worker",
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

function renderLiveStreamBody(live) {
  if (!live) return "…";
  const parts = [];
  if (live.thinking?.trim()) {
    parts.push(
      `<section class="msg-live-section"><header>思考</header><pre class="msg-live-pre">${esc(live.thinking.trim())}</pre></section>`,
    );
  }
  if (live.output?.trim()) {
    parts.push(
      `<section class="msg-live-section"><header>输出</header><pre class="msg-live-pre">${esc(live.output.trim())}</pre></section>`,
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

function renderMsgVariantBadge(msg) {
  const total = msg.branchTotal ?? 1;
  if (total <= 1) return "";
  const index = (msg.branchIndex ?? 0) + 1;
  return `<span class="msg-variant-badge">${index}/${total}</span>`;
}

function hideMsgMenu() {
  const menu = document.getElementById("msg-action-menu");
  if (menu) menu.hidden = true;
  msgMenuState.messageId = null;
}

const msgMenuState = { messageId: null, handlers: null };

function showMsgMenu(card, x, y) {
  const menu = document.getElementById("msg-action-menu");
  if (!menu || !card) return;
  const isReview = card.dataset.review === "1";
  const canEdit = !isReview && card.dataset.canEdit === "1";
  const canDelete = !isReview && Boolean(card.dataset.messageId);
  const hasContext = card.dataset.hasContext === "1";
  const editBtn = document.getElementById("msg-menu-edit");
  const delBtn = document.getElementById("msg-menu-delete");
  const ctxBtn = document.getElementById("msg-menu-context");
  if (editBtn) editBtn.toggleAttribute("hidden", !canEdit);
  if (delBtn) delBtn.toggleAttribute("hidden", !canDelete);
  if (ctxBtn) ctxBtn.toggleAttribute("hidden", !hasContext);
  menu.hidden = false;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  msgMenuState.messageId = card.dataset.messageId ?? null;
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
    hideMsgMenu();
    if (!messageId || !action) return;
    const card = document.querySelector(`[data-message-id="${messageId}"]`);
    const bodyEl = card?.querySelector(".msg-body:not(.msg-body-editing)");
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
    if (action === "delete") {
      if (!confirm("删除此消息及之后的对话？")) return;
      msgMenuState.handlers?.onDeleteMessage?.(messageId);
    }
  });
}

function wireMessageContextMenu(feed, handlers) {
  if (!feed || feed.dataset.contextWired) return;
  feed.dataset.contextWired = "1";
  wireMsgActionMenu(handlers);
  feed.addEventListener("contextmenu", (e) => {
    const bubble = e.target.closest(".msg-bubble");
    const card = e.target.closest("[data-message-id]");
    if (!bubble || !card || card.classList.contains("msg-pending")) return;
    e.preventDefault();
    showMsgMenu(card, e.clientX, e.clientY);
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
  if (!feed || feed.dataset.actionsWired) return;
  feed.dataset.actionsWired = "1";
  feed.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-msg-action]");
    if (!btn || btn.disabled) return;
    const action = btn.getAttribute("data-msg-action");
    const messageId = btn.getAttribute("data-msg-id");
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
      handlers.onEditMessage?.(messageId, next);
      return;
    }

    if (action === "refresh") {
      handlers.onRefreshMessage?.(messageId);
      return;
    }

    if (action === "variant-prev") {
      handlers.onSwitchVariant?.(messageId, "prev");
      return;
    }

    if (action === "variant-next") {
      handlers.onSwitchVariant?.(messageId, "next");
    }
  });
}

function msgBody(msg, view) {
  let body = (msg.body ?? msg.text ?? "").trim();
  if (msg.kind === "worker_questions") {
    if (getActiveQuestions(view)) {
      const qs = view.waitingReason?.questions ?? [];
      const n = Array.isArray(qs) ? qs.length : 0;
      return `提问中 · ${n || "?"} 题（请在下方询问卡作答）`;
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

/** 旧会话 skill 选择提示，新流程不再展示 */
const SKILL_SELECTION_RE = /请选择创作 skill|请选择创作类型/;

/** @deprecated 旧会话可能仍处于 skill_selection；新作品不再展示选包 UI */
export function renderSkillPicker(_view, _onPick) {
  const el = document.getElementById("skill-picker");
  if (!el) return;
  el.hidden = true;
  el.innerHTML = "";
}

let activeAgentTab = "timeline";
let lastAutoTabReason = null;
let userPinnedAgentTab = false;

export function setAgentTab(tab, { user = false } = {}) {
  activeAgentTab = tab;
  if (user) userPinnedAgentTab = true;
  const tabs = document.getElementById("agent-tabs");
  tabs?.querySelectorAll(".agent-tab").forEach((btn) => {
    const id = btn.getAttribute("data-tab");
    const active = id === tab && !btn.hidden;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  for (const id of ["timeline", "review", "progress", "board"]) {
    const panel = document.getElementById(`agent-panel-${id}`);
    panel?.classList.toggle("active", tab === id);
    panel?.toggleAttribute("hidden", tab !== id);
  }
}

function wireAgentTabs() {
  const tabs = document.getElementById("agent-tabs");
  if (!tabs || tabs.dataset.wired) return;
  tabs.dataset.wired = "1";
  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".agent-tab");
    if (!btn || btn.hidden) return;
    setAgentTab(btn.getAttribute("data-tab") ?? "timeline", { user: true });
  });
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

function shouldShowInFeed(msg, view) {
  if (msg.role === "user") return true;
  const kind = msg.kind ?? "system_info";
  if (HIDE_KINDS.has(kind)) return false;
  if (FEED_HIDDEN_KINDS.has(kind)) return false;
  if (msg.compressed) return false;
  if (isSkillSelectionMessage(msg)) return false;
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
  if (kind === "orchestrator_prompt") return false;
  return true;
}

function maybeAutoSwitchTab(view) {
  const reason = view.waitingReason?.kind ?? null;
  // 创作验收改在主对话展示，不再自动跳到侧栏「验收」Tab
  if (reason === "review_artifact") {
    if (lastAutoTabReason !== "review_artifact" && activeAgentTab === "review") {
      setAgentTab("timeline");
    }
  } else if (!userPinnedAgentTab && reason === "worker_questions") {
    if (lastAutoTabReason !== "worker_questions" && activeAgentTab === "review") {
      setAgentTab("timeline");
    }
  }
  lastAutoTabReason = reason;
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

export function renderSkillGuide(view) {
  wireAgentTabs();
  const progressTabBtn = document.getElementById("agent-tab-btn-progress");
  const list = document.getElementById("skill-guide-list");
  const workerPanel = document.getElementById("worker-set-user-panel");
  if (!list) return;

  const hasCatalog =
    view.lifecycleStage === "design" && (view.skillCatalog?.length ?? 0) > 0;
  const hasWorkerView = Boolean(
    view.workerSetView?.workers?.length || view.workerSetView?.contextTags?.length,
  );
  const hasFlowView = Boolean(view.creationFlowView?.steps?.length);
  const show = hasCatalog || hasWorkerView || hasFlowView;

  if (progressTabBtn) {
    progressTabBtn.hidden = !show;
  }

  if (workerPanel) {
    const parts = [];
    if (hasFlowView && view.lifecycleStage === "design") {
      parts.push(renderCreationFlowView(view.creationFlowView));
    }
    if (hasWorkerView && view.lifecycleStage === "design") {
      parts.push(renderWorkerSetUserView(view.workerSetView, { compact: true }));
    }
    workerPanel.innerHTML = parts.join("");
    workerPanel.hidden = !workerPanel.innerHTML;
  }

  if (!show) {
    list.innerHTML = "";
    if (activeAgentTab === "progress") setAgentTab("timeline");
    return;
  }

  list.innerHTML = (view.skillCatalog ?? [])
    .map(
      (s) => `
    <div class="skill-guide-item ${s.status}">
      <span class="skill-guide-dot"></span>
      <div>
        <div class="skill-guide-label">${esc(s.label)} <code>${esc(s.id)}</code>${s.runCount && s.runCount > 1 ? ` <span class="skill-guide-runs">×${s.runCount}</span>` : ""}</div>
        <div class="skill-guide-purpose">${esc(s.purpose)}</div>
      </div>
    </div>`,
    )
    .join("");
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
      ? `<pre class="ws-focus-body-text">${esc(t)}</pre>`
      : `<p class="ws-muted">（本块尚无正文，请在下方对话中补充）</p>`;
  }
  try {
    const pretty = JSON.stringify(body, null, 2);
    return `<pre class="json-pretty ws-focus-body-json" tabindex="0"><code>${highlightJson(pretty)}</code></pre>`;
  } catch {
    return `<pre class="ws-focus-body-text">${esc(String(body))}</pre>`;
  }
}

function renderFocusUnitBanner(focusUnit) {
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
  const hint = isContext
    ? "请重点审阅高亮区：这是本次要写入 / 验收的上下文正文。"
    : focusUnit.kind === "worker"
      ? "请重点审阅当前 Worker 规格；展示名应使用中文。"
      : "请重点审阅当前创作单位。";
  const bodyHtml = isContext || focusUnit.kind === "phase"
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

  // 当前单位横幅：填充上下文时高亮正文；创造 worker 时标明焦点
  const focusBanner = renderFocusUnitBanner(focusUnit);
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
      `<section class="ws-section"><h4>核心 Worker</h4><p><code>${esc(userView.coreWorker)}</code> — 负责推剧情并产出本轮实质内容</p></section>`,
    );
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

/** 尝试把正文美化为缩进 JSON；失败则原样 pre */
function formatArtifactBodyHtml(body) {
  const trimmed = (body || "").trim();
  if (!trimmed) {
    return `<p class="empty-sm">（无正文）</p>`;
  }

  const tryParse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  let parsed = tryParse(trimmed);
  if (!parsed) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = tryParse(trimmed.slice(start, end + 1));
    }
  }
  if (!parsed) {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start >= 0 && end > start) {
      parsed = tryParse(trimmed.slice(start, end + 1));
    }
  }

  if (parsed != null && typeof parsed === "object") {
    const pretty = JSON.stringify(parsed, null, 2);
    return `<pre class="json-pretty" tabindex="0"><code>${highlightJson(pretty)}</code></pre>`;
  }

  return `<pre class="review-feed-plain">${esc(trimmed)}</pre>`;
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
      <p class="review-parse-error-hint">需要 JSON：steps 数组，每步含 name（与可选 id）与 depends_on；可含 status=open|closed。</p>
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
      return `<li class="flow-step">
        <span class="flow-order">${esc(String(s.order))}</span>
        <span class="flow-name">${nameLabel}${occ}</span>
        <span class="flow-deps">依赖：${deps}</span>
      </li>`;
    })
    .join("");

  return `<section class="ws-section ws-creation-flow">
    <h4>创作流程</h4>
    ${brief}
    ${statusHtml}
    <ol class="flow-steps">${rows}</ol>
  </section>`;
}

function renderReviewFeedCard(review) {
  const flowHtml = review.creationFlowView
    ? renderCreationFlowView(review.creationFlowView)
    : "";
  const structured = !flowHtml && review.workerSetView
    ? renderWorkerSetUserView(review.workerSetView)
    : "";
  const jsonHtml = formatArtifactBodyHtml(review.body);
  const contextId = review.sourceMessageId || review.id || "";
  const hasContext = review.contextTrace ? "1" : "0";
  const structuredBlock = flowHtml || structured;

  return `
    <article class="msg msg-assistant-row msg-review" data-review="1" data-message-id="${esc(contextId)}" data-can-edit="0" data-has-context="${hasContext}">
      <div class="msg-bubble msg-review-bubble">
        <header class="msg-head">
          <div class="msg-head-main">
            <span class="msg-tag">待验收</span>
            <span class="msg-subtitle">${esc(displayWorkerLabel(review.workerId) || "产物")}</span>
          </div>
        </header>
        ${review.summary ? `<p class="review-feed-summary">${esc(review.summary)}</p>` : ""}
        <p class="review-hint">接受后：本单位过程讨论会折叠，产物进入前情。确认请用底栏「接受目前产物」；要改则在底栏输入修改意见后发送。</p>
        ${structuredBlock ? `<div class="review-worker-set">${structuredBlock}</div>` : ""}
        <section class="review-json-block">
          <h4 class="review-json-title">${structuredBlock ? "规格 JSON" : "产物正文"}</h4>
          ${jsonHtml}
        </section>
      </div>
    </article>`;
}

/** 侧栏验收 Tab 已弃用：验收改在主对话；此处仅隐藏 Tab */
export function renderReviewPanel(view, _handlers = {}) {
  const tabBtn = document.getElementById("agent-tab-btn-review");
  const panel = document.getElementById("review-artifact-panel");
  if (!tabBtn || !panel) return;
  tabBtn.hidden = true;
  panel.innerHTML = "";
  if (activeAgentTab === "review") setAgentTab("timeline");
}

export function renderAgentPanel(view, loading) {
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
    badgeEl.textContent = `burst ${view.burst.count}/${view.burst.max}`;
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

export function renderMessageFeed(view, loading, handlers = {}) {
  const feed = document.getElementById("message-feed");
  if (!feed) return;

  if (feed.querySelector(".msg.is-editing")) {
    return;
  }

  const intake =
    view.waitingReason?.kind === "intake" && view.intake?.fields?.length;
  const showIntakePanel = intake && hasUserMessages(view);

  feed.innerHTML = "";

  if (showIntakePanel) {
    const box = document.createElement("div");
    box.className = "intake-panel";
    box.innerHTML = renderIntakePanel(view.intake, { variant: "feed" });
    feed.appendChild(box);
  }

  const visible = (view.messages ?? []).filter((m) => shouldShowInFeed(m, view));

  if (!visible.length && !loading) {
    const reviewing =
      view.waitingReason?.kind === "review_artifact" && view.reviewArtifact;
    if (!reviewing) {
      const p = document.createElement("p");
      p.className = "empty";
      if (view.lifecycleStage === "play") {
        p.textContent = "游玩模式：Agent 将按 Worker 集调度，推进世界与叙事。";
      } else if (view.uiPrompt) {
        const recipeLine = view.selectedRecipe?.name
          ? `\n\n已选导演：${view.selectedRecipe.name}`
          : view.recipes?.length
            ? "\n\n（请先在新建作品时选定导演）"
            : "";
        p.textContent = `${view.uiPrompt}${recipeLine}`;
        p.classList.add("empty-intake");
      } else if (view.waitingReason?.kind === "worker_questions") {
        p.textContent = "在下方回答 Skill 的提问。";
      } else if (intake) {
        p.textContent = "在下方描述你想创作什么；Agent 会收成 Worker 集供你验收。";
      } else {
        p.textContent = "在下方继续对话。";
      }
      p.classList.add("empty-intake");
      feed.appendChild(p);
      return;
    }
  }

  for (const msg of visible) {
    const isUser = msg.role === "user";
    const kind = msg.kind ?? (isUser ? "user_input" : "system_info");
    const body = msgBody(msg, view);
    const card = document.createElement("article");
    card.className = `msg ${MSG_CLASS[kind] ?? "system"}${isUser ? " msg-user-row" : " msg-assistant-row"}`;
    card.dataset.messageId = msg.id;

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

    card.dataset.canEdit = canEditMessage(msg) ? "1" : "0";
    card.dataset.hasContext = msg.contextTrace ? "1" : "0";
    card.dataset.originalText = body;

    card.innerHTML = `
      <div class="msg-bubble">
        ${!isUser && kind === "worker_questions" ? `<div class="msg-questions-banner">需要你回答</div>` : ""}
        ${isUser ? "" : `<header class="msg-head">${headInner}</header>`}
        ${!isUser && msg.thinking ? renderThinkingBlock(msg.thinking) : ""}
        <div class="msg-body">${kind === "worker_questions" ? formatQuestionsHtml(body) : esc(body)}</div>
        ${isUser ? `<footer class="msg-foot">${headInner}</footer>` : ""}
      </div>`;
    feed.appendChild(card);
  }

  wireMessageFeedActions(feed, handlers);
  wireMessageContextMenu(feed, handlers);

  if (
    view.waitingReason?.kind === "review_artifact" &&
    view.reviewArtifact &&
    !loading
  ) {
    const wrap = document.createElement("div");
    wrap.innerHTML = renderReviewFeedCard(view.reviewArtifact);
    const card = wrap.firstElementChild;
    if (card) feed.appendChild(card);
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
        <div class="msg-body msg-live-body">${renderLiveStreamBody(live)}</div>
      </div>`;
    feed.appendChild(pending);
  }

  feed.scrollTop = feed.scrollHeight;
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
  body.innerHTML = renderLiveStreamBody(live);
  const feed = document.getElementById("message-feed");
  if (feed) feed.scrollTop = feed.scrollHeight;
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
  maybeAutoSwitchTab(view);
  const qHost = document.getElementById("questions-card-host");
  if (qHost) {
    renderQuestionsCard(qHost, view, {
      onSkipQuestions: () => handlers.onSkipQuestions?.(),
    });
  }
  renderMessageFeed(view, loading, handlers);
  renderSkillGuide(view);
  renderReviewPanel(view, handlers);
  renderBoardPanel(view);
  renderAgentPanel(view, loading);
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#msg-action-menu")) hideMsgMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideMsgMenu();
});
document.addEventListener("scroll", hideMsgMenu, true);
