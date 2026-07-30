import { renderWorkspace, updateLiveStreamPanel } from "./agent-ui.js";
import { downloadMarkdown, sessionToMarkdown } from "./export.js";
import { renderIntakePanel } from "./intake-ui.js";
import { displaySkillPackLabel } from "./display-labels.js";
import {
  clearQuestionCardState,
  collectQuestionAnswers,
  getActiveQuestions,
  renderQuestionsCard,
} from "./questions-ui.js";

let sessionId = null;
let activeBookId = null;
let lastView = null;
let books = [];
let composerForceInput = false;
let sidebarNav = { level: "root" };
let bookSelectMode = false;
let selectedBookIds = new Set();
const playSavesByBook = new Map();
const playSavesLoading = new Set();
let bookMenuBookId = null;
let livePollTimer = null;

const LIVE_POLL_MS = 280;

const $ = (id) => document.getElementById(id);

const PHASE = { idle: "待命", running: "执行中", waiting_user: "等待你", done: "已完成", error: "出错" };
const REASON = {
  skill_selection: "选择配方",
  intake: "补充信息",
  input: "等待输入",
  approve_step: "确认执行",
  review_artifact: "验收产物",
  worker_questions: "回答提问",
  revision: "按反馈修改",
};

/** @type {{ id: string, name: string, description: string }[]} */
let directors = [];

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
    return { cls: "running", text: view.focus?.action ?? "总管运行中" };
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
  if (view.phase === "error") {
    const send = view.actions?.find((a) => a.type === "send_message");
    return {
      mode: "input",
      placeholder: send?.placeholder ?? "说明后重试，或直接发送继续…",
      hint: view.hints?.[0] ?? "执行出错，可在下方重试",
    };
  }
  if (isAgentBusy(view, loading)) {
    return { mode: "waiting", text: view.focus?.action ?? "总管或 Worker 执行中…" };
  }

  const confirmIntake = view.actions?.find((a) => a.type === "confirm_intake");
  if (view.waitingReason?.kind === "intake" && view.intake) {
    const hasUser = (view.messages ?? []).some((m) => m.role === "user");
    const send = view.actions?.find((a) => a.type === "send_message");
    return {
      mode: view.intake.ready && confirmIntake ? "intake_ready" : "intake",
      intake: view.intake,
      intakePrompt: hasUser ? view.intakePrompt : null,
      showIntakePanel: hasUser,
      confirmIntake,
      placeholder: send?.placeholder ?? "描述你想创作什么…",
    };
  }

  const approve = view.actions?.find((a) => a.type === "approve");
  const accept = view.actions?.find((a) => a.type === "accept");
  if (approve && !composerForceInput) {
    return {
      mode: "action",
      primary: approve,
      primaryType: "approve",
      hint: view.focus?.detail,
      showReject: true,
    };
  }
  if (accept && view.waitingReason?.kind !== "review_artifact" && !composerForceInput) {
    return {
      mode: "action",
      primary: accept,
      primaryType: "accept",
      hint: "验收产物",
      showReject: true,
    };
  }

  const send = view.actions?.find((a) => a.type === "send_message");
  const hasQuestionsCard =
    (view.waitingReason?.kind === "worker_questions" &&
      view.waitingReason?.questions?.length) ||
    (view.waitingReason?.kind === "input" &&
      view.waitingReason?.questions?.length) ||
    (view.waitingReason?.kind === "review_artifact" &&
      view.waitingReason?.questions?.length);

  if (view.waitingReason?.kind === "review_artifact") {
    const parseBroken = Boolean(view.reviewArtifact?.workerSetView?.parseError);
    return {
      mode: "input",
      placeholder: send?.placeholder ?? "输入修改意见后发送…",
      hint: hasQuestionsCard
        ? "接受产物即收起追问（表示无需再完善）"
        : null,
      acceptAction: accept
        ? {
            label: accept.label || "接受目前产物",
            disabled: parseBroken,
            disabledTitle: parseBroken
              ? "规格解析失败，请先发送修改意见让 Worker 重写"
              : undefined,
          }
        : null,
    };
  }

  if (hasQuestionsCard && !composerForceInput) {
    return {
      mode: "input",
      placeholder: send?.placeholder ?? "也可在此自由补充…",
      hint: null,
    };
  }

  if (
    send ||
    view.waitingReason?.kind === "input" ||
    view.waitingReason?.kind === "worker_questions" ||
    composerForceInput
  ) {
    const wr = view.waitingReason;
    if (wr?.kind === "worker_questions" && !hasQuestionsCard) {
      return {
        mode: "input",
        placeholder: "在此直接回答上面的问题…",
        hint: null,
      };
    }
    const hint = view.hints?.[0] ?? null;
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
    const intakePanel =
      spec.showIntakePanel
        ? `<div class="intake-panel">${renderIntakePanel(spec.intake, { variant: "composer" })}</div>`
        : "";
    const confirm =
      spec.mode === "intake_ready" && spec.confirmIntake
        ? `<div class="composer-actions"><button type="button" class="btn btn-primary" data-act="confirm_intake">${esc(spec.confirmIntake.label)}</button></div>`
        : "";
    root.innerHTML = `
      ${spec.intakePrompt ? `<p class="composer-hint">${esc(spec.intakePrompt)}</p>` : ""}
      ${intakePanel}
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

  const acceptBtn = spec.acceptAction
    ? `<button type="button" class="btn btn-primary" data-act="accept" ${
        spec.acceptAction.disabled
          ? `disabled title="${esc(spec.acceptAction.disabledTitle || "暂不可接受")}"`
          : ""
      }>${esc(spec.acceptAction.label)}</button>`
    : "";
  root.innerHTML = `
    ${spec.askBanner
      ? `<div class="composer-ask-banner"><strong>${esc(spec.askBanner.title)}</strong>${esc(spec.askBanner.body)}</div>`
      : ""}
    ${spec.hint ? `<p class="composer-hint">${esc(spec.hint)}</p>` : ""}
    <form class="composer-form" id="composer-form">
      <textarea id="composer-input" rows="2" placeholder="${esc(spec.placeholder)}"></textarea>
      <button type="submit" class="btn${spec.acceptAction ? "" : " btn-primary"}">发送</button>
      ${acceptBtn}
    </form>`;
  wireComposerForm();
  root.querySelector("[data-act=accept]")?.addEventListener("click", () => runAction("accept"));
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

function bookPlayReady(bookId) {
  return lastView?.bookId === bookId && Boolean(lastView?.playReady);
}

async function fetchPlaySavesForBook(bookId, force = false) {
  if (!force && (playSavesByBook.has(bookId) || playSavesLoading.has(bookId))) return;
  playSavesLoading.add(bookId);
  renderBookList();
  try {
    const data = await api(`/api/books/${encodeURIComponent(bookId)}/saves`);
    playSavesByBook.set(bookId, data.saves ?? []);
  } catch {
    playSavesByBook.set(bookId, []);
  } finally {
    playSavesLoading.delete(bookId);
    renderBookList();
  }
}

function setBookSelectMode(on, { keepSelection = false } = {}) {
  bookSelectMode = on;
  if (!on) selectedBookIds = new Set();
  else if (!keepSelection) selectedBookIds = new Set();
  renderBookList();
}

function toggleBookSelection(bookId) {
  if (!bookSelectMode) setBookSelectMode(true, { keepSelection: true });
  if (selectedBookIds.has(bookId)) selectedBookIds.delete(bookId);
  else selectedBookIds.add(bookId);
  renderBookList();
}

function hideBookMenu() {
  const menu = $("book-action-menu");
  if (menu) menu.hidden = true;
  bookMenuBookId = null;
}

function refreshBookMenuLabels() {
  const n = selectedBookIds.size;
  const multi = bookSelectMode && n > 0;
  $("book-menu-open")?.toggleAttribute("hidden", multi);
  $("book-menu-rename")?.toggleAttribute("hidden", n !== 1);
  const dup = $("book-menu-duplicate");
  if (dup) dup.textContent = n > 1 ? `复制 ${n} 项备份` : "复制备份";
  const del = $("book-menu-delete");
  if (del) del.textContent = n > 1 ? `删除 ${n} 项` : "删除";
  const sel = $("book-menu-select");
  if (sel) sel.textContent = bookSelectMode ? "取消多选" : "多选";
}

function showBookMenu(bookId, x, y) {
  const menu = $("book-action-menu");
  if (!menu) return;
  bookMenuBookId = bookId;
  refreshBookMenuLabels();
  menu.hidden = false;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`;
  }
}

