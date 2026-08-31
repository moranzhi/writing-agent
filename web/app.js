import {
  renderWorkspace,
  updateLiveStreamPanel,
  resetRailChrome,
  fillStepArtifactDialog,
  canOfferSaveProduct,
  canOfferEnterPlay,
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

let sessionId = null;
let activeBookId = null;
let lastView = null;
let books = [];
let composerForceInput = false;
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
const expandedProductsByBook = new Map();
const playSavesLoading = new Set();
let bookMenuBookId = null;
let livePollTimer = null;
let inflightSeq = 0;

const LIVE_POLL_MS = 280;

const $ = (id) => document.getElementById(id);

const PHASE = { idle: "待命", running: "执行中", waiting_user: "等待你", done: "已完成", error: "出错" };

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

  if (isPlayView(view) && wr?.kind !== "worker_questions") {
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
      label: "可保存",
      title: "落档产物",
      hint: view.hasProduct
        ? "可再保存一份新定稿，或用已有产物开玩。补节点仍点图。"
        : "点「保存定稿」拆出产物。创作流程还在，之后用产物开玩。",
    };
  }

  if (isFlowPlanReview(view) || wr?.kind === "pick_creation_step") {
    return {
      id: "speak",
      label: "选节点",
      title: "选要做的节点",
      hint: "点可进入的节点即确认并开始；要改排在底栏写意见再发。",
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
      taskHint: "点可进入的节点即确认并开始；虚线原型点一下增殖。要改排在底栏写意见再发。",
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
  if (id !== "speak" && id !== "answer" && id !== "review") return "";
  const label = spec.task.label || "";
  const tip = [spec.taskTitle, spec.taskHint].filter(Boolean).join(" — ");
  const tone = spec.acceptAction?.tone ? ` data-tone="${esc(spec.acceptAction.tone)}"` : "";
  return `<span class="composer-mode-chip" data-task="${esc(id)}"${tone} title="${esc(tip)}">${esc(label)}</span>`;
}

function composerInputShell(spec, { textareaHtml, trailing = "" } = {}) {
  const chip = composerModeChip(spec);
  const tone = spec.acceptAction?.tone
    ? ` data-tone="${esc(spec.acceptAction.tone)}"`
    : "";
  return `<div class="composer-input-shell" data-task="${esc(spec.task?.id || "")}"${tone}>
    ${chip}
    ${textareaHtml}
    ${trailing ? `<div class="composer-shell-actions">${trailing}</div>` : ""}
  </div>`;
}

function leaveStepButtonHtml(spec) {
  if (!spec.leaveStep) return "";
  return `<button type="button" class="btn" data-act="leave_step" title="${esc(
    spec.leaveStep.title || "先不写这一步，回到节点选择",
  )}">${esc(spec.leaveStep.label)}</button>`;
}

function stashComposerDraftFromDom() {
  if (skipComposerStash) return;
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

function renderComposer(view, loading) {
  stashComposerDraftFromDom();
  if (pendingComposerDraft) composerForceInput = true;
  const host = $("composer");
  const root = $("composer-main") || host;
  if (!root || !host) return;
  if (host._enterHandler) {
    document.removeEventListener("keydown", host._enterHandler);
    host._enterHandler = null;
  }
  const spec = resolveComposer(view, loading);
  const leaveAct = view.actions?.find((a) => a.type === "leave_step");
  if (leaveAct && spec.mode !== "waiting" && spec.mode !== "idle") {
    spec.leaveStep = {
      label: leaveAct.label || "返回节点",
      title: "先不写这一步，回到节点选择",
    };
  }

  if (spec.mode === "waiting") {
    root.innerHTML = `<div class="composer-waiting">
      <span>${esc(spec.text)}</span>
      <button type="button" class="btn" data-act="retry_run" title="停止当前生成并重试">停止并重试</button>
    </div>`;
    root.querySelector("[data-act=retry_run]")?.addEventListener("click", () => retryRun());
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
      trailing: `<button type="submit" class="btn btn-primary composer-btn">发送</button>`,
    });
    root.innerHTML = `
      ${intakePanel}
      ${confirm}
      <form class="composer-form" id="composer-form">${shell}</form>`;
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
      ? `<button type="button" class="btn btn-primary" data-act="save-product">保存定稿</button>`
      : "";
    const enterPlay = canOfferEnterPlay(view)
      ? `<button type="button" class="btn" data-act="enter-play">${
          view.hasProduct ? "用产物开玩" : "开玩"
        }</button>`
      : "";
    const sendCls =
      canOfferSaveProduct(view) || canOfferEnterPlay(view)
        ? "btn composer-btn"
        : "btn btn-primary composer-btn";
    const shell = composerInputShell(spec, {
      textareaHtml: `<textarea id="composer-input" rows="1" placeholder="${esc(spec.placeholder)}"></textarea>`,
      trailing: `${saveProduct}${enterPlay}<button type="submit" class="${sendCls}" data-act="pick-replan" disabled title="写下意见后再发；点图上节点即确认并进入">${esc(spec.submitLabel || "发送")}</button>`,
    });
    root.innerHTML = `<form class="composer-form" id="composer-form">${shell}</form>`;
    wireComposerForm({ requiresText: true });
    root.querySelector("[data-act=save-product]")?.addEventListener("click", () => {
      void saveCurrentInstance();
    });
    root.querySelector("[data-act=enter-play]")?.addEventListener("click", () => {
      enterPlayNow();
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
  const submitLabel = spec.submitLabel || "发送";
  const sendIsPrimary = !acceptOnEmpty;
  const placeholder = acceptOnEmpty
    ? `${spec.placeholder || "修改意见…"}（${spec.emptyEnterHint || "空 Enter＝确认"}）`
    : spec.placeholder;
  const shell = composerInputShell(spec, {
    textareaHtml: `<textarea id="composer-input" rows="1" placeholder="${esc(placeholder)}"></textarea>`,
    trailing: `${leaveStepButtonHtml(spec)}<button type="button" class="btn composer-btn${
      sendIsPrimary ? " btn-primary" : ""
    }" data-act="revise" title="${esc(
      acceptOnEmpty
        ? `有字或已选追问时 Enter＝${submitLabel}`
        : "Enter 发送"
    )}">${esc(submitLabel)}</button>${acceptBtn}`,
  });
  root.innerHTML = `<form class="composer-form" id="composer-form">${shell}</form>`;
  wireComposerForm({ acceptOnEmpty });
  root.querySelector("[data-act=accept]")?.addEventListener("click", () => runAction("accept"));
  root.querySelector("[data-act=leave_step]")?.addEventListener("click", () => runAction("leave_step"));
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
  btn.title = hasText
    ? "发送改编排意见"
    : "写下意见后再发；点图上节点即确认并进入";
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

function isProductExpanded(bookId, instanceId, fallback) {
  const set = expandedProductsByBook.get(bookId);
  if (set) return set.has(instanceId);
  return Boolean(fallback);
}

function toggleProductExpanded(bookId, instanceId) {
  const open = isProductExpanded(bookId, instanceId, false);
  const next = new Set();
  if (!open) next.add(instanceId);
  expandedProductsByBook.set(bookId, next);
  renderBookList();
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
  if (on && sidebarNav.level === "book") return;
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
  const bookId = bookMenuBookId;
  const ready = bookId ? bookPlayReady(bookId) : false;
  const thisBook = bookId && bookId === activeBookId;
  $("book-menu-open")?.toggleAttribute("hidden", multi);
  $("book-menu-play")?.toggleAttribute("hidden", multi || !ready);
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

function isCatalogNav() {
  return sidebarNav.level !== "book";
}

function getNavBook() {
  if (sidebarNav.level !== "book") return null;
  return books.find((b) => b.id === sidebarNav.bookId) ?? null;
}

function syncRailContext() {
  const el = $("rail-context");
  if (!el) return;
  const book = getNavBook();
  if (sidebarNav.level === "book" && book) {
    el.textContent = book.title;
    el.title = book.title;
  } else {
    el.textContent = "作品";
    el.removeAttribute("title");
  }
  $("rail-tabs")?.toggleAttribute("hidden", sidebarNav.level !== "book");
}

function navigateToBook(bookId) {
  if (!bookId) return;
  sidebarNav = { level: "book", bookId };
  document.body.dataset.navLevel = "book";
  bookSelectMode = false;
  selectedBookIds = new Set();
  syncRailContext();
  renderBookList();
  void fetchPlaySavesForBook(bookId);
}

function showCatalog() {
  beginUiRequest();
  stopLivePoll();
  sidebarNav = { level: "root" };
  document.body.dataset.navLevel = "root";
  bookSelectMode = false;
  selectedBookIds = new Set();
  closeWorkspace();
  syncRailContext();
  renderBookList();
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
  child,
  twistie,
  expanded,
  onTwistie,
  title,
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
  if (bookId && !child) {
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

function renderBookBranch(book, list) {
  const loading = playSavesLoading.has(book.id);
  const saves = playSavesByBook.get(book.id);
  const products = productInstancesForBook(book.id);
  const playHere = book.id === activeBookId && isPlayNow();
  const playingInstanceId =
    playHere && lastView?.playInstanceId
      ? lastView.playInstanceId
      : playWorkingInstanceByBook.get(book.id);
  const latestId = products[0]?.id;

  if (loading && saves === undefined) {
    const hint = document.createElement("p");
    hint.className = "explorer-hint";
    hint.textContent = "加载存档…";
    list.appendChild(hint);
    return;
  }

  for (const product of products) {
    const isLatest = product.id === latestId;
    const isPlayingHere = playHere && playingInstanceId === product.id;
    const hasWorking = playingInstanceId === product.id;
    const expanded = isProductExpanded(book.id, product.id, isPlayingHere);
    const runs = runsForProduct(book.id, product.id, products);
    const wrap = document.createElement("div");
    wrap.className = `explorer-product${expanded ? " is-open" : ""}`;

    const header = renderExplorerRow({
      name: product.label,
      meta: isLatest ? "最新" : "",
      twistie: true,
      expanded,
      title: "点开游玩存档，双击改名",
      onTwistie: () => toggleProductExpanded(book.id, product.id),
      onClick: () => toggleProductExpanded(book.id, product.id),
      onRename: () => void renamePlaySave(book.id, product.id, product.label),
      onDelete: () => void deletePlaySave(book.id, product.id, product.label, "落档"),
    });
    header.setAttribute("aria-expanded", expanded ? "true" : "false");
    wrap.appendChild(header);

    if (expanded) {
      const drop = document.createElement("div");
      drop.className = "explorer-drop";
      drop.setAttribute("role", "group");
      drop.setAttribute("aria-label", `${product.label} 的游玩存档`);

      if (hasWorking) {
        drop.appendChild(
          renderExplorerRow({
            name: "当前游玩",
            meta: isPlayingHere && !activePlaySaveId ? "进行中" : "工作副本",
            active: isPlayingHere && !activePlaySaveId,
            child: true,
            onClick: () => void openCurrentPlay(book.id),
          }),
        );
      }

      if (!runs.length && !hasWorking) {
        const hint = document.createElement("p");
        hint.className = "explorer-drop-empty";
        hint.textContent = "还没有游玩存档";
        drop.appendChild(hint);
      }

      for (const run of runs) {
        const runWhen = formatSaveWhen(run.createdAt);
        drop.appendChild(
          renderExplorerRow({
            name: run.label,
            meta: runWhen || "游玩进度",
            active: playHere && activePlaySaveId === run.id,
            child: true,
            actionClass: "explorer-file",
            onClick: () => void loadPlaySave(book.id, run.id),
            onRename: () => void renamePlaySave(book.id, run.id, run.label),
            onDelete: () => void deletePlaySave(book.id, run.id, run.label, "游玩存档"),
          }),
        );
      }

      drop.appendChild(
        renderExplorerRow({
          name: "+ 新开一局",
          actionClass: "explorer-action",
          child: true,
          onClick: () => void startNewPlayForBook(book.id, product.id),
        }),
      );
      wrap.appendChild(drop);
    }

    list.appendChild(wrap);
  }
}

function renderBookContents(book, list) {
  const designing = book.id === activeBookId && !isPlayNow();
  list.appendChild(
    renderExplorerRow({
      name: "继续创作",
      meta: designing ? "进行中" : "",
      active: designing,
      onClick: () => void openBookDesign(book.id),
    }),
  );
  renderBookBranch(book, list);
}

function renderBookList() {
  const list = $("book-list");
  if (!list) return;
  syncRailContext();
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
    syncRailContext();
  }

  for (const book of books) {
    const skill = book.activeSkillName ?? book.activeSkillId ?? book.orchestratorName ?? "实例设计";
    const selected = selectedBookIds.has(book.id);
    list.appendChild(
      renderExplorerRow({
        name: book.title,
        meta: skill,
        selected,
        bookId: book.id,
        actionClass: "explorer-folder",
        onClick: () => {
          if (bookSelectMode) {
            toggleBookSelection(book.id);
            return;
          }
          void openBook(book.id);
        },
      }),
    );
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

async function loadPlaySave(bookId, saveId) {
  try {
    navigateToBook(bookId);
    if (lastView?.bookId === bookId) renderSession(lastView, true);
    const data = await api(
      `/api/books/${encodeURIComponent(bookId)}/saves/${encodeURIComponent(saveId)}/load`,
      { method: "POST" },
    );
    activePlaySaveId = saveId === "play-working" ? null : saveId;
    renderSession(data.session, false);
  } catch (err) {
    if (lastView) renderSession(lastView, false);
    alert(err.message);
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
    navigateToBook(bookId);
    if (lastView?.bookId === bookId) renderSession(lastView, true);
    const data = await api(`/api/books/${encodeURIComponent(bookId)}/play/new`, {
      method: "POST",
      body: JSON.stringify(instanceId ? { instanceId } : {}),
    });
    activePlaySaveId = null;
    if (instanceId) {
      expandedProductsByBook.set(bookId, new Set([instanceId]));
    }
    renderSession(data.session, false);
    void fetchPlaySavesForBook(bookId, true);
  } catch (err) {
    if (lastView) renderSession(lastView, false);
    alert(err.message);
  }
}

async function openBookDesign(bookId) {
  navigateToBook(bookId);
  activePlaySaveId = null;
  if (activeBookId !== bookId || !sessionId) {
    await openBook(bookId);
  }
  if (isPlayNow()) {
    await setLifecycle("design");
    return;
  }
  renderBookList();
}

async function openCurrentPlay(bookId) {
  navigateToBook(bookId);
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
}

function closeWorkspace({ emptyCopy = "" } = {}) {
  stopLivePoll();
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
}

function beginUiRequest() {
  return ++inflightSeq;
}

function isStaleUiRequest(seq) {
  return seq !== inflightSeq;
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
    if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
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
  if (isCatalogNav()) return;
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
    onRollbackToInput: (messageId, draft) => {
      pendingComposerDraft = String(draft ?? "");
      pendingComposerDraftSeq = 0;
      messageAction("delete", messageId);
    },
    onViewContext: (messageId) => showContextTraceDialog(messageId),
    onSwitchVariant: (messageId, direction) =>
      messageAction("variant", messageId, { direction }),
    onRetryRun: () => retryRun(),
    onPickCreationStep: (stepId) => runAction("pick_step", { stepId }),
    onReenterCreationStep: (stepId) =>
      runAction("pick_step", { stepId, reenter: true }),
    onViewStepArtifact: (stepId, name) => showStepArtifactDialog(stepId, name),
    onSpawnCreationStep: (moduleName) => runAction("spawn_step", { moduleName }),
    onLeaveCreationStep: () => runAction("leave_step"),
    onEnterPlay: () => enterPlayNow(),
    onSaveProduct: () => void saveCurrentInstance(),
  });
  renderComposer(view, loading);
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
      if (qHost) qHost._qDismissed = null;
      if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
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
        if (qHost) qHost._qDismissed = null;
        if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
      }
      return;
    }
    // 未选中：不带问；点发送仍算答复 → 收起卡
    if (!trimmed) {
      clearQuestionCardState(qHost, lastView);
      await runAction("skip_questions");
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
      }
    }
    return;
  }
  try {
    renderSession(lastView, true);
    const view = await api(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: trimmed }),
    });
    if (isStaleUiRequest(seq)) return;
    clearQuestionCardState(qHost);
    renderSession(view, false);
  } catch (err) {
    if (isStaleUiRequest(seq)) return;
    if (cardOpen && qHost) qHost._qDismissed = null;
    if (lastView) renderSession({ ...lastView, hints: [err.message] }, false);
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
  void setLifecycle("play");
}

