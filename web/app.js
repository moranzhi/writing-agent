import { renderWorkspace } from "./agent-ui.js";
import { downloadMarkdown, sessionToMarkdown } from "./export.js";
import { renderIntakePanel } from "./intake-ui.js";

let sessionId = null;
let activeBookId = null;
let lastView = null;
let books = [];
let composerForceInput = false;

const $ = (id) => document.getElementById(id);

const PHASE = { idle: "待命", running: "执行中", waiting_user: "等待你", done: "已完成", error: "出错" };
const REASON = {
  skill_selection: "选择 skill",
  intake: "填写需求",
  input: "补充说明",
  worker_questions: "回答提问",
  approve_step: "确认执行",
  review_artifact: "验收产物",
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function statusFor(view, loading) {
  if (loading) return { cls: "running", text: "处理中…" };
  if (view.phase === "done") return { cls: "done", text: "已完成" };
  if (view.phase === "running" && !view.waitingReason) {
    return { cls: "running", text: view.focus?.action ?? "Agent 运行中" };
  }
  if (view.waitingReason) {
    return { cls: "waiting", text: REASON[view.waitingReason.kind] ?? view.waitingReason.kind };
  }
  return { cls: "", text: PHASE[view.phase] ?? view.phase };
}

function isAgentBusy(view, loading) {
  if (loading) return true;
  return view.phase === "running" && !view.waitingReason;
}

function resolveComposer(view, loading) {
  if (view.phase === "done") return { mode: "idle", text: "会话已结束" };
  if (isAgentBusy(view, loading)) {
    return { mode: "waiting", text: view.focus?.action ?? "Agent 或 Skill 执行中…" };
  }

  const confirmIntake = view.actions?.find((a) => a.type === "confirm_intake");
  if (view.waitingReason?.kind === "intake" && view.intake) {
    const send = view.actions?.find((a) => a.type === "send_message");
    return {
      mode: view.intake.ready && confirmIntake ? "intake_ready" : "intake",
      intake: view.intake,
      intakePrompt: view.intakePrompt,
      confirmIntake,
      placeholder: send?.placeholder ?? "补充信息…",
    };
  }

  const approve = view.actions?.find((a) => a.type === "approve");
  const accept = view.actions?.find((a) => a.type === "accept");
  if ((approve || accept) && !composerForceInput) {
    return {
      mode: "action",
      primary: approve ?? accept,
      primaryType: approve ? "approve" : "accept",
      hint: approve ? view.focus?.detail : "验收 Skill 产出",
      showReject: true,
    };
  }

  const send = view.actions?.find((a) => a.type === "send_message");
  if (
    send ||
    view.waitingReason?.kind === "input" ||
    view.waitingReason?.kind === "skill_selection" ||
    view.waitingReason?.kind === "worker_questions" ||
    composerForceInput
  ) {
    let hint = view.hints?.[0] ?? null;
    if (view.waitingReason?.kind === "skill_selection") {
      hint = "选择 skill 包，或输入名称 / 编号";
    }
    return { mode: "input", placeholder: send?.placeholder ?? "输入消息…", hint };
  }

  const finish = view.actions?.find((a) => a.type === "finish");
  if (finish) {
    return { mode: "action", primary: finish, primaryType: "finish", hint: null, showReject: false };
  }

  return { mode: "idle", text: "暂无可用操作" };
}

function renderComposer(view, loading) {
  const root = $("composer");
  if (!root) return;
  const spec = resolveComposer(view, loading);

  if (spec.mode === "waiting") {
    root.innerHTML = `<div class="composer-waiting">${esc(spec.text)}</div>`;
    return;
  }
  if (spec.mode === "idle") {
    root.innerHTML = `<div class="composer-idle">${esc(spec.text)}</div>`;
    return;
  }

  if (spec.mode === "intake" || spec.mode === "intake_ready") {
    const confirm =
      spec.mode === "intake_ready" && spec.confirmIntake
        ? `<div class="composer-actions"><button type="button" class="btn btn-primary" data-act="confirm_intake">${esc(spec.confirmIntake.label)}</button></div>`
        : "";
    root.innerHTML = `
      ${spec.intakePrompt ? `<p class="composer-hint">${esc(spec.intakePrompt)}</p>` : ""}
      <div class="intake-panel">${renderIntakePanel(spec.intake, { variant: "composer" })}</div>
      ${confirm}
      <form class="composer-form" id="composer-form">
        <textarea id="composer-input" rows="2" placeholder="${esc(spec.placeholder)}"></textarea>
        <button type="submit" class="btn btn-primary">发送</button>
      </form>`;
    wireComposerForm();
    root.querySelector("[data-act=confirm_intake]")?.addEventListener("click", () => runAction("confirm_intake"));
    return;
  }

  if (spec.mode === "action") {
    const reject = spec.showReject
      ? `<button type="button" class="btn" data-act="reject">${spec.primaryType === "approve" ? "暂不" : "重新来"}</button>
         <button type="button" class="btn" data-act="force-input">说明意见</button>`
      : "";
    root.innerHTML = `
      ${spec.hint ? `<p class="composer-hint">${esc(spec.hint)}</p>` : ""}
      <div class="composer-actions">
        <button type="button" class="btn btn-primary" data-act="${esc(spec.primaryType)}">${esc(spec.primary.label)}</button>
        ${reject}
      </div>`;
    root.querySelector(`[data-act="${spec.primaryType}"]`)?.addEventListener("click", () => runAction(spec.primaryType));
    root.querySelector("[data-act=reject]")?.addEventListener("click", () => runAction("reject"));
    root.querySelector("[data-act=force-input]")?.addEventListener("click", () => {
      composerForceInput = true;
      renderComposer(view, loading);
    });
    return;
  }

  root.innerHTML = `
    ${spec.hint ? `<p class="composer-hint">${esc(spec.hint)}</p>` : ""}
    <form class="composer-form" id="composer-form">
      <textarea id="composer-input" rows="2" placeholder="${esc(spec.placeholder)}"></textarea>
      <button type="submit" class="btn btn-primary">发送</button>
    </form>`;
  wireComposerForm();
}

function wireComposerForm() {
  const form = $("composer-form");
  const input = $("composer-input");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await sendText(input?.value ?? "");
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form?.requestSubmit();
    }
  });
  input?.focus();
}