function getNavBook() {
  if (sidebarNav.level !== "book") return null;
  return books.find((b) => b.id === sidebarNav.bookId) ?? null;
}

function navigateToRoot() {
  sidebarNav = { level: "root" };
  renderPathBar();
  renderBookList();
}

function navigateToBook(bookId) {
  sidebarNav = { level: "book", bookId };
  renderPathBar();
  renderBookList();
  void fetchPlaySavesForBook(bookId);
}

async function renameBookById(bookId) {
  const book = books.find((b) => b.id === bookId);
  if (!book) return;
  const title = prompt("作品名称", book.title);
  if (title == null) return;
  const trimmed = title.trim();
  if (!trimmed) return alert("名称不能为空");
  try {
    const data = await api(`/api/books/${encodeURIComponent(bookId)}`, {
      method: "PUT",
      body: JSON.stringify({ title: trimmed }),
    });
    const i = books.findIndex((b) => b.id === bookId);
    if (i >= 0 && data.book) books[i] = { ...books[i], ...data.book };
    if (activeBookId === bookId && lastView) {
      renderSession({ ...lastView, bookTitle: trimmed }, false);
    } else {
      renderBookList();
    }
  } catch (err) {
    alert(err.message);
  }
}

async function duplicateBookById(bookId, title) {
  try {
    const data = await api(`/api/books/${encodeURIComponent(bookId)}/duplicate`, {
      method: "POST",
      body: JSON.stringify(title ? { title } : {}),
    });
    if (data.book) {
      books.unshift({
        id: data.book.id,
        title: data.book.title,
        activeSkillId: data.book.activeSkillId ?? data.book.orchestratorId,
        activeSkillName: data.book.activeSkillName ?? data.book.orchestratorName,
        preview: data.book.preview,
        updatedAt: data.book.updatedAt,
        orchestratorId: data.book.orchestratorId,
        orchestratorName: data.book.orchestratorName,
      });
      renderBookList();
    }
    return data.book;
  } catch (err) {
    alert(err.message);
    return null;
  }
}

