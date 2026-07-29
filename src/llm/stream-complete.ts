import type {
  ChatMessage,
  CompleteWithToolsOptions,
  CompleteWithToolsResult,
  ParsedToolCall,
  StreamCallbacks,
  TokenUsage,
} from "./client.js";
import { parseUsage } from "./client.js";

type ToolCallAccumulator = Map<
  number,
  { id?: string; name?: string; arguments: string }
>;

function applyToolCallDelta(
  acc: ToolCallAccumulator,
  raw: unknown,
): void {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const index = Number(row.index ?? 0);
    const entry = acc.get(index) ?? { arguments: "" };
    if (typeof row.id === "string") entry.id = row.id;
    const fn = row.function;
    if (fn && typeof fn === "object") {
      const f = fn as Record<string, unknown>;
      if (typeof f.name === "string") entry.name = f.name;
      if (typeof f.arguments === "string") entry.arguments += f.arguments;
    }
    acc.set(index, entry);
  }
}

function toolCallsFromAccumulator(acc: ToolCallAccumulator): ParsedToolCall[] {
  const out: ParsedToolCall[] = [];
  for (const [, entry] of [...acc.entries()].sort((a, b) => a[0] - b[0])) {
    const name = entry.name?.trim();
    const id = entry.id?.trim();
    if (!name || !id) continue;
    out.push({ id, name, arguments: entry.arguments || "{}" });
  }
  return out;
}

/** 解析 OpenAI 兼容 SSE 流，累积 reasoning / content / tool_calls */
export async function consumeOpenAiToolStream(
  body: ReadableStream<Uint8Array>,
  callbacks: StreamCallbacks,
): Promise<{
  content: string | null;
  reasoning: string;
  toolCalls: ParsedToolCall[];
  usage?: TokenUsage;
  model?: string;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  const toolAcc: ToolCallAccumulator = new Map();
  let usage: TokenUsage | undefined;
  let model: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (typeof parsed.model === "string") model = parsed.model;
      const u = parseUsage(parsed.usage);
      if (u) usage = u;

      const choice = (parsed.choices as unknown[])?.[0];
      if (!choice || typeof choice !== "object") continue;
      const delta = (choice as Record<string, unknown>).delta;
      if (!delta || typeof delta !== "object") continue;
      const d = delta as Record<string, unknown>;

      if (typeof d.reasoning_content === "string" && d.reasoning_content) {
        reasoning += d.reasoning_content;
        callbacks.onReasoningDelta?.(d.reasoning_content);
      }
      if (typeof d.content === "string" && d.content) {
        content += d.content;
        callbacks.onContentDelta?.(d.content);
      }
      if (d.tool_calls) applyToolCallDelta(toolAcc, d.tool_calls);
    }
  }

  return {
    content: content.trim() || null,
    reasoning: reasoning.trim(),
    toolCalls: toolCallsFromAccumulator(toolAcc),
    usage,
    model,
  };
}

export type StreamableLlm = {
  completeWithToolsStream?(
    messages: ChatMessage[],
    options: CompleteWithToolsOptions,
    callbacks: StreamCallbacks,
  ): Promise<CompleteWithToolsResult>;
};

export function supportsToolStream(llm: unknown): llm is StreamableLlm {
  return (
    typeof llm === "object" &&
    llm != null &&
    typeof (llm as StreamableLlm).completeWithToolsStream === "function"
  );
}

export type ContentStreamableLlm = {
  completeStream?(
    messages: ChatMessage[],
    options?: import("./client.js").CompleteOptions,
    callbacks?: StreamCallbacks,
  ): Promise<import("./client.js").CompleteResult>;
};

export function supportsContentStream(llm: unknown): llm is ContentStreamableLlm {
  return (
    typeof llm === "object" &&
    llm != null &&
    typeof (llm as ContentStreamableLlm).completeStream === "function"
  );
}
