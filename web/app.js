import {
  renderWorkspace,
  updateLiveStreamPanel,
  resetRailChrome,
  setRailTab,
  fillStepArtifactDialog,
  canOfferSaveProduct,
  canOfferEnterPlay,
  placeMenu,
} from "./agent-ui.js";
import { downloadMarkdown, sessionToMarkdown } from "./export.js";
import { renderIntakePanel } from "./intake-ui.js";
import { displaySkillPackLabel, isFlowPlanReview, reviewComposerCopy } from "./display-labels.js";
import {
  clearQuestionCardState,
  collectQuestionAnswers,
  getActiveQuestions,
  isModuleOpeningWaiting,
  renderQuestionsCard,
} from "./questions-ui.js";
import {
  applyColorTheme,
  bumpUiFontScale,
  getStoredColorTheme,
  getStoredUiFontScale,
  initColorTheme,
  initUiFontScale,
  themeById,
  UI_FONT_SCALE_MAX,
  UI_FONT_SCALE_MIN,
} from "./theme.js";
import {
  applyMarkdownRender,
  initMarkdownRender,
  isMarkdownRenderEnabled,
} from "./markdown.js";
import {
  filterUsedApiProfiles,
  forgetApiProfileUsage,
  loadApiProfileUsage,
  membersUsageRank,
  pruneApiProfileUsage,
  recordApiProfileUsage,
  seedApiProfileUsage,
  sortByApiProfileUsage,
} from "./api-profile-usage.js";
import { wireDirectiveAutocomplete } from "./directive-autocomplete.js";
import {
  refreshDirectiveHighlight,
  wireDirectiveHighlight,
} from "./directive-highlight.js";

let sessionId = null;
let activeBookId = null;
let lastView = null;
let books = [];
let composerForceInput = false;
/** 全局用户角色（不依赖会话）；含 description */
let globalPersonas = [];
let globalActivePersonaId = null;
/** 面板内正在编辑的角色 id；`__new__` 表示新建 */
let personaEditingId = null;
let pendingComposerDraft = "";
let pendingComposerDraftSeq = 0;
/** 正在提交底栏：重绘时不要把已捕获的正文再塞进 pending */
let skipComposerStash = false;
let sidebarNav = { level: "root" };
let bookSelectMode = false;
let selectedBookIds = new Set();
let activePlaySaveId = null;
const playSavesByBook = new Map();
const playWorkingInstanceByBook = new Map();
const playSavesLoading = new Set();
/** @type {Map<string, Set<string>>} */
const expandedSpecsByBook = new Map();
let bookMenuBookId = null;
let enterPickerBookId = null;
let livePollTimer = null;
/** 本轮 live poll 是否已见过服务端 runActive=true（用于判断「跑完了」） */
let livePollSawRun = false;
/** 启动轮询时的结构指纹；用于漏掉 runActive 时的收尾兜底 */
let livePollBaselineSig = "";
/** 结构指纹：消息/产物变化时在 loading 下整页刷新，避免主区空白 */
let livePollStructuralSig = "";
/** 本轮轮询开始时间 */
let livePollStartedAt = 0;
/** 连续轮询失败次数（服务重启后 session 会 404） */
let livePollFailCount = 0;
let inflightSeq = 0;
/** 底栏菜单：只切当前 API，不编辑 */
let apiProfileList = [];
let apiProfileGroups = [];
let activeApiProfileId = null;
/** idle | loading | ready | error */
let apiProfileMenuStatus = "idle";
let apiProfileMenuError = "";
let apiProfileSwitchingId = null;
let apiProfileSwitchingLabel = "";

const LIVE_POLL_MS = 280;
const WORKSPACE_SESSION_KEY = "wa-workspace-session-v1";

const $ = (id) => document.getElementById(id);

const PHASE = { idle: "待命", running: "执行中", waiting_user: "等待你", done: "已完成", error: "出错" };

function readWorkspaceSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(WORKSPACE_SESSION_KEY) || "null");
    if (!value || typeof value !== "object" || typeof value.bookId !== "string") {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function rememberWorkspaceSession() {
  if (!activeBookId || !sessionId || lastView?.bookId !== activeBookId) return;
  try {
    const mode = isPlayView(lastView) ? "play" : "design";
    sessionStorage.setItem(
      WORKSPACE_SESSION_KEY,
      JSON.stringify({
        bookId: activeBookId,
        sessionId,
        mode,
        playSaveId:
          mode === "play" ? activePlaySaveId || "play-working" : null,
        navLevel: sidebarNav.level === "book" ? "book" : "root",
      }),
    );
  } catch {
    /* sessionStorage 不可用时维持无记忆模式 */
  }
}

function forgetWorkspaceSession() {
  try {
    sessionStorage.removeItem(WORKSPACE_SESSION_KEY);
  } catch {
    /* sessionStorage 不可用 */
  }
}

/** 用户任务三态（表层）；底层 waitingReason 映射进来 */
const USER_TASK = {
  speak: { id: "speak", label: "说话", title: "继续说" },
  answer: { id: "answer", label: "答题", title: "回答问题" },
  review: { id: "review", label: "验收", title: "验收产物" },
};

function reviewCopyFromView(view) {
  return reviewComposerCopy(view?.reviewArtifact?.workerId, {
    hasQuestions: Boolean(getActiveQuestions(view)?.questions?.length),
    outputTags: view?.reviewArtifact?.outputTags,
  });
}

function isPlayView(view) {
  return Boolean(view?.playLayerActive || view?.lifecycleStage === "play");
}

/**
 * 把 waitingReason 收成用户三态：说话 / 答题+自由发挥 / 批阅。
 * @returns {{ id: 'speak'|'answer'|'review'|'busy'|'idle'|'error', label: string, title: string, hint: string|null }}
 */
function resolveUserTask(view, loading) {
  if (loading || isAgentBusy(view, loading)) {
    return {
      id: "busy",
      label: "执行中",
      title: view.focus?.action ?? "总管或 Worker 执行中…",
      hint: null,
    };
  }
  if (composerForceInput) {
    return {
      id: "speak",
      label: USER_TASK.speak.label,
      title: "说明意见",
      hint: "写完发送即可。",
    };
  }
  if (view.phase === "done") {
    return { id: "idle", label: "已完成", title: "会话已结束", hint: null };
  }
  if (view.phase === "error") {
    return {
      id: "error",
      label: "出错",
      title: "说明后重试",
      hint: view.hints?.[0] ?? "执行出错，可在下方重试",
    };
  }

  const wr = view.waitingReason;
  const hasQuestions = Boolean(getActiveQuestions(view)?.questions?.length);
  const moduleOpening = isModuleOpeningWaiting(view);

  if (isPlayView(view)) {
    return {
      id: "speak",
      label: USER_TASK.speak.label,
      title: "继续说",
      hint: "你说一句，世界推进一轮。",
    };
  }

  if (canOfferSaveProduct(view)) {
    return {
      id: "speak",
      label: USER_TASK.speak.label,
      hideChip: true,
      title: "落档产物",
      hint: view.hasProduct
        ? "可再保存一份新定稿，或用已有产物开玩。"
        : view.creationMode === "dictate"
          ? "点「保存定稿」拆出产物。创作对话还在，之后用产物开玩。"
          : "点「保存定稿」拆出产物。创作流程还在，之后用产物开玩。",
    };
  }

  if (isFlowPlanReview(view) || wr?.kind === "pick_creation_step") {
    return {
      id: "speak",
      label: "选节点",
      title: "选要做的节点",
      hint: "点图上可进入的节点即开始。要看技能池点上方「技能」。",
    };
  }

  if (wr?.kind === "review_artifact") {
    const copy = reviewCopyFromView(view);
    return {
      id: "review",
      label: copy.taskLabel,
      title: copy.taskTitle,
      hint: copy.hint,
    };
  }

  // 能力默认问题：对齐美学纲领开局 → 说话面，不进「答题」
  if (moduleOpening) {
    const stepName = view.openingGuide?.stepName?.trim();
    return {
      id: "speak",
      label: USER_TASK.speak.label,
      title: stepName || "按引导先说几句",
      hint: "想到什么写什么，不必整齐；写完发送即可。",
    };
  }

  if (hasQuestions || wr?.kind === "worker_questions") {
    return {
      id: "answer",
      label: USER_TASK.answer.label,
      title: "回答问题",
      hint: "先点选项作答；也可以在底栏自由补充。",
    };
  }

  if (wr?.kind === "approve_step") {
    const proposed = view.proposedNextStep;
    return {
      id: "speak",
      label: "确认",
      title: proposed?.name
        ? proposed.mode === "revise"
          ? `回头修改 · ${proposed.name}`
          : `接下来生成 · ${proposed.name}`
        : "确认下一步",
      hint: proposed
        ? proposedOutputCopy(proposed)
        : view.focus?.detail ?? "确认执行，或说明意见。",
    };
  }

  if (wr?.kind === "next_intent") {
    return {
      id: "speak",
      label: USER_TASK.speak.label,
      title: "下一步想写什么",
      hint: "说说接下来想做什么；可留空，也可说回头改某步。发送后会展示下一节点。",
    };
  }

  if (wr?.kind === "revision") {
    return {
      id: "speak",
      label: USER_TASK.speak.label,
      title: "说明修改意见",
      hint: "写清楚要改哪里；发送后在现有产物上修改。",
    };
  }

  if (wr?.kind === "intake") {
    const hasUser = (view.messages ?? []).some((m) => m.role === "user");
    return {
      id: "speak",
      label: USER_TASK.speak.label,
      title: hasUser ? "继续补充" : "描述你想创作什么",
      hint: hasUser
        ? "继续说细节，或等信息齐后确认。"
        : "用几句话说明题材、玩法或爽点即可。",
    };
  }

  if (wr?.kind === "input" || wr?.kind === "skill_selection") {
    return {
      id: "speak",
      label: USER_TASK.speak.label,
      title: "继续说",
      hint: view.hints?.[0] ?? "直接输入你的想法或补充。",
    };
  }

  if (view.phase === "waiting_user") {
    return {
      id: "speak",
      label: USER_TASK.speak.label,
      title: "继续说",
      hint: view.hints?.[0] ?? null,
    };
  }

  return {
    id: "idle",
    label: PHASE[view.phase] ?? view.phase,
    title: PHASE[view.phase] ?? "待命",
    hint: null,
  };
}

function applyUserTaskChrome(task) {
  document.body.dataset.userTask = task?.id || "";
}

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

function attr(s) {
  return esc(s).replace(/"/g, "&quot;");
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
  if (proposed?.mode === "revise") {
    if (targetText) {
      return `将在既有「${targetText}」的${proposed.name}上继续改，不是从零再生成。`;
    }
    return `将在既有「${proposed?.name || "该步"}」上继续改，不是从零再生成。`;
  }
  if (targetText) {
    return `将生成「${targetText}」的${proposed.name}。`;
  }
  return `接下来将生成：${proposed?.name || "下一项内容"}。`;
}

/** 确认下一步：给人看「生成什么」；有 target 时顺带露出后台 id，便于改对象时同步。 */
function proposeVisibleFields(proposed) {
  if (proposed?.kind === "prior-artifact") return [];
  const missing = new Set(proposed?.paramsMissing || []);
  const specs = Array.isArray(proposed?.paramSpecs) ? proposed.paramSpecs : [];
  const byKey = new Map(specs.map((s) => [s.key, s]));
  const out = [];
  const push = (key) => {
    const spec = byKey.get(key);
    if (!spec || out.some((s) => s.key === key)) return;
    out.push(spec);
  };

  if (byKey.has("target")) {
    push("target");
    // 对象与后台 id 绑定：改女租客→丧尸时，rule_id 也要换成 zombies 一类英文
    if (byKey.has("rule_id")) push("rule_id");
  } else if (byKey.has("rule_id") && (missing.has("rule_id") || proposed?.name === "具体实例")) {
    push("rule_id");
  }

  for (const key of missing) push(key);
  return out;
}

function proposeFieldLabel(field) {
  if (field.key === "rule_id" && field.label === "规则 id") return "后台 id";
  return field.label || field.key;
}

function proposeFieldHint(field, proposed) {
  if (field.key === "rule_id" && proposed?.paramSpecs?.some((s) => s.key === "target")) {
    return "英文 kebab-case，须与上方对象对应；改对象时一并改（如丧尸→zombies）";
  }
  return field.hint || field.key;
}

function statusFor(view, loading) {
  const task = resolveUserTask(view, loading);
  if (task.id === "busy") return { cls: "running", text: task.title };
  if (task.id === "error") return { cls: "", text: task.label };
  if (task.id === "idle" && view.phase === "done") return { cls: "done", text: "已完成" };
  if (task.id === "speak" || task.id === "answer" || task.id === "review") {
    return { cls: "waiting", text: task.label };
  }
  return { cls: "", text: task.label };
}

function isAgentBusy(view, loading) {
  if (loading) return true;
  return view.phase === "running" && !view.waitingReason;
}

function resolveComposer(view, loading) {
  const task = resolveUserTask(view, loading);
  applyUserTaskChrome(task);

  if (task.id === "busy") {
    return { mode: "waiting", text: task.title, task };
  }
  if (view.phase === "done") {
    return { mode: "idle", text: "会话已结束", task };
  }
  if (view.phase === "error") {
    const send = view.actions?.find((a) => a.type === "send_message");
    return {
      mode: "input",
      task,
      taskTitle: task.title,
      taskHint: task.hint,
      placeholder: send?.placeholder ?? "说明后重试，或直接发送继续…",
      hint: null,
    };
  }

  if (isPlayView(view)) {
    const send = view.actions?.find((a) => a.type === "send_message");
    return {
      mode: "input",
      task,
      taskTitle: task.title || "继续说",
      taskHint: task.hint,
      placeholder: send?.placeholder ?? "说你要做什么…",
      hint: null,
      submitLabel: "发送",
    };
  }

  const confirmIntake = view.actions?.find((a) => a.type === "confirm_intake");
  if (view.waitingReason?.kind === "intake" && view.intake) {
    const hasUser = (view.messages ?? []).some((m) => m.role === "user");
    const send = view.actions?.find((a) => a.type === "send_message");
    return {
      mode: view.intake.ready && confirmIntake ? "intake_ready" : "intake",
      task,
      taskTitle: task.title,
      taskHint: task.hint,
      intake: view.intake,
      intakePrompt: hasUser ? view.intakePrompt : null,
      showIntakePanel: hasUser,
      confirmIntake,
      placeholder: send?.placeholder ?? "描述你想创作什么…",
    };
  }

  const approve = view.actions?.find((a) => a.type === "approve");
  const accept = view.actions?.find((a) => a.type === "accept");
  if (approve && view.proposedNextStep && !composerForceInput) {
    return {
      mode: "propose_step",
      task,
      taskTitle: task.title,
      taskHint: task.hint,
      proposed: view.proposedNextStep,
      primary: approve,
      hint: null,
    };
  }
  if (approve && !composerForceInput) {
    return {
      mode: "action",
      task,
      taskTitle: task.title,
      taskHint: task.hint,
      primary: approve,
      primaryType: "approve",
      hint: null,
      showReject: true,
    };
  }
  if (accept && view.waitingReason?.kind !== "review_artifact" && !composerForceInput) {
    return {
      mode: "action",
      task,
      taskTitle: "验收产物",
      taskHint: "同意就接受；要改可先点「说明意见」。",
      primary: accept,
      primaryType: "accept",
      hint: null,
      showReject: true,
    };
  }

  const send = view.actions?.find((a) => a.type === "send_message");
  const hasQuestionsCard = Boolean(getActiveQuestions(view)?.questions?.length);

  if (
    (view.waitingReason?.kind === "pick_creation_step" || isFlowPlanReview(view)) &&
    !composerForceInput
  ) {
    return {
      mode: "pick_step",
      task,
      taskTitle: "选要做的节点",
      taskHint: "点图上可进入的节点即开始；虚线原型点一下增殖。要看技能池点上方「技能」。要改排在底栏写意见再发。",
      placeholder: send?.placeholder ?? "例如：补舞台骨架、把某步改到开场白之前…",
      hint: null,
      submitLabel: "发送",
      requiresText: true,
    };
  }

  if (view.waitingReason?.kind === "review_artifact") {
    const parseBroken = Boolean(view.reviewArtifact?.workerSetView?.parseError);
    const copy = reviewCopyFromView(view);
    return {
      mode: "input",
      task,
      taskTitle: copy.taskTitle,
      taskHint: copy.hint,
      placeholder: send?.placeholder ?? copy.placeholder,
      hint: null,
      submitLabel: copy.submitLabel,
      emptyEnterHint: copy.emptyEnterHint,
      acceptAction: accept
        ? {
            label: copy.acceptLabel,
            title: copy.hint,
            tone: copy.tone,
            disabled: parseBroken,
            disabledTitle: parseBroken
              ? "规格解析失败，请先写修改意见再改产物"
              : undefined,
          }
        : null,
    };
  }

  if (hasQuestionsCard && !composerForceInput) {
    return {
      mode: "input",
      task,
      taskTitle: task.title,
      taskHint: task.hint,
      placeholder: send?.placeholder ?? "也可在此自由补充…",
      hint: null,
      submitLabel: "补充并发送",
    };
  }

  if (
    send ||
    view.waitingReason?.kind === "input" ||
    view.waitingReason?.kind === "worker_questions" ||
    view.waitingReason?.kind === "revision" ||
    view.waitingReason?.kind === "next_intent" ||
    view.waitingReason?.kind === "pick_creation_step" ||
    composerForceInput
  ) {
    const wr = view.waitingReason;
    let placeholder = send?.placeholder ?? "输入你想说的…";
    let submitLabel = "发送";
    if (wr?.kind === "next_intent") {
      placeholder = send?.placeholder ?? "下一步想写什么？（可留空）…";
      submitLabel = "继续";
    } else if (wr?.kind === "approve_step" && composerForceInput) {
      placeholder =
        "例如：补开局 NPC、改成丧尸怪物规则（后台 id 也换成 zombies）…";
      submitLabel = "发送意见";
    } else if (wr?.kind === "revision") {
      placeholder = "说明要改哪里…";
      submitLabel = "按意见修改";
    } else if (wr?.kind === "worker_questions" && !hasQuestionsCard) {
      placeholder = isModuleOpeningWaiting(view)
        ? "想到什么写什么…"
        : "直接回答问题…";
    } else if (
      view.openingGuide?.text &&
      !(view.messages ?? []).some((m) => m.role === "user")
    ) {
      placeholder = "按上方引导写几句…";
    }
    return {
      mode: "input",
      task,
      taskTitle: task.title,
      taskHint: task.hint,
      placeholder,
      hint: null,
      submitLabel,
      allowEmpty: wr?.kind === "next_intent",
    };
  }

  const finish = view.actions?.find((a) => a.type === "finish");
  if (finish) {
    return {
      mode: "action",
      task,
      taskTitle: "结束",
      taskHint: null,
      primary: finish,
      primaryType: "finish",
      hint: null,
      showReject: false,
    };
  }

  return { mode: "idle", text: "暂无可用操作", task };
}

function composerModeChip(spec) {
  const id = spec.task?.id;
  if (spec.task?.hideChip) return "";
  if (id !== "speak" && id !== "answer" && id !== "review" && id !== "busy") return "";
  const label = spec.task.label || "";
  if (!label) return "";
  const tip = [spec.taskTitle, spec.taskHint].filter(Boolean).join(" — ");
  const tone = spec.acceptAction?.tone ? ` data-tone="${esc(spec.acceptAction.tone)}"` : "";
  return `<span class="composer-mode-chip" data-task="${esc(id)}"${tone} title="${esc(tip)}">${esc(label)}</span>`;
}

function activePersonaRecord() {
  return (
    globalPersonas.find((p) => p.id === globalActivePersonaId) ||
    globalPersonas[0] ||
    null
  );
}

function shortPersonaDesc(text) {
  const t = String(text || "").trim();
  if (!t) return "（无人设描述）";
  return t.length > 72 ? `${t.slice(0, 72)}…` : t;
}

function personaPickerHtml() {
  const personas = globalPersonas;
  const active = activePersonaRecord();
  const nested = lastView?.sessionProtagonist;
  const usingOpening = lastView?.openingPersonaChoice === "opening";
  const activeName =
    usingOpening && nested?.name ? nested.name : active?.name || "玩家";
  const wasOpen = $("persona-menu")?.open === true;

  const cards = personas
    .map((p) => {
      const activeCls = p.id === active?.id ? " is-active" : "";
      if (personaEditingId === p.id) {
        return `<div class="persona-edit" data-persona-edit="${esc(p.id)}">
          <input type="text" name="name" value="${esc(p.name)}" placeholder="角色名" maxlength="40" />
          <textarea name="description" placeholder="简单人设描述（外貌、性格、身份…）">${esc(p.description || "")}</textarea>
          <div class="persona-edit-actions">
            <button type="button" class="btn-sm" data-persona-act="cancel-edit">取消</button>
            <button type="button" class="btn-sm btn-primary" data-persona-act="save-edit" data-id="${esc(p.id)}">保存</button>
          </div>
        </div>`;
      }
      const bindBlock =
        usingOpening && nested && p.id === active?.id
          ? `<div class="persona-card-bind">
            <div class="persona-card-bind-name">${esc(nested.name)}</div>
            ${
              nested.description || nested.summary
                ? `<div class="persona-card-bind-sum">${esc(nested.description || nested.summary)}</div>`
                : ""
            }
          </div>`
          : "";
      return `<div class="persona-card${activeCls}" data-persona-id="${esc(p.id)}" role="button" tabindex="0">
        <div class="persona-card-name">${esc(p.name)}</div>
        <div class="persona-card-desc">${esc(shortPersonaDesc(p.description))}</div>
        ${bindBlock}
        <div class="persona-card-actions">
          <button type="button" data-persona-act="edit" data-id="${esc(p.id)}">编辑</button>
          ${
            personas.length > 1
              ? `<button type="button" data-persona-act="delete" data-id="${esc(p.id)}">删除</button>`
              : ""
          }
        </div>
      </div>`;
    })
    .join("");

  const newForm =
    personaEditingId === "__new__"
      ? `<div class="persona-edit" data-persona-edit="__new__">
          <input type="text" name="name" value="" placeholder="角色名" maxlength="40" />
          <textarea name="description" placeholder="简单人设描述（外貌、性格、身份…）"></textarea>
          <div class="persona-edit-actions">
            <button type="button" class="btn-sm" data-persona-act="cancel-edit">取消</button>
            <button type="button" class="btn-sm btn-primary" data-persona-act="save-new">创建</button>
          </div>
        </div>`
      : "";

  return `<details class="more-menu persona-menu" id="persona-menu"${wasOpen ? " open" : ""}>
    <summary class="persona-menu-sum" title="用户角色（@玩家）">
      <span class="persona-menu-sum-label">我</span>
      <span class="persona-menu-sum-name">${esc(activeName)}</span>
    </summary>
    <div class="persona-menu-panel" role="menu">
      <div class="persona-menu-head">
        <span class="persona-menu-head-title">用户角色</span>
        <button type="button" class="persona-menu-add" data-persona-act="add">＋ 新建</button>
      </div>
      ${newForm}
      ${cards || `<p class="empty" style="margin:8px;font-size:12px">还没有角色</p>`}
    </div>
  </details>`;
}

function renderPersonaPicker() {
  const host = $("persona-picker-host");
  if (!host) return;
  if (!globalPersonas.length && personaEditingId !== "__new__") {
    host.hidden = false;
    host.innerHTML = `<details class="more-menu persona-menu" id="persona-menu">
      <summary class="persona-menu-sum" title="用户角色"><span class="persona-menu-sum-label">我</span><span class="persona-menu-sum-name">未设置</span></summary>
      <div class="persona-menu-panel">
        <div class="persona-menu-head">
          <span class="persona-menu-head-title">用户角色</span>
          <button type="button" class="persona-menu-add" data-persona-act="add">＋ 新建</button>
        </div>
      </div>
    </details>`;
    wirePersonaMenu();
    refreshDirectiveHighlight();
    return;
  }
  host.hidden = false;
  host.innerHTML = personaPickerHtml();
  wirePersonaMenu();
  refreshDirectiveHighlight();
}

async function loadPersonas() {
  try {
    const data = await api("/api/personas");
    globalPersonas = (data.personas || []).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || "",
    }));
    globalActivePersonaId = data.activeId ?? data.active?.id ?? null;
    if (lastView) {
      lastView.personas = globalPersonas.map((p) => ({
        id: p.id,
        name: p.name,
      }));
      const active = activePersonaRecord();
      lastView.activePersona = active
        ? {
            id: active.id,
            name: active.name,
            description: active.description || "",
          }
        : null;
    }
    renderPersonaPicker();
  } catch (err) {
    console.error(err);
  }
}