async function duplicateSelectedBooks() {
  const ids = bookSelectMode || selectedBookIds.size ? [...selectedBookIds] : [];
  if (!ids.length) return;
  for (const id of ids) {
    await duplicateBookById(id);
  }
  setBookSelectMode(false);
}

async function deleteSelectedBooks() {
  const ids = [...selectedBookIds];
  if (!ids.length) return;
  const label =
    ids.length === 1
      ? `「${books.find((b) => b.id === ids[0])?.title ?? "该作品"}」`
      : `${ids.length} 个作品`;
  if (!confirm(`删除 ${label}？不可恢复。`)) return;
  try {
    const data = await api("/api/books/batch", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    });
    const deleted = new Set(data.deleted ?? ids);
    books = books.filter((b) => !deleted.has(b.id));
    setBookSelectMode(false);
    if (activeBookId && deleted.has(activeBookId)) {
      if (books.length) await openBook(books[0].id);
      else renderEmpty();
    } else {
      renderBookList();
    }
  } catch (err) {
    alert(err.message);
  }
}

function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function setupBookBoxSelect() {
  const list = $("book-list");
  const overlay = $("book-box-overlay");
  if (!list || !overlay) return;

  let dragging = false;
  let start = null;

  const clearDrag = () => {
    dragging = false;
    start = null;
    overlay.hidden = true;
  };

  list.addEventListener("mousedown", (e) => {
    if (sidebarNav.level !== "root" || e.button !== 0) return;
    if (e.target.closest("#book-action-menu")) return;
    dragging = true;
    start = { x: e.clientX, y: e.clientY };
    overlay.hidden = true;

    const onMove = (ev) => {
      if (!dragging || !start) return;
      const dx = Math.abs(ev.clientX - start.x);
      const dy = Math.abs(ev.clientY - start.y);
      if (dx < 6 && dy < 6) return;
      if (!bookSelectMode) setBookSelectMode(true, { keepSelection: true });
      const left = Math.min(start.x, ev.clientX);
      const top = Math.min(start.y, ev.clientY);
      const width = Math.abs(ev.clientX - start.x);
      const height = Math.abs(ev.clientY - start.y);
      overlay.hidden = false;
      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
    };

    const onUp = (ev) => {
      if (!dragging || !start) return;
      const dx = Math.abs(ev.clientX - start.x);
      const dy = Math.abs(ev.clientY - start.y);
      if (dx >= 6 || dy >= 6) {
        const box = {
          left: Math.min(start.x, ev.clientX),
          right: Math.max(start.x, ev.clientX),
          top: Math.min(start.y, ev.clientY),
          bottom: Math.max(start.y, ev.clientY),
        };
        for (const row of list.querySelectorAll("[data-book-id]")) {
          const rect = row.getBoundingClientRect();
          if (rectsIntersect(box, rect)) selectedBookIds.add(row.dataset.bookId);
        }
        renderBookList();
      }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      clearDrag();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function renderPathBar() {
  const bar = $("book-path-bar");
  if (!bar) return;
  bar.innerHTML = "";
  bar.hidden = !books.length;

  const rootBtn = document.createElement("button");
  rootBtn.type = "button";
  rootBtn.className = "path-seg";
  rootBtn.dataset.nav = "root";
  rootBtn.innerHTML = `<span class="path-icon" aria-hidden="true">⌂</span><span>作品</span>`;
  if (sidebarNav.level === "root") rootBtn.classList.add("current");
  rootBtn.addEventListener("click", () => {
    if (sidebarNav.level !== "root") navigateToRoot();
  });
  bar.appendChild(rootBtn);

  if (sidebarNav.level === "book") {
    const book = getNavBook();
    if (!book) return;
    const sep = document.createElement("span");
    sep.className = "path-sep";
    sep.setAttribute("aria-hidden", "true");
    sep.textContent = "›";
    bar.appendChild(sep);

    const bookSeg = document.createElement("span");
    bookSeg.className = "path-seg current";
    bookSeg.textContent = book.title;
    bar.appendChild(bookSeg);
  }
}

function renderExplorerRow({ name, meta, active, selected, bookId, actionClass, onClick, onDelete }) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = ["explorer-row", actionClass, active ? "active" : "", selected ? "selected" : ""]
    .filter(Boolean)
    .join(" ");
  if (bookId) row.dataset.bookId = bookId;
  row.innerHTML = `
    <span class="explorer-name">${esc(name)}</span>
    ${meta ? `<span class="explorer-meta">${esc(meta)}</span>` : ""}
    ${onDelete ? `<span class="explorer-del" role="button" tabindex="-1" aria-label="删除">×</span>` : ""}`;
  row.addEventListener("click", (e) => {
    if (e.target.closest(".explorer-del")) return;
    onClick?.(e);
  });
  row.querySelector(".explorer-del")?.addEventListener("click", (e) => {
    e.stopPropagation();
    onDelete?.();
  });
  if (bookId) {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (bookSelectMode && !selectedBookIds.has(bookId)) {
        selectedBookIds.add(bookId);
        renderBookList();
      }
      showBookMenu(bookId, e.clientX, e.clientY);
    });
  }
  return row;
}

function renderBookContents(book, list) {
  const loading = playSavesLoading.has(book.id);
  const saves = playSavesByBook.get(book.id);
  const ready = bookPlayReady(book.id);

  list.appendChild(
    renderExplorerRow({
      name: "继续创作",
      meta: "自动保存",
      active: activeBookId === book.id && lastView?.lifecycleStage !== "play",
      onClick: () => {
        void openBook(book.id).then(() => navigateToRoot());
      },
    }),
  );

  if (loading && saves === undefined) {
    const hint = document.createElement("p");
    hint.className = "explorer-hint";
    hint.textContent = "加载存档…";
    list.appendChild(hint);
    return;
  }

  const saveList = saves ?? [];
  if (!saveList.length && !ready) {
    const hint = document.createElement("p");
    hint.className = "explorer-hint";
    hint.textContent = "验收 Worker 集后可保存定稿 / 游玩存档";
    list.appendChild(hint);
    return;
  }

  if (saveList.length) {
    const label = document.createElement("div");
    label.className = "explorer-section-label";
    label.textContent = "存档";
    list.appendChild(label);
  }

  for (const s of saveList) {
    const kindLabel =
      s.kindLabel ||
      (s.kind === "instance" ? "创作定稿" : s.kind === "opening" ? "开局" : "游玩进度");
    list.appendChild(
      renderExplorerRow({
        name: s.label,
        meta: `${kindLabel} · ${new Date(s.createdAt).toLocaleString("zh-CN")}`,
        onClick: () => void loadPlaySave(book.id, s.id),
        onDelete: () => void deletePlaySave(book.id, s.id, s.label),
        actionClass: "explorer-file",
      }),
    );
  }

  if (ready) {
    list.appendChild(
      renderExplorerRow({
        name: "+ 新建游玩",
        actionClass: "explorer-action",
        onClick: () => void startNewPlayForBook(book.id),
      }),
    );
  } else if (!saveList.length) {
    const hint = document.createElement("p");
    hint.className = "explorer-hint";
    hint.textContent = "暂无游玩存档";
    list.appendChild(hint);
  }
}

function renderBookList() {
  const list = $("book-list");
  if (!list) return;
  renderPathBar();
  if (!books.length) {
    list.innerHTML = `<p class="sidebar-empty">暂无作品<br><button type="button" class="btn-sm" id="btn-new-inline">+ 新建</button></p>`;
    $("btn-new-inline")?.addEventListener("click", openNewBookDialog);
    return;
  }
  list.innerHTML = "";

  if (sidebarNav.level === "book") {
    const book = getNavBook();
    if (!book) {
      navigateToRoot();
      return;
    }
    renderBookContents(book, list);
    return;
  }

  for (const book of books) {
    const skill = book.activeSkillName ?? book.activeSkillId ?? book.orchestratorName ?? "实例设计";
    const selected = selectedBookIds.has(book.id);
    list.appendChild(
      renderExplorerRow({
        name: book.title,
        meta: skill,
        active: book.id === activeBookId && !selected,
        selected,
        bookId: book.id,
        actionClass: "explorer-folder",
        onClick: () => {
          if (bookSelectMode) {
            toggleBookSelection(book.id);
            return;
          }
          navigateToBook(book.id);
          void openBook(book.id);
        },
      }),
    );
  }
}

async function loadPlaySave(bookId, saveId) {
  try {
    if (lastView) renderSession(lastView, true);
    const data = await api(
      `/api/books/${encodeURIComponent(bookId)}/saves/${encodeURIComponent(saveId)}/load`,
      { method: "POST" },
    );
    sidebarNav = { level: "root" };
    renderSession(data.session, false);
  } catch (err) {
    if (lastView) renderSession(lastView, false);
    alert(err.message);
  }
}

async function deletePlaySave(bookId, saveId, label) {
  if (!confirm(`删除游玩存档「${label}」？`)) return;
  try {
    await api(
      `/api/books/${encodeURIComponent(bookId)}/saves/${encodeURIComponent(saveId)}`,
      { method: "DELETE" },
    );
    await fetchPlaySavesForBook(bookId, true);
  } catch (err) {
    alert(err.message);
  }
}

async function startNewPlayForBook(bookId) {
  if (!bookPlayReady(bookId)) {
    alert("须先验收 Worker 集");
    return;
  }
  try {
    if (lastView) renderSession(lastView, true);
    const data = await api(`/api/books/${encodeURIComponent(bookId)}/play/new`, { method: "POST" });
    sidebarNav = { level: "root" };
    renderSession(data.session, false);
  } catch (err) {
    if (lastView) renderSession(lastView, false);
    alert(err.message);
  }
}

function renderHeader(view, loading) {
  const st = statusFor(view, loading);
  $("work-title").textContent = view.bookTitle ?? "未命名作品";
  const skill = displaySkillPackLabel(view.activeSkill) ||
    view.selectedRecipe?.name ||
    "配方";
  const phase = view.waitingReason
    ? REASON[view.waitingReason.kind] ?? view.phase
    : PHASE[view.phase] ?? view.phase;
  $("work-meta").textContent = `${skill} · ${phase}`;
  $("status-dot").className = `status-dot ${st.cls}`;
  $("status-text").textContent = st.text;
  const showSavePlay = Boolean(view.bookId && view.playReady && view.lifecycleStage === "play");
  const showSaveInstance = Boolean(view.bookId && view.playReady);
  $("btn-save-play").hidden = !showSavePlay;
  const btnInst = $("btn-save-instance");
  if (btnInst) btnInst.hidden = !showSaveInstance;
  $("btn-export").disabled = !(view.messages?.length);
}

function renderEmpty() {
  sessionId = null;
  lastView = null;
  activeBookId = null;
  sidebarNav = { level: "root" };
  setBookSelectMode(false);
  composerForceInput = false;
  $("work-title").textContent = "未打开作品";
  $("work-meta").textContent = "";
  $("status-dot").className = "status-dot";
  $("status-text").textContent = "—";
  $("btn-save-play").hidden = true;
  const btnInst = $("btn-save-instance");
  if (btnInst) btnInst.hidden = true;
  $("btn-export").disabled = true;
  $("message-feed").innerHTML = `<p class="empty">点击左侧 + 新建作品</p>`;
  $("skill-picker").hidden = true;
  $("agent-focus").innerHTML = "";
  $("agent-timeline").innerHTML = "";
  $("skill-guide-list").innerHTML = "";
  const wsp = $("worker-set-user-panel");
  if (wsp) wsp.innerHTML = "";
  $("tool-trace").hidden = true;
  hideBookMenu();
  document.body.dataset.lifecycle = "design";
  $("composer").innerHTML = `<div class="composer-idle">暂无打开的作品</div>`;
  renderBookList();
}

function stopLivePoll() {
  if (livePollTimer != null) {
    clearInterval(livePollTimer);
    livePollTimer = null;
  }
}

function startLivePoll() {
  stopLivePoll();
  if (!sessionId) return;
  livePollTimer = setInterval(async () => {
    if (!sessionId) return;
    try {
      const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
      lastView = { ...lastView, liveStream: view.liveStream, agentThinking: view.agentThinking };
      updateLiveStreamPanel(view);
    } catch {
      /* ignore transient poll errors */
    }
  }, LIVE_POLL_MS);
}

function renderSession(view, loading = false) {
  lastView = view;
  sessionId = view.id;
  activeBookId = view.bookId ?? activeBookId;
  if (
    !loading &&
    view.waitingReason?.kind !== "approve_step" &&
    view.waitingReason?.kind !== "review_artifact" &&
    view.waitingReason?.kind !== "worker_questions" &&
    !(view.waitingReason?.kind === "input" && view.waitingReason?.questions?.length)
  ) {
    composerForceInput = false;
  }
  renderHeader(view, loading);
  renderBookList();
  renderWorkspace(view, loading, (skillId) => sendText(skillId), {
    onSkipQuestions: () => runAction("skip_questions"),
    onEditMessage: (messageId, text) => messageAction("edit", messageId, { text }),
    onRefreshMessage: (messageId) => messageAction("refresh", messageId),
    onDeleteMessage: (messageId) => messageAction("delete", messageId),
    onViewContext: (messageId) => showContextTraceDialog(messageId),
    onSwitchVariant: (messageId, direction) =>
      messageAction("variant", messageId, { direction }),
  });
  renderComposer(view, loading);
  if (loading) startLivePoll();
  else stopLivePoll();
}

async function messageAction(kind, messageId, body = {}) {
  if (!sessionId) return;
  try {
    renderSession(lastView, true);
    const view = await api(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/${kind}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    renderSession(view, false);
  } catch (err) {
    if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
  }
}

async function sendText(text) {
  if (!sessionId) return;
  const trimmed = text?.trim() ?? "";
  const qHost = $("questions-card-host");
  const activeQs = getActiveQuestions(lastView);
  const reviewing = lastView?.waitingReason?.kind === "review_artifact";

  // 产物验收：底栏有字 ⇒ 按修改意见重做；接受走「接受目前产物」
  if (reviewing && trimmed) {
    try {
      renderSession(lastView, true);
      const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: trimmed }),
      });
      clearQuestionCardState(qHost);
      renderSession(view, false);
    } catch (err) {
      if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
    }
    return;
  }

  if (activeQs?.questions?.length && qHost?.classList.contains("is-open")) {
    const collected = collectQuestionAnswers(qHost, lastView);
    const answered = collected.ok
      ? collected.answers.filter((a) => a.text && a.text !== "（未答）")
      : [];
    // 可选追问：未选任何选项时，允许直接发自由文本（或空操作交给下方逻辑）
    if (!collected.ok && !activeQs.optional) {
      if (typeof collected.page === "number" && qHost._qState) {
        qHost._qState.page = collected.page;
        renderQuestionsCard(qHost, lastView, {
          onSkipQuestions: () => runAction("skip_questions"),
        });
      }
      alert(collected.error);
      return;
    }
    if (collected.ok && answered.length) {
      try {
        renderSession(lastView, true);
        const body = { answers: collected.answers };
        if (trimmed) body.note = trimmed;
        const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/answers`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        clearQuestionCardState(qHost);
        renderSession(view, false);
      } catch (err) {
        if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
      }
      return;
    }
  }

  if (!trimmed) return;
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
    // 接受产物 = 不再完善 → 收起询问卡；跳过追问同理
    if (action === "accept" || action === "skip_questions") {
      clearQuestionCardState($("questions-card-host"));
    }
    renderSession(view, false);
  } catch (err) {
    if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
  }
}

async function setLifecycle(stage) {
  if (!sessionId || stage === lastView?.lifecycleStage) return;
  if (stage === "play" && !lastView?.playReady) {
    alert("请先验收 Worker 集（创作定稿）后再进入游玩");
    return;
  }
  try {
    const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/lifecycle`, {
      method: "POST",
      body: JSON.stringify({ stage }),
    });
    renderSession(view, false);
  } catch (err) {
    alert(err.message || "无法切换阶段");
    if (lastView) renderSession(lastView, false);
  }
}

