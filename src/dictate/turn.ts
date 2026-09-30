import type { LlmProvider } from "../llm/client.js";
import {
  createLocalLlmDriver,
  DriverIterationLimitError,
  type AgentDriver,
} from "../runtime/driver.js";
import { buildDictateMessages } from "./context.js";
import { buildDictateSystemPrompt } from "./prompt.js";
import { DICTATE_TOOL_DEFINITIONS } from "./tools.js";
import {
  isAllowedProductTag,
  parseDictateOrder,
  type DictateSelfScore,
  type DictateChatTurn,
  type DictateProduct,
} from "./types.js";
import {
  DICTATE_MULTI_MODULE_REPLY_HINT,
  resolveModuleForInsertTag,
} from "./insert-feedback.js";
import { dictateProductFamily, resolveRepeatableInsertTag, splitConcreteInstanceContents } from "./repeatable-tags.js";
import type { ModuleCatalog } from "../skills/creation-flow.js";
import {
  CREATION_PLAN_TAG,
  formatCreationPlanCapabilityCatalog,
  formatCreationPlanProgress,
  parseCreationPlan,
  requiredCreationPlanGaps,
  validateCreationPlan,
} from "./creation-plan.js";
import {
  DICTATE_MODULE_READ_STATE_TAG,
  parseDictateModuleReadState,
  readLibraryEntries,
  serializeDictateModuleReadState,
  type DictateModuleReadPayload,
} from "./read-module.js";
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
import { isDictateOpeningTag } from "./experience-anchor.js";
import { canonicalizeInsertedContent } from "../parse/json-doc.js";