function keepPersonaMenuOpen() {
  const menu = $("persona-menu");
  if (menu) menu.open = true;
}

function wirePersonaMenu() {
  const host = $("persona-picker-host");
  if (!host) return;

  host.onclick = async (e) => {
    const actBtn = e.target.closest("[data-persona-act]");
    if (actBtn && host.contains(actBtn)) {
      e.preventDefault();
      e.stopPropagation();
      const act = actBtn.getAttribute("data-persona-act");
      const id = actBtn.getAttribute("data-id");
      try {
        if (act === "add") {
          personaEditingId = "__new__";
          renderPersonaPicker();
          keepPersonaMenuOpen();
          host.querySelector(".persona-edit input[name=name]")?.focus();
          return;
        }
        if (act === "edit") {
          personaEditingId = id;
          renderPersonaPicker();
          keepPersonaMenuOpen();
          host.querySelector(".persona-edit input[name=name]")?.focus();
          return;
        }
        if (act === "cancel-edit") {
          personaEditingId = null;
          renderPersonaPicker();
          keepPersonaMenuOpen();
          return;
        }
        if (act === "save-new") {
          const box = host.querySelector("[data-persona-edit='__new__']");
          const name = box?.querySelector("input[name=name]")?.value?.trim() || "";
          const description =
            box?.querySelector("textarea[name=description]")?.value || "";
          if (!name) {
            host.querySelector(".persona-edit input[name=name]")?.focus();
            return;
          }
          await api("/api/personas", {
            method: "POST",
            body: JSON.stringify({ name, description, activate: true }),
          });
          personaEditingId = null;
          await loadPersonas();
          keepPersonaMenuOpen();
          return;
        }
        if (act === "save-edit") {
          const box = host.querySelector(
            `[data-persona-edit="${CSS.escape(id || "")}"]`,
          );
          const name = box?.querySelector("input[name=name]")?.value?.trim() || "";
          const description =
            box?.querySelector("textarea[name=description]")?.value || "";
          if (!name) return;
          await api(`/api/personas/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify({ name, description }),
          });
          personaEditingId = null;
          await loadPersonas();
          keepPersonaMenuOpen();
          return;
        }
        if (act === "delete") {
          if (!confirm("删除这个用户角色？")) return;
          await api(`/api/personas/${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
          personaEditingId = null;
          await loadPersonas();
          keepPersonaMenuOpen();
          return;
        }
      } catch (err) {
        console.error(err);
        alert(err.message || "操作失败");
      }
      return;
    }

    const card = e.target.closest(".persona-card[data-persona-id]");
    if (card && host.contains(card) && !e.target.closest(".persona-card-actions")) {
      e.preventDefault();
      const pid = card.getAttribute("data-persona-id");
      if (!pid || pid === globalActivePersonaId) return;
      try {
        const data = await api(
          `/api/personas/${encodeURIComponent(pid)}/activate`,
          { method: "POST" },
        );
        globalActivePersonaId = data.activeId ?? pid;
        if (Array.isArray(data.personas)) {
          globalPersonas = data.personas.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description || "",
          }));
        }
        personaEditingId = null;
        if (sessionId) {
          const view = await api(
            `/api/sessions/${encodeURIComponent(sessionId)}`,
          );
          renderSession(view);
        } else {
          renderPersonaPicker();
        }
        $("persona-menu")?.removeAttribute("open");
      } catch (err) {
        console.error(err);
      }
    }
  };
}

function composerInputShell(spec, { textareaHtml, trailing = "" } = {}) {
  const chip = composerModeChip(spec);
  const tone = spec.acceptAction?.tone
    ? ` data-tone="${esc(spec.acceptAction.tone)}"`
    : "";
  return `<div class="composer-input-shell" data-task="${esc(spec.task?.id || "")}"${tone}>
    ${chip}
    <div class="composer-input-field">
      <div class="composer-input-backdrop" aria-hidden="true"></div>
      ${textareaHtml}
    </div>
    ${trailing ? `<div class="composer-shell-actions">${trailing}</div>` : ""}
  </div>`;
}

function wireComposerDirectiveUi(input) {
  if (!input) return;
  wireDirectiveAutocomplete(input);
  wireDirectiveHighlight(input, {
    getPersona: () => activePersonaRecord(),
  });
}

function summarizeApiProfile(profile) {
  return {
    id: profile.id,
    name: profile.name || "未命名",
    model: profile.model || "",
    groupId: profile.groupId || "",
    hasKey: Boolean(String(profile.apiKey ?? "").trim()),
  };
}

function activeApiProfile() {
  return apiProfileList.find((p) => p.id === activeApiProfileId) || null;
}

function composerMoreMenuTitle() {
  const active = activeApiProfile();
  return active ? `更多选项 · ${active.name}` : "更多选项";
}

function composerApiSubmenuMeta() {
  if (apiProfileSwitchingId) {
    return { desc: apiProfileSwitchingLabel || "切换中…", title: "API" };
  }
  if (apiProfileMenuStatus === "loading" || apiProfileMenuStatus === "idle") {
    return { desc: "加载中…", title: "API" };
  }
  if (apiProfileMenuStatus === "error") {
    return { desc: "加载失败", title: "API" };
  }
  if (!apiProfileList.length) {
    return { desc: "未配置", title: "API" };
  }
  const active = activeApiProfile();
  const group = apiProfileGroups.find((item) => item.id === active?.groupId);
  const groupName = group?.name ? `${group.name} · ` : "";
  const model = active?.model ? ` · ${active.model}` : "";
  return {
    desc: active ? `${groupName}${active.name}${model}` : "选择配置",
    title: active ? `API · ${active.name}${model}` : "API",
  };
}

function composerProfileButtonHtml(profile, switching) {
  const active = profile.id === activeApiProfileId;
  const disabled = !profile.hasKey || switching;
  const model = profile.model || profile.name || "未指定模型";
  const nameNote =
    profile.name && profile.name !== profile.model ? profile.name : "";
  const desc = !profile.hasKey ? "未设置 Key" : nameNote;
  const forget =
    !active && profile.id
      ? `<button type="button" class="more-profile-forget" data-forget-profile="${attr(profile.id)}" title="移出曾用记录，配置仍保留">移出</button>`
      : "";
  return `<div class="more-profile-row">
      <button
        type="button"
        class="more-menu-item more-theme-item more-profile-item${active ? " is-active" : ""}"
        data-activate-profile="${attr(profile.id)}"
        role="menuitemradio"
        aria-checked="${active ? "true" : "false"}"
        ${disabled ? "disabled" : ""}
        ${profile.id === apiProfileSwitchingId ? "aria-busy=\"true\"" : ""}
        title="${attr(model)}"
      >
        <span class="more-theme-copy">
          <span class="more-theme-name">${esc(model)}</span>
          ${desc ? `<span class="more-theme-desc">${esc(desc)}</span>` : ""}
        </span>
        <span class="more-toggle-mark" aria-hidden="true"></span>
      </button>
      ${forget}
    </div>`;
}

