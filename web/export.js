/** 将会话消息导出为可读 Markdown 文本 */

function formatExportTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const KIND_LABELS = {
  user_input: "用户输入",
  orchestrator_decision: "导演决策",
  orchestrator_prompt: "导演询问",
  agent_tool: "Agent Tool",
  worker_running: "Worker 执行",
  worker_output: "Worker 产出",
  worker_stub: "Worker 占位",
  system_info: "系统",
  error: "错误",
};

export function sessionToMarkdown(view) {
  if (!view) return "";

  const lines = [];
  lines.push(`# ${view.bookTitle ?? "未命名作品"}`);
  lines.push("");
  lines.push(`- Skill: \`${view.activeSkill ?? "—"}\``);
  lines.push(`- 阶段: ${view.phase ?? "—"}`);
  if (view.waitingReason?.kind) {
    lines.push(`- 等待: ${view.waitingReason.kind}`);
  }
  lines.push(`- 导出时间: ${new Date().toLocaleString("zh-CN")}`);
  lines.push("");

  if (view.skillCatalog?.length) {
    const stageLabel = view.lifecycleStage === "play" ? "游玩" : "创作";
    lines.push(`## ${stageLabel}能力清单`);
    lines.push("");
    for (const skill of view.skillCatalog) {
      const mark =
        skill.status === "done"
          ? "x"
          : skill.status === "active"
            ? ">"
            : " ";
      lines.push(`- [${mark}] **${skill.label}** (\`${skill.id}\`) — ${skill.purpose}`);
    }
    lines.push("");
  } else if (view.pipeline?.length) {
    lines.push("## 流程进度");
    lines.push("");
    for (const step of view.pipeline) {
      const mark =
        step.status === "done" ? "x" : step.status === "active" ? ">" : " ";
      lines.push(`- [${mark}] ${step.label}`);
    }
    lines.push("");
  }

  lines.push("## 对话与调度记录");
  lines.push("");

  for (const msg of view.messages ?? []) {
    const kind = msg.kind ?? (msg.role === "user" ? "user_input" : "system_info");
    const label = msg.title ?? KIND_LABELS[kind] ?? kind;
    lines.push(`### ${label}`);
    lines.push("");
    lines.push(`*${formatExportTime(msg.createdAt)}${msg.actor ? ` · ${msg.actor}` : ""}*`);

    if (msg.tokenUsage?.totalTokens) {
      lines.push(`*Token: ${msg.tokenUsage.totalTokens}*`);
    }
    lines.push("");

    if (msg.thinking?.trim()) {
      lines.push("**思维链**");
      lines.push("");
      lines.push(msg.thinking.trim());
      lines.push("");
    }

    const body = (msg.body ?? msg.text ?? "").trim();
    if (body) {
      lines.push(body);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

export function downloadMarkdown(filename, content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
