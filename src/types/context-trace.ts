import type { GenerationParameters } from "./preset.js";

/** 一次 LLM 调用实际发送的上下文（全量，供右键观察） */
export type LlmContextMessage = {
  role: string;
  content: string;
};

export type LlmContextTrace = {
  /** 调用方，如 worker:design-core / main-agent */
  caller: string;
  createdAt: string;
  messages: LlmContextMessage[];
  /** 便于列表展示 */
  charCount: number;
  model?: string;
  /** 与请求一并送出的生成参数（无则未带） */
  generation?: GenerationParameters;
};

/** 把即将写入请求 body.messages 的条目冻成痕迹（含 tool_calls 等附加字段） */
export function snapshotRequestMessages(
  messages: Array<{
    role: string;
    content?: string | null;
    tool_calls?: unknown;
    tool_call_id?: string;
  }>,
): LlmContextMessage[] {
  return messages.map((m) => {
    const hasExtras = Boolean(m.tool_calls) || Boolean(m.tool_call_id);
    if (!hasExtras) {
      return {
        role: m.role,
        content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
      };
    }
    return {
      role: m.role,
      content: JSON.stringify({
        role: m.role,
        content: m.content ?? "",
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      }),
    };
  });
}

export function buildContextTrace(params: {
  caller: string;
  messages: Array<{
    role: string;
    content?: string | null;
    tool_calls?: unknown;
    tool_call_id?: string;
  }>;
  model?: string;
  generation?: GenerationParameters;
}): LlmContextTrace {
  const messages = snapshotRequestMessages(params.messages);
  const charCount = messages.reduce((n, m) => n + m.content.length, 0);
  return {
    caller: params.caller,
    createdAt: new Date().toISOString(),
    messages,
    charCount,
    model: params.model,
    ...(params.generation && Object.keys(params.generation).length
      ? { generation: params.generation }
      : {}),
  };
}

/** 编排检查点：不随「只留最新 N 条」丢掉，否则开场白阶段无法回看/回退到流程编排 */
export function isPinnedContextTraceCaller(caller: string | undefined): boolean {
  const id = (caller ?? "").trim();
  return id === "worker:design-flow" || id.endsWith(":design-flow");
}

/**
 * 只保留「带 contextTrace 的消息」中最新 keepLatest 条的全文；
 * 更早的消息删除 contextTrace 字段（消息本身保留）。
 * design-flow 痕迹钉住不删（keep=0 仍全部清除）。
 */
export function pruneContextTraces<T extends { contextTrace?: LlmContextTrace }>(
  messages: T[],
  keepLatest: number,
): T[] {
  const keep = Math.max(0, Math.floor(keepLatest));
  if (keep <= 0) {
    return messages.map((m) => {
      if (!m.contextTrace) return m;
      const { contextTrace: _drop, ...rest } = m as T & { contextTrace?: LlmContextTrace };
      return rest as T;
    });
  }
  const droppableIdx: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const trace = messages[i].contextTrace;
    if (!trace) continue;
    if (isPinnedContextTraceCaller(trace.caller)) continue;
    droppableIdx.push(i);
  }
  if (droppableIdx.length <= keep) return messages;
  const drop = new Set(droppableIdx.slice(0, droppableIdx.length - keep));
  return messages.map((m, i) => {
    if (!drop.has(i) || !m.contextTrace) return m;
    const { contextTrace: _drop, ...rest } = m as T & { contextTrace?: LlmContextTrace };
    return rest as T;
  });
}