function composerApiProfileItemsHtml() {
  if (apiProfileMenuStatus === "loading" || apiProfileMenuStatus === "idle") {
    return `<p class="more-menu-empty">加载 API 配置…</p>`;
  }
  if (apiProfileMenuStatus === "error") {
    return `<p class="more-menu-empty">无法加载 API 配置。${esc(apiProfileMenuError || "请重试")} <button type="button" class="more-menu-retry" data-reload-profiles>重试</button></p>`;
  }
  if (!apiProfileList.length) {
    return `<p class="more-menu-empty">还没有 API 配置。<a href="/settings.html">去设置添加</a></p>`;
  }
  const switching = Boolean(apiProfileSwitchingId);
  const usage = loadApiProfileUsage();
  const buckets = new Map();
  for (const profile of apiProfileList) {
    const key = profile.groupId || "";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(profile);
  }
  for (const [key, members] of buckets) {
    buckets.set(key, filterUsedApiProfiles(members, usage, activeApiProfileId));
  }
  const ordered = [
    ...apiProfileGroups.filter((group) => buckets.has(group.id)),
    ...[...buckets.keys()]
      .filter((id) => id && !apiProfileGroups.some((group) => group.id === id))
      .map((id) => ({ id, name: "未命名组" })),
  ];
  if (buckets.has("")) ordered.push({ id: "", name: "未分组" });
  const sortedGroups = sortByApiProfileUsage(ordered, (group) =>
    membersUsageRank(buckets.get(group.id) || [], usage),
  );
  return sortedGroups
    .map((group) => {
      const members = buckets.get(group.id) || [];
      if (!members.length) return "";
      if (members.length === 1) {
        return composerProfileButtonHtml(members[0], switching);
      }
      const containsActive = members.some((profile) => profile.id === activeApiProfileId);
      const existing = document.querySelector(
        `#composer-api-menu [data-api-group="${CSS.escape(group.id)}"]`,
      );
      const open = existing ? existing.hasAttribute("open") : containsActive;
      const activeModel = members.find((profile) => profile.id === activeApiProfileId)?.model;
      const desc = activeModel || `${members.length} 个曾用`;
      return `<details class="api-fold" data-api-group="${attr(group.id)}"${open ? " open" : ""}>
        <summary class="more-menu-item more-theme-item api-fold-sum${containsActive ? " is-active" : ""}">
          <span class="more-theme-copy">
            <span class="more-theme-name">${esc(group.name)}</span>
            <span class="more-theme-desc">${esc(desc)}</span>
          </span>
          <span class="api-fold-chevron" aria-hidden="true"></span>
        </summary>
        <div class="api-fold-list" role="group" aria-label="${attr(group.name)}">
          ${members.map((profile) => composerProfileButtonHtml(profile, switching)).join("")}
        </div>
      </details>`;
    })
    .join("");
}

function composerApiSectionHtml() {
  const meta = composerApiSubmenuMeta();
  return `<div class="more-menu-label" id="composer-api-label" title="${attr(meta.title)}">API</div>
    <div id="composer-api-menu" role="group" aria-label="API 配置">${composerApiProfileItemsHtml()}</div>`;
}

function composerMoreMenuHtml() {
  const on = isMarkdownRenderEnabled();
  const wasOpen = $("composer-more-menu")?.hasAttribute("open");
  const title = composerMoreMenuTitle();
  const showClearDictate =
    lastView?.creationMode === "dictate" && !isPlayView(lastView);
  const clearDictateItem = showClearDictate
    ? `<div class="more-menu-sep" role="separator"></div>
      <div class="more-menu-label">对话</div>
      <button
        type="button"
        class="more-menu-item"
        data-act="clear-dictate"
        role="menuitem"
        title="清空对话，保留产物"
      >
        <span class="more-theme-copy">
          <span class="more-theme-name">清空对话</span>
          <span class="more-theme-desc">保留已落盘产物与变量</span>
        </span>
      </button>`
    : "";
  return `<details class="more-menu composer-more-menu" id="composer-more-menu"${wasOpen ? " open" : ""}>
    <summary class="btn-sm more-menu-sum" title="${esc(title)}" aria-label="${esc(title)}">
      <span class="hamburger-icon" aria-hidden="true"></span>
    </summary>
    <div class="more-menu-panel composer-more-panel" role="menu">
      ${composerApiSectionHtml()}
      <div class="more-menu-sep" role="separator"></div>
      <div class="more-menu-label">显示</div>
      <button
        type="button"
        class="more-menu-item more-toggle-item${on ? " is-active" : ""}"
        data-toggle-markdown
        role="menuitemcheckbox"
        aria-checked="${on ? "true" : "false"}"
      >
        <span class="more-theme-copy">
          <span class="more-theme-name">Markdown 渲染</span>
          <span class="more-theme-desc">消息与产物按 Markdown 显示</span>
        </span>
        <span class="more-toggle-mark" aria-hidden="true"></span>
      </button>
      ${clearDictateItem}
    </div>
  </details>`;
}

/** 作曲区图标按钮（tooltip = title / aria-label） */
function composerIconBtn(opts) {
  const {
    act,
    title,
    primary = false,
    kind = "button",
    disabled = false,
    icon,
    extraClass = "",
  } = opts;
  const type = kind === "submit" ? "submit" : "button";
  const cls = [
    "btn",
    "composer-btn-icon",
    primary ? "btn-primary" : "",
    extraClass,
  ]
    .filter(Boolean)
    .join(" ");
  return `<button type="${type}" class="${cls}" data-act="${esc(act)}" title="${esc(
    title,
  )}" aria-label="${esc(title)}"${disabled ? " disabled" : ""}>${icon}</button>`;
}

const COMPOSER_ICON_SAVE = `<svg class="composer-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2.5 1.5h8.2L14 4.8V13.5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm1.2 1.2v3.6h6.4V2.7H3.7Zm0 10.6h8.6V8.2H3.7v5.1Zm7.4-11.3.9.9H11v-1h.1Z"/></svg>`;
const COMPOSER_ICON_SEND = `<svg class="composer-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M1.4 2.1 14.6 8 1.4 13.9l.2-4.4L10 8 1.6 6.5l-.2-4.4Z"/></svg>`;

function syncApiProfileMenuUi() {
  const host = $("composer-api-menu");
  if (host) host.innerHTML = composerApiProfileItemsHtml();
  const meta = composerApiSubmenuMeta();
  const label = $("composer-api-label");
  if (label) label.title = meta.title;
  const sum = document.querySelector("#composer-more-menu .more-menu-sum");
  if (sum) {
    const title = composerMoreMenuTitle();
    sum.title = title;
    sum.setAttribute("aria-label", title);
  }
}

async function loadApiProfiles() {
  apiProfileMenuStatus = "loading";
  apiProfileMenuError = "";
  syncApiProfileMenuUi();
  try {
    const data = await api("/api/profiles");
    apiProfileList = (data.profiles || []).map(summarizeApiProfile);
    apiProfileGroups = data.groups || [];
    activeApiProfileId = data.activeProfileId ?? apiProfileList[0]?.id ?? null;
    pruneApiProfileUsage(new Set(apiProfileList.map((p) => p.id)));
    seedApiProfileUsage(activeApiProfileId);
    apiProfileMenuStatus = "ready";
    syncApiProfileMenuUi();
  } catch (err) {
    apiProfileMenuStatus = "error";
    apiProfileMenuError = err.message || "请求失败";
    syncApiProfileMenuUi();
  }
}

function closeComposerMoreMenu(menu) {
  menu?.removeAttribute("open");
}

async function activateApiProfileFromMenu(id, menu) {
  if (!id || id === activeApiProfileId) {
    closeComposerMoreMenu(menu);
    return;
  }
  const profile = apiProfileList.find((p) => p.id === id);
  if (!profile?.hasKey) return;
  apiProfileSwitchingId = id;
  apiProfileSwitchingLabel = profile ? `切换到 ${profile.name}…` : "切换中…";
  syncApiProfileMenuUi();
  try {
    const result = await api(`/api/profiles/${encodeURIComponent(id)}/activate`, {
      method: "POST",
    });
    activeApiProfileId = result.activeProfileId || id;
    recordApiProfileUsage(activeApiProfileId);
    apiProfileSwitchingId = null;
    apiProfileSwitchingLabel = "";
    syncApiProfileMenuUi();
    closeComposerMoreMenu(menu);
  } catch (err) {
    apiProfileSwitchingId = null;
    apiProfileSwitchingLabel = "";
    syncApiProfileMenuUi();
    alert(err.message || "切换失败");
  }
}

function composerFormHtml(shell) {
  return `<form class="composer-form" id="composer-form">${composerMoreMenuHtml()}${shell}</form>`;
}

function syncMarkdownMenuUi() {
  const mdOn = isMarkdownRenderEnabled();
  document.querySelectorAll("[data-toggle-markdown]").forEach((btn) => {
    btn.classList.toggle("is-active", mdOn);
    btn.setAttribute("aria-checked", mdOn ? "true" : "false");
  });
}

function syncThemeMenuUi() {
  const colorId = document.documentElement.getAttribute("data-color-theme") || getStoredColorTheme();
  const percent = getStoredUiFontScale();
  const colorMeta = themeById(colorId);
  const sum = $("theme-menu-sum");
  if (sum) {
    sum.title = `${colorMeta.name} · 字号 ${percent}`;
    if (!sum.querySelector(".hamburger-icon")) {
      sum.innerHTML = `<span class="hamburger-icon" aria-hidden="true"></span>`;
    }
  }
  document.querySelectorAll("[data-color-theme].more-theme-item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-color-theme") === colorMeta.id);
  });
  const valueEl = $("theme-font-scale-value");
  if (valueEl) valueEl.textContent = String(percent);
  const minus = document.querySelector("[data-font-scale-bump='-1']");
  const plus = document.querySelector("[data-font-scale-bump='1']");
  if (minus) minus.disabled = percent <= UI_FONT_SCALE_MIN;
  if (plus) plus.disabled = percent >= UI_FONT_SCALE_MAX;
  syncMarkdownMenuUi();
}

function stashComposerDraftFromDom() {
  if (skipComposerStash) {
    skipComposerStash = false;
    return;
  }
  const input = $("composer-input");
  if (!input) return;
  const v = String(input.value ?? "");
  if (v) {
    pendingComposerDraft = v;
    pendingComposerDraftSeq = 0;
  }
}

function keepComposerDraft(text) {
  const v = String(text ?? "");
  if (!v) return;
  pendingComposerDraft = v;
  pendingComposerDraftSeq = 0;
}

function dropComposerDraft() {
  pendingComposerDraft = "";
  pendingComposerDraftSeq = 0;
}

function clearComposerInput() {
  const input = $("composer-input");
  if (!input) return;
  input.value = "";
  autosizeComposerInput(input);
  syncPickReplanButton(input);
  refreshReviewComposerChrome();
  refreshDirectiveHighlight(input);
}

/** 正文已提交：立刻清空底栏，且后续重绘不要把刚发出去的字再塞回来。 */
function beginComposerSubmit() {
  dropComposerDraft();
  clearComposerInput();
  skipComposerStash = true;
}

function endComposerSubmit() {
  skipComposerStash = false;
}

function renderPreferenceReview(view) {
  const host = $("preference-review");
  if (!host) return;
  const items = Array.isArray(view?.preferenceReview) ? view.preferenceReview : [];
  if (!items.length) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  host.innerHTML = "";
  items.forEach((c, i) => {
    const card = document.createElement("article");
    card.className = "preference-review-card";
    card.dataset.candidateId = c.id;

    const head = document.createElement("header");
    head.className = "preference-review-head";
    const title = document.createElement("strong");
    title.textContent = `偏好候选${items.length > 1 ? ` ${i + 1}/${items.length}` : ""}`;
    const hint = document.createElement("span");
    hint.className = "preference-review-hint";
    hint.textContent = "可编辑后收下；本局正文不受影响";
    head.append(title, hint);

    const ta = document.createElement("textarea");
    ta.className = "preference-review-content";
    ta.rows = 3;
    ta.value = c.content ?? "";

    const actions = document.createElement("div");
    actions.className = "preference-review-actions";
    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "btn-primary";
    acceptBtn.textContent = "收下";
    acceptBtn.addEventListener("click", () => {
      resolvePreferenceReview(c.id, "accept", ta.value);
    });
    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "btn-secondary";
    rejectBtn.textContent = "不要";
    rejectBtn.addEventListener("click", () => {
      resolvePreferenceReview(c.id, "reject");
    });
    actions.append(acceptBtn, rejectBtn);

    card.append(head, ta, actions);
    host.appendChild(card);
  });
}

