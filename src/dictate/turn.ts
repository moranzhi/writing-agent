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
import {
  VARIABLE_CATALOG_TAG,
  parseVariableCatalog,
  serializeVariableCatalog,
  upsertVariableField,
  type UpsertVariableInput,
} from "../skills/variable-catalog.js";
import {
  VALUE_MAP_TAG,
  parseValueMapDoc,
  serializeValueMapDoc,
  upsertValueMapEntry,
  type UpsertMapInput,
} from "../skills/value-map.js";

export type DictateTurnHandlers = {
  listProducts: () => DictateProduct[];
  /** order 省略时由实现沿用原序或默认 */
  writeProduct: (tag: string, content: string, order?: number) => void;
  /** 读/写变量目录与映射（程序校验后的 JSON） */
  readTag: (tag: string) => string | undefined;
  writeTag: (tag: string, content: string) => void;
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
 * 跑一轮 Boss 直聘整理：上下文 = 预设提示 + 按相对序的产物 + 全量对话。
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
  const userBlock = assembled.filter((m) => m.role !== "system");

  const run = await driver.run({
    system: systemPrompt,
    messages: userBlock,
    tools: DICTATE_TOOL_DEFINITIONS,
    caller: "dictate_agent",
    label: "Boss直聘",
    onThinkingDelta: params.handlers.onThinkingDelta,
    onThinkingDone: params.handlers.onThinkingDone,
    handleStep: (calls) => {
      const results = calls.map((call) => {
        const args = safeParseArgs(call.arguments);
        if (call.name === "insert" || call.name === "write_product") {
          const tag = String(args.position ?? args.tag ?? "").trim();
          const content = String(args.content ?? "");
          if (tag === VARIABLE_CATALOG_TAG || tag === VALUE_MAP_TAG) {
            const err = `请用 declare_variable / declare_map，不要 insert ${tag}`;
            params.handlers.onToolCall?.(call.name, err);
            return { callId: call.id, content: JSON.stringify({ error: err }) };
          }
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
        if (call.name === "declare_variable") {
          const input: UpsertVariableInput = {
            key: String(args.key ?? "").trim(),
            type: args.type != null ? String(args.type) : undefined,
            initial: args.initial,
            user_visible:
              args.user_visible === undefined
                ? undefined
                : Boolean(args.user_visible),
            note: args.note != null ? String(args.note) : undefined,
          };
          const current = parseVariableCatalog(
            params.handlers.readTag(VARIABLE_CATALOG_TAG),
          );
          const { doc, error } = upsertVariableField(current, input);
          if (error) {
            params.handlers.onToolCall?.(call.name, error);
            return { callId: call.id, content: JSON.stringify({ error }) };
          }
          params.handlers.writeTag(
            VARIABLE_CATALOG_TAG,
            serializeVariableCatalog(doc),
          );
          wroteTags.push(VARIABLE_CATALOG_TAG);
          const detail = `${input.key} visible=${doc.fields.find((f) => f.key === input.key)?.user_visible !== false}`;
          params.handlers.onToolCall?.(call.name, detail);
          return {
            callId: call.id,
            content: JSON.stringify({ ok: true, key: input.key, fields: doc.fields.length }),
          };
        }
        if (call.name === "declare_map") {
          const input: UpsertMapInput = {
            id: String(args.id ?? "").trim(),
            field: String(args.field ?? "").trim(),
            target_tag: String(args.target_tag ?? "").trim(),
            bands: args.bands,
            note: args.note != null ? String(args.note) : undefined,
          };
          const current = parseValueMapDoc(
            params.handlers.readTag(VALUE_MAP_TAG),
          );
          const { doc, error } = upsertValueMapEntry(current, input);
          if (error) {
            params.handlers.onToolCall?.(call.name, error);
            return { callId: call.id, content: JSON.stringify({ error }) };
          }
          params.handlers.writeTag(VALUE_MAP_TAG, serializeValueMapDoc(doc));
          wroteTags.push(VALUE_MAP_TAG);
          const detail = `${input.id} ${input.field}→${input.target_tag}`;
          params.handlers.onToolCall?.(call.name, detail);
          return {
            callId: call.id,
            content: JSON.stringify({
              ok: true,
              id: input.id,
              target_tag: input.target_tag,
              maps: doc.maps.length,
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
              note: "对话已清空；产物与变量/映射仍在。",
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