async function loadBooks() {
  const data = await api("/api/books");
  books = data.books ?? [];
  renderBookList();
}

function openNewBookDialog() {
  $("input-book-title").value = "";
  void populateDirectorSelect();
  $("dialog-new-book").showModal();
  $("input-book-title").focus();
}

async function populateDirectorSelect() {
  const sel = $("select-director");
  const desc = $("director-desc");
  if (!sel) return;
  try {
    const data = await api("/api/directors");
    const directors = data.directors ?? [];
    sel.innerHTML = "";
    if (!directors.length) {
      sel.innerHTML = `<option value="">暂无配方</option>`;
      if (desc) {
        desc.hidden = false;
        desc.textContent = "尚未配置配方选项（recipes/catalog.yaml）。";
      }
      return;
    }
    for (const d of directors) {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = displaySkillPackLabel(d.id) || d.name || d.id;
      sel.appendChild(opt);
    }
    const preferred =
      directors.find((d) => d.id === "world-simulator") ?? directors[0];
    sel.value = preferred.id;
    const syncDesc = () => {
      const cur = directors.find((d) => d.id === sel.value);
      if (desc) {
        const text = (cur?.declaration ?? "").trim();
        desc.hidden = !text;
        desc.textContent = text;
      }
    };
    sel.onchange = syncDesc;
    syncDesc();
  } catch (err) {
    sel.innerHTML = `<option value="">加载失败</option>`;
    if (desc) {
      desc.hidden = false;
      desc.textContent = err.message;
    }
  }
}