async function resolvePreferenceReview(candidateId, action, content) {
  if (!sessionId) return;
  try {
    const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/preferences/review`, {
      method: "POST",
      body: JSON.stringify({
        candidateId,
        action,
        ...(action === "accept" ? { content } : {}),
      }),
    });
    renderSession(view);
  } catch (err) {
    alert(err.message || "审核失败");
  }
}

function renderComposer(view, loading) {
  stashComposerDraftFromDom();
  if (pendingComposerDraft) composerForceInput = true;
  const host = $("composer");
  const root = $("composer-main") || host;
  if (!root || !host) return;
  renderPreferenceReview(view);
  if (host._enterHandler) {
    document.removeEventListener("keydown", host._enterHandler);
    host._enterHandler = null;
  }
  const spec = resolveComposer(view, loading);
  if (spec.mode === "waiting") {
    const shell = composerInputShell(
      { ...spec, task: { ...(spec.task || {}), id: "busy", label: spec.task?.label || "生成中" } },
      {
        textareaHtml: `<textarea id="composer-input" rows="1" placeholder="生成中…可提前停止或重roll"></textarea>`,
        trailing: `<button type="button" class="btn composer-btn-icon" data-act="abort_run" title="提前停止" aria-label="提前停止">□</button>
          <button type="button" class="btn composer-btn-icon" data-act="retry_run" title="重roll" aria-label="重roll">🔄</button>`,
      },
    );
    root.innerHTML = composerFormHtml(shell);
    root.querySelector("#composer-form")?.addEventListener("submit", (e) => e.preventDefault());
    root.querySelector("[data-act=abort_run]")?.addEventListener("click", () => abortRun());
    root.querySelector("[data-act=retry_run]")?.addEventListener("click", () => retryRun());
    applyPendingComposerDraft();
    const input = $("composer-input");
    if (input) {
      autosizeComposerInput(input);
      wireComposerDirectiveUi(input);
    }
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
    const shell = composerInputShell(spec, {
      textareaHtml: `<textarea id="composer-input" rows="1" placeholder="${esc(spec.placeholder)}"></textarea>`,
      trailing: composerIconBtn({
        act: "send",
        title: "发送",
        primary: true,
        kind: "submit",
        icon: COMPOSER_ICON_SEND,
      }),
    });
    root.innerHTML = `
      ${intakePanel}
      ${confirm}
      ${composerFormHtml(shell)}`;
    wireComposerForm();
    root.querySelector("[data-act=confirm_intake]")?.addEventListener("click", () => runAction("confirm_intake"));
    applyPendingComposerDraft();
    return;
  }

  if (spec.mode === "action") {
    const reject = spec.showReject
      ? `<button type="button" class="btn" data-act="reject">${spec.primaryType === "approve" ? "返回节点" : "不接受"}</button>
         <button type="button" class="btn" data-act="force-input">说明意见</button>`
      : "";
    const chip = composerModeChip(spec);
    root.innerHTML = `
      <div class="composer-actions composer-actions-with-chip">
        ${chip}
        <button type="button" class="btn btn-primary" data-act="${esc(spec.primaryType)}" title="Enter">${esc(spec.primary.label)}</button>
        ${reject}
      </div>`;
    root.querySelector(`[data-act="${spec.primaryType}"]`)?.addEventListener("click", () => runAction(spec.primaryType));
    root.querySelector("[data-act=reject]")?.addEventListener("click", () => runAction("reject"));
    root.querySelector("[data-act=force-input]")?.addEventListener("click", () => {
      composerForceInput = true;
      renderComposer(view, loading);
    });
    wireComposerActionEnter(spec.primaryType);
    return;
  }

  if (spec.mode === "propose_step") {
    const p = spec.proposed;
    const missing = new Set(p.paramsMissing || []);
    const originalTarget = String(p.params?.target ?? "").trim();
    const originalRuleId = String(p.params?.rule_id ?? "").trim();
    const visible = proposeVisibleFields(p);
    const fields = visible
      .map((field) => {
        const val = p.params?.[field.key];
        const str =
          val == null ? "" : typeof val === "string" ? val : JSON.stringify(val);
        const need = missing.has(field.key);
        const hint = proposeFieldHint(field, p);
        return `<label class="propose-field${need ? " is-missing" : ""}${
          field.key === "rule_id" ? " propose-field-id" : ""
        }">
          <span class="propose-field-label">${esc(proposeFieldLabel(field))}${
            need ? `<span class="propose-req">需补充</span>` : ""
          }</span>
          <input type="text" data-param-key="${esc(field.key)}" value="${esc(str)}" placeholder="${esc(hint)}" />
        </label>`;
      })
      .join("");
    const syncHint =
      visible.some((f) => f.key === "target") && visible.some((f) => f.key === "rule_id")
        ? `<p class="propose-sync-hint">改生成对象时，后台 id 也要改成对应英文（如丧尸怪物 → zombies）。</p>`
        : "";
    const planHint =
      p.kind === "prior-artifact"
        ? `<p class="propose-plan-hint">${
            originalTarget
              ? "编排器已规划对象，步骤内可修订。"
              : "具体写什么在步骤内确定。"
          }</p>`
        : "";
    const closerHint = p.closer
      ? `<p class="propose-plan-hint">这是收口步。若还没做 NPC 等前序节点，点「改意见」说明要补什么，会回到流程编排。</p>`
      : "";
    root.innerHTML = `
      <div class="propose-step" id="propose-step" data-step-id="${esc(p.stepId)}">
        <div class="propose-step-head">
          <span class="propose-kicker">${p.mode === "revise" ? "回头修改" : "下一步"}</span>
          <strong class="propose-name">${esc(p.name)}</strong>
        </div>
        <p class="propose-output" data-propose-output>${esc(proposedOutputCopy(p))}</p>
        ${planHint}
        ${closerHint}
        ${fields ? `<div class="propose-fields">${fields}</div>` : ""}
        ${syncHint}
        <div class="composer-actions">
          <button type="button" class="btn btn-primary" data-act="approve">${esc(spec.primary.label)}</button>
          <button type="button" class="btn" data-act="reject" title="先不写这一步，回到节点选择">返回节点</button>
          <button type="button" class="btn" data-act="force-input">改意见</button>
        </div>
      </div>`;
    const targetInput = root.querySelector('[data-param-key="target"]');
    const ruleIdInput = root.querySelector('[data-param-key="rule_id"]');
    const outputEl = root.querySelector("[data-propose-output]");
    const refreshOutput = () => {
      if (!outputEl || !targetInput) return;
      const next = {
        ...p,
        params: { ...(p.params || {}), target: String(targetInput.value ?? "").trim() },
      };
      outputEl.textContent = proposedOutputCopy(next);
    };
    const markRuleIdSync = () => {
      if (!targetInput || !ruleIdInput) return;
      const nextTarget = String(targetInput.value ?? "").trim();
      const nextRuleId = String(ruleIdInput.value ?? "").trim();
      const targetChanged = Boolean(originalTarget) && nextTarget !== originalTarget;
      const ruleStale =
        targetChanged && Boolean(originalRuleId) && nextRuleId === originalRuleId;
      ruleIdInput.closest(".propose-field")?.classList.toggle("is-stale-id", ruleStale);
    };
    targetInput?.addEventListener("input", () => {
      refreshOutput();
      markRuleIdSync();
    });
    ruleIdInput?.addEventListener("input", markRuleIdSync);
    const approvePropose = () => {
      const stepParams = { ...(p.params || {}) };
      root.querySelectorAll("[data-param-key]").forEach((input) => {
        const key = input.getAttribute("data-param-key");
        if (!key) return;
        const v = String(input.value ?? "").trim();
        if (v) stepParams[key] = v;
        else delete stepParams[key];
      });
      const nextTarget = String(stepParams.target ?? "").trim();
      const nextRuleId = String(stepParams.rule_id ?? "").trim();
      if (
        originalTarget &&
        nextTarget &&
        nextTarget !== originalTarget &&
        originalRuleId &&
        nextRuleId === originalRuleId
      ) {
        alert("生成对象已改，请把后台 id 改成对应英文（例如丧尸怪物 → zombies），不要沿用旧 id。");
        ruleIdInput?.focus();
        markRuleIdSync();
        return;
      }
      void runAction("approve", { stepParams });
    };
    root.querySelector("[data-act=approve]")?.addEventListener("click", approvePropose);
    root.querySelector("[data-act=reject]")?.addEventListener("click", () => runAction("reject"));
    root.querySelector("[data-act=force-input]")?.addEventListener("click", () => {
      composerForceInput = true;
      renderComposer(view, loading);
    });
    wireComposerActionEnter("approve", { onEnter: approvePropose, allowInInputs: true });
    return;
  }

  if (spec.mode === "pick_step") {
    const saveProduct = canOfferSaveProduct(view)
      ? composerIconBtn({
          act: "save-product",
          title: "保存定稿",
          primary: true,
          icon: COMPOSER_ICON_SAVE,
        })
      : "";
    const sendClsPrimary = !canOfferSaveProduct(view);
    const shell = composerInputShell(spec, {
      textareaHtml: `<textarea id="composer-input" rows="1" placeholder="${esc(spec.placeholder)}"></textarea>`,
      trailing: `${saveProduct}${composerIconBtn({
        act: "pick-replan",
        title: spec.submitLabel || "发送",
        primary: sendClsPrimary,
        kind: "submit",
        disabled: true,
        icon: COMPOSER_ICON_SEND,
      })}`,
    });
    root.innerHTML = composerFormHtml(shell);
    wireComposerForm({ requiresText: true });
    root.querySelector("[data-act=save-product]")?.addEventListener("click", () => {
      void saveCurrentInstance();
    });
    applyPendingComposerDraft();
    return;
  }

  const acceptOnEmpty = Boolean(spec.acceptAction);
  const acceptTone = spec.acceptAction?.tone || "accept";
  const acceptBtn = spec.acceptAction
    ? `<button type="button" class="btn composer-btn-accept${
        acceptTone === "accept" ? " composer-btn-review" : ""
      }${acceptOnEmpty ? " btn-primary" : ""}" data-act="accept" title="${esc(
        spec.acceptAction.disabled
          ? spec.acceptAction.disabledTitle || "暂不可确认"
          : spec.acceptAction.title || spec.acceptAction.label
      )}" ${spec.acceptAction.disabled ? "disabled" : ""}>${esc(spec.acceptAction.label)}</button>`
    : "";
  const saveProduct = canOfferSaveProduct(view)
    ? composerIconBtn({
        act: "save-product",
        title: "保存定稿",
        primary: true,
        icon: COMPOSER_ICON_SAVE,
      })
    : "";
  const submitLabel = spec.submitLabel || "发送";
  const sendIsPrimary = !acceptOnEmpty && !saveProduct;
  const placeholder = acceptOnEmpty
    ? `${spec.placeholder || "修改意见…"}（${spec.emptyEnterHint || "空 Enter＝确认"}）`
    : spec.placeholder;
  const sendTitle = acceptOnEmpty
    ? `有字或已选追问时 Enter＝${submitLabel}`
    : `${submitLabel}（Enter）`;
  const shell = composerInputShell(spec, {
    textareaHtml: `<textarea id="composer-input" rows="1" placeholder="${esc(placeholder)}"></textarea>`,
    trailing: `${saveProduct}${composerIconBtn({
      act: "revise",
      title: sendTitle,
      primary: sendIsPrimary,
      icon: COMPOSER_ICON_SEND,
    })}${acceptBtn}`,
  });
  root.innerHTML = composerFormHtml(shell);
  wireComposerForm({ acceptOnEmpty });
  root.querySelector("[data-act=accept]")?.addEventListener("click", () => runAction("accept"));
  root.querySelector("[data-act=save-product]")?.addEventListener("click", () => {
    void saveCurrentInstance();
  });
  applyPendingComposerDraft();
}

function composerTextareaMaxPx(el) {
  const raw = getComputedStyle(el).maxHeight;
  const n = Number.parseFloat(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return Math.min(window.innerHeight * 0.42, 360);
}

/** SillyTavern 式：高度随内容上长，触顶后框内滚动 */
function autosizeComposerInput(el) {
  if (!el) return;
  const max = composerTextareaMaxPx(el);
  el.style.height = "auto";
  el.style.overflowY = "hidden";
  const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 21;
  const floor = Math.ceil(line);
  const next = Math.min(Math.max(el.scrollHeight, floor), max);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > max + 1 ? "auto" : "hidden";
}

function applyPendingComposerDraft() {
  if (!pendingComposerDraft) return;
  if (pendingComposerDraftSeq && pendingComposerDraftSeq !== inflightSeq) {
    pendingComposerDraft = "";
    pendingComposerDraftSeq = 0;
    return;
  }
  const input = $("composer-input");
  if (!input) return;
  input.value = pendingComposerDraft;
  pendingComposerDraft = "";
  pendingComposerDraftSeq = 0;
  autosizeComposerInput(input);
  syncPickReplanButton(input);
  input.focus();
  refreshReviewComposerChrome();
  refreshDirectiveHighlight(input);
}

/** 无输入框的确认态：Enter = 主按钮 */
function wireComposerActionEnter(action, opts = {}) {
  const root = $("composer");
  if (!root) return;
  const prev = root._enterHandler;
  if (prev) document.removeEventListener("keydown", prev);
  const handler = (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.isComposing) return;
    const t = e.target;
    const tag = t?.tagName;
    if (t?.isContentEditable || tag === "TEXTAREA") return;
    if (tag === "INPUT" && !opts.allowInInputs) return;
    if (t?.closest?.(".questions-card-host [contenteditable=true], .qcard-other-input, .msg-edit-input")) {
      return;
    }
    e.preventDefault();
    if (typeof opts.onEnter === "function") opts.onEnter();
    else void runAction(action);
  };
  root._enterHandler = handler;
  document.addEventListener("keydown", handler);
}

function refreshReviewComposerChrome() {
  const input = $("composer-input");
  const acceptBtn = $("composer")?.querySelector("[data-act=accept]");
  const sendBtn = $("composer")?.querySelector("[data-act=revise]");
  if (!acceptBtn || !sendBtn) return;
  syncDualComposerPrimary(input, acceptBtn, sendBtn);
  if (!input || lastView?.waitingReason?.kind !== "review_artifact") return;
  const copy = reviewCopyFromView(lastView);
  const empty = !String(input.value ?? "").trim();
  const hasAnswers = selectedQuestionAnswers(lastView).answered.length > 0;
  input.placeholder = hasAnswers && empty
    ? `${copy.placeholder}（Enter＝${copy.submitLabel}）`
    : `${copy.placeholder}（${copy.emptyEnterHint}）`;
}

function syncDualComposerPrimary(input, acceptBtn, sendBtn) {
  if (!acceptBtn || !sendBtn) return;
  const empty = !String(input?.value ?? "").trim();
  const hasAnswers = selectedQuestionAnswers(lastView).answered.length > 0;
  const revisePrimary = !empty || hasAnswers;
  acceptBtn.classList.toggle("btn-primary", !revisePrimary && !acceptBtn.disabled);
  sendBtn.classList.toggle("btn-primary", revisePrimary);
}

function syncPickReplanButton(input) {
  const btn = $("composer-form")?.querySelector("[data-act=pick-replan]");
  if (!btn) return;
  const hasText = Boolean(String(input?.value ?? "").trim());
  btn.disabled = !hasText;
  const tip = hasText
    ? "发送改编排意见"
    : "写下意见后再发；点图上节点即确认并进入";
  btn.title = tip;
  btn.setAttribute("aria-label", tip);
}

function wireComposerForm(opts = {}) {
  const form = $("composer-form");
  const input = $("composer-input");
  const acceptOnEmpty = opts.acceptOnEmpty === true;
  const requiresText = opts.requiresText === true;
  const sendBtn = form?.querySelector("[data-act=revise]");
  const root = $("composer");
  if (root?._enterHandler) {
    document.removeEventListener("keydown", root._enterHandler);
    root._enterHandler = null;
  }
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitComposer(input?.value ?? "", { acceptOnEmpty, requiresText });
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submitComposer(input?.value ?? "", { acceptOnEmpty, requiresText });
    }
  });
  sendBtn?.addEventListener("click", () => {
    void sendText(input?.value ?? "");
  });
  if (acceptOnEmpty) {
    const handler = (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.isComposing) return;
      const t = e.target;
      const tag = t?.tagName;
      if (t?.isContentEditable || tag === "TEXTAREA" || tag === "INPUT") return;
      if (t?.closest?.(".msg-edit-input, .qcard-other-input, .questions-card-host [contenteditable=true]")) {
        return;
      }
      e.preventDefault();
      void submitComposer(input?.value ?? "", { acceptOnEmpty: true });
    };
    root._enterHandler = handler;
    document.addEventListener("keydown", handler);
  }
  const grow = () => {
    autosizeComposerInput(input);
    if (acceptOnEmpty) refreshReviewComposerChrome();
    if (requiresText) syncPickReplanButton(input);
  };
  input?.addEventListener("input", grow);
  input?.addEventListener("change", grow);
  requestAnimationFrame(grow);
  wireComposerDirectiveUi(input);
  input?.focus();
}

function isPlayNow() {
  return isPlayView(lastView);
}

function playRunsForBook(bookId) {
  return (playSavesByBook.get(bookId) ?? []).filter((s) => s.kind === "run");
}

function productInstancesForBook(bookId) {
  return (playSavesByBook.get(bookId) ?? []).filter((s) => s.kind === "instance");
}

function resolveRunInstanceId(run, products) {
  if (run.instanceId && products.some((p) => p.id === run.instanceId)) {
    return run.instanceId;
  }
  if (!products.length) return null;
  const sorted = [...products].sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt)),
  );
  let id = sorted[0].id;
  for (const product of sorted) {
    if (String(product.createdAt) <= String(run.createdAt)) id = product.id;
  }
  return id;
}

function runsForProduct(bookId, instanceId, products) {
  return playRunsForBook(bookId).filter(
    (run) => resolveRunInstanceId(run, products) === instanceId,
  );
}

function bookPlayReady(bookId) {
  if (lastView?.bookId === bookId && Boolean(lastView?.playReady || lastView?.hasProduct)) {
    return true;
  }
  const saves = playSavesByBook.get(bookId);
  if (!Array.isArray(saves)) return false;
  return saves.some((s) => s.kind === "instance" || s.kind === "run");
}

