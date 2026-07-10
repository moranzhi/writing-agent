import { renderIntakePanel } from "./intake-ui.js";

const HIDE_KINDS = new Set(["worker_stub"]);

const MSG_CLASS = {
  user_input: "user",
  agent_tool: "agent",
  orchestrator_decision: "agent",
  orchestrator_prompt: "agent",
  worker_running: "skill",
  worker_output: "skill",
  worker_questions: "skill",
  error: "error",
};

const MSG_LABEL = {
  user_input: "你",
  agent_tool: "Tool",
  orchestrator_decision: "Agent",
  orchestrator_prompt: "Agent",
  worker_running: "Skill",
  worker_output: "Skill",
  worker_questions: "Skill 提问",
  error: "错误",
  system_info: "系统",
};

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function msgLabel(msg) {
  const k = msg.kind ?? (msg.role === "user" ? "user_input" : "system_info");
  if (k.startsWith("worker") && msg.actor) return `Skill · ${msg.actor}`;
  return MSG_LABEL[k] ?? k;
}

function msgBody(msg, view) {
  let body = (msg.body ?? msg.text ?? "").trim();
  if (msg.kind === "worker_questions" && !body) {
    const wr = view.waitingReason;
    if (wr?.kind === "worker_questions") {
      const qs = (wr.questions ?? []).filter(Boolean);
      if (qs.length) body = qs.map((q) => `- ${q}`).join("\n");
    }
    if (!body) body = "请补充当前 skill 需要的信息。";
  }
  return body;
}

export function renderSkillPicker(view, onPick) {
  const el = document.getElementById("skill-picker");
  if (!el) return;
  const selecting = view.waitingReason?.kind === "skill_selection";
  const skills = view.skills ?? [];
  if (!selecting || !skills.length) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  el.innerHTML = `
    <h2>选择 skill 包</h2>
    <p>Agent 需要知道你要用哪套能力。选一项开始实例化（也可在下方输入名称或编号）。</p>
    <div class="skill-grid" id="skill-grid"></div>`;
  const grid = el.querySelector("#skill-grid");
  skills.forEach((skill, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "skill-card";
    btn.innerHTML = `
      <div class="skill-card-name">${esc(skill.name)}</div>
      <div class="skill-card-desc">${esc(skill.description || "无说明")}</div>
      <div class="skill-card-tag">${esc(skill.category || "")} · #${i + 1}</div>`;
    btn.addEventListener("click", () => onPick(skill.name));
    grid.appendChild(btn);
  });
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
      btn.title = view.playReady ? "" : "实例就绪后可切换";
    } else {
      btn.disabled = false;
    }
  });
}

export function renderSkillGuide(view) {
  const wrap = document.getElementById("skill-guide");
  const list = document.getElementById("skill-guide-list");
  if (!wrap || !list) return;
  const show = view.lifecycleStage === "design" && (view.skillCatalog?.length ?? 0) > 0;
  if (!show) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  list.innerHTML = view.skillCatalog
    .map(
      (s) => `
    <div class="skill-guide-item ${s.status}">
      <span class="skill-guide-dot"></span>
      <div>
        <div class="skill-guide-label">${esc(s.label)} <code>${esc(s.id)}</code></div>
        <div class="skill-guide-purpose">${esc(s.purpose)}</div>
      </div>
    </div>`,
    )
    .join("");
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
    items.push({
      kind,
      title: msg.title ?? msgLabel(msg),
      body: msgBody(msg, view).slice(0, 160),
      at: msg.createdAt,
    });
  }
  if (loading && f) {
    items.push({ kind: "pending", title: f.action, body: f.detail ?? "", at: "" });
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

export function renderMessageFeed(view, loading) {
  const feed = document.getElementById("message-feed");
  if (!feed) return;

  const intake =
    view.waitingReason?.kind === "intake" && view.intake?.fields?.length;
  const selecting = view.waitingReason?.kind === "skill_selection";

  feed.innerHTML = "";

  if (intake) {
    const box = document.createElement("div");
    box.className = "intake-panel";
    box.innerHTML = renderIntakePanel(view.intake, { variant: "feed" });
    feed.appendChild(box);
  }

  const visible = (view.messages ?? []).filter((m) => {
    if (m.role === "user") return true;
    return !HIDE_KINDS.has(m.kind ?? "");
  });

  if (!visible.length && !loading && !intake) {
    const p = document.createElement("p");
    p.className = "empty";
    if (selecting) {
      p.textContent = "在上方选择 skill 包，或在下方输入 skill 名称。";
    } else if (view.lifecycleStage === "play") {
      p.textContent = "游玩模式：Agent 将调度 run skill，推进世界与叙事。";
    } else {
      p.textContent = "创作模式：与 Agent 对话，完成实例化后可切到游玩。";
    }
    feed.appendChild(p);
    return;
  }

  for (const msg of visible) {
    const isUser = msg.role === "user";
    const kind = msg.kind ?? (isUser ? "user_input" : "system_info");
    const card = document.createElement("article");
    card.className = `msg ${MSG_CLASS[kind] ?? "system"}`;
    card.innerHTML = `
      <header class="msg-head">
        <span class="msg-tag">${esc(msgLabel(msg))}</span>
        <span>${esc(msg.title ?? "")}</span>
        <span class="msg-time">${fmtTime(msg.createdAt)}</span>
      </header>
      <div class="msg-body">${esc(msgBody(msg, view))}</div>`;
    feed.appendChild(card);
  }

  if (loading) {
    const pending = document.createElement("article");
    pending.className = "msg agent msg-pending";
    pending.innerHTML = `
      <header class="msg-head"><span class="msg-tag">进行中</span><span>${esc(view.focus?.action ?? "处理中")}</span></header>
      <div class="msg-body">…</div>`;
    feed.appendChild(pending);
  }

  feed.scrollTop = feed.scrollHeight;
}

export function renderWorkspace(view, loading, onPickSkill) {
  renderLifecycle(view);
  renderSkillPicker(view, onPickSkill);
  renderMessageFeed(view, loading);
  renderSkillGuide(view);
  renderAgentPanel(view, loading);
}