export type DictateTurnHandlers = {
  listProducts: () => DictateProduct[];
  /** order 省略时由实现沿用原序或默认 */
  writeProduct: (
    tag: string,
    content: string,
    order?: number,
    metadata?: { layer?: "intermediate" | "final"; selfScore?: DictateSelfScore },
  ) => void;
  /** 删除固定产物 tag；返回是否曾存在 */
  deleteProduct: (tag: string) => boolean;
  /** 读/写变量目录与映射（程序校验后的 JSON） */
  readTag: (tag: string) => string | undefined;
  writeTag: (tag: string, content: string) => void;
  /** 删除任意黑板 tag（投影 / 变量.当前 等） */
  deleteTag: (tag: string) => boolean;
  /** 写入开场白前运行确定性收口工具，保证运行配置先于开场落盘。 */
  prepareOpening?: () => void;
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
 * 一轮对话落盘的工具上限。
 * 串行模型往往一轮只调一个工具：读能力再写入，方案里十余项，再加上收尾回复。
 */
export const DICTATE_DRIVER_MAX_ITERATIONS = 36;

/** 接近上限时写进工具结果，让模型停下来回复用户。 */
export const DICTATE_TURN_LIMIT_HINT =
  "本轮工具次数已接近上限。停止调用工具，直接回复用户。已写入的保留；未写的能力下一轮继续。";

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
  /** 尚无本局方案时显示的旧配方案例目录 */
  recipeExamples?: string;
  /** 用于本局方案覆盖校验及方案态能力状态 */
  moduleCatalog?: ModuleCatalog | null;
  /** 当前能力提示的可读内容与版本；存在时启用写前读取门禁 */
  moduleReadIndex?: ReadonlyMap<string, DictateModuleReadPayload>;
  /** catalog 中 repeatable 能力的 artifact 基名（设计.生成规则 等） */
  repeatableFamilies?: ReadonlySet<string> | readonly string[];
  driver?: AgentDriver;
}): Promise<DictateTurnResult> {
  const driver = params.driver ?? createLocalLlmDriver(params.llm);
  const wroteTags: string[] = [];
  const deletedTags: string[] = [];
  let clearedDialogue = false;
  let openingPrepared = false;
  let dialogue = [...params.dialogue];
  const repeatableFamilies = new Set(
    [...(params.repeatableFamilies ?? [])].map((t) => String(t).trim()).filter(Boolean),
  );

  const systemPrompt =
    params.systemPrompt ??
    (() => {
      const products = params.handlers.listProducts();
      const plan = parseCreationPlan(
        products.find((product) => product.tag === CREATION_PLAN_TAG)?.content,
      );
      return buildDictateSystemPrompt({
        ...(plan
          ? {
              creationPlanState: formatCreationPlanProgress({
                plan,
                catalog: params.moduleCatalog,
                products,
              }),
            }
          : {
              capabilityCatalog:
                formatCreationPlanCapabilityCatalog(params.moduleCatalog) ||
                params.moduleGuide,
              recipeExamples: params.recipeExamples,
              recipeName: params.recipeName,
              recipeBrief: params.recipeBrief,
            }),
      });
    })();
  const assembled = buildDictateMessages({
    systemPrompt,
    products: params.handlers.listProducts(),
    dialogue,
  });
  const userBlock = assembled.filter((m) => m.role !== "system");
  let toolSteps = 0;

  let run;
  try {
    run = await driver.run({
    system: systemPrompt,
    messages: userBlock,
    tools: DICTATE_TOOL_DEFINITIONS,
    caller: "dictate_agent",
    label: "对话落盘",
    maxIterations: DICTATE_DRIVER_MAX_ITERATIONS,
    onThinkingDelta: params.handlers.onThinkingDelta,
    onThinkingDone: params.handlers.onThinkingDone,
    handleStep: (calls) => {
      toolSteps += 1;
      const moduleNamesThisStep: string[] = [];
      const results = calls.map((call) => {
        const args = safeParseArgs(call.arguments);
        if (
          call.name === "declare_variable" ||
          call.name === "declare_map" ||
          call.name === "delete" ||
          call.name === "undeclare_variable" ||
          call.name === "remove_map"
        ) {
          openingPrepared = false;
        }
        if (call.name === "read_module") {
          const ref = String(args.module_id ?? "").trim();
          const module = params.moduleReadIndex?.get(ref);
          if (!module) {
            const err = `未找到能力：${ref || "空"}`;
            params.handlers.onToolCall?.(call.name, err);
            return { callId: call.id, content: JSON.stringify({ error: err }) };
          }
          const state = parseDictateModuleReadState(
            params.handlers.readTag(DICTATE_MODULE_READ_STATE_TAG),
          );
          state.modules[module.module_id] = module.version;
          state.active_module_id = module.module_id;
          params.handlers.writeTag(
            DICTATE_MODULE_READ_STATE_TAG,
            serializeDictateModuleReadState(state),
          );
          params.handlers.onToolCall?.(
            call.name,
            `${module.module_id}@${module.version}`,
          );
          return {
            callId: call.id,
            content: JSON.stringify({ ok: true, ...module }),
          };
        }
        if (call.name === "read_library_entry") {
          const state = parseDictateModuleReadState(
            params.handlers.readTag(DICTATE_MODULE_READ_STATE_TAG),
          );
          const module = state.active_module_id
            ? params.moduleReadIndex?.get(state.active_module_id)
            : undefined;
          if (!module) {
            const err = "请先 read_module 读取要使用该库的能力";
            params.handlers.onToolCall?.(call.name, err);
            return { callId: call.id, content: JSON.stringify({ error: err }) };
          }
          const result = readLibraryEntries({
            module,
            libraryId: String(args.library_id ?? ""),
            entryIds: Array.isArray(args.entry_ids)
              ? args.entry_ids.map(String)
              : [],
            reason: typeof args.reason === "string" ? args.reason : undefined,
          });
          params.handlers.onToolCall?.(
            call.name,
            result.error ?? `${args.library_id}: ${result.entries?.length ?? 0}`,
          );
          return {
            callId: call.id,
            content: JSON.stringify(
              result.error
                ? { error: result.error }
                : {
                    ok: true,
                    module_id: module.module_id,
                    library_id: String(args.library_id ?? ""),
                    entries: result.entries,
                  },
            ),
          };
        }
        if (call.name === "prepare_opening") {
          params.handlers.prepareOpening?.();
          openingPrepared = true;
          params.handlers.onToolCall?.(
            call.name,
            "信息可见范围 → 游玩执行方式 → 上下文排序 → 运行配置组装",
          );
          return {
            callId: call.id,
            content: JSON.stringify({
              ok: true,
              runtime_prepared: true,
              next: "现在生成并 insert 开场白",
            }),
          };
        }
        if (call.name === "insert" || call.name === "write_product") {
          let tag = String(args.position ?? args.tag ?? "").trim();
          const content = canonicalizeInsertedContent(String(args.content ?? ""));
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
          const targetModule = resolveModuleForInsertTag(
            tag,
            params.moduleCatalog,
          );
          if (
            targetModule &&
            params.moduleReadIndex &&
            requiresModuleRead(targetModule.id, targetModule.auto)
          ) {
            const current = params.moduleReadIndex.get(targetModule.id);
            const state = parseDictateModuleReadState(
              params.handlers.readTag(DICTATE_MODULE_READ_STATE_TAG),
            );
            if (!current || state.modules[targetModule.id] !== current.version) {
              const err = `写入 ${tag} 前必须先 read_module("${targetModule.id}") 读取当前提示版本`;
              params.handlers.onToolCall?.(call.name, err);
              return {
                callId: call.id,
                content: JSON.stringify({
                  error: err,
                  required_module_id: targetModule.id,
                  required_version: current?.version,
                }),
              };
            }
          }
          const currentModule = targetModule
            ? params.moduleReadIndex?.get(targetModule.id)
            : undefined;
          const selfScore = parseAndValidateSelfScore(
            args.self_score,
            currentModule?.score_dimensions ?? [],
          );
          if ("error" in selfScore) {
            params.handlers.onToolCall?.(call.name, selfScore.error);
            return {
              callId: call.id,
              content: JSON.stringify({ error: selfScore.error }),
            };
          }
          if (tag === CREATION_PLAN_TAG) {
            const validation = validateCreationPlan(content, params.moduleCatalog);
            if (!validation.ok) {
              const err = validation.error ?? "本局创作方案校验失败";
              params.handlers.onToolCall?.(call.name, err);
              return {
                callId: call.id,
                content: JSON.stringify({
                  error: err,
                  missing_ids: validation.missingIds,
                  duplicate_ids: validation.duplicateIds,
                  unknown_ids: validation.unknownIds,
                }),
              };
            }
          }
          if (repeatableFamilies.size) {
            const family = dictateProductFamily(tag);
            const pieces =
              targetModule?.id === "concrete-instances" ||
              family === "设计.具体实例"
                ? splitConcreteInstanceContents(content)
                : [content];
            const baseTag = pieces.length > 1 ? "设计.具体实例" : tag;
            const positions: string[] = [];
            const resolvedPieces: Array<{ tag: string; content: string }> = [];
            for (const piece of pieces) {
              const resolved = resolveRepeatableInsertTag({
                tag: baseTag,
                content: piece,
                existingTags: [
                  ...params.handlers.listProducts().map((p) => p.tag),
                  ...resolvedPieces.map((item) => item.tag),
                ],
                repeatableFamilies,
              });
              if ("error" in resolved) {
                params.handlers.onToolCall?.(call.name, resolved.error);
                return {
                  callId: call.id,
                  content: JSON.stringify({ error: resolved.error }),
                };
              }
              resolvedPieces.push({ tag: resolved.tag, content: piece });
            }
            let replyModule: string | undefined;
            for (const [index, piece] of resolvedPieces.entries()) {
              const pieceTag = piece.tag;
              const order = parseDictateOrder(args.order);
              const productsBeforeWrite = params.handlers.listProducts();
              const isOpening = isDictateOpeningTag(pieceTag);
              const explicitlyPrepared = openingPrepared;
              if (isOpening && !explicitlyPrepared) {
                params.handlers.prepareOpening?.();
              }
              params.handlers.writeProduct(pieceTag, piece.content, order, {
                ...(targetModule
                  ? {
                      layer: resolveInsertLayer({
                        moduleId: targetModule.id,
                        catalogLayer: targetModule.layer,
                        content: piece.content,
                      }),
                    }
                  : {}),
                ...(selfScore.value ? { selfScore: selfScore.value } : {}),
              });
              if (!isOpening) openingPrepared = false;
              wroteTags.push(pieceTag);
              positions.push(pieceTag);
              const detail =
                order === undefined ? pieceTag : `${pieceTag} order=${order}`;
              params.handlers.onToolCall?.(call.name, detail);
              replyModule =
                params.handlers.lookupInsertFeedback?.(pieceTag)?.trim() ||
                replyModule;
              const requiredGaps = isDictateOpeningTag(pieceTag)
                ? requiredCreationPlanGaps({
                    planRaw: productsBeforeWrite.find(
                      (product) => product.tag === CREATION_PLAN_TAG,
                    )?.content,
                    catalog: params.moduleCatalog,
                    products: [
                      ...productsBeforeWrite.filter((product) => product.tag !== pieceTag),
                      { tag: pieceTag, content: piece.content, order },
                    ],
                  })
                : [];
              if (index === resolvedPieces.length - 1) {
                if (replyModule) {
                  const title =
                    replyModule.match(/^#\s*(?:模块|本轮关注)\s*·\s*(.+)$/m)?.[1]?.trim() ||
                    pieceTag;
                  moduleNamesThisStep.push(title);
                }
                return {
                  callId: call.id,
                  content: JSON.stringify({
                    ok: true,
                    position: positions[0],
                    ...(positions.length > 1 ? { positions, split: positions.length } : {}),
                    ...(isOpening
                      ? {
                          runtime_prepared_before_opening: true,
                          preparation_mode: explicitlyPrepared
                            ? "prepare_opening"
                            : "implicit_fallback",
                        }
                      : {}),
                    ...(order !== undefined ? { order } : {}),
                    ...(requiredGaps.length
                      ? {
                          warning: `仍有“必须”能力未落：${requiredGaps.join("、")}。开场白已写入，请在准备开玩前提醒用户补齐或调整方案。`,
                          missing_required_module_ids: requiredGaps,
                        }
                      : {}),
                    ...(replyModule
                      ? {
                          reply_module: replyModule,
                          reply_hint: DICTATE_MULTI_MODULE_REPLY_HINT,
                        }
                      : {}),
                  }),
                };
              }
            }
          }
          const order = parseDictateOrder(args.order);
          const productsBeforeWrite = params.handlers.listProducts();
          const isOpening = isDictateOpeningTag(tag);
          const explicitlyPrepared = openingPrepared;
          if (isOpening && !explicitlyPrepared) {
            params.handlers.prepareOpening?.();
          }
          params.handlers.writeProduct(tag, content, order, {
            ...(targetModule
              ? {
                  layer: resolveInsertLayer({
                    moduleId: targetModule.id,
                    catalogLayer: targetModule.layer,
                    content,
                  }),
                }
              : {}),
            ...(selfScore.value ? { selfScore: selfScore.value } : {}),
          });
          if (!isOpening) openingPrepared = false;
          wroteTags.push(tag);
          const detail =
            order === undefined ? tag : `${tag} order=${order}`;
          params.handlers.onToolCall?.(call.name, detail);
          const replyModule =
            params.handlers.lookupInsertFeedback?.(tag)?.trim() || undefined;
          if (replyModule) {
            const title =
              replyModule.match(/^#\s*(?:模块|本轮关注)\s*·\s*(.+)$/m)?.[1]?.trim() || tag;
            moduleNamesThisStep.push(title);
          }
          const requiredGaps = isDictateOpeningTag(tag)
            ? requiredCreationPlanGaps({
                planRaw: productsBeforeWrite.find(
                  (product) => product.tag === CREATION_PLAN_TAG,
                )?.content,
                catalog: params.moduleCatalog,
                products: [
                  ...productsBeforeWrite.filter((product) => product.tag !== tag),
                  { tag, content, order },
                ],
              })
            : [];
          return {
            callId: call.id,
            content: JSON.stringify({
              ok: true,
              position: tag,
              ...(isOpening
                ? {
                    runtime_prepared_before_opening: true,
                    preparation_mode: explicitlyPrepared
                      ? "prepare_opening"
                      : "implicit_fallback",
                  }
                : {}),
              ...(order !== undefined ? { order } : {}),
              ...(requiredGaps.length
                ? {
                    warning: `仍有“必须”能力未落：${requiredGaps.join("、")}。开场白已写入，请在准备开玩前提醒用户补齐或调整方案。`,
                    missing_required_module_ids: requiredGaps,
                  }
                : {}),
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

      if (toolSteps >= DICTATE_DRIVER_MAX_ITERATIONS - 2) {
        noteTurnLimit(results);
      }

      return { kind: "continue" as const, results };
    },
  });
  } catch (err) {
    if (!(err instanceof DriverIterationLimitError)) throw err;
    return {
      reply: composeDictateReply({
        wroteTags,
        deletedTags,
        clearedDialogue,
        capped: true,
      }),
      iterations: err.iterations,
      wroteTags: [...new Set(wroteTags)],
      deletedTags: [...new Set(deletedTags)],
      clearedDialogue,
    };
  }

  return {
    reply: composeDictateReply({
      stopText: run.stop.kind === "text" ? run.stop.content : "",
      wroteTags,
      deletedTags,
      clearedDialogue,
    }),
    iterations: run.iterations,
    wroteTags: [...new Set(wroteTags)],
    deletedTags: [...new Set(deletedTags)],
    clearedDialogue,
  };
}

function noteTurnLimit(
  results: Array<{ callId: string; content: string }>,
): void {
  const last = results.at(-1);
  if (!last) return;
  try {
    const parsed = JSON.parse(last.content) as Record<string, unknown>;
    parsed.turn_limit = DICTATE_TURN_LIMIT_HINT;
    last.content = JSON.stringify(parsed);
  } catch {
    last.content = `${last.content}\n${DICTATE_TURN_LIMIT_HINT}`;
  }
}

function composeDictateReply(params: {
  stopText?: string;
  wroteTags: string[];
  deletedTags: string[];
  clearedDialogue: boolean;
  capped?: boolean;
}): string {
  let reply = params.stopText?.trim() ?? "";
  if (!reply) {
    if (params.wroteTags.length || params.deletedTags.length) {
      const parts: string[] = [];
      if (params.wroteTags.length) {
        parts.push(`已写入：${[...new Set(params.wroteTags)].join("、")}`);
      }
      if (params.deletedTags.length) {
        parts.push(`已删除：${[...new Set(params.deletedTags)].join("、")}`);
      }
      reply = `${parts.join("；")}。还有要补充的吗？`;
    } else if (params.clearedDialogue) {
      reply = "对话已清空，产物都还在。可以继续说。";
    } else if (params.capped) {
      reply = "这轮工具次数已用完，还没有新的产物。可以说要先补哪一块。";
    } else {
      reply = "我在听，请继续说你想要的体验或设定。";
    }
  }
  if (params.capped && !reply.includes("工具次数已用完")) {
    reply = `${reply} 这轮工具次数已用完，其余下一轮继续。`;
  }
  return reply;
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

function requiresModuleRead(moduleId: string, auto?: boolean): boolean {
  if (auto) return false;
  return !new Set([
    "narrative",
    "variable-context",
    "context-order",
    "worker-spec",
    "refine",
  ]).has(moduleId);
}

function resolveInsertLayer(params: {
  moduleId: string;
  catalogLayer?: "intermediate" | "final";
  content: string;
}): "intermediate" | "final" {
  if (params.moduleId === "generation-rules") {
    const lifecycle = normalizeGenerationRuleLifecycle(
      extractGenerationRuleLifecycle(params.content),
    );
    if (lifecycle === "seed_only") return "intermediate";
    if (lifecycle === "runtime_only" || lifecycle === "seed_and_runtime") {
      return "final";
    }
  }
  return params.catalogLayer ?? "final";
}

function extractGenerationRuleLifecycle(
  content: string,
): string | undefined {
  try {
    const parsed = JSON.parse(content) as {
      正文?: { 生命周期?: unknown };
      生命周期?: unknown;
    };
    const raw = parsed.正文?.生命周期 ?? parsed.生命周期;
    return typeof raw === "string" ? raw.trim() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeGenerationRuleLifecycle(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  if (raw === "只预生成" || raw === "seed_only") return "seed_only";
  if (raw === "仅游玩期" || raw === "runtime_only") return "runtime_only";
  if (raw === "预生成并游玩期" || raw === "seed_and_runtime") {
    return "seed_and_runtime";
  }
  return raw;
}

function parseAndValidateSelfScore(
  raw: unknown,
  expectedNames: readonly string[],
): { value?: DictateSelfScore } | { error: string } {
  if (expectedNames.length === 0) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `self_score 必填；维度：${expectedNames.join("、")}` };
  }
  const dims = (raw as { dims?: unknown }).dims;
  if (!Array.isArray(dims)) {
    return { error: "self_score.dims 必须是数组" };
  }
  const parsed: DictateSelfScore["dims"] = [];
  for (const item of dims) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { error: "self_score.dims 含无效条目" };
    }
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const score = Number(row.score);
    const gap = typeof row.gap === "string" ? row.gap.trim() : "";
    const options = Array.isArray(row.options)
      ? row.options.map(String).map((option) => option.trim()).filter(Boolean)
      : [];
    if (!name || !Number.isInteger(score) || score < 1 || score > 5) {
      return { error: "self_score 每项须含合法 name 与 1～5 整数 score" };
    }
    if (score <= 3 && !gap) {
      return { error: `self_score「${name}」不高于 3 分时必须写 gap` };
    }
    if (options.length > 0 && (options.length < 2 || options.length > 3)) {
      return { error: `self_score「${name}」的 options 必须为 2～3 项` };
    }
    parsed.push({
      name,
      score,
      ...(gap ? { gap } : {}),
      ...(options.length ? { options } : {}),
    });
  }
  const actual = parsed.map((dim) => dim.name);
  if (
    actual.length !== expectedNames.length ||
    expectedNames.some((name) => !actual.includes(name)) ||
    actual.some((name) => !expectedNames.includes(name))
  ) {
    return {
      error: `self_score 维度必须与能力 score 一致：${expectedNames.join("、")}`,
    };
  }
  return { value: { dims: parsed } };
}