async function setLifecycle(stage) {
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
      body: JSON.stringify({ stage }),
    });
    if (stage === "design") activePlaySaveId = null;
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
  const seq = beginUiRequest();
  activeBookId = bookId;
  navigateToBook(bookId);
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
    return alert("须先完成收口或验收 Worker 集");
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
    if (newest) {
      expandedProductsByBook.set(activeBookId, new Set([newest.id]));
      renderBookList();
    }
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
$("btn-export")?.addEventListener("click", () => {
  document.querySelector("details.more-menu")?.removeAttribute("open");
  exportSession();
});
$("btn-save-play")?.addEventListener("click", () => {
  document.querySelector("details.more-menu")?.removeAttribute("open");
  void saveCurrentPlay();
});
$("btn-save-instance")?.addEventListener("click", () => {
  document.querySelector("details.more-menu")?.removeAttribute("open");
  void saveCurrentInstance();
});

window.addEventListener("wa:session-updated", (e) => {
  const view = e.detail;
  if (!view?.id || isCatalogNav() || !sessionId) return;
  if (view.id !== sessionId) return;
  renderSession(view, false);
});

window.addEventListener("wa:nav-root", () => {
  showCatalog();
});

document.addEventListener("click", (e) => {
  document.querySelectorAll("details.more-menu[open]").forEach((d) => {
    if (!d.contains(e.target)) d.removeAttribute("open");
  });
});

async function init() {
  try {
    void populateDirectorSelect();
    await loadBooks();
    if (books.length) {
      showCatalog();
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