function formatSaveWhen(createdAt) {
  const when = new Date(createdAt);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function fetchPlaySavesForBook(bookId, force = false) {
  if (!force && (playSavesByBook.has(bookId) || playSavesLoading.has(bookId))) return;
  playSavesLoading.add(bookId);
  try {
    const data = await api(`/api/books/${encodeURIComponent(bookId)}/saves`);
    playSavesByBook.set(bookId, data.saves ?? []);
    playWorkingInstanceByBook.set(bookId, data.playWorkingInstanceId ?? null);
  } catch {
    playSavesByBook.set(bookId, []);
    playWorkingInstanceByBook.set(bookId, null);
  } finally {
    playSavesLoading.delete(bookId);
    renderBookList();
  }
}

function setBookSelectMode(on, { keepSelection = false } = {}) {
  if (on && sidebarNav.level !== "root") return;
  if (on) hideEnterPicker();
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

function hideEnterPicker() {
  document.querySelectorAll(".explorer-folder.is-picking").forEach((el) => {
    el.classList.remove("is-picking");
  });
  const pop = $("book-enter-pop");
  if (pop) pop.hidden = true;
  enterPickerBookId = null;
}

function showEnterPicker(bookId, anchorEl) {
  const pop = $("book-enter-pop");
  if (!pop || !anchorEl) return;
  hideBookMenu();
  hideSaveMenu();
  enterPickerBookId = bookId;
  document.querySelectorAll(".explorer-folder.is-picking").forEach((el) => {
    el.classList.remove("is-picking");
  });
  anchorEl.classList.add("is-picking");
  const playBtn = pop.querySelector("[data-enter=play]");
  const ready = bookPlayReady(bookId);
  if (playBtn) {
    playBtn.disabled = !ready;
    playBtn.title = ready ? "进入游玩" : "验收后可游玩";
  }
  pop.hidden = false;
  const rect = anchorEl.getBoundingClientRect();
  // 与右键菜单同一套定位（消化 html zoom）
  placeMenu(pop, rect.right + 8, rect.top);
}

let saveMenuState = { bookId: null, saveId: null, label: "" };

function hideSaveMenu() {
  const menu = $("save-action-menu");
  if (menu) menu.hidden = true;
  saveMenuState = { bookId: null, saveId: null, label: "" };
}

function placeFixedMenu(menu, x, y) {
  placeMenu(menu, x, y);
}

function showSaveMenu(bookId, saveId, label, x, y) {
  const menu = $("save-action-menu");
  if (!menu) return;
  hideEnterPicker();
  hideBookMenu();
  saveMenuState = { bookId, saveId, label: label || "" };
  placeFixedMenu(menu, x, y);
}

async function openSnapshotProductsEditor(bookId, saveId, label) {
  const dlg = $("dialog-snapshot-products");
  const title = $("snapshot-products-title");
  const meta = $("snapshot-products-meta");
  const body = $("snapshot-products-body");
  if (!dlg || !body) return;
  if (title) title.textContent = label ? `产物 · ${label}` : "快照产物";
  if (meta) meta.textContent = "按创作步骤展开；点「改」手改正文后保存。";
  body.innerHTML = `<p class="empty-sm">加载中…</p>`;
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");

  try {
    const data = await api(
      `/api/books/${encodeURIComponent(bookId)}/saves/${encodeURIComponent(saveId)}`,
    );
    const products = Array.isArray(data.products) ? data.products : [];
    if (!products.length) {
      body.innerHTML = `<p class="empty-sm">这份快照里还没有可编辑产物。</p>`;
      return;
    }
    body.innerHTML = products
      .map((p, i) => {
        const preview = String(p.content || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);
        return `<div class="snap-product" data-idx="${i}" data-tag="${esc(p.tag)}">
          <div class="snap-product-head">
            <span class="snap-product-label">${esc(p.label || p.tag)}</span>
            <span class="snap-product-tag">${esc(p.tag)}</span>
            <button type="button" class="btn-sm snap-product-edit" data-snap-edit="${i}">改</button>
          </div>
          <div class="snap-product-preview" data-snap-preview="${i}">${esc(preview)}${
            String(p.content || "").length > 160 ? "…" : ""
          }</div>
        </div>`;
      })
      .join("");
    body.dataset.bookId = bookId;
    body.dataset.saveId = saveId;
    body._products = products;
  } catch (err) {
    body.innerHTML = `<p class="empty-sm">${esc(err.message || "读取失败")}</p>`;
  }
}

async function saveSnapshotProductEdit(bookId, saveId, tag, content, rowEl, products, idx) {
  const data = await api(
    `/api/books/${encodeURIComponent(bookId)}/saves/${encodeURIComponent(saveId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ tag, content }),
    },
  );
  const next = Array.isArray(data.products) ? data.products : products;
  const body = $("snapshot-products-body");
  if (body) body._products = next;
  const updated = next.find((p) => p.tag === tag) || { tag, content, label: tag };
  products[idx] = updated;
  const preview = String(updated.content || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  rowEl.innerHTML = `
    <div class="snap-product-head">
      <span class="snap-product-label">${esc(updated.label || updated.tag)}</span>
      <span class="snap-product-tag">${esc(updated.tag)}</span>
      <button type="button" class="btn-sm snap-product-edit" data-snap-edit="${idx}">改</button>
    </div>
    <div class="snap-product-preview" data-snap-preview="${idx}">${esc(preview)}${
      String(updated.content || "").length > 160 ? "…" : ""
    }</div>`;
}

function refreshBookMenuLabels() {
  const n = selectedBookIds.size;
  const multi = bookSelectMode && n > 0;
  const bookId = bookMenuBookId;
  const ready = bookId ? bookPlayReady(bookId) : false;
  const thisBook = bookId && bookId === activeBookId;
  $("book-menu-open")?.toggleAttribute("hidden", true);
  $("book-menu-play")?.toggleAttribute("hidden", true);
  $("book-menu-save-instance")?.toggleAttribute("hidden", multi || !thisBook || !ready);
  $("book-menu-save-play")?.toggleAttribute(
    "hidden",
    multi || !thisBook || !ready || !isPlayNow(),
  );
  $("book-menu-export")?.toggleAttribute(
    "hidden",
    multi || !thisBook || !(lastView?.messages?.length),
  );
  $("book-menu-rename")?.toggleAttribute("hidden", n > 1);
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
  hideEnterPicker();
  hideSaveMenu();
  bookMenuBookId = bookId;
  refreshBookMenuLabels();
  placeFixedMenu(menu, x, y);
}

function isCatalogNav() {
  return sidebarNav.level === "root";
}

function isWorkspaceNav() {
  return sidebarNav.level === "book";
}

function getNavBook() {
  if (!isWorkspaceNav() || !sidebarNav.bookId) return null;
  return books.find((b) => b.id === sidebarNav.bookId) ?? null;
}

function catalogBookMeta(book) {
  const saves = playSavesByBook.get(book.id);
  if (saves === undefined) {
    void fetchPlaySavesForBook(book.id);
    return "";
  }
  if (playWorkingInstanceByBook.get(book.id)) return "游玩中";
  if (saves.some((s) => s.kind === "instance" || s.kind === "run")) return "可游玩";
  return "创作中";
}

function specOwnsWorkingPlay(book, specId) {
  const playingId = playingInstanceIdForBook(book);
  if (!playingId) return false;
  const products = productInstancesForBook(book.id);
  if (products.some((p) => p.id === playingId)) return playingId === specId;
  return products[0]?.id === specId;
}

function defaultExpandedSpecIds(bookId) {
  const products = productInstancesForBook(bookId);
  const playing = playingInstanceIdForBook({ id: bookId });
  const target =
    playing && products.some((p) => p.id === playing) ? playing : products[0]?.id;
  return target ? new Set([target]) : new Set();
}

function specIsExpanded(bookId, specId) {
  const set = expandedSpecsByBook.get(bookId);
  if (set) return set.has(specId);
  return defaultExpandedSpecIds(bookId).has(specId);
}

function toggleSpecExpanded(bookId, specId) {
  const next = new Set(expandedSpecsByBook.get(bookId) ?? defaultExpandedSpecIds(bookId));
  if (next.has(specId)) next.delete(specId);
  else next.add(specId);
  expandedSpecsByBook.set(bookId, next);
  renderBookList();
}

function ensureSpecExpanded(bookId, specId) {
  if (!bookId) return;
  if (specId) {
    const next = new Set(expandedSpecsByBook.get(bookId) ?? defaultExpandedSpecIds(bookId));
    next.add(specId);
    expandedSpecsByBook.set(bookId, next);
  }
  navigateToBook(bookId);
}

function pathSep() {
  const li = document.createElement("li");
  li.className = "path-bar-item";
  li.setAttribute("aria-hidden", "true");
  const sep = document.createElement("span");
  sep.className = "path-sep";
  sep.textContent = "›";
  li.appendChild(sep);
  return li;
}

function pathItem({ label, title, current, onClick }) {
  const li = document.createElement("li");
  li.className = current ? "path-bar-item path-bar-item-current" : "path-bar-item";
  const el = document.createElement(current || !onClick ? "span" : "button");
  el.className = current ? "path-seg current" : "path-seg";
  if (el.tagName === "BUTTON") el.type = "button";
  if (current) el.setAttribute("aria-current", "page");
  el.textContent = label;
  if (title) el.title = title;
  if (!current && onClick) el.addEventListener("click", onClick);
  li.appendChild(el);
  return li;
}

function renderPathBar() {
  const bar = $("book-path-bar");
  if (!bar) return;
  bar.innerHTML = "";
  const book = getNavBook();
  const inBook = Boolean(book);

  $("rail-tabs")?.toggleAttribute("hidden", !(isWorkspaceNav() || Boolean(activeBookId)));

  const list = document.createElement("ol");
  list.className = "path-bar-list";
  list.appendChild(
    pathItem({
      label: "目录",
      title: "作品目录",
      current: !inBook,
      onClick: () => showCatalog({ closeSession: false }),
    }),
  );
  if (inBook) {
    const bookLabel = book.title?.trim() || "作品";
    list.appendChild(pathSep());
    list.appendChild(
      pathItem({
        label: bookLabel,
        title: bookLabel,
        current: true,
      }),
    );
  }
  bar.appendChild(list);
}

function navigateToBook(bookId) {
  if (!bookId) return;
  hideEnterPicker();
  sidebarNav = { level: "book", bookId };
  document.body.dataset.navLevel = "book";
  bookSelectMode = false;
  selectedBookIds = new Set();
  setRailTab("books", { expand: true });
  renderPathBar();
  renderBookList();
  void fetchPlaySavesForBook(bookId);
}

function showCatalog({ closeSession = true } = {}) {
  hideEnterPicker();
  if (closeSession) {
    beginUiRequest();
    stopLivePoll();
    closeWorkspace();
  }
  sidebarNav = { level: "root" };
  document.body.dataset.navLevel = "root";
  bookSelectMode = false;
  selectedBookIds = new Set();
  renderPathBar();
  renderBookList();
  if (!closeSession) rememberWorkspaceSession();
}

function renderExplorerRow({
  name,
  meta,
  active,
  selected,
  bookId,
  actionClass,
  onClick,
  onDelete,
  onRename,
  onContextMenu,
  child,
  twistie,
  expanded,
  onTwistie,
  title,
  ariaExpanded,
}) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = [
    "explorer-row",
    actionClass,
    active ? "active" : "",
    selected ? "selected" : "",
    child ? "child" : "",
    twistie ? "has-twist" : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (bookId) row.dataset.bookId = bookId;
  if (title) row.title = title;
  if (typeof ariaExpanded === "boolean") {
    row.setAttribute("aria-expanded", ariaExpanded ? "true" : "false");
  }
  row.innerHTML = `
    ${twistie ? `<span class="explorer-twist" data-twist>${expanded ? "▾" : "▸"}</span>` : ""}
    <span class="explorer-main">
      <span class="explorer-name" title="${esc(name)}">${esc(name)}</span>
      ${meta ? `<span class="explorer-meta" title="${esc(meta)}">${esc(meta)}</span>` : ""}
    </span>
    ${onDelete ? `<span class="explorer-del" role="button" tabindex="-1" aria-label="删除">×</span>` : ""}`;
  row.addEventListener("click", (e) => {
    if (e.target.closest(".explorer-del") || e.target.closest("[data-twist]")) return;
    onClick?.(e);
  });
  if (onRename) {
    row.addEventListener("dblclick", (e) => {
      if (e.target.closest(".explorer-del") || e.target.closest("[data-twist]")) return;
      e.preventDefault();
      onRename();
    });
  }
  row.querySelector("[data-twist]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    (onTwistie || onClick)?.();
  });
  row.querySelector(".explorer-del")?.addEventListener("click", (e) => {
    e.stopPropagation();
    onDelete?.();
  });
  if (onContextMenu) {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e);
    });
  } else if (bookId && !child) {
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

function playingInstanceIdForBook(book) {
  const playHere = book.id === activeBookId && isPlayNow();
  if (playHere && lastView?.playInstanceId) return lastView.playInstanceId;
  return playWorkingInstanceByBook.get(book.id) ?? null;
}

function renderSpecChildren(book, product, list) {
  const playHere = book.id === activeBookId && isPlayNow();
  if (specOwnsWorkingPlay(book, product.id)) {
    const live = playHere && !activePlaySaveId;
    list.appendChild(
      renderExplorerRow({
        name: "当前游玩",
        meta: live ? "游玩中" : "",
        active: live,
        actionClass: "explorer-run",
        child: true,
        onClick: () => void loadPlaySave(book.id, "play-working"),
        onContextMenu: (e) =>
          showSaveMenu(book.id, "play-working", "当前游玩", e.clientX, e.clientY),
      }),
    );
  }
  const runs = runsForProduct(book.id, product.id, productInstancesForBook(book.id));

  for (const run of runs) {
    const runWhen = formatSaveWhen(run.createdAt);
    list.appendChild(
      renderExplorerRow({
        name: run.label,
        meta: runWhen || "游玩进度",
        active: playHere && activePlaySaveId === run.id,
        actionClass: "explorer-run",
        child: true,
        onClick: () => void loadPlaySave(book.id, run.id),
        onRename: () => void renamePlaySave(book.id, run.id, run.label),
        onDelete: () => void deletePlaySave(book.id, run.id, run.label, "游玩存档"),
        onContextMenu: (e) =>
          showSaveMenu(book.id, run.id, run.label, e.clientX, e.clientY),
      }),
    );
  }
}

function appendNewPlayFromSnapshot(book, list, instanceId) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "explorer-add child";
  btn.textContent = "+";
  btn.title = "从这份创作快照新开一局";
  btn.setAttribute("aria-label", "新开一局");
  btn.addEventListener("click", () => void startNewPlayForBook(book.id, instanceId));
  list.appendChild(btn);
}

function appendCurrentDesignRow(book, list) {
  const live =
    book.id === activeBookId && Boolean(sessionId) && !isPlayNow();
  list.appendChild(
    renderExplorerRow({
      name: "当前创作",
      meta: live ? "进行中" : "继续",
      active: live,
      actionClass: "explorer-design",
      title: "继续创作；定稿会出现在下方",
      onClick: () => void resumeDesignSession(book.id),
    }),
  );
}

function renderBookContents(book, list) {
  const playingInstanceId = playingInstanceIdForBook(book);
  const products = productInstancesForBook(book.id);

  appendCurrentDesignRow(book, list);

  const loading = playSavesLoading.has(book.id);
  const saves = playSavesByBook.get(book.id);
  if (loading && saves === undefined) {
    const hint = document.createElement("p");
    hint.className = "explorer-hint";
    hint.textContent = "加载存档…";
    list.appendChild(hint);
    return;
  }

  if (!products.length) {
    const hint = document.createElement("p");
    hint.className = "explorer-hint";
    hint.textContent = bookPlayReady(book.id) ? "还没有创作快照" : "定稿后会出现在这里";
    list.appendChild(hint);
    return;
  }

  for (const product of products) {
    const expanded = specIsExpanded(book.id, product.id);
    const bits = [];
    if (!expanded && product.id === playingInstanceId) bits.push("游玩中");
    list.appendChild(
      renderExplorerRow({
        name: product.label,
        meta: bits.join(" · "),
        title: "已保存的创作快照；展开可看游玩",
        actionClass: "explorer-spec",
        twistie: true,
        expanded,
        ariaExpanded: expanded,
        onClick: () => toggleSpecExpanded(book.id, product.id),
        onTwistie: () => toggleSpecExpanded(book.id, product.id),
        onRename: () => void renamePlaySave(book.id, product.id, product.label),
        onDelete: () => void deletePlaySave(book.id, product.id, product.label, "规格"),
        onContextMenu: (e) =>
          showSaveMenu(book.id, product.id, product.label, e.clientX, e.clientY),
      }),
    );
    if (expanded) renderSpecChildren(book, product, list);
    appendNewPlayFromSnapshot(book, list, product.id);
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
    if (book) {
      renderBookContents(book, list);
      return;
    }
    sidebarNav = { level: "root" };
    document.body.dataset.navLevel = "root";
    renderPathBar();
  }

  for (const book of books) {
    const selected = selectedBookIds.has(book.id);
    list.appendChild(
      renderExplorerRow({
        name: book.title,
        meta: catalogBookMeta(book),
        active: book.id === activeBookId,
        selected,
        bookId: book.id,
        actionClass: "explorer-folder",
        onClick: (e) => {
          if (bookSelectMode) {
            toggleBookSelection(book.id);
            return;
          }
          e.stopPropagation();
          if (enterPickerBookId === book.id) {
            hideEnterPicker();
            return;
          }
          showEnterPicker(book.id, e.currentTarget);
        },
      }),
    );
  }
  if (enterPickerBookId && sidebarNav.level === "root") {
    const row = list.querySelector(`[data-book-id="${enterPickerBookId}"]`);
    if (row) showEnterPicker(enterPickerBookId, row);
    else hideEnterPicker();
  }
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
      if (books.length) showCatalog();
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
    if (e.target.closest(".explorer-row")) return;
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

async function loadPlaySave(bookId, saveId, { silent = false } = {}) {
  try {
    const products = productInstancesForBook(bookId);
    const run = playRunsForBook(bookId).find((r) => r.id === saveId);
    const instanceId = run ? resolveRunInstanceId(run, products) : null;
    if (instanceId) ensureSpecExpanded(bookId, instanceId);
    else navigateToBook(bookId);
    if (lastView?.bookId === bookId) renderSession(lastView, true);
    const data = await api(
      `/api/books/${encodeURIComponent(bookId)}/saves/${encodeURIComponent(saveId)}/load`,
      { method: "POST" },
    );
    activePlaySaveId = saveId === "play-working" ? null : saveId;
    renderSession(data.session, false);
    return true;
  } catch (err) {
    if (lastView) renderSession(lastView, false);
    if (!silent) alert(err.message);
    return false;
  }
}

async function renamePlaySave(bookId, saveId, currentLabel) {
  const next = prompt("名称", currentLabel);
  if (next == null) return;
  const trimmed = next.trim();
  if (!trimmed) return alert("名称不能为空");
  if (trimmed === currentLabel) return;
  try {
    await api(
      `/api/books/${encodeURIComponent(bookId)}/saves/${encodeURIComponent(saveId)}`,
      { method: "PATCH", body: JSON.stringify({ label: trimmed }) },
    );
    await fetchPlaySavesForBook(bookId, true);
  } catch (err) {
    alert(err.message);
  }
}

async function deletePlaySave(bookId, saveId, label, kindLabel = "游玩存档") {
  if (!confirm(`删除${kindLabel}「${label}」？`)) return;
  try {
    await api(
      `/api/books/${encodeURIComponent(bookId)}/saves/${encodeURIComponent(saveId)}`,
      { method: "DELETE" },
    );
    if (activePlaySaveId === saveId) activePlaySaveId = null;
    const expanded = expandedSpecsByBook.get(bookId);
    expanded?.delete(saveId);
    await fetchPlaySavesForBook(bookId, true);
  } catch (err) {
    alert(err.message);
  }
}

async function startNewPlayForBook(bookId, instanceId) {
  const thisView = lastView?.bookId === bookId ? lastView : null;
  if (!bookPlayReady(bookId) && !thisView?.hasProduct && !canOfferEnterPlay(thisView)) {
    alert("请先保存产物，或完成收口后再开玩");
    return;
  }
  try {
    if (instanceId) ensureSpecExpanded(bookId, instanceId);
    else navigateToBook(bookId);
    if (activeBookId !== bookId || !sessionId) {
      await openBook(bookId);
    } else if (lastView?.bookId === bookId) {
      renderSession(lastView, true);
    }
    const data = await api(`/api/books/${encodeURIComponent(bookId)}/play/new`, {
      method: "POST",
      body: JSON.stringify(instanceId ? { instanceId } : {}),
    });
    activePlaySaveId = null;
    renderSession(data.session, false);
    void fetchPlaySavesForBook(bookId, true);
  } catch (err) {
    if (lastView) renderSession(lastView, false);
    alert(err.message);
  }
}

async function resumeDesignSession(bookId) {
  activePlaySaveId = null;
  try {
    if (activeBookId !== bookId || !sessionId) {
      await openBook(bookId);
    }
    if (isPlayNow()) {
      await setLifecycle("design");
      return;
    }
    renderPathBar();
    renderBookList();
  } catch (err) {
    alert(err.message || "打开创作失败");
  }
}

/** 点「创作」：进入该作品快照列表，并打开/恢复创作会话 */
async function openBookDesign(bookId) {
  hideEnterPicker();
  bookSelectMode = false;
  selectedBookIds = new Set();
  navigateToBook(bookId);
  await resumeDesignSession(bookId);
}

async function openCurrentPlay(bookId) {
  hideEnterPicker();
  const instanceId = playingInstanceIdForBook({ id: bookId });
  if (instanceId) ensureSpecExpanded(bookId, instanceId);
  else navigateToBook(bookId);
  const alreadyHere =
    activeBookId === bookId &&
    isPlayNow() &&
    !activePlaySaveId &&
    sessionId &&
    lastView?.waitingReason?.kind !== "review_artifact";
  if (alreadyHere) {
    renderBookList();
    return;
  }
  if (activeBookId !== bookId || !sessionId) {
    await openBook(bookId);
  }
  if (activePlaySaveId && lastView?.playLayerActive) {
    try {
      const data = await api(
        `/api/books/${encodeURIComponent(bookId)}/saves/${encodeURIComponent("play-working")}/load`,
        { method: "POST" },
      );
      activePlaySaveId = null;
      renderSession(data.session, false);
      return;
    } catch {
      /* 尚无工作副本则走生命周期入口 */
    }
  }
  activePlaySaveId = null;
  await setLifecycle("play");
}

function renderHeader(view, loading) {
  const st = statusFor(view, loading);
  const title = view.bookTitle ?? "未命名作品";
  document.title = `${title} · Writing Agent`;
  $("status-dot").className = `status-dot ${st.cls}`;
  $("status-text").textContent = st.text;
  const showSavePlay = Boolean(
    view.bookId && view.playReady && view.lifecycleStage === "play" && view.playLayerActive,
  );
  const showSaveInstance = Boolean(view.bookId && view.playReady);
  const btnPlay = $("btn-save-play");
  if (btnPlay) btnPlay.hidden = !showSavePlay;
  const btnInst = $("btn-save-instance");
  if (btnInst) btnInst.hidden = !showSaveInstance;
  const btnExport = $("btn-export");
  if (btnExport) btnExport.disabled = !(view.messages?.length);
  if (view.activePersona?.id) {
    globalActivePersonaId = view.activePersona.id;
    const hit = globalPersonas.find((p) => p.id === view.activePersona.id);
    if (hit) {
      hit.name = view.activePersona.name || hit.name;
      if (view.activePersona.description != null) {
        hit.description = view.activePersona.description;
      }
    }
  }
  renderPersonaPicker();
}

function closeWorkspace({ emptyCopy = "" } = {}) {
  hideEnterPicker();
  stopLivePoll();
  forgetWorkspaceSession();
  sessionId = null;
  lastView = null;
  activeBookId = null;
  activePlaySaveId = null;
  composerForceInput = false;
  document.title = "Writing Agent";
  $("status-dot").className = "status-dot";
  $("status-text").textContent = "—";
  const btnPlay = $("btn-save-play");
  if (btnPlay) btnPlay.hidden = true;
  const btnInst = $("btn-save-instance");
  if (btnInst) btnInst.hidden = true;
  const btnExport = $("btn-export");
  if (btnExport) btnExport.disabled = true;
  const toggle = $("lifecycle-toggle");
  if (toggle) toggle.hidden = true;
  $("message-feed").innerHTML = emptyCopy ? `<p class="empty">${emptyCopy}</p>` : "";
  const stage = $("workspace-stage");
  if (stage) {
    stage.hidden = true;
    stage.innerHTML = "";
  }
  const drawer = $("coord-rail");
  if (drawer) {
    drawer.hidden = true;
    drawer.dataset.collapsed = "1";
    const body = $("coord-drawer-body");
    if (body) body.innerHTML = "";
    const count = $("coord-drawer-count");
    if (count) count.textContent = "";
  }
  document.body.classList.remove("is-reviewing", "design-workspace", "coord-rail-collapsed");
  document.body.dataset.userTask = "";
  delete document.body.dataset.designSurface;
  $("skill-picker").hidden = true;
  const focus = $("agent-focus");
  if (focus) focus.innerHTML = "";
  const timeline = $("agent-timeline");
  if (timeline) timeline.innerHTML = "";
  const trace = $("tool-trace");
  if (trace) {
    trace.hidden = true;
    trace.innerHTML = "";
  }
  resetRailChrome();
  hideBookMenu();
  document.body.dataset.lifecycle = "design";
  const composerMain = $("composer-main");
  if (composerMain) composerMain.innerHTML = `<div class="composer-idle">暂无打开的作品</div>`;
}

function renderEmpty() {
  sidebarNav = { level: "root" };
  document.body.dataset.navLevel = "root";
  bookSelectMode = false;
  selectedBookIds = new Set();
  closeWorkspace({ emptyCopy: "点击左侧 + 新建作品" });
  renderBookList();
}

function stopLivePoll() {
  if (livePollTimer != null) {
    clearInterval(livePollTimer);
    livePollTimer = null;
  }
  livePollSawRun = false;
  livePollBaselineSig = "";
  livePollStructuralSig = "";
  livePollStartedAt = 0;
  livePollFailCount = 0;
}

function beginUiRequest() {
  return ++inflightSeq;
}

function isStaleUiRequest(seq) {
  return seq !== inflightSeq;
}

function sessionStructuralSig(view) {
  const messages = view?.messages ?? [];
  const last = messages[messages.length - 1];
  const products = view?.dictateProducts ?? [];
  return [
    messages.length,
    last?.id ?? "",
    products.length,
    products.map((p) => p.tag).join(","),
    view?.phase ?? "",
    view?.waitingReason?.kind ?? "",
    view?.runActive ? "1" : "0",
  ].join("|");
}

/** 用服务端最新 view 结束本地「生成中」，并作废悬挂的 POST */
function finishUiLoading(view) {
  beginUiRequest();
  renderSession(view, false);
}

async function recoverBusySession() {
  if (!sessionId) return false;
  try {
    const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
    finishUiLoading(view);
    return true;
  } catch {
    const bookId = lastView?.bookId || activeBookId;
    if (!bookId) return false;
    try {
      const data = await api(`/api/books/${encodeURIComponent(bookId)}/open`, {
        method: "POST",
      });
      if (data?.session) {
        finishUiLoading(data.session);
        return true;
      }
    } catch {
      /* fall through */
    }
  }
  return false;
}

async function retryRun() {
  if (!sessionId) return;
  const seq = beginUiRequest();
  try {
    renderSession(lastView, true);
    const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: "retry_run" }),
    });
    if (isStaleUiRequest(seq)) return;
    renderSession(view, false);
  } catch (err) {
    if (isStaleUiRequest(seq)) return;
    const recovered = await recoverBusySession();
    if (!recovered && lastView) {
      renderSession({ ...lastView, hints: [err.message] }, false);
    }
  }
}

async function abortRun() {
  if (!sessionId) return;
  const seq = beginUiRequest();
  try {
    renderSession(lastView, true);
    const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: "abort_run" }),
    });
    if (isStaleUiRequest(seq)) return;
    renderSession(view, false);
  } catch (err) {
    if (isStaleUiRequest(seq)) return;
    // 请求已在服务端结束、或会话因重启丢失：停止也要能退出「生成中」
    const recovered = await recoverBusySession();
    if (!recovered && lastView) {
      renderSession(
        { ...lastView, hints: [err.message || "已停止"] },
        false,
      );
    }
  }
}

async function clearDictateDialogue() {
  if (!sessionId) return;
  if (!confirm("清空对话？产物会保留。")) return;
  const seq = beginUiRequest();
  try {
    const view = await api(
      `/api/sessions/${encodeURIComponent(sessionId)}/dictate/clear-dialogue`,
      { method: "POST", body: "{}" },
    );
    if (isStaleUiRequest(seq)) return;
    renderSession(view, false);
  } catch (err) {
    if (isStaleUiRequest(seq)) return;
    alert(err.message);
  }
}

function startLivePoll() {
  // 已在轮询时不要重置：loading 下因消息落盘而 renderSession(..., true) 会再次调用
  if (livePollTimer != null) return;
  if (!sessionId) return;
  livePollSawRun = false;
  livePollFailCount = 0;
  livePollBaselineSig = sessionStructuralSig(lastView);
  livePollStructuralSig = livePollBaselineSig;
  livePollStartedAt = Date.now();
  livePollTimer = setInterval(async () => {
    if (!sessionId || livePollTimer == null) return;
    try {
      const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (!sessionId || livePollTimer == null) return;
      livePollFailCount = 0;

      if (view.runActive) livePollSawRun = true;

      const sig = sessionStructuralSig(view);
      const progressed = sig !== livePollBaselineSig;
      const elapsed = Date.now() - livePollStartedAt;
      // 服务端已空闲且：见过 run / 或内容相对启动时已推进
      const serverDone =
        !view.runActive &&
        (livePollSawRun || (progressed && elapsed > 600));
      if (serverDone) {
        finishUiLoading(view);
        return;
      }

      if (sig !== livePollStructuralSig) {
        livePollStructuralSig = sig;
        // 保持 loading 底栏，但把已写入的用户句/产物/回复刷进主区
        renderSession(view, true);
        return;
      }

      lastView = {
        ...lastView,
        liveStream: view.liveStream,
        agentThinking: view.agentThinking,
        runActive: view.runActive,
        dictateProducts: view.dictateProducts ?? lastView.dictateProducts,
      };
      updateLiveStreamPanel(view);
    } catch {
      livePollFailCount += 1;
      // 服务重启后内存会话丢失：重开作品收尾，避免永远转圈
      if (livePollFailCount >= 3) {
        const ok = await recoverBusySession();
        if (!ok && lastView) {
          finishUiLoading({
            ...lastView,
            hints: ["连接中断，请点左侧作品重新打开"],
          });
        }
      }
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
    view.waitingReason?.kind !== "pick_creation_step" &&
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
    onQuestionAnswersChange: () => refreshReviewComposerChrome(),
    onQuestionCardEnter: () => {
      const { answered } = selectedQuestionAnswers(lastView);
      if (!answered.length) return;
      void sendText($("composer-input")?.value ?? "");
    },
    onEditMessage: (messageId, text) => messageAction("edit", messageId, { text }),
    onRefreshMessage: (messageId) => messageAction("refresh", messageId),
    onDeleteMessage: (messageId) => messageAction("delete", messageId),
    onRestartFromMessage: (messageId) => messageAction("restart", messageId),
    onRollbackToInput: (messageId, draft) => {
      pendingComposerDraft = String(draft ?? "");
      pendingComposerDraftSeq = 0;
      messageAction("delete", messageId);
    },
    onViewContext: (messageId) => showContextTraceDialog(messageId),
    onCompareModels: (messageId) => openModelComparePicker(messageId),
    onSwitchVariant: (messageId, direction) =>
      messageAction("variant", messageId, { direction }),
    onRetryRun: () => retryRun(),
    onPickCreationStep: (stepId) => runAction("pick_step", { stepId }),
    onReenterCreationStep: (stepId) =>
      runAction("pick_step", { stepId, reenter: true }),
    onViewStepArtifact: (stepId, name) => showStepArtifactDialog(stepId, name),
    onDeleteCreationStep: (stepId, name) => {
      const label = name ? `${name}` : stepId;
      if (!confirm(`删除「${label}」这条产物？会从图上拿掉，不可恢复。`)) return;
      void runAction("delete_step", { stepId });
    },
    onSpawnCreationStep: (moduleName) => runAction("spawn_step", { moduleName }),
    onLeaveCreationStep: () => runAction("leave_step"),
    onEnterPlay: () => enterPlayNow(),
    onSaveProduct: () => void saveCurrentInstance(),
    onPatchTable: (tag, cells) => void patchPlayTable(tag, cells),
    onSelectOpening: (index, usePersona) => void selectPlayOpening(index, usePersona),
    onRefuseOpeningPersona: () => {
      const idx = lastView?.playAux?.selectedOpeningIndex ?? 0;
      void selectPlayOpening(idx, false);
    },
  });
  renderComposer(view, loading);
  rememberWorkspaceSession();
  if (loading) startLivePoll();
  else stopLivePoll();
}

async function messageAction(kind, messageId, body = {}) {
  if (!sessionId) return;
  const seq = beginUiRequest();
  if (pendingComposerDraft && pendingComposerDraftSeq === 0 && kind === "delete") {
    pendingComposerDraftSeq = seq;
  } else if (pendingComposerDraft && pendingComposerDraftSeq !== seq) {
    pendingComposerDraft = "";
    pendingComposerDraftSeq = 0;
  }
  try {
    renderSession(lastView, true);
    const view = await api(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/${kind}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    if (isStaleUiRequest(seq)) return;
    renderSession(view, false);
  } catch (err) {
    if (isStaleUiRequest(seq)) return;
    pendingComposerDraft = "";
    pendingComposerDraftSeq = 0;
    if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
  }
}

/** 询问卡已选中的追问作答（不要求卡仍标 is-open；未选则为空） */
function selectedQuestionAnswers(view) {
  const qHost = $("questions-card-host");
  const activeQs = getActiveQuestions(view);
  if (!activeQs?.questions?.length || !qHost?._qState) {
    return { collected: null, answered: [] };
  }
  const collected = collectQuestionAnswers(qHost, view);
  const answered = collected?.ok
    ? collected.answers.filter((a) => a.text && a.text !== "（未答）")
    : [];
  return { collected, answered };
}

/** 空 Enter＝接受；有字或已选追问则按意见改。点「按意见修改」不走这条。 */
async function submitComposer(text, { acceptOnEmpty, requiresText } = {}) {
  const trimmed = String(text ?? "").trim();
  if (requiresText && !trimmed) {
    alert("点图上节点即确认并进入；要改编排请先写下意见。");
    return;
  }
  if (acceptOnEmpty && !trimmed) {
    const { answered } = selectedQuestionAnswers(lastView);
    if (answered.length === 0) {
      const acceptBtn = $("composer")?.querySelector("[data-act=accept]");
      if (acceptBtn && !acceptBtn.disabled) {
        await runAction("accept");
        return;
      }
    }
  }
  await sendText(text);
}

async function sendText(text) {
  if (!sessionId) return;
  const seq = beginUiRequest();
  const trimmed = text?.trim() ?? "";
  const qHost = $("questions-card-host");
  const activeQs = getActiveQuestions(lastView);
  const reviewing = lastView?.waitingReason?.kind === "review_artifact";
  const cardOpen = Boolean(
    activeQs?.questions?.length && qHost?.classList.contains("is-open"),
  );

  // 能力默认问题：对齐美学纲领，须自由书写，不能空发/跳过当答复
  if (isModuleOpeningWaiting(lastView) && !trimmed) {
    alert("请先按主栏引导写几句再发送。");
    return;
  }

  // 核对/验收：有选中追问或修改意见 ⇒ 写回产物；点「按意见修改」绝不等于接受
  if (reviewing) {
    const { collected, answered } = selectedQuestionAnswers(lastView);
    if (!trimmed && answered.length === 0) {
      alert(
        isFlowPlanReview(lastView)
          ? "点图上节点即确认并进入；要改编排请先写下意见。"
          : "请选择追问选项或填写修改意见；满意请点「接受」收下产物。",
      );
      return;
    }
    try {
      const body = { text: trimmed };
      if (answered.length && collected?.answers) {
        body.answers = collected.answers;
      }
      clearQuestionCardState(qHost, lastView);
      beginComposerSubmit();
      renderSession(lastView, true);
      const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (isStaleUiRequest(seq)) return;
      clearQuestionCardState(qHost);
      renderSession(view, false);
    } catch (err) {
      if (isStaleUiRequest(seq)) return;
      keepComposerDraft(trimmed);
      if (qHost) qHost._qDismissed = null;
      if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
    } finally {
      endComposerSubmit();
    }
    return;
  }

  if (cardOpen) {
    const collected = collectQuestionAnswers(qHost, lastView);
    const answered = collected.ok
      ? collected.answers.filter((a) => a.text && a.text !== "（未答）")
      : [];
    // 必答题未选：拦住发送
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
    // 有选中 → 问+答拼接发送，并收起卡
    if (collected.ok && answered.length) {
      try {
        clearQuestionCardState(qHost, lastView);
        beginComposerSubmit();
        renderSession(lastView, true);
        const body = { answers: collected.answers };
        if (trimmed) body.note = trimmed;
        const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/answers`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (isStaleUiRequest(seq)) return;
        clearQuestionCardState(qHost);
        renderSession(view, false);
      } catch (err) {
        if (isStaleUiRequest(seq)) return;
        keepComposerDraft(trimmed);
        if (qHost) qHost._qDismissed = null;
        if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
      } finally {
        endComposerSubmit();
      }
      return;
    }
    // 未选中：不带问；点发送仍算答复 → 收起卡
    if (!trimmed) {
      clearQuestionCardState(qHost, lastView);
      beginComposerSubmit();
      try {
        await runAction("skip_questions");
      } finally {
        endComposerSubmit();
      }
      return;
    }
    clearQuestionCardState(qHost, lastView);
  }

  if (!trimmed) {
    if (
      lastView?.waitingReason?.kind === "pick_creation_step" ||
      isFlowPlanReview(lastView)
    ) {
      alert("点图上节点即确认并进入；要改编排请先写下意见。");
      return;
    }
    if (
      lastView?.waitingReason?.kind === "next_intent" ||
      resolveComposer(lastView, false)?.allowEmpty
    ) {
      try {
        beginComposerSubmit();
        renderSession(lastView, true);
        const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ text: "" }),
        });
        if (isStaleUiRequest(seq)) return;
        clearQuestionCardState(qHost);
        renderSession(view, false);
      } catch (err) {
        if (isStaleUiRequest(seq)) return;
        if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
      } finally {
        endComposerSubmit();
      }
    }
    return;
  }
  try {
    beginComposerSubmit();
    const optimistic = lastView
      ? {
          ...lastView,
          messages: [
            ...(lastView.messages ?? []),
            {
              id: `local-${Date.now()}`,
              role: "user",
              kind: "user_input",
              text: trimmed,
              body: trimmed,
              createdAt: new Date().toISOString(),
            },
          ],
        }
      : lastView;
    renderSession(optimistic || lastView, true);
    const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: trimmed }),
    });
    if (isStaleUiRequest(seq)) return;
    clearQuestionCardState(qHost);
    renderSession(view, false);
  } catch (err) {
    if (isStaleUiRequest(seq)) return;
    keepComposerDraft(trimmed);
    if (cardOpen && qHost) qHost._qDismissed = null;
    const recovered = await recoverBusySession();
    if (!recovered && lastView) {
      renderSession({ ...lastView, hints: [err.message] }, false);
    }
  } finally {
    endComposerSubmit();
  }
}

