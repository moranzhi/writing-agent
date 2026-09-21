import { execSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type {
  ApplyEventResult,
  RuntimeEvent,
  RuntimePhase,
  RuntimeSession,
  WaitingReason,
} from "./types/runtime.js";
import { getUserDataDir } from "./config/user-data-dir.js";

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const UTF8_BOM = "\uFEFF";

const KIND_LABEL = {
  llm: "模型",
  state: "状态",
  step: "步骤",
} as const;

const PHASE_LABEL: Record<RuntimePhase, string> = {
  idle: "空闲",
  running: "执行中",
  waiting_user: "等待用户",
  done: "完成",
  error: "出错",
};

const WAIT_LABEL: Record<WaitingReason["kind"], string> = {
  skill_selection: "选能力包",
  intake: "收集需求",
  input: "等待输入",
  approve_step: "确认开干",
  review_artifact: "验收产物",
  worker_questions: "执行单元提问",
  revision: "修订",
  next_intent: "下一步意向",
  pick_creation_step: "点选节点",
};

const EVENT_LABEL: Record<RuntimeEvent["type"], string> = {
  session_started: "会话开始",
  skill_selected: "已选能力包",
  user_submitted_input: "用户发言",
  user_confirmed_intake: "确认需求",
  main_agent_decision_created: "总管决策",
  user_approved_next_step: "确认下一步",
  user_rejected_next_step: "拒绝下一步",
  user_requested_flow_replan: "再编排",
  user_picked_creation_step: "点选节点",
  creation_step_pick_awaited: "等待点选节点",
  user_left_creation_step: "返回节点选择",
  worker_started: "执行单元开始",
  worker_completed: "执行单元完成",
  worker_needs_input: "执行单元提问",
  worker_revision_produced_nothing: "修订无新产物",
  user_resolved_sidecar_questions: "回答挂载追问",
  user_accepted_artifact: "验收通过",
  user_rejected_artifact: "打回产物",
  user_requested_revision: "请求修订",
  programmatic_review_started: "程序验收开始",
  programmatic_review_passed: "程序验收通过",
  programmatic_review_failed: "程序验收失败",
  flow_completed: "流程结束",
  runtime_failed: "运行失败",
};

const EFFECT_LABEL: Record<string, string> = {
  invoke_main_agent: "调用总管",
  run_worker: "启动执行单元",
  resume_worker: "恢复执行单元",
  run_programmatic_review: "程序验收",
  emit_message: "发消息",
  propose_next_creation_step: "提案下一步",
  seal_creation_opening: "收口开场白",
  unseal_creation_opening: "解开开场收口",
  run_play_turn: "开游玩回合",
  continue_play_turn: "续游玩管线",
};

const TOOL_LABEL: Record<string, string> = {
  read_blackboard: "读黑板",
  list_workers: "列执行单元",
  list_artifacts: "列产物",
  run_worker: "跑执行单元",
  ask_user: "问用户",
  review_blackboard: "审黑板",
  finish: "结束",
  insert: "写入产物",
  write_product: "写入产物",
  delete: "删除产物",
  declare_variable: "声明变量",
  undeclare_variable: "移除变量",
  declare_map: "声明映射",
  remove_map: "移除映射",
  clear_dialogue: "清空对话",
  chance: "机遇裁定",
  submit_present_packet: "提交呈现",
  submit_worker_result: "提交结果",
};

const ACTION_LABEL: Record<string, string> = {
  run_worker: "跑执行单元",
  ask_user: "问用户",
  review_blackboard: "审黑板",
  finish: "结束",
};

let consoleUtf8Ready = false;

/** Windows 控制台切到 UTF-8，避免中文日志乱码。 */
export function ensureConsoleUtf8(): void {
  if (consoleUtf8Ready) return;
  consoleUtf8Ready = true;
  if (process.platform !== "win32") return;
  try {
    // inherit 才会改当前窗口代码页；stdio ignore 只影响子进程
    execSync("chcp 65001 >NUL", { stdio: "inherit", shell: true, windowsHide: true });
  } catch {
    /* 无控制台（桌面隐藏启动）时忽略 */
  }
  try {
    process.stdout.setDefaultEncoding("utf8");
    process.stderr.setDefaultEncoding("utf8");
  } catch {
    /* ignore */
  }
}

export function getRuntimeLogPath(): string {
  return path.join(getUserDataDir(), "logs", "runtime.log");
}

let logFilePrepared = false;

function fileHasUtf8Bom(file: string): boolean {
  try {
    const fd = openSync(file, "r");
    const buf = Buffer.alloc(3);
    const n = readSync(fd, buf, 0, 3, 0);
    closeSync(fd);
    return n >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  } catch {
    return false;
  }
}

function prepareLogFile(file: string): void {
  if (logFilePrepared) return;
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file) && statSync(file).size > 0 && !fileHasUtf8Bom(file)) {
    try {
      renameSync(file, `${file}.old`);
    } catch {
      /* ignore */
    }
  }
  if (!existsSync(file) || statSync(file).size === 0) {
    writeFileSync(file, `${UTF8_BOM}=== 写作助手运行日志（UTF-8）===\n`, "utf8");
  }
  logFilePrepared = true;
}

