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
import { DICTATE_MULTI_MODULE_REPLY_HINT } from "./insert-feedback.js";
import { resolveRepeatableInsertTag } from "./repeatable-tags.js";
import {
  VARIABLE_CATALOG_TAG,
  parseVariableCatalog,
  serializeVariableCatalog,
  upsertVariableField,
  removeVariableField,
  type UpsertVariableInput,
} from "../skills/variable-catalog.js";
import {
  VALUE_MAP_TAG,
  parseValueMapDoc,
  serializeValueMapDoc,
  upsertValueMapEntry,
  removeValueMapEntry,
  type UpsertMapInput,
} from "../skills/value-map.js";
import {
  parseTableDoc,
  stringifyTableDoc,
} from "../blackboard/table-cells.js";

export type DictateTurnHandlers = {
  listProducts: () => DictateProduct[];
  /** order 省略时由实现沿用原序或默认 */
  writeProduct: (tag: string, content: string, order?: number) => void;
  /** 删除固定产物 tag；返回是否曾存在 */
  deleteProduct: (tag: string) => boolean;
  /** 读/写变量目录与映射（程序校验后的 JSON） */
  readTag: (tag: string) => string | undefined;
  writeTag: (tag: string, content: string) => void;
  /** 删除任意黑板 tag（投影 / 变量.当前 等） */
  deleteTag: (tag: string) => boolean;
  clearDialogue: () => void;
  onToolCall?: (name: string, detail: string) => void;
  onThinkingDelta?: (delta: string) => void;
  onThinkingDone?: (text: string) => void;
  /**
   * insert 成功后：按 tag 反查能力，返回独立「回复模块」markdown。
   * 程序写入 tool result 的 reply_module；同轮多个须在末尾回复中全部附带。
   */
  lookupInsertFeedback?: (tag: string) => string | undefined;
};

export type DictateTurnResult = {
  reply: string;
  iterations: number;
  wroteTags: string[];
  deletedTags: string[];
  clearedDialogue: boolean;
};

/**
 * 跑一轮对话落盘整理：任务 messages 由本模块拼；preset 夹心由 LLM 包装层统一装配。
 */