async function createBook() {
  const title = $("input-book-title").value.trim() || "未命名作品";
  const recipeId = $("select-director")?.value?.trim();
  if (!recipeId) {
    alert("请选择配方");
    return;
  }
  $("btn-create-book").disabled = true;
  try {
    const directorsMeta = await api("/api/directors").catch(() => null);
    const orchestratorId = directorsMeta?.skillPackId || "world-simulator";
    const data = await api("/api/books", {
      method: "POST",
      body: JSON.stringify({
        title,
        orchestratorId,
        recipeId,
      }),
    });
    $("dialog-new-book").close();
    if (data.book) books.unshift(data.book);
    activeBookId = data.book?.id;
    navigateToBook(data.book.id);
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

async function deleteBookById(bookId) {
  const book = books.find((b) => b.id === bookId);
  if (!book) return;
  if (!confirm(`删除「${book.title}」？不可恢复。`)) return;
  try {
    await api(`/api/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
    books = books.filter((b) => b.id !== bookId);
    playSavesByBook.delete(bookId);
    selectedBookIds.delete(bookId);
    if (sidebarNav.level === "book" && sidebarNav.bookId === bookId) sidebarNav = { level: "root" };
    hideBookMenu();
    if (activeBookId === bookId) {
      if (books.length) {
        await openBook(books[0].id);
      } else {
        renderEmpty();
      }
    } else {
      renderBookList();
    }
  } catch (err) {
    alert(err.message);
  }
}

async function saveCurrentPlay() {
  if (!activeBookId || !lastView?.playReady) return alert("须先验收 Worker 集");
  if (lastView.lifecycleStage !== "play") return alert("请先切换到「游玩」");
  const label = prompt("游玩进度存档名称");
  if (!label?.trim()) return;
  try {
    await api(`/api/books/${encodeURIComponent(activeBookId)}/saves`, {
      method: "POST",
      body: JSON.stringify({ label: label.trim(), sessionId, kind: "run" }),
    });
    playSavesByBook.delete(activeBookId);
    if (sidebarNav.level === "book" && sidebarNav.bookId === activeBookId) {
      void fetchPlaySavesForBook(activeBookId, true);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function saveCurrentInstance() {
  if (!activeBookId || !lastView?.playReady) return alert("须先验收 Worker 集");
  const label = prompt("创作定稿存档名称");
  if (!label?.trim()) return;
  try {
    await api(`/api/books/${encodeURIComponent(activeBookId)}/saves`, {
      method: "POST",
      body: JSON.stringify({ label: label.trim(), sessionId, kind: "instance" }),
    });
    playSavesByBook.delete(activeBookId);
    if (sidebarNav.level === "book" && sidebarNav.bookId === activeBookId) {
      void fetchPlaySavesForBook(activeBookId, true);
    }
  } catch (err) {
    alert(err.message);
  }
}

function showContextTraceDialog(messageId) {
  const msg = (lastView?.messages ?? []).find((m) => m.id === messageId);
  const review = lastView?.reviewArtifact;
  const trace =
    msg?.contextTrace ||
    (review &&
    (review.sourceMessageId === messageId || review.id === messageId)
      ? review.contextTrace
      : undefined);
  const dlg = $("dialog-context-trace");
  const meta = $("context-trace-meta");
  const body = $("context-trace-body");
  if (!dlg || !meta || !body) return;
  if (!trace?.messages?.length) {
    alert("这条消息没有保存请求上下文（可能已被修剪，或当时未开启保存）");
    return;
  }
  const kb = ((trace.charCount || 0) / 1024).toFixed(1);
  meta.textContent = `${trace.caller || "unknown"} · ${trace.model || "model?"} · ${kb} KB · ${trace.createdAt || ""}`;
  body.textContent = trace.messages
    .map((m) => `======== ${m.role} ========\n${m.content}`)
    .join("\n\n");
  dlg.showModal();
}

$("btn-copy-context")?.addEventListener("click", async () => {
  const body = $("context-trace-body")?.textContent ?? "";
  try {
    await navigator.clipboard.writeText(body);
  } catch {
    alert("复制失败");
  }
});

function exportSession() {
  if (!lastView) return;
  const name = (lastView.bookTitle ?? "session").replace(/[\\/:*?"<>|]/g, "_");
  downloadMarkdown(`${name}.md`, sessionToMarkdown(lastView));
}

$("btn-new-book")?.addEventListener("click", openNewBookDialog);
$("btn-cancel-new")?.addEventListener("click", () => $("dialog-new-book").close());
$("book-action-menu")?.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.getAttribute("data-action");
  const bookId = bookMenuBookId;
  hideBookMenu();
  if (!bookId || !action) return;
  if (action === "open") {
    setBookSelectMode(false);
    navigateToBook(bookId);
    void openBook(bookId);
  } else if (action === "rename") {
    const id = selectedBookIds.size === 1 ? [...selectedBookIds][0] : bookId;
    void renameBookById(id);
  } else if (action === "duplicate") {
    if (selectedBookIds.size > 1) void duplicateSelectedBooks();
    else void duplicateBookById(bookId).then(() => setBookSelectMode(false));
  } else if (action === "select-mode") {
    if (bookSelectMode) {
      setBookSelectMode(false);
    } else {
      setBookSelectMode(true, { keepSelection: true });
      selectedBookIds.add(bookId);
      renderBookList();
    }
  } else if (action === "delete") {
    if (selectedBookIds.size > 1) void deleteSelectedBooks();
    else void deleteBookById(bookId);
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#book-action-menu")) hideBookMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideBookMenu();
    if (bookSelectMode || selectedBookIds.size) setBookSelectMode(false);
  }
});
document.addEventListener("scroll", hideBookMenu, true);
$("form-new-book")?.addEventListener("submit", (e) => {
  e.preventDefault();
  createBook();
});
$("lifecycle-toggle")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-stage]");
  if (!btn?.disabled) setLifecycle(btn.getAttribute("data-stage"));
});
$("btn-export")?.addEventListener("click", exportSession);
$("btn-save-play")?.addEventListener("click", () => void saveCurrentPlay());
$("btn-save-instance")?.addEventListener("click", () => void saveCurrentInstance());

window.addEventListener("wa:session-updated", (e) => {
  const view = e.detail;
  if (view?.id) renderSession(view, false);
});

async function init() {
  try {
    void populateDirectorSelect();
    await loadBooks();
    if (books.length) {
      sidebarNav = { level: "root" };
      await openBook(books[0].id);
    } else {
      renderEmpty();
    }
  } catch {
    $("status-text").textContent = "加载失败";
  }
}

init();
setupBookBoxSelect();