function appendRuntimeLog(line: string): void {
  if (process.env.VITEST) return;
  try {
    const file = getRuntimeLogPath();
    prepareLogFile(file);
    try {
      if (statSync(file).size > MAX_LOG_BYTES) {
        renameSync(file, `${file}.1`);
        writeFileSync(file, `${UTF8_BOM}=== 写作助手运行日志（UTF-8）===\n`, "utf8");
      }
    } catch {
      /* rotate best-effort */
    }
    appendFileSync(file, `${line}\n`, "utf8");
  } catch {
    /* logging must not break the app */
  }
}

function stamp(): string {
  return new Date().toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function labelPhase(phase: string): string {
  return PHASE_LABEL[phase as RuntimePhase] ?? phase;
}

function labelWait(wait: string): string {
  if (wait === "-") return "无";
  return WAIT_LABEL[wait as WaitingReason["kind"]] ?? wait;
}

export function labelCaller(caller: string | undefined): string {
  const who = caller?.trim() || "未知";
  if (who === "main_agent" || who.startsWith("main_agent:")) return "总管";
  if (who === "intake_extract") return "需求抽取";
  if (who === "dictate_agent") return "对话落盘";
  if (who === "preset-probe") return "预设探测";
  if (who.startsWith("model-compare:")) {
    return `模型对比 ${who.slice("model-compare:".length)}`;
  }
  if (who.startsWith("worker:")) return `执行单元 ${who.slice("worker:".length)}`;
  if (who === "unknown") return "未知";
  return who;
}

export function labelLlmMode(kind: string): string {
  switch (kind) {
    case "complete":
      return "整段";
    case "stream":
      return "流式";
    case "tools":
      return "工具";
    case "tools-stream":
      return "工具流式";
    default:
      return kind;
  }
}

export function labelTool(name: string): string {
  return TOOL_LABEL[name] ?? name;
}

export function labelAction(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/** 服务端必要步骤：每次模型请求、状态迁移、创作步骤推进。 */
export function debugLog(kind: "llm" | "state" | "step", line: string): void {
  ensureConsoleUtf8();
  const text = `[${stamp()} ${KIND_LABEL[kind]}] ${line}`;
  console.log(text);
  appendRuntimeLog(text);
}

export function sessionSnap(session: RuntimeSession): {
  phase: string;
  wait: string;
  step: string;
  worker: string;
} {
  return {
    phase: session.phase,
    wait: session.waitingReason?.kind ?? "-",
    step: session.currentStepId ?? "-",
    worker: session.currentWorkerId ?? "-",
  };
}

function eventHint(event: RuntimeEvent): string {
  switch (event.type) {
    case "worker_started":
    case "worker_needs_input":
      return event.payload.workerId;
    case "main_agent_decision_created": {
      const d = event.payload.decision;
      const action = labelAction(d.action);
      return d.workerId ? `${action} ${d.workerId}` : action;
    }
    case "skill_selected":
      return event.payload.skill.name;
    case "user_accepted_artifact":
    case "user_rejected_artifact":
      return event.payload.artifactId.slice(0, 8);
    default:
      return "";
  }
}

export function logStateChange(
  event: RuntimeEvent,
  before: ReturnType<typeof sessionSnap>,
  result: ApplyEventResult,
): void {
  const after = sessionSnap(result.session);
  const bits = [EVENT_LABEL[event.type] ?? event.type];
  const hint = eventHint(event);
  if (hint) bits.push(hint);
  if (before.phase !== after.phase) {
    bits.push(`相位 ${labelPhase(before.phase)}→${labelPhase(after.phase)}`);
  } else {
    bits.push(`相位=${labelPhase(after.phase)}`);
  }
  if (before.wait !== after.wait) {
    bits.push(`等待 ${labelWait(before.wait)}→${labelWait(after.wait)}`);
  } else if (after.wait !== "-") {
    bits.push(`等待=${labelWait(after.wait)}`);
  }
  if (before.step !== after.step) bits.push(`步骤 ${before.step}→${after.step}`);
  if (before.worker !== after.worker) bits.push(`执行单元 ${before.worker}→${after.worker}`);
  const effects = result.effects.map((e) => {
    const name = EFFECT_LABEL[e.type] ?? e.type;
    return e.type === "run_worker" ? `${name} ${e.workerId}` : name;
  });
  if (effects.length) bits.push(`随后 ${effects.join("，")}`);
  if (result.error) bits.push(`出错 ${result.error.slice(0, 120)}`);
  debugLog("state", bits.join("  "));
}
