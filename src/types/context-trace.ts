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
};

export function buildContextTrace(params: {
  caller: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
}): LlmContextTrace {
  const messages = params.messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
  }));
  const charCount = messages.reduce((n, m) => n + m.content.length, 0);
  return {
    caller: params.caller,
    createdAt: new Date().toISOString(),
    messages,
    charCount,
    model: params.model,
  };
}

/**
 * 只保留「带 contextTrace 的消息」中最新 keepLatest 条的全文；
 * 更早的消息删除 contextTrace 字段（消息本身保留）。
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
  const withTraceIdx: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].contextTrace) withTraceIdx.push(i);
  }
  if (withTraceIdx.length <= keep) return messages;
  const drop = new Set(withTraceIdx.slice(0, withTraceIdx.length - keep));
  return messages.map((m, i) => {
    if (!drop.has(i) || !m.contextTrace) return m;
    const { contextTrace: _drop, ...rest } = m as T & { contextTrace?: LlmContextTrace };
    return rest as T;
  });
}
