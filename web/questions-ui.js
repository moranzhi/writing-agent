/**
 * 结构化询问卡：点字母选中，点文案编辑；左右分页。
 * 询问是对同一次发送的可选增强：有选中则问+答拼接；未选中则不带问。
 * 点发送即答复 → 收起本轮卡（卡上无独立发送钮）。
 * 产物验收挂载题：底栏有字优先按「改产物」发送；无字时才提交所选答案。
 * 分页 / 跳过为悬浮控件，不占独立 header/footer 行。
 */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i) => {
      if (typeof item === "string") {
        const prompt = item.trim();
        if (!prompt) return null;
        return { id: `q${i + 1}`, prompt, allowOther: true, required: false, options: [] };
      }
      if (!item || typeof item !== "object") return null;
      const prompt = String(item.prompt ?? item.question ?? item.text ?? "").trim();
      if (!prompt) return null;
      const options = Array.isArray(item.options)
        ? item.options
            .map((o, j) => {
              if (typeof o === "string") {
                const label = o.trim();
                return label
                  ? { id: String.fromCharCode(65 + (j % 26)), label, editable: true }
                  : null;
              }
              if (!o || typeof o !== "object") return null;
              const label = String(o.label ?? o.text ?? "").trim();
              if (!label) return null;
              return {
                id: String(o.id ?? String.fromCharCode(65 + (j % 26))),
                label,
                editable: o.editable === false ? false : true,
              };
            })
            .filter(Boolean)
        : [];
      return {
        id: String(item.id ?? `q${i + 1}`),
        prompt,
        options,
        allowOther: item.allowOther === false ? false : true,
        required: item.required === true ? true : false,
      };
    })
    .filter(Boolean);
}

/** @returns {{ questions: any[], workerId?: string, pageSize: number, assessment?: string, optional?: boolean, skipLabel?: string } | null} */
export function getActiveQuestions(view) {
  const wr = view?.waitingReason;
  if (!wr) return null;
  // 默认每页 1 题，左右切换；勿一次堆多题
  const pageSize = Math.max(1, Number(wr.pageSize) || 1);
  if (wr.kind === "worker_questions" && wr.questions?.length) {
    return {
      questions: normalizeQuestions(wr.questions),
      workerId: wr.workerId,
      pageSize,
      optional: true,
      skipLabel: "跳过",
    };
  }
  if (wr.kind === "review_artifact" && wr.questions?.length) {
    const assessment =
      typeof wr.assessment === "string" && wr.assessment.trim()
        ? wr.assessment.trim()
        : "";
    return {
      questions: normalizeQuestions(wr.questions).map((q) => ({
        ...q,
        required: false,
      })),
      workerId: view.reviewArtifact?.workerId,
      pageSize,
      assessment,
      optional: true,
      skipLabel: "跳过",
      dismissOnAccept: true,
    };
  }
  if (wr.kind === "input" && wr.questions?.length) {
    const assessment =
      typeof wr.message === "string" && wr.message.trim()
        ? wr.message.trim()
        : "";
    // 短调度句不当作内容评价展示
    const showAssessment =
      assessment.length > 80 ||
      /完备度|核心体验|已知|待探|#\s/.test(assessment);
    return {
      questions: normalizeQuestions(wr.questions).map((q) => ({
        ...q,
        required: q.required === true ? true : false,
      })),
      workerId: "orchestrator",
      pageSize,
      assessment: showAssessment ? assessment : "",
      optional: true,
      skipLabel: "跳过",
    };
  }
  return null;
}

function persistDraftsFromDom(host, state) {
  host.querySelectorAll("[data-draft]").forEach((el) => {
    const key = el.getAttribute("data-draft");
    if (key) state.drafts[key] = el.textContent ?? "";
  });
  host.querySelectorAll("[data-other]").forEach((el) => {
    const qid = el.getAttribute("data-other");
    if (!qid) return;
    const prev = state.answers[qid] ?? {};
    state.answers[qid] = { ...prev, otherText: el.value };
  });
}

/**
 * 从询问卡收集并校验全部作答（供 composer 发送时调用）。
 * @returns {{ ok: true, answers: Array<{questionId:string, optionId?:string, text:string}> } | { ok: false, error: string, page?: number }}
 */