export async function runDictateTurn(params: {
  llm: LlmProvider;
  dialogue: DictateChatTurn[];
  handlers: DictateTurnHandlers;
  systemPrompt?: string;
  recipeName?: string;
  recipeBrief?: string;
  /** modules catalog 的何时落盘块（formatModuleCatalogForDictate） */
  moduleGuide?: string;
  /** catalog 中 repeatable 能力的 artifact 基名（设计.生成规则 等） */
  repeatableFamilies?: ReadonlySet<string> | readonly string[];
  driver?: AgentDriver;
}): Promise<DictateTurnResult> {
  const driver = params.driver ?? createLocalLlmDriver(params.llm);
  const wroteTags: string[] = [];
  const deletedTags: string[] = [];
  let clearedDialogue = false;
  let dialogue = [...params.dialogue];
  const repeatableFamilies = new Set(
    [...(params.repeatableFamilies ?? [])].map((t) => String(t).trim()).filter(Boolean),
  );

  const systemPrompt =
    params.systemPrompt ??
    buildDictateSystemPrompt({
      recipeName: params.recipeName,
      recipeBrief: params.recipeBrief,
      moduleGuide: params.moduleGuide,
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
    label: "对话落盘",
    onThinkingDelta: params.handlers.onThinkingDelta,
    onThinkingDone: params.handlers.onThinkingDone,
    handleStep: (calls) => {
      const moduleNamesThisStep: string[] = [];
      const results = calls.map((call) => {
        const args = safeParseArgs(call.arguments);
        if (call.name === "insert" || call.name === "write_product") {
          let tag = String(args.position ?? args.tag ?? "").trim();
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
          if (repeatableFamilies.size) {
            const resolved = resolveRepeatableInsertTag({
              tag,
              content,
              existingTags: params.handlers.listProducts().map((p) => p.tag),
              repeatableFamilies,
            });
            if ("error" in resolved) {
              params.handlers.onToolCall?.(call.name, resolved.error);
              return {
                callId: call.id,
                content: JSON.stringify({ error: resolved.error }),
              };
            }
            tag = resolved.tag;
          }
          const order = parseDictateOrder(args.order);
          params.handlers.writeProduct(tag, content, order);
          wroteTags.push(tag);
          const detail =
            order === undefined ? tag : `${tag} order=${order}`;
          params.handlers.onToolCall?.(call.name, detail);
          const replyModule =
            params.handlers.lookupInsertFeedback?.(tag)?.trim() || undefined;
          if (replyModule) {
            const title =
              replyModule.match(/^#\s*模块\s*·\s*(.+)$/m)?.[1]?.trim() || tag;
            moduleNamesThisStep.push(title);
          }
          return {
            callId: call.id,
            content: JSON.stringify({
              ok: true,
              position: tag,
              ...(order !== undefined ? { order } : {}),
              ...(replyModule
                ? {
                    reply_module: replyModule,
                    reply_hint: DICTATE_MULTI_MODULE_REPLY_HINT,
                  }
                : {}),
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
        if (call.name === "delete") {
          const tag = String(args.position ?? args.tag ?? "").trim();
          const reason = String(args.reason ?? "").trim();
          if (!isAllowedProductTag(tag)) {
            const err = `拒绝删除：position 必须以「用户.」或「设计.」开头（收到：${tag || "空"}）`;
            params.handlers.onToolCall?.(call.name, err);
            return { callId: call.id, content: JSON.stringify({ error: err }) };
          }
          const existed = params.handlers.deleteProduct(tag);
          if (!existed) {
            const err = `无产物 ${tag}`;
            params.handlers.onToolCall?.(call.name, err);
            return { callId: call.id, content: JSON.stringify({ error: err }) };
          }
          deletedTags.push(tag);
          const detail = reason ? `${tag}（${reason}）` : tag;
          params.handlers.onToolCall?.(call.name, detail);
          return {
            callId: call.id,
            content: JSON.stringify({ ok: true, deleted: tag }),
          };
        }
        if (call.name === "undeclare_variable") {
          const key = String(args.key ?? "").trim();
          const current = parseVariableCatalog(
            params.handlers.readTag(VARIABLE_CATALOG_TAG),
          );
          const { doc, error } = removeVariableField(current, key);
          if (error) {
            params.handlers.onToolCall?.(call.name, error);
            return { callId: call.id, content: JSON.stringify({ error }) };
          }
          if (doc.fields.length === 0) {
            params.handlers.deleteTag(VARIABLE_CATALOG_TAG);
          } else {
            params.handlers.writeTag(
              VARIABLE_CATALOG_TAG,
              serializeVariableCatalog(doc),
            );
          }
          // 同步从 变量.当前 / 运行.初始变量 去掉该格
          for (const tableTag of ["变量.当前", "运行.初始变量"] as const) {
            const raw = params.handlers.readTag(tableTag);
            const table = parseTableDoc(raw);
            if (!table?.rows.some((r) => r.key === key)) continue;
            const next = {
              rows: table.rows.filter((r) => r.key !== key),
            };
            if (next.rows.length === 0) {
              params.handlers.deleteTag(tableTag);
            } else {
              params.handlers.writeTag(tableTag, stringifyTableDoc(next));
            }
          }
          deletedTags.push(`${VARIABLE_CATALOG_TAG}#${key}`);
          params.handlers.onToolCall?.(call.name, key);
          return {
            callId: call.id,
            content: JSON.stringify({
              ok: true,
              key,
              fields: doc.fields.length,
            }),
          };
        }
        if (call.name === "remove_map") {
          const id = String(args.id ?? "").trim();
          const current = parseValueMapDoc(
            params.handlers.readTag(VALUE_MAP_TAG),
          );
          const { doc, error, removed } = removeValueMapEntry(current, id);
          if (error || !removed) {
            const err = error ?? `映射无 id ${id}`;
            params.handlers.onToolCall?.(call.name, err);
            return { callId: call.id, content: JSON.stringify({ error: err }) };
          }
          if (doc.maps.length === 0) {
            params.handlers.deleteTag(VALUE_MAP_TAG);
          } else {
            params.handlers.writeTag(VALUE_MAP_TAG, serializeValueMapDoc(doc));
          }
          const stillUsed = doc.maps.some(
            (m) => m.target_tag === removed.target_tag,
          );
          if (!stillUsed) {
            params.handlers.deleteTag(removed.target_tag);
          }
          deletedTags.push(`${VALUE_MAP_TAG}#${id}`);
          params.handlers.onToolCall?.(
            call.name,
            `${id} → ${removed.target_tag}`,
          );
          return {
            callId: call.id,
            content: JSON.stringify({
              ok: true,
              id,
              cleared_target: stillUsed ? null : removed.target_tag,
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

      if (moduleNamesThisStep.length > 1) {
        const roster = moduleNamesThisStep.join("、");
        for (const r of results) {
          try {
            const parsed = JSON.parse(r.content) as Record<string, unknown>;
            if (typeof parsed.reply_module === "string") {
              parsed.reply_hint = `${DICTATE_MULTI_MODULE_REPLY_HINT} 本步已带回模块：${roster}。`;
              r.content = JSON.stringify(parsed);
            }
          } catch {
            /* ignore */
          }
        }
      }

      return { kind: "continue" as const, results };
    },
  });

  let reply = "";
  if (run.stop.kind === "text") {
    reply = run.stop.content.trim();
  }
  if (!reply) {
    if (wroteTags.length || deletedTags.length) {
      const parts: string[] = [];
      if (wroteTags.length) {
        parts.push(`已写入：${[...new Set(wroteTags)].join("、")}`);
      }
      if (deletedTags.length) {
        parts.push(`已删除：${[...new Set(deletedTags)].join("、")}`);
      }
      reply = `${parts.join("；")}。还有要补充的吗？`;
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
    deletedTags: [...new Set(deletedTags)],
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
