import type { LlmProvider } from "../llm/client.js";
import {
  createLocalLlmDriver,
  type AgentDriver,
} from "../runtime/driver.js";
import { buildDictateMessages } from "./context.js";
import { buildDictateSystemPrompt } from "./prompt.js";
import { DICTATE_TOOL_DEFINITIONS } from "./tools.js";
import {
  isAllowedProductTag,
  parseDictateOrder,
  type DictateChatTurn,
  type DictateProduct,
} from "./types.js";

export type DictateTurnHandlers = {
  listProducts: () => DictateProduct[];
  /** order 省略时由实现沿用原序或默认 */
  writeProduct: (tag: string, content: string, order?: number) => void;
  clearDialogue: () => void;
  onToolCall?: (name: string, detail: string) => void;
  onThinkingDelta?: (delta: string) => void;
  onThinkingDone?: (text: string) => void;
};

export type DictateTurnResult = {
  reply: string;
  iterations: number;
  wroteTags: string[];
  clearedDialogue: boolean;
};

/**
 * 跑一轮转述整理：上下文 = 预设提示 + 按相对序的产物 + 全量对话。
 * 产物只许 insert(position, content, order?)；最终文本即对用户回复。
 */
export async function runDictateTurn(params: {
  llm: LlmProvider;
  dialogue: DictateChatTurn[];
  handlers: DictateTurnHandlers;
  systemPrompt?: string;
  recipeName?: string;
  recipeBrief?: string;
  driver?: AgentDriver;
}): Promise<DictateTurnResult> {
  const driver = params.driver ?? createLocalLlmDriver(params.llm);
  const wroteTags: string[] = [];
  let clearedDialogue = false;
  let dialogue = [...params.dialogue];

  const systemPrompt =
    params.systemPrompt ??
    buildDictateSystemPrompt({
      recipeName: params.recipeName,
      recipeBrief: params.recipeBrief,
    });
  const assembled = buildDictateMessages({
    systemPrompt,
    products: params.handlers.listProducts(),
    dialogue,
  });
  // driver 会再前置 system；此处只传 user 拼装块，避免双重 system
  const userBlock = assembled.filter((m) => m.role !== "system");

  const run = await driver.run({
    system: systemPrompt,
    messages: userBlock,
    tools: DICTATE_TOOL_DEFINITIONS,
    caller: "dictate_agent",
    label: "转述整理",
    onThinkingDelta: params.handlers.onThinkingDelta,
    onThinkingDone: params.handlers.onThinkingDone,
    handleStep: (calls) => {
      const results = calls.map((call) => {
        const args = safeParseArgs(call.arguments);
        if (call.name === "insert" || call.name === "write_product") {
          const tag = String(
            args.position ?? args.tag ?? "",
          ).trim();
          const content = String(args.content ?? "");
          if (!isAllowedProductTag(tag)) {
            const err = `拒绝写入：position 必须以「用户.」或「设计.」开头（收到：${tag || "空"}）`;
            params.handlers.onToolCall?.(call.name, err);
            return { callId: call.id, content: JSON.stringify({ error: err }) };
          }
          if (!content.trim()) {
            const err = "content 不能为空";
            params.handlers.onToolCall?.(call.name, err);
            return { callId: call.id, content: JSON.stringify({ error: err }) };
          }
          const order = parseDictateOrder(args.order);
          params.handlers.writeProduct(tag, content, order);
          wroteTags.push(tag);
          const detail =
            order === undefined ? tag : `${tag} order=${order}`;
          params.handlers.onToolCall?.(call.name, detail);
          return {
            callId: call.id,
            content: JSON.stringify({
              ok: true,
              position: tag,
              ...(order !== undefined ? { order } : {}),
            }),
          };
        }
        if (call.name === "clear_dialogue") {
          const reason = String(args.reason ?? "").trim() || "上下文过长";
          params.handlers.clearDialogue();
          clearedDialogue = true;
          dialogue = [];
          params.handlers.onToolCall?.(call.name, reason);
          return {
            callId: call.id,
            content: JSON.stringify({
              ok: true,
              cleared: true,
              note: "对话已清空；产物仍在。后续上下文以产物为准。",
            }),
          };
        }
        const err = `未知工具：${call.name}`;
        params.handlers.onToolCall?.(call.name, err);
        return { callId: call.id, content: JSON.stringify({ error: err }) };
      });
      return { kind: "continue" as const, results };
    },
  });

  // driver 的 messages 在首轮已固定；clear 后若还要续写依赖模型已知工具结果。
  // 若模型只调工具不说话，给一个兜底回复。
  let reply = "";
  if (run.stop.kind === "text") {
    reply = run.stop.content.trim();
  }
  if (!reply) {
    if (wroteTags.length) {
      reply = `已写入：${[...new Set(wroteTags)].join("、")}。还有要补充的吗？`;
    } else if (clearedDialogue) {
      reply = "对话已清空，产物都还在。可以继续说。";
    } else {
      reply = "我在听，请继续说你想要的体验或设定。";
    }
  }

  return {
    reply,
    iterations: run.iterations,
    wroteTags: [...new Set(wroteTags)],
    clearedDialogue,
  };
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}