export function collectQuestionAnswers(host, view) {
  const active = getActiveQuestions(view);
  if (!active?.questions?.length) {
    return { ok: false, error: "当前没有待回答的追问" };
  }
  if (!host?._qState) {
    return { ok: false, error: "请先在询问卡中选择选项" };
  }
  const state = host._qState;
  persistDraftsFromDom(host, state);

  const { questions, pageSize } = active;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (q.required === false) continue;
    const ans = state.answers[q.id];
    if (!ans?.optionId) {
      return {
        ok: false,
        error: `请先选择第 ${i + 1} 题的选项（点字母选中）`,
        page: Math.floor(i / pageSize),
      };
    }
    if (ans.optionId === "other") {
      const text = (ans.otherText ?? ans.text ?? "").trim();
      if (!text) {
        return {
          ok: false,
          error: `请填写第 ${i + 1} 题的 Other`,
          page: Math.floor(i / pageSize),
        };
      }
      state.answers[q.id] = { optionId: "other", text, otherText: text };
    } else {
      const draftKey = `${q.id}:${ans.optionId}`;
      const text = (state.drafts[draftKey] ?? ans.text ?? "").trim();
      if (!text) {
        return {
          ok: false,
          error: `第 ${i + 1} 题选项文案不能为空`,
          page: Math.floor(i / pageSize),
        };
      }
      state.answers[q.id] = { ...ans, text };
    }
  }

  const answers = questions.map((q) => {
    const ans = state.answers[q.id];
    if (!ans?.optionId) {
      return { questionId: q.id, text: "（未答）" };
    }
    if (ans.optionId === "other") {
      return {
        questionId: q.id,
        optionId: "other",
        text: (ans.otherText ?? ans.text ?? "").trim() || "（未答）",
      };
    }
    const draftKey = `${q.id}:${ans.optionId}`;
    const text = (state.drafts[draftKey] ?? ans.text ?? "").trim();
    return {
      questionId: q.id,
      optionId: ans.optionId,
      text: text || "（未答）",
    };
  });

  return { ok: true, answers };
}

/**
 * 收起询问卡。传入 view 时标记本轮题已答复，避免 loading 用旧 waitingReason 把卡又画回来。
 * @param {HTMLElement | null | undefined} host
 * @param {object} [view]
 */
export function clearQuestionCardState(host, view) {
  if (!host) return;
  const active = view ? getActiveQuestions(view) : null;
  if (active?.questions?.length && view?.id) {
    host._qDismissed = {
      sessionId: view.id,
      key: JSON.stringify(active.questions.map((q) => q.id)),
    };
  } else if (host._qState?.sessionId && host._qState?.key) {
    host._qDismissed = {
      sessionId: host._qState.sessionId,
      key: host._qState.key,
    };
  }
  host._qState = null;
  host.hidden = true;
  host.innerHTML = "";
  host.classList.remove("is-open");
}

/**
 * @param {HTMLElement} host
 * @param {object} view
 * @param {{}} [_handlers]
 */
