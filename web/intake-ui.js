function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function intakeItemRow(f, { showEmpty = true } = {}) {
  if (!f.filled && !showEmpty) return "";
  const status = f.filled ? "filled" : "empty";
  const preview = f.value
    ? `<span class="intake-value" title="${escapeHtml(f.value)}">${escapeHtml(f.value)}</span>`
    : `<span class="intake-value empty">未填写</span>`;
  return `<li class="intake-item ${status}">
    <span class="intake-mark" aria-hidden="true">${f.filled ? "✓" : "○"}</span>
    <span class="intake-label">${escapeHtml(f.label)}</span>
    ${preview}
  </li>`;
}

function intakeListSection(title, items, countLabel, { showEmpty = true } = {}) {
  if (!items.length) return "";
  const filled = items.filter((f) => f.filled).length;
  const rows = items.map((f) => intakeItemRow(f, { showEmpty })).filter(Boolean);
  if (!rows.length) return "";
  return `<div class="intake-section">
    <div class="intake-section-head">
      <span class="intake-section-title">${escapeHtml(title)}</span>
      <span class="intake-section-count">${filled}/${items.length} ${countLabel}</span>
    </div>
    <ul class="intake-list">${rows.join("")}</ul>
  </div>`;
}

function renderFilledSummary(fields) {
  const filled = fields.filter((f) => f.filled && f.value);
  if (!filled.length) return "";
  const body = filled
    .map(
      (f) =>
        `<section class="intake-filled-entry">
          <h4 class="intake-filled-label">${escapeHtml(f.label)}</h4>
          <div class="intake-filled-value">${escapeHtml(f.value)}</div>
        </section>`,
    )
    .join("");
  return `<details class="intake-filled-block" open>
    <summary>已填写内容 <span class="intake-summary-badge">${filled.length} 项</span></summary>
    <div class="intake-filled-body">${body}</div>
  </details>`;
}

function renderOptionalBlock(optional) {
  if (!optional.length) return "";
  const filled = optional.filter((f) => f.filled).length;
  const open = filled > 0 ? " open" : "";
  const rows = optional.map((f) => intakeItemRow(f, { showEmpty: true })).join("");
  return `<details class="intake-optional-block"${open}>
    <summary>可选项（选填） <span class="intake-summary-badge">${filled}/${optional.length} 已填</span></summary>
    <div class="intake-optional-body">
      <p class="intake-optional-hint">以下可补充；不填也可在确认后进入实例化。</p>
      <ul class="intake-list">${rows}</ul>
    </div>
  </details>`;
}

/**
 * @param {object | undefined} intake
 * @param {{ variant?: "composer" | "feed" }} [options]
 */
export function renderIntakePanel(intake, options = {}) {
  if (!intake?.fields?.length) return "";
  const variant = options.variant ?? "composer";
  const required = intake.fields.filter((f) => f.required);
  const optional = intake.fields.filter((f) => !f.required);
  const requiredSection = intakeListSection("必要项", required, "已填");
  const filledSummary = renderFilledSummary(intake.fields);
  const optionalBlock = renderOptionalBlock(optional);
  const headBadge =
    required.length > 0
      ? `<span class="intake-panel-badge">${intake.requiredFilled}/${intake.requiredTotal} 必要项</span>`
      : "";

  const className =
    variant === "feed" ? "intake-panel intake-panel-feed" : "intake-panel";

  return `<div class="${className}" role="region" aria-label="初始化填空进度">
    <div class="intake-panel-head">
      <span class="intake-panel-title">填空进度</span>
      ${headBadge}
    </div>
    ${requiredSection}
    ${filledSummary}
    ${optionalBlock}
  </div>`;
}