function renderBookList() {
  const list = $("book-list");
  if (!list) return;
  if (!books.length) {
    list.innerHTML = `<p class="sidebar-empty">暂无作品<br><button type="button" class="btn-sm" id="btn-new-inline">+ 新建</button></p>`;
    $("btn-new-inline")?.addEventListener("click", openNewBookDialog);
    return;
  }
  list.innerHTML = "";
  for (const book of books) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `book-item${book.id === activeBookId ? " active" : ""}`;
    const skill = book.activeSkillName ?? book.activeSkillId ?? book.orchestratorName ?? "未选 skill";
    btn.innerHTML = `
      <div class="book-item-title">${esc(book.title)}</div>
      <div class="book-item-sub">${esc(skill)} · ${esc(book.preview?.slice(0, 40) || "")}</div>`;
    btn.addEventListener("click", () => openBook(book.id));
    list.appendChild(btn);
  }
}

function renderHeader(view, loading) {
  const st = statusFor(view, loading);
  $("work-title").textContent = view.bookTitle ?? "未命名作品";
  const skill = view.activeSkill ?? "未选 skill";
  const phase = view.waitingReason
    ? REASON[view.waitingReason.kind] ?? view.phase
    : PHASE[view.phase] ?? view.phase;
  $("work-meta").textContent = `${skill} · ${phase}`;
  $("status-dot").className = `status-dot ${st.cls}`;
  $("status-text").textContent = st.text;
  $("btn-delete").hidden = !view.bookId;
  $("btn-saves").hidden = !view.bookId;
  $("btn-export").disabled = !(view.messages?.length);
}

function renderEmpty() {
  sessionId = null;
  lastView = null;
  activeBookId = null;
  composerForceInput = false;
  $("work-title").textContent = "未打开作品";
  $("work-meta").textContent = "";
  $("status-dot").className = "status-dot";
  $("status-text").textContent = "—";
  $("btn-delete").hidden = true;
  $("btn-saves").hidden = true;
  $("btn-export").disabled = true;
  $("message-feed").innerHTML = `<p class="empty">点击左侧 + 新建作品</p>`;
  $("skill-picker").hidden = true;
  $("skill-guide").hidden = true;
  $("agent-focus").innerHTML = "";
  $("agent-timeline").innerHTML = "";
  $("tool-trace").hidden = true;
  document.body.dataset.lifecycle = "design";
  $("composer").innerHTML = `<div class="composer-idle">暂无打开的作品</div>`;
  renderBookList();
}

function renderSession(view, loading = false) {
  lastView = view;
  sessionId = view.id;
  activeBookId = view.bookId ?? activeBookId;
  if (!loading && !["approve_step", "review_artifact"].includes(view.waitingReason?.kind)) {
    composerForceInput = false;
  }
  renderHeader(view, loading);
  renderBookList();
  renderWorkspace(view, loading, (skillId) => sendText(skillId));
  renderComposer(view, loading);
}

async function sendText(text) {
  const trimmed = text?.trim();
  if (!trimmed || !sessionId) return;
  try {
    renderSession(lastView, true);
    const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: trimmed }),
    });
    renderSession(view, false);
  } catch (err) {
    if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
  }
}

async function runAction(action) {
  if (!sessionId) return;
  try {
    renderSession(lastView, true);
    const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/actions`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    renderSession(view, false);
  } catch (err) {
    if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
  }
}

async function setLifecycle(stage) {
  if (!sessionId || stage === lastView?.lifecycleStage) return;
  if (stage === "play" && !lastView?.playReady) return;
  try {
    const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/lifecycle`, {
      method: "POST",
      body: JSON.stringify({ stage }),
    });
    renderSession(view, false);
  } catch (err) {
    if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
  }
}