export function renderQuestionsCard(host, view, _handlers = {}) {
  if (!host) return false;
  const active = getActiveQuestions(view);
  if (!active?.questions?.length) {
    host.hidden = true;
    host.innerHTML = "";
    host.classList.remove("is-open");
    host._qDismissed = null;
    return false;
  }

  const qKey = JSON.stringify(active.questions.map((q) => q.id));
  // 本轮已通过发送/跳过答复 → 在 waitingReason 清掉前也不再打开
  if (
    host._qDismissed?.sessionId === view.id &&
    host._qDismissed?.key === qKey
  ) {
    host.hidden = true;
    host.innerHTML = "";
    host.classList.remove("is-open");
    return false;
  }

  host.hidden = false;
  host.classList.add("is-open");

  const state = host._qState?.sessionId === view.id && host._qState?.key === qKey
    ? host._qState
    : {
        sessionId: view.id,
        key: qKey,
        page: 0,
        // questionId -> { optionId?, text, otherText? }
        answers: {},
        drafts: {}, // option key -> edited label
      };
  host._qState = state;

  const { questions, pageSize, assessment, optional, skipLabel, dismissOnAccept } =
    active;
  const pageCount = Math.max(1, Math.ceil(questions.length / pageSize));
  if (state.page >= pageCount) state.page = pageCount - 1;
  if (state.page < 0) state.page = 0;
  const start = state.page * pageSize;
  const pageQs = questions.slice(start, start + pageSize);

  const assessmentHtml =
    assessment && state.page === 0
      ? `<div class="qcard-assessment">${esc(assessment)}</div>`
      : "";

  const dismissNote =
    dismissOnAccept && state.page === 0
      ? `<p class="qcard-optional-note">可选 · 接受产物即收起（无需再完善）</p>`
      : optional && state.page === 0
        ? `<p class="qcard-optional-note">可选 · 可跳过继续</p>`
        : "";

  const pagerHtml =
    pageCount > 1
      ? `<div class="qcard-pager" aria-label="问题切换">
          <button type="button" class="qcard-nav" data-qnav="prev" ${state.page <= 0 ? "disabled" : ""} aria-label="上一题">‹</button>
          <span class="qcard-page">${state.page + 1}/${pageCount}</span>
          <button type="button" class="qcard-nav" data-qnav="next" ${state.page >= pageCount - 1 ? "disabled" : ""} aria-label="下一题">›</button>
        </div>`
      : "";

  const skipHtml = optional
    ? `<button type="button" class="qcard-skip" data-qskip title="Esc">${esc(skipLabel || "跳过")}</button>`
    : "";

  const chromeClass = [
    "qcard",
    pageCount > 1 ? "has-pager" : "",
    optional ? "has-skip" : "",
  ]
    .filter(Boolean)
    .join(" ");

  host.innerHTML = `
    <div class="${chromeClass}" role="dialog" aria-label="询问">
      <div class="qcard-float">
        ${pagerHtml}
        ${skipHtml}
      </div>
      <div class="qcard-body">
        ${dismissNote}
        ${assessmentHtml}
        ${pageQs
          .map((q, qi) => {
            const globalIdx = start + qi + 1;
            const ans = state.answers[q.id] ?? {};
            const opts = q.options?.length
              ? q.options
              : q.allowOther
                ? []
                : [{ id: "A", label: q.prompt, editable: true }];
            return `
            <section class="qcard-q" data-qid="${esc(q.id)}">
              <div class="qcard-prompt">${globalIdx}. ${esc(q.prompt)}</div>
              <ul class="qcard-options">
                ${opts
                  .map((opt, oi) => {
                    const letter = String.fromCharCode(65 + (oi % 26));
                    const draftKey = `${q.id}:${opt.id}`;
                    const label = state.drafts[draftKey] ?? opt.label;
                    const selected = ans.optionId === opt.id;
                    const editable = opt.editable !== false;
                    return `
                    <li class="qcard-opt${selected ? " is-selected" : ""}" data-oid="${esc(opt.id)}">
                      <button type="button" class="qcard-letter" data-select="${esc(opt.id)}" title="选中">${letter}</button>
                      ${
                        editable
                          ? `<div class="qcard-label" contenteditable="true" data-draft="${esc(draftKey)}" spellcheck="false">${esc(label)}</div>`
                          : `<div class="qcard-label is-readonly">${esc(label)}</div>`
                      }
                    </li>`;
                  })
                  .join("")}
                ${
                  q.allowOther !== false
                    ? `
                  <li class="qcard-opt qcard-other${ans.optionId === "other" ? " is-selected" : ""}" data-oid="other">
                    <button type="button" class="qcard-letter" data-select="other" title="选中">+</button>
                    <input class="qcard-other-input" type="text" placeholder="Other…" data-other="${esc(q.id)}" value="${esc(ans.otherText ?? "")}" />
                  </li>`
                    : ""
                }
              </ul>
            </section>`;
          })
          .join("")}
      </div>
    </div>`;

  host.querySelector("[data-qskip]")?.addEventListener("click", () => {
    _handlers.onSkipQuestions?.();
  });

  host.querySelectorAll("[data-qnav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      persistDraftsFromDom(host, state);
      const dir = btn.getAttribute("data-qnav");
      if (dir === "prev" && state.page > 0) state.page -= 1;
      if (dir === "next" && state.page < pageCount - 1) state.page += 1;
      renderQuestionsCard(host, view, _handlers);
    });
  });

  host.querySelectorAll("[data-select]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      persistDraftsFromDom(host, state);
      const section = btn.closest(".qcard-q");
      const qid = section?.getAttribute("data-qid");
      const oid = btn.getAttribute("data-select");
      if (!qid || !oid) return;
      let text = "";
      if (oid === "other") {
        const input = section.querySelector(`[data-other="${qid}"]`);
        text = (input?.value ?? "").trim();
        state.answers[qid] = { optionId: "other", text, otherText: text };
      } else {
        const draftKey = `${qid}:${oid}`;
        const labelEl = section.querySelector(`[data-draft="${draftKey}"]`);
        text = (labelEl?.textContent ?? state.drafts[draftKey] ?? "").trim();
        state.answers[qid] = { optionId: oid, text };
      }
      renderQuestionsCard(host, view, _handlers);
    });
  });

  host.querySelectorAll("[data-draft]").forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      }
    });
    el.addEventListener("blur", () => {
      const key = el.getAttribute("data-draft");
      if (key) state.drafts[key] = el.textContent ?? "";
      const section = el.closest(".qcard-q");
      const qid = section?.getAttribute("data-qid");
      const oid = el.closest(".qcard-opt")?.getAttribute("data-oid");
      if (qid && oid && state.answers[qid]?.optionId === oid) {
        state.answers[qid] = {
          ...state.answers[qid],
          text: (el.textContent ?? "").trim(),
        };
      }
    });
  });

  return true;
}