async function runAction(action, extra = {}) {
  if (!sessionId) return;
  const seq = beginUiRequest();
  const qHost = $("questions-card-host");
  try {
    // 接受 / 跳过：先收起询问卡，避免 loading 用旧 waitingReason 再画出来
    if (action === "accept" || action === "skip_questions") {
      clearQuestionCardState(qHost, lastView);
    }
    renderSession(lastView, true);
    const payload = { action, ...extra };
    if (action === "accept") {
      const picker = document.querySelector("[data-opening-picker]");
      if (picker) {
        const n = Number(picker.getAttribute("data-selected") || 0);
        if (Number.isFinite(n)) payload.openingIndex = n;
      }
    }
    const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/actions`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (isStaleUiRequest(seq)) return;
    if (action === "accept" || action === "skip_questions") {
      clearQuestionCardState(qHost);
    }
    renderSession(view, false);
  } catch (err) {
    if (isStaleUiRequest(seq)) return;
    if (
      (action === "accept" || action === "skip_questions") &&
      qHost
    ) {
      qHost._qDismissed = null;
    }
    if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
  }
}

function enterPlayNow() {
  if (activeBookId) {
    void openCurrentPlay(activeBookId);
    return;
  }
  void (async () => {
    await setLifecycle("play");
  })();
}

async function patchPlayTable(tag, cells) {
  if (!sessionId) return;
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/table`, {
      method: "POST",
      body: JSON.stringify({ tag, cells }),
    });
    const skipped = data.tablePatch?.skipped ?? [];
    const conflicts = skipped.filter((s) => String(s.reason || "").includes("rev"));
    if (conflicts.length) {
      alert(
        `有字段已被更新，未写入：${conflicts.map((c) => c.key).join("、")}。请再改一次。`,
      );
    }
    renderSession(data, false);
  } catch (err) {
    alert(err.message || "无法改表");
    if (lastView) renderSession(lastView, false);
  }
}