async function loadBooks() {
  const data = await api("/api/books");
  books = data.books ?? [];
  renderBookList();
}

function openNewBookDialog() {
  $("input-book-title").value = "";
  $("dialog-new-book").showModal();
  $("input-book-title").focus();
}

async function createBook() {
  const title = $("input-book-title").value.trim() || "未命名作品";
  $("btn-create-book").disabled = true;
  try {
    const data = await api("/api/books", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    $("dialog-new-book").close();
    if (data.book) books.unshift(data.book);
    activeBookId = data.book?.id;
    renderSession(data.session, false);
  } catch (err) {
    alert(err.message);
  } finally {
    $("btn-create-book").disabled = false;
  }
}

async function openBook(bookId) {
  activeBookId = bookId;
  renderBookList();
  if (lastView) renderSession(lastView, true);
  try {
    const data = await api(`/api/books/${encodeURIComponent(bookId)}/open`, { method: "POST" });
    if (data.book) {
      const i = books.findIndex((b) => b.id === bookId);
      if (i >= 0) books[i] = { ...books[i], ...data.book };
    }
    renderSession(data.session, false);
  } catch (err) {
    if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
  }
}

async function deleteBook() {
  if (!activeBookId || !lastView?.bookTitle) return;
  if (!confirm(`删除「${lastView.bookTitle}」？不可恢复。`)) return;
  try {
    await api(`/api/books/${encodeURIComponent(activeBookId)}`, { method: "DELETE" });
    books = books.filter((b) => b.id !== activeBookId);
    if (books.length) await openBook(books[0].id);
    else renderEmpty();
  } catch (err) {
    alert(err.message);
  }
}

function exportSession() {
  if (!lastView) return;
  const name = (lastView.bookTitle ?? "session").replace(/[\\/:*?"<>|]/g, "_");
  downloadMarkdown(`${name}.md`, sessionToMarkdown(lastView));
}

async function refreshSaves() {
  if (!activeBookId) return;
  const data = await api(`/api/books/${encodeURIComponent(activeBookId)}/saves`);
  const list = $("saves-list");
  const saves = data.saves ?? [];
  if (!saves.length) {
    list.innerHTML = `<p class="timeline-empty">暂无存档</p>`;
    return;
  }
  list.innerHTML = saves
    .map(
      (s) => `
    <div class="save-row" data-id="${esc(s.id)}">
      <span>${esc(s.label)} <small style="color:var(--muted)">${esc(s.kind)}</small></span>
      <span>
        <button type="button" class="btn-sm" data-load="${esc(s.id)}">读档</button>
        <button type="button" class="btn-sm btn-danger" data-del="${esc(s.id)}">删</button>
      </span>
    </div>`,
    )
    .join("");
  list.querySelectorAll("[data-load]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const data = await api(
          `/api/books/${encodeURIComponent(activeBookId)}/saves/${encodeURIComponent(btn.getAttribute("data-load"))}/load`,
          { method: "POST" },
        );
        $("dialog-saves").close();
        renderSession(data.session, false);
      } catch (err) {
        alert(err.message);
      }
    });
  });
  list.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("删除此存档？")) return;
      await api(
        `/api/books/${encodeURIComponent(activeBookId)}/saves/${encodeURIComponent(btn.getAttribute("data-del"))}`,
        { method: "DELETE" },
      );
      refreshSaves();
    });
  });
}

async function createSave() {
  const label = $("input-save-label").value.trim();
  const kind = document.querySelector('input[name="save-kind"]:checked')?.value ?? "run";
  if (!label) return alert("请输入名称");
  try {
    await api(`/api/books/${encodeURIComponent(activeBookId)}/saves`, {
      method: "POST",
      body: JSON.stringify({ label, kind, sessionId }),
    });
    $("input-save-label").value = "";
    refreshSaves();
  } catch (err) {
    alert(err.message);
  }
}

$("btn-new-book")?.addEventListener("click", openNewBookDialog);
$("btn-new-inline")?.addEventListener("click", openNewBookDialog);
$("btn-cancel-new")?.addEventListener("click", () => $("dialog-new-book").close());
$("form-new-book")?.addEventListener("submit", (e) => {
  e.preventDefault();
  createBook();
});
$("lifecycle-toggle")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-stage]");
  if (!btn?.disabled) setLifecycle(btn.getAttribute("data-stage"));
});
$("btn-delete")?.addEventListener("click", deleteBook);
$("btn-export")?.addEventListener("click", exportSession);
$("btn-saves")?.addEventListener("click", () => {
  $("dialog-saves").showModal();
  refreshSaves();
});
$("btn-close-saves")?.addEventListener("click", () => $("dialog-saves").close());
$("btn-save-create")?.addEventListener("click", createSave);

async function init() {
  try {
    await loadBooks();
    if (books.length) await openBook(books[0].id);
    else renderEmpty();
  } catch {
    $("status-text").textContent = "加载失败";
  }
}

init();