async function selectPlayOpening(index, usePersona) {
  if (!sessionId) return;
  try {
    const view = await api(
      `/api/sessions/${encodeURIComponent(sessionId)}/play/opening`,
      {
        method: "POST",
        body: JSON.stringify({
          index,
          ...(typeof usePersona === "boolean" ? { usePersona } : {}),
        }),
      },
    );
    renderSession(view, false);
  } catch (err) {
    alert(err.message || "无法选用开场");
    if (lastView) renderSession(lastView, false);
  }
}

async function setLifecycle(stage, opts) {
  if (!sessionId) return;
  if (stage === lastView?.lifecycleStage) {
    if (stage === "design") return;
    if (
      stage === "play" &&
      lastView?.playLayerActive &&
      lastView?.waitingReason?.kind !== "review_artifact"
    ) {
      return;
    }
  }
  if (stage === "play" && !lastView?.playReady && !canOfferEnterPlay(lastView) && !lastView?.hasProduct) {
    alert("请先保存产物，或完成收口后再开玩");
    return;
  }
  try {
    const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/lifecycle`, {
      method: "POST",
      body: JSON.stringify({
        stage,
        ...(typeof opts?.useOpeningPersona === "boolean"
          ? { useOpeningPersona: opts.useOpeningPersona }
          : {}),
      }),
    });
    if (stage === "design") {
      activePlaySaveId = null;
      if (activeBookId) navigateToBook(activeBookId);
    } else if (stage === "play" && activeBookId) {
      navigateToBook(activeBookId);
    }
    renderSession(view, false);
    if (activeBookId) void fetchPlaySavesForBook(activeBookId, true);
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
  $("dialog-new-book").showModal();
  $("input-book-title").focus();
}

async function createBook() {
  const title = $("input-book-title").value.trim() || "未命名作品";
  $("btn-create-book").disabled = true;
  try {
    const data = await api("/api/books", {
      method: "POST",
      body: JSON.stringify({
        title,
        orchestratorId: "world-simulator",
        creationMode: "dictate",
      }),
    });
    $("dialog-new-book").close();
    if (data.book) books.unshift(data.book);
    activeBookId = data.book?.id;
    sidebarNav = { level: "root" };
    document.body.dataset.navLevel = "root";
    renderSession(data.session, false);
  } catch (err) {
    alert(err.message);
  } finally {
    $("btn-create-book").disabled = false;
  }
}

async function openBook(bookId) {
  const seq = beginUiRequest();
  activeBookId = bookId;
  if (lastView?.bookId === bookId) renderSession(lastView, true);
  try {
    const data = await api(`/api/books/${encodeURIComponent(bookId)}/open`, { method: "POST" });
    if (isStaleUiRequest(seq)) return;
    if (data.book) {
      const i = books.findIndex((b) => b.id === bookId);
      if (i >= 0) books[i] = { ...books[i], ...data.book };
    }
    renderSession(data.session, false);
  } catch (err) {
    if (isStaleUiRequest(seq)) return;
    if (lastView?.bookId === bookId) renderSession({ ...lastView, hints: [err.message] }, false);
    else alert(err.message);
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
    if (activeBookId === bookId) activePlaySaveId = null;
    hideBookMenu();
    const wasHere = activeBookId === bookId || sidebarNav.bookId === bookId;
    if (wasHere) {
      if (books.length) showCatalog();
      else renderEmpty();
    } else {
      renderBookList();
    }
  } catch (err) {
    alert(err.message);
  }
}

async function saveCurrentPlay() {
  if (!activeBookId || !lastView?.playReady) return alert("须先验收 Worker 集");
  if (lastView.lifecycleStage !== "play" || !lastView.playLayerActive) {
    return alert("请先进入游玩");
  }
  const label = prompt("游玩进度存档名称");
  if (!label?.trim()) return;
  try {
    await api(`/api/books/${encodeURIComponent(activeBookId)}/saves`, {
      method: "POST",
      body: JSON.stringify({ label: label.trim(), sessionId, kind: "run" }),
    });
    playSavesByBook.delete(activeBookId);
    void fetchPlaySavesForBook(activeBookId, true);
  } catch (err) {
    alert(err.message);
  }
}

function defaultArchiveLabel() {
  return (
    formatSaveWhen(new Date().toISOString()) ||
    new Date().toLocaleString("zh-CN")
  );
}

async function saveCurrentInstance() {
  if (!activeBookId || (!lastView?.playReady && !canOfferSaveProduct(lastView))) {
    return alert(
      lastView?.creationMode === "dictate"
        ? "请先让 Agent 写入至少一项产物，再保存定稿"
        : "须先完成收口或验收 Worker 集",
    );
  }
  const label = prompt("落档名称", defaultArchiveLabel());
  if (!label?.trim()) return;
  try {
    await api(`/api/books/${encodeURIComponent(activeBookId)}/saves`, {
      method: "POST",
      body: JSON.stringify({ label: label.trim(), sessionId, kind: "instance" }),
    });
    if (lastView) {
      lastView = { ...lastView, hasProduct: true };
      renderSession(lastView, false);
    }
    await fetchPlaySavesForBook(activeBookId, true);
    const newest = productInstancesForBook(activeBookId)[0];
    if (newest) ensureSpecExpanded(activeBookId, newest.id);
    else navigateToBook(activeBookId);
  } catch (err) {
    alert(err.message);
  }
}

async function showStepArtifactDialog(stepId, name) {
  if (!sessionId || !stepId) return;
  try {
    const data = await api(
      `/api/sessions/${encodeURIComponent(sessionId)}/step-artifact?stepId=${encodeURIComponent(stepId)}`,
    );
    fillStepArtifactDialog({
      name: data.name || name,
      content: data.content,
    });
  } catch (err) {
    alert(err.message || "无法读取产物");
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
  const subject = msg || review || {};
  const requestChars =
    trace.charCount ??
    trace.messages.reduce((sum, item) => sum + String(item.content ?? "").length, 0);
  const usage = subject.tokenUsage;
  const responseBody = String(subject.body ?? subject.text ?? "").trim();
  const thinking = String(subject.thinking ?? "").trim();
  const requestLog = trace.messages.map((item, index) => {
    const content = String(item.content ?? "");
    const part = String(index + 1).padStart(2, "0");
    return `======== REQUEST ${part}/${trace.messages.length} · ${item.role} · ${content.length.toLocaleString("zh-CN")} chars ========\n${content}`;
  });
  const responseLog = [
    thinking
      ? `======== RESPONSE THINKING · ${thinking.length.toLocaleString("zh-CN")} chars ========\n${thinking}`
      : "",
    responseBody
      ? `======== RESPONSE BODY · ${responseBody.length.toLocaleString("zh-CN")} chars ========\n${responseBody}`
      : "",
  ].filter(Boolean);
  const tokenMeta = usage?.totalTokens
    ? ` · ${Number(usage.totalTokens).toLocaleString("zh-CN")} tokens`
    : "";
  meta.textContent = [
    subject.kind || "message",
    subject.actor || trace.caller || "unknown",
    trace.model || usage?.model || "model?",
    `${trace.messages.length} 段请求`,
    `${(requestChars / 1024).toFixed(1)} KB`,
  ].join(" · ") + tokenMeta;
  body.textContent = [
    `MESSAGE  ${messageId}`,
    `KIND     ${subject.kind || "unknown"}`,
    `ACTOR    ${subject.actor || "-"}`,
    `CALLER   ${trace.caller || usage?.caller || "unknown"}`,
    `MODEL    ${trace.model || usage?.model || "model?"}`,
    `CREATED  ${trace.createdAt || subject.createdAt || "-"}`,
    `REQUEST  ${trace.messages.length} messages / ${requestChars.toLocaleString("zh-CN")} chars`,
    trace.generation && Object.keys(trace.generation).length
      ? `GEN      ${JSON.stringify(trace.generation)}`
      : "GEN      (none)",
    usage?.totalTokens
      ? `TOKENS   total=${usage.totalTokens} cached=${usage.cachedTokens ?? 0} miss=${usage.cacheMissTokens ?? 0}`
      : "TOKENS   not recorded",
    "",
    ...requestLog,
    ...(responseLog.length ? ["", ...responseLog] : []),
  ].join("\n\n");
  dlg.showModal();
}

let comparePickerMessageId = null;
let comparePollTimer = null;
let compareActiveJobId = null;

function stopComparePoll() {
  if (comparePollTimer) {
    clearTimeout(comparePollTimer);
    comparePollTimer = null;
  }
}

async function openModelComparePicker(messageId) {
  if (!sessionId) return;
  const msg = (lastView?.messages ?? []).find((m) => m.id === messageId);
  const review = lastView?.reviewArtifact;
  const hasTrace =
    msg?.contextTrace?.messages?.length ||
    (review &&
      (review.sourceMessageId === messageId || review.id === messageId) &&
      review.contextTrace?.messages?.length);
  if (!hasTrace) {
    alert("这条消息没有可重放的上下文（可能已被修剪）");
    return;
  }
  comparePickerMessageId = messageId;
  const list = $("compare-profile-list");
  const dlg = $("dialog-model-compare-pick");
  if (!list || !dlg) return;
  list.innerHTML = `<p class="dialog-desc">加载 API 配置…</p>`;
  dlg.showModal();
  try {
    const data = await api("/api/profiles");
    const profiles = (data.profiles ?? []).filter((p) => p.apiKey?.trim());
    if (!profiles.length) {
      list.innerHTML = `<p class="dialog-desc">没有可用的 API 配置，请先到设置页添加。</p>`;
      return;
    }
    list.innerHTML = profiles
      .map(
        (p, i) => `
      <label class="compare-profile-item">
        <input type="checkbox" name="compare-profile" value="${esc(p.id)}" ${i < 2 ? "checked" : ""} />
        <span>
          <strong>${esc(p.model || p.name)}</strong>
          <div class="muted">${esc(
            [p.name && p.name !== p.model ? p.name : "", p.baseUrl || ""]
              .filter(Boolean)
              .join(" · "),
          )}</div>
        </span>
      </label>`,
      )
      .join("");
  } catch (err) {
    list.innerHTML = `<p class="dialog-desc">${esc(err.message || "加载失败")}</p>`;
  }
}

async function startModelCompareFromPicker() {
  if (!sessionId || !comparePickerMessageId) return;
  const checked = [
    ...document.querySelectorAll('input[name="compare-profile"]:checked'),
  ].map((el) => el.value);
  if (checked.length < 1) {
    alert("请至少选择一个 API 配置");
    return;
  }
  $("dialog-model-compare-pick")?.close();
  try {
    const job = await api(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(comparePickerMessageId)}/compare`,
      {
        method: "POST",
        body: JSON.stringify({ profileIds: checked }),
      },
    );
    openModelCompareWindow(job);
  } catch (err) {
    alert(err.message || "无法开始对比");
  }
}

function openModelCompareWindow(job) {
  stopComparePoll();
  compareActiveJobId = job.id;
  const dlg = $("dialog-model-compare");
  const meta = $("compare-meta");
  if (!dlg || !meta) return;
  meta.textContent = `任务 ${job.id.slice(0, 8)} · 原文模型 ${job.original?.model || "?"} · 共 ${job.candidates?.length ?? 0} 个候选`;
  renderCompareJob(job);
  dlg.showModal();
  scheduleComparePoll();
}

function scheduleComparePoll() {
  stopComparePoll();
  if (!compareActiveJobId || !sessionId) return;
  comparePollTimer = setTimeout(async () => {
    try {
      const job = await api(
        `/api/sessions/${encodeURIComponent(sessionId)}/compare/${encodeURIComponent(compareActiveJobId)}`,
      );
      renderCompareJob(job);
      if (job.status === "running") scheduleComparePoll();
    } catch (err) {
      const meta = $("compare-meta");
      if (meta) meta.textContent = err.message || "轮询失败";
    }
  }, 800);
}

function renderCompareJob(job) {
  const host = $("compare-results");
  if (!host) return;
  const original = job.original ?? {};
  const cards = [
    `<article class="compare-card">
      <div class="compare-card-head">
        <strong>原文</strong>
        <span>${esc(original.model || "当前结果")}</span>
      </div>
      <div class="compare-card-status">对照 · 不会写入废案</div>
      <pre class="compare-card-body">${esc(original.text || "")}</pre>
    </article>`,
    ...(job.candidates ?? []).map((c) => {
      const statusText =
        c.status === "done"
          ? c.usage?.totalTokens
            ? `完成 · ${Number(c.usage.totalTokens).toLocaleString("zh-CN")} tokens`
            : "完成"
          : c.status === "error"
            ? `失败 · ${c.error || ""}`
            : c.status === "running"
              ? "生成中…"
              : "排队中";
      const body =
        c.status === "done"
          ? [
              c.thinking ? `【思考】\n${c.thinking}\n\n【正文】\n` : "",
              c.content || "",
            ].join("")
          : c.error || "";
      const adoptBtn =
        c.status === "done"
          ? `<div class="compare-card-actions">
              <button type="button" class="btn btn-primary" data-adopt-profile="${esc(c.profileId)}">采用此结果</button>
            </div>`
          : "";
      return `<article class="compare-card">
        <div class="compare-card-head">
          <strong>${esc(c.profileName || c.profileId)}</strong>
          <span>${esc(c.model || "")}</span>
        </div>
        <div class="compare-card-status ${c.status === "error" ? "is-error" : ""}">${esc(statusText)}</div>
        <pre class="compare-card-body">${esc(body)}</pre>
        ${adoptBtn}
      </article>`;
    }),
  ];
  host.innerHTML = cards.join("");
}

async function adoptCompareResult(profileId) {
  if (!sessionId || !compareActiveJobId || !profileId) return;
  const seq = beginUiRequest();
  try {
    const view = await api(
      `/api/sessions/${encodeURIComponent(sessionId)}/compare/${encodeURIComponent(compareActiveJobId)}/adopt`,
      {
        method: "POST",
        body: JSON.stringify({ profileId }),
      },
    );
    if (isStaleUiRequest(seq)) return;
    stopComparePoll();
    $("dialog-model-compare")?.close();
    compareActiveJobId = null;
    renderSession(view, false);
  } catch (err) {
    alert(err.message || "采用失败");
  }
}

$("btn-start-model-compare")?.addEventListener("click", () => {
  void startModelCompareFromPicker();
});
$("btn-close-model-compare")?.addEventListener("click", () => {
  stopComparePoll();
  compareActiveJobId = null;
  $("dialog-model-compare")?.close();
});
$("compare-results")?.addEventListener("click", (e) => {
  const profileId = e.target.closest("[data-adopt-profile]")?.getAttribute("data-adopt-profile");
  if (!profileId) return;
  if (!confirm("采用此结果？其它成功候选会作为废案保留，可用左右切换查看。")) return;
  void adoptCompareResult(profileId);
});

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

$("lifecycle-toggle")?.addEventListener("click", (e) => {
  const stage = e.target.closest("[data-stage]")?.getAttribute("data-stage");
  if (stage === "play") enterPlayNow();
  else if (stage === "design") void setLifecycle("design");
});
$("btn-new-book")?.addEventListener("click", openNewBookDialog);
$("btn-cancel-new")?.addEventListener("click", () => $("dialog-new-book").close());
$("book-enter-pop")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const btn = e.target.closest("[data-enter]");
  if (!btn || btn.disabled) return;
  const enter = btn.getAttribute("data-enter");
  const bookId = enterPickerBookId;
  hideEnterPicker();
  if (!bookId) return;
  if (enter === "design") void openBookDesign(bookId);
  else if (enter === "play") void openCurrentPlay(bookId);
});

$("book-action-menu")?.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.getAttribute("data-action");
  const bookId = bookMenuBookId;
  hideBookMenu();
  if (!bookId || !action) return;
  if (action === "open") {
    setBookSelectMode(false);
    void openBookDesign(bookId);
  } else if (action === "play") {
    setBookSelectMode(false);
    void openCurrentPlay(bookId);
  } else if (action === "save-instance") {
    if (bookId === activeBookId) void saveCurrentInstance();
  } else if (action === "save-play") {
    if (bookId === activeBookId) void saveCurrentPlay();
  } else if (action === "export") {
    if (bookId === activeBookId) exportSession();
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
  if (!e.target.closest("#save-action-menu")) hideSaveMenu();
  if (
    !e.target.closest("#book-enter-pop") &&
    !e.target.closest(".explorer-folder")
  ) {
    hideEnterPicker();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideBookMenu();
    hideSaveMenu();
    hideEnterPicker();
    if (bookSelectMode || selectedBookIds.size) setBookSelectMode(false);
  }
});
document.addEventListener("scroll", () => {
  hideBookMenu();
  hideSaveMenu();
  hideEnterPicker();
}, true);

$("save-action-menu")?.addEventListener("click", (e) => {
  const action = e.target
    .closest("[data-save-menu-action]")
    ?.getAttribute("data-save-menu-action");
  const { bookId, saveId, label } = saveMenuState;
  hideSaveMenu();
  if (!bookId || !saveId || !action) return;
  if (action === "edit-products") {
    void openSnapshotProductsEditor(bookId, saveId, label);
  }
});

$("snapshot-products-body")?.addEventListener("click", (e) => {
  const body = $("snapshot-products-body");
  if (!body) return;
  const bookId = body.dataset.bookId;
  const saveId = body.dataset.saveId;
  const products = body._products;
  if (!bookId || !saveId || !Array.isArray(products)) return;

  const editBtn = e.target.closest("[data-snap-edit]");
  if (editBtn) {
    const idx = Number(editBtn.getAttribute("data-snap-edit"));
    const p = products[idx];
    const row = body.querySelector(`.snap-product[data-idx="${idx}"]`);
    if (!p || !row) return;
    row.innerHTML = `
      <div class="snap-product-head">
        <span class="snap-product-label">${esc(p.label || p.tag)}</span>
        <span class="snap-product-tag">${esc(p.tag)}</span>
      </div>
      <textarea class="snap-product-ta" data-snap-ta="${idx}"></textarea>
      <div class="snap-product-actions">
        <button type="button" class="btn btn-primary btn-sm" data-snap-save="${idx}">保存</button>
        <button type="button" class="btn btn-sm" data-snap-cancel="${idx}">取消</button>
      </div>`;
    const ta = row.querySelector("textarea");
    if (ta) {
      ta.value = p.content || "";
      ta.focus();
    }
    return;
  }

  const cancelBtn = e.target.closest("[data-snap-cancel]");
  if (cancelBtn) {
    const idx = Number(cancelBtn.getAttribute("data-snap-cancel"));
    const p = products[idx];
    const row = body.querySelector(`.snap-product[data-idx="${idx}"]`);
    if (!p || !row) return;
    const preview = String(p.content || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    row.innerHTML = `
      <div class="snap-product-head">
        <span class="snap-product-label">${esc(p.label || p.tag)}</span>
        <span class="snap-product-tag">${esc(p.tag)}</span>
        <button type="button" class="btn-sm snap-product-edit" data-snap-edit="${idx}">改</button>
      </div>
      <div class="snap-product-preview" data-snap-preview="${idx}">${esc(preview)}${
        String(p.content || "").length > 160 ? "…" : ""
      }</div>`;
    return;
  }

  const saveBtn = e.target.closest("[data-snap-save]");
  if (saveBtn) {
    const idx = Number(saveBtn.getAttribute("data-snap-save"));
    const p = products[idx];
    const row = body.querySelector(`.snap-product[data-idx="${idx}"]`);
    const ta = row?.querySelector("textarea");
    if (!p || !row || !ta) return;
    saveBtn.disabled = true;
    void saveSnapshotProductEdit(bookId, saveId, p.tag, ta.value, row, products, idx).catch(
      (err) => {
        saveBtn.disabled = false;
        alert(err.message || "保存失败");
      },
    );
  }
});

$("form-new-book")?.addEventListener("submit", (e) => {
  e.preventDefault();
  createBook();
});
$("btn-export")?.addEventListener("click", () => {
  exportSession();
});
$("btn-save-play")?.addEventListener("click", () => {
  void saveCurrentPlay();
});
$("btn-save-instance")?.addEventListener("click", () => {
  void saveCurrentInstance();
});

$("theme-menu")?.addEventListener("click", (e) => {
  const menu = $("theme-menu");
  if (!menu) return;
  const colorBtn = e.target.closest("[data-color-theme]");
  if (colorBtn && menu.contains(colorBtn)) {
    e.preventDefault();
    applyColorTheme(colorBtn.getAttribute("data-color-theme"));
    syncThemeMenuUi();
    menu.removeAttribute("open");
    return;
  }
  const bumpBtn = e.target.closest("[data-font-scale-bump]");
  if (bumpBtn && menu.contains(bumpBtn)) {
    e.preventDefault();
    e.stopPropagation();
    bumpUiFontScale(bumpBtn.getAttribute("data-font-scale-bump"));
    syncThemeMenuUi();
  }
});

$("composer")?.addEventListener("click", (e) => {
  const menu = e.target.closest("#composer-more-menu");
  if (!menu) return;
  const clearDictateBtn = e.target.closest("[data-act=clear-dictate]");
  if (clearDictateBtn && menu.contains(clearDictateBtn)) {
    e.preventDefault();
    closeComposerMoreMenu(menu);
    void clearDictateDialogue();
    return;
  }
  const mdBtn = e.target.closest("[data-toggle-markdown]");
  if (mdBtn && menu.contains(mdBtn)) {
    e.preventDefault();
    applyMarkdownRender(!isMarkdownRenderEnabled());
    syncMarkdownMenuUi();
    if (lastView && sessionId) renderSession(lastView, false);
    return;
  }
  const reloadBtn = e.target.closest("[data-reload-profiles]");
  if (reloadBtn && menu.contains(reloadBtn)) {
    e.preventDefault();
    void loadApiProfiles();
    return;
  }
  const forgetBtn = e.target.closest("[data-forget-profile]");
  if (forgetBtn && menu.contains(forgetBtn)) {
    e.preventDefault();
    e.stopPropagation();
    const id = forgetBtn.getAttribute("data-forget-profile");
    if (id && id !== activeApiProfileId && forgetApiProfileUsage(id)) {
      syncApiProfileMenuUi();
    }
    return;
  }
  const profileBtn = e.target.closest("[data-activate-profile]");
  if (profileBtn && menu.contains(profileBtn)) {
    e.preventDefault();
    void activateApiProfileFromMenu(profileBtn.getAttribute("data-activate-profile"), menu);
  }
});

window.addEventListener("wa:session-updated", (e) => {
  const view = e.detail;
  if (!view?.id || !sessionId) return;
  if (view.id !== sessionId) return;
  renderSession(view, false);
});

window.addEventListener("wa:nav-root", () => {
  showCatalog();
});

document.addEventListener("click", (e) => {
  document.querySelectorAll("details.more-menu[open]").forEach((d) => {
    if (!d.contains(e.target)) {
      d.removeAttribute("open");
      d.querySelectorAll("details.more-submenu[open], details.api-fold[open]").forEach((sub) => {
        sub.removeAttribute("open");
      });
    }
  });
});

/** API 组二级菜单：同时只展开一个 */
document.addEventListener("toggle", (e) => {
  const fold = e.target;
  if (!(fold instanceof HTMLDetailsElement) || !fold.classList.contains("api-fold") || !fold.open) {
    return;
  }
  const root = fold.closest("#composer-api-menu");
  if (!root) return;
  root.querySelectorAll("details.api-fold[open]").forEach((other) => {
    if (other !== fold) other.removeAttribute("open");
  });
}, true);

async function restoreWorkspaceSession() {
  const saved = readWorkspaceSession();
  if (!saved || !books.some((book) => book.id === saved.bookId)) {
    forgetWorkspaceSession();
    return false;
  }

  const bookId = saved.bookId;
  activeBookId = bookId;
  activePlaySaveId =
    saved.playSaveId && saved.playSaveId !== "play-working"
      ? saved.playSaveId
      : null;
  if (saved.navLevel === "book") {
    navigateToBook(bookId);
  } else {
    sidebarNav = { level: "root" };
    document.body.dataset.navLevel = "root";
    renderPathBar();
    renderBookList();
  }

  if (saved.sessionId) {
    try {
      const view = await api(
        `/api/sessions/${encodeURIComponent(saved.sessionId)}`,
      );
      if (view?.bookId === bookId) {
        renderSession(view, false);
        void fetchPlaySavesForBook(bookId);
        return true;
      }
    } catch {
      /* 服务端会话已失效时，从作品与存档恢复 */
    }
  }

  try {
    if (saved.mode === "play") {
      await fetchPlaySavesForBook(bookId, true);
      const restored = saved.playSaveId
        ? await loadPlaySave(bookId, saved.playSaveId, { silent: true })
        : false;
      if (!restored) await openCurrentPlay(bookId);
    } else {
      await openBookDesign(bookId);
    }
    if (saved.navLevel !== "book") {
      showCatalog({ closeSession: false });
    }
    return Boolean(sessionId && activeBookId === bookId);
  } catch {
    forgetWorkspaceSession();
    return false;
  }
}

async function init() {
  initColorTheme();
  initUiFontScale();
  initMarkdownRender();
  syncThemeMenuUi();
  try {
    await Promise.all([loadBooks(), loadPersonas(), loadApiProfiles()]);
    if (books.length) {
      const restored = await restoreWorkspaceSession();
      if (!restored) showCatalog();
    } else {
      renderEmpty();
      openNewBookDialog();
    }
  } catch {
    $("status-text").textContent = "加载失败";
  }
}

init();
setupBookBoxSelect();
