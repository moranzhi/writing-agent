/**
 * 一句用户话：先用 select_nodes 定目标节点，程序注入这些节点的写法，再 fill 写入。
 * 已通过的不再覆盖。未通过的可在同轮按设置补写若干次：底稿上只改失败点，已接受的自评维度带回。
 * 补写次数用尽后，失败项记入「失败待补」，下轮继续。
 * 没有未通过项时，同一次请求里的 reply_user 才给用户。
 * 选题与回复二选一：调用 reply_user 则本轮到此为止，不再填写，也不再补回复。
 * 填写步若未调用 reply_user，程序再打一轮瘦回复（只带本轮刚落盘产物）；填写提示不提及此事。
 */
import { randomUUID } from "node:crypto";
import type { DriverStepOutcome, DriverToolCall } from "../runtime/driver.js";
import type { AgentDriver } from "../runtime/driver.js";
import type { ChatMessage, LlmProvider, UsageDetail, UsageSink } from "../llm/client.js";
import { normalizeDictateFillRetries } from "../config/settings.js";
import { DICTATE_REPLY_TOOL, DICTATE_SELECT_REPLY_TOOL, DICTATE_SELECT_TOOL, DICTATE_WRITE_LOOP_TOOLS } from "./tools.js";
import { buildDictateContext, type DictateSegmentChars } from "./context.js";
import {
  CREATION_PLAN_SCHEMA,
  CREATION_PLAN_TAG,
  formatCreationPlanCapabilityCatalog,
  formatCreationPlanProgress,
  parseCreationPlan,
} from "./creation-plan.js";
import { isDictateOpeningTag } from "./experience-anchor.js";
import { resolveDictateHistoryTurns } from "./history-window.js";
import {
  buildDictateReplyPrompt,
  buildDictateSelectPrompt,
  buildDictateSystemPrompt,
  formatDictateRoundTail,
  type DictatePromptTailOpts,
} from "./prompt.js";
import {
  parseDictateModuleReadState,
  readLibraryEntries,
  serializeDictateModuleReadState,
  DICTATE_MODULE_READ_STATE_TAG,
  type DictateModuleReadPayload,
} from "./read-module.js";
import {
  DICTATE_REMEDIATE_SCHEMA,
  DICTATE_REMEDIATE_TAG,
  formatRemediateChecklist,
  parseDictateRemediate,
  serializeDictateRemediate,
  type DictateKeptDim,
  type DictateRemediateItem,
} from "./remediate.js";
import { resolveModuleForInsertTag } from "./insert-feedback.js";
import type { DictateChatTurn, DictateProduct } from "./types.js";
import { isAllowedProductTag } from "./types.js";
import { VALUE_MAP_TAG } from "../skills/value-map.js";
import { VARIABLE_CATALOG_TAG } from "../skills/variable-catalog.js";

const READ_EXEMPT = new Set([
  "narrative",
  "variable-context",
  "context-order",
  "worker-spec",
  "refine",
]);

type Apply = (calls: DriverToolCall[]) => DriverStepOutcome | Promise<DriverStepOutcome>;

export type PlannedRoundParams = {
  llm: LlmProvider;
  dialogue: DictateChatTurn[];
  handlers: {
    listProducts: () => DictateProduct[];
    readTag: (tag: string) => string | undefined;
    writeTag: (tag: string, content: string) => void;
    deleteTag?: (tag: string) => boolean;
    prepareOpening?: () => void;
    /** 本轮刚写入 tag 的能力回复口径（探测/原则/自评关注） */
    lookupInsertFeedback?: (tag: string) => string | undefined;
    onThinkingDelta?: (delta: string) => void;
    onThinkingDone?: (text: string) => void;
  };
  moduleCatalog?: import("../skills/creation-flow.js").ModuleCatalog | null;
  moduleReadIndex?: ReadonlyMap<string, DictateModuleReadPayload>;
  moduleGuide?: string;
  recipeExamples?: string;
  recipeName?: string;
  recipeBrief?: string;
  systemPrompt?: string;
  /** 更早对话保留轮数；默认 2，见 resolveDictateHistoryTurns */
  historyTurns?: number;
  /**
   * 第一次填写失败后，同轮最多再补写几次。
   * 缺省 0：只填一次，失败留给下一句。
   */
  fillRetries?: number;
};

type PlanInsert = {
  tag: string;
  moduleId: string;
  libraryId?: string;
  entryIds: string[];
  reason?: string;
};

type SelectPlan = {
  /** 本轮不落盘时的提问 */
  clarify: string[];
  /** 本轮不落盘时的回答 */
  reply: string;
  inserts: PlanInsert[];
  deletes: string[];
};


type ItemFailure = { tag: string; error: string; moduleId?: string; kind?: "insert" | "delete" };

export function createPlannedDictateDriver(params: PlannedRoundParams): AgentDriver {
  return {
    async run(input) {
      const reply = await runPlannedDictateRound(params, input.handleStep);
      return { iterations: reply.modelCalls, stop: { kind: "text", content: reply.text } };
    },
  };
}

async function runPlannedDictateRound(
  params: PlannedRoundParams,
  apply: Apply,
): Promise<{ text: string; modelCalls: number }> {
  const turnId = randomUUID();
  const historyTurns = resolveDictateHistoryTurns(params.historyTurns);
  const fillSystem = params.systemPrompt?.trim() || buildDictateSystemPrompt();
  const remediations = parseDictateRemediate(params.handlers.readTag(DICTATE_REMEDIATE_TAG));
  const remediateChecklist = formatRemediateChecklist(remediations.items);
  const tailOpts = tailState(params);
  const selectTail = formatDictateRoundTail({
    ...tailOpts,
    phase: "select",
    checklist: remediateChecklist,
  });
  const selectCtx = buildDictateContext({
    systemPrompt: buildDictateSelectPrompt(),
    products: params.handlers.listProducts(),
    dialogue: params.dialogue,
    phase: "select",
    tail: selectTail,
    historyTurns,
  });
  const selected = await params.llm.completeWithTools(selectCtx.messages, {
    caller: "dictate_agent",
    label: "对话落盘 选题",
    tools: [DICTATE_SELECT_TOOL, DICTATE_SELECT_REPLY_TOOL],
    toolChoice: "required",
    usageDetail: detail(turnId, "select", 0, selectCtx.segmentChars),
    usageSink: sinkFor(turnId, "select"),
  });
  if (selected.reasoning?.trim()) params.handlers.onThinkingDone?.(selected.reasoning.trim());
  const replyCall = selected.toolCalls.find((call) => call.name === DICTATE_REPLY_TOOL.function.name);
  const selectCall = selected.toolCalls.find((call) => call.name === "select_nodes");
  const earlyReply = replyCall
    ? replyText({
        id: replyCall.id || "reply",
        name: replyCall.name,
        arguments: replyCall.arguments,
      })
    : "";
  if (earlyReply && !selectCall) {
    return { modelCalls: 1, text: earlyReply };
  }
  const plan = parseSelect(selectCall ? safeJson(selectCall.arguments) : {}, params);
  const noWork = plan.inserts.length === 0 && plan.deletes.length === 0;
  const speaking = noWork && (plan.clarify.length > 0 || plan.reply.length > 0);
  if (!speaking && !earlyReply) mergeRemediationsIntoPlan(plan, remediations.items, params);
  if (plan.inserts.length === 0 && plan.deletes.length === 0) {
    const text = earlyReply || (speaking ? formatSpeak(plan) : "") || selected.content?.trim() || "这轮先不落盘。";
    return { modelCalls: 1, text };
  }

  const blocked = plan.inserts.filter((item) => item.tag.startsWith("!"));
  const inserts = plan.inserts.filter((item) => !item.tag.startsWith("!"));
  const openings = inserts.filter((item) => isDictateOpeningTag(item.tag));
  const rest = inserts.filter((item) => !isDictateOpeningTag(item.tag));
  const blockedLines = blocked.map(
    (item) => `${item.tag.slice(1)}（${item.reason || "计划未通过程序核验"}）`,
  );
  if (openings.length > 0) params.handlers.prepareOpening?.();
  const injected = injectGroup(params, [...rest, ...openings]);
  const priorFailures = remediations.items.filter((item) =>
    [...rest, ...openings].some((row) => row.tag === item.tag) ||
    plan.deletes.includes(item.tag),
  );
  const drafts = new Map<string, string>();
  const keptDims = new Map<string, DictateKeptDim[]>();
  for (const item of priorFailures) {
    if (item.kind === "delete") continue;
    if (item.draft) drafts.set(item.tag, item.draft);
    if (item.keptDims?.length) keptDims.set(item.tag, item.keptDims);
  }
  const tail = formatDictateRoundTail({
    ...tailOpts,
    phase: "fill",
    checklist: formatChecklist(
      [...rest, ...openings],
      plan.deletes,
      priorFailures.map((item) => ({
        tag: item.tag,
        error: item.error,
        moduleId: item.moduleId,
        kind: item.kind,
      })),
      drafts,
    ),
  });
  const ctx = buildDictateContext({
    systemPrompt: fillSystem,
    products: params.handlers.listProducts(),
    dialogue: params.dialogue,
    phase: "fill",
    injected: injected.text,
    tail,
    historyTurns,
  });
  const passed = new Set<string>();
  const pending = new Set([...rest, ...openings].map((item) => item.tag));
  const pendingDeletes = new Set(plan.deletes);
  const errors = new Map<string, string>();
  let replyFromTool = "";
  let lastProse = "";
  let modelCalls = 1;
  const fillRetries = normalizeDictateFillRetries(params.fillRetries);
  let messages: ChatMessage[] = ctx.messages;
  let fillAttempts = 0;

  while (pending.size > 0 || pendingDeletes.size > 0) {
    if (fillAttempts > fillRetries) break;
    const filled = await params.llm.completeWithTools(messages, {
      caller: "dictate_agent",
      label: fillAttempts === 0 ? "对话落盘 填写" : `对话落盘 补写 ${fillAttempts}`,
      tools: DICTATE_WRITE_LOOP_TOOLS,
      toolChoice: "required",
      usageDetail: {
        ...detail(
          turnId,
          fillAttempts === 0 ? "fill" : "fill-retry",
          fillAttempts,
          ctx.segmentChars,
        ),
        plannedTags: [...pending, ...pendingDeletes],
      },
      usageSink: sinkFor(turnId, fillAttempts === 0 ? "fill" : "fill-retry"),
    });
    fillAttempts += 1;
    modelCalls += 1;
    if (filled.reasoning?.trim()) params.handlers.onThinkingDone?.(filled.reasoning.trim());
    const prose = filled.content?.trim() ?? "";
    if (prose) lastProse = prose;
    const calls: DriverToolCall[] = filled.toolCalls.map((call, index) => ({
      id: call.id || `call-${fillAttempts}-${index}`,
      name: call.name,
      arguments: call.arguments,
    }));
    const settled =
      calls.length > 0
        ? await settleWriteStep(
            params,
            apply,
            calls,
            passed,
            pending,
            pendingDeletes,
            errors,
            drafts,
            keptDims,
          )
        : { results: [], reply: "" };
    if (pending.size === 0 && pendingDeletes.size === 0) {
      replyFromTool = settled.reply;
      break;
    }
    if (fillAttempts > fillRetries) break;
    messages = appendFillContinuation(
      messages,
      filled.content,
      calls,
      settled.results,
      incrementalRetryNote(passed, pending, pendingDeletes, errors),
    );
  }

  const moduleByTag = new Map(
    [...rest, ...openings].map((item) => [item.tag, item.moduleId] as const),
  );
  persistRemediations(params, {
    pending,
    pendingDeletes,
    errors,
    moduleByTag,
    prior: remediations.items,
    drafts,
    keptDims,
  });

  let reply = replyFromTool || earlyReply;
  if (
    !reply &&
    pending.size === 0 &&
    pendingDeletes.size === 0 &&
    passed.size > 0
  ) {
    reply = await runLeanReply(params, turnId, passed, plan.deletes, lastProse);
    modelCalls += 1;
  } else if (!reply) {
    reply = lastProse;
  }

  const failed = [...pending, ...pendingDeletes].map(
    (tag) => `${tag}（${errors.get(tag) ?? "尚未通过"}）`,
  );
  const pendingLines = [...blockedLines, ...failed];
  const retryNote = fillAttempts > 1 ? `已同轮补写 ${fillAttempts - 1} 次。` : "";
  const text = pendingLines.length
    ? [
        reply,
        `失败待补（下轮继续）：${pendingLines.join("、")}。${retryNote}`,
      ]
        .filter(Boolean)
        .join("\n")
    : reply;
  return { text, modelCalls };
}

function formatSpeak(plan: SelectPlan): string {
  const questions =
    plan.clarify.length <= 1
      ? plan.clarify[0] ?? ""
      : plan.clarify.map((item, index) => `${index + 1}. ${item}`).join("\n");
  if (questions && plan.reply && questions !== plan.reply) return `${questions}\n\n${plan.reply}`;
  return questions || plan.reply;
}

async function runLeanReply(
  params: PlannedRoundParams,
  turnId: string,
  passed: Set<string>,
  plannedDeletes: string[],
  fallbackProse: string,
): Promise<string> {
  const writtenTags = [...passed].filter((tag) => !tag.startsWith("del:"));
  const deletedTags = [...passed]
    .filter((tag) => tag.startsWith("del:"))
    .map((tag) => tag.slice(4))
    .filter(Boolean);
  const products = params.handlers
    .listProducts()
    .filter((product) => writtenTags.some((tag) => product.tag === tag || product.tag.startsWith(`${tag}#`)));
  const feedbackBlocks = writtenTags
    .map((tag) => params.handlers.lookupInsertFeedback?.(tag)?.trim())
    .filter((text): text is string => Boolean(text));
  if (writtenTags.length > 1 && feedbackBlocks.length > 1) {
    feedbackBlocks.unshift(
      "本轮写入了多个产物。用一段自然回复综合说明本轮变化、共同强项与关键缺口；不要逐模块套标题或重复模板。只有缺口确需用户决定时才提问。",
    );
  }
  const tailOpts = tailState(params);
  const deleteNote =
    deletedTags.length || plannedDeletes.length
      ? `本轮已删除：${(deletedTags.length ? deletedTags : plannedDeletes).join("、")}`
      : "";
  const replyTail = [
    formatDictateRoundTail({
      ...tailOpts,
      phase: "reply",
      checklist: [
        writtenTags.length ? `本轮已写入：${writtenTags.join("、")}` : "",
        deleteNote,
      ]
        .filter(Boolean)
        .join("\n"),
    }),
    feedbackBlocks.length ? `## 本轮关注（按能力回复口径）\n\n${feedbackBlocks.join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const replyCtx = buildDictateContext({
    systemPrompt: buildDictateReplyPrompt(),
    products,
    dialogue: params.dialogue,
    phase: "reply",
    tail: replyTail,
  });
  const filled = await params.llm.completeWithTools(replyCtx.messages, {
    caller: "dictate_agent",
    label: "对话落盘 回复",
    tools: [DICTATE_REPLY_TOOL],
    toolChoice: { type: "function", function: { name: DICTATE_REPLY_TOOL.function.name } },
    usageDetail: {
      ...detail(turnId, "reply", 0, replyCtx.segmentChars),
      plannedTags: writtenTags,
    },
    usageSink: sinkFor(turnId, "reply"),
  });
  if (filled.reasoning?.trim()) params.handlers.onThinkingDone?.(filled.reasoning.trim());
  const call = filled.toolCalls.find((item) => item.name === DICTATE_REPLY_TOOL.function.name);
  if (call) {
    const text = replyText({
      id: call.id || "reply",
      name: call.name,
      arguments: call.arguments,
    });
    if (text) return text;
  }
  return filled.content?.trim() || fallbackProse;
}

async function settleWriteStep(
  params: PlannedRoundParams,
  apply: Apply,
  calls: DriverToolCall[],
  passed: Set<string>,
  pending: Set<string>,
  pendingDeletes: Set<string>,
  errors: Map<string, string>,
  drafts: Map<string, string>,
  keptDims: Map<string, DictateKeptDim[]>,
): Promise<{ results: Array<{ callId: string; content: string }>; reply: string }> {
  const results: Array<{ callId: string; content: string }> = [];
  const forward: DriverToolCall[] = [];
  let reply = "";
  for (const call of calls) {
    if (call.name === DICTATE_REPLY_TOOL.function.name) continue;
    const tag = callTag(call, params);
    if (call.name === "insert" && tag && passed.has(tag)) {
      results.push({
        callId: call.id,
        content: JSON.stringify({ error: "已通过，本步不要再写", tag }),
      });
      continue;
    }
    if (call.name === "delete" && tag && passed.has(`del:${tag}`)) {
      results.push({
        callId: call.id,
        content: JSON.stringify({ error: "已通过，本步不要再删除", tag }),
      });
      continue;
    }
    if (call.name === "insert" && tag) {
      const args = asRecord(safeJson(call.arguments));
      const merged = mergeKeptDimsIntoArgs(
        args,
        keptDims.get(tag),
        scoreDimensionsForTag(params, tag),
      );
      forward.push({ ...call, arguments: JSON.stringify({ ...merged, position: tag }) });
      continue;
    }
    forward.push(call);
  }
  const outcome = await apply(forward);
  if (outcome.kind === "continue") {
      for (const result of outcome.results) {
        results.push(result);
        const call = forward.find((item) => item.id === result.callId);
        const payload = asRecord(safeJson(result.content));
        const tag = call ? callTag(call, params) : "";
        if (payload.ok === true && tag) {
          if (call?.name === "delete") {
            passed.add(`del:${tag}`);
            pendingDeletes.delete(tag);
          } else {
            passed.add(tag);
            for (const planned of [...pending]) {
              if (planned === tag || tag.startsWith(`${planned}#`)) pending.delete(planned);
            }
          }
          errors.delete(tag);
        } else if (typeof payload.error === "string" && tag) {
          const planned = [...pending, ...pendingDeletes].find(
            (item) => item === tag || tag.startsWith(`${item}#`),
          );
          const plannedTag = planned ?? tag;
          errors.set(plannedTag, payload.error);
          if (call?.name === "insert") {
            rememberFailedInsert(call, plannedTag, params, drafts, keptDims);
          }
        }
      }
    }
    for (const call of calls) {
      if (call.name !== DICTATE_REPLY_TOOL.function.name) continue;
      const text = replyText(call);
      if (pending.size > 0 || pendingDeletes.size > 0) {
        const left = [...pending, ...pendingDeletes].join("、");
        results.push({
          callId: call.id,
          content: JSON.stringify({
            error: `还有未通过：${left}。这份回复先不给用户。只再写入这些。`,
          }),
        });
        continue;
      }
      reply = text;
      results.push({ callId: call.id, content: JSON.stringify({ ok: true }) });
    }
  return { results, reply };
}

function callTag(call: DriverToolCall, params: PlannedRoundParams): string {
  const args = asRecord(safeJson(call.arguments));
  const raw = String(args.position ?? args.tag ?? "").trim();
  if (!raw) return "";
  return canonicalProductTag(raw, "", params.moduleCatalog)?.tag ?? raw;
}

function replyText(call: DriverToolCall): string {
  const args = asRecord(safeJson(call.arguments));
  return String(args.text ?? args.reply ?? args.content ?? args.message ?? "").trim();
}

const MAX_FAILED_DRAFT_CHARS = 24_000;

function rememberFailedInsert(
  call: DriverToolCall,
  tag: string,
  params: PlannedRoundParams,
  drafts: Map<string, string>,
  keptDims: Map<string, DictateKeptDim[]>,
): void {
  const args = asRecord(safeJson(call.arguments));
  const content = String(args.content ?? "").trim();
  if (content) {
    drafts.set(
      tag,
      content.length > MAX_FAILED_DRAFT_CHARS
        ? `${content.slice(0, MAX_FAILED_DRAFT_CHARS)}\n…（底稿已截断）`
        : content,
    );
  }
  const expected = scoreDimensionsForTag(params, tag);
  const harvested = harvestKeptDims(args.self_score, expected);
  if (!harvested.length) return;
  const merged = new Map((keptDims.get(tag) ?? []).map((dim) => [dim.name, dim] as const));
  for (const dim of harvested) merged.set(dim.name, dim);
  keptDims.set(tag, [...merged.values()]);
}

function scoreDimensionsForTag(params: PlannedRoundParams, tag: string): string[] {
  const module = resolveModuleForInsertTag(tag, params.moduleCatalog);
  if (!module) return [];
  return params.moduleReadIndex?.get(module.id)?.score_dimensions ?? [];
}

function mergeKeptDimsIntoArgs(
  args: Record<string, unknown>,
  kept: readonly DictateKeptDim[] | undefined,
  expected: readonly string[],
): Record<string, unknown> {
  if (!kept?.length || !expected.length) return args;
  const score = asRecord(args.self_score);
  const dims = Array.isArray(score.dims) ? [...score.dims] : [];
  const names = new Set(
    dims.map((item) => String(asRecord(item).name ?? "").trim()).filter(Boolean),
  );
  const additions = kept.filter((dim) => expected.includes(dim.name) && !names.has(dim.name));
  if (!additions.length) return args;
  return { ...args, self_score: { ...score, dims: [...dims, ...additions] } };
}

function harvestKeptDims(raw: unknown, expected: readonly string[]): DictateKeptDim[] {
  if (!expected.length) return [];
  const dims = Array.isArray(asRecord(raw).dims) ? asRecord(raw).dims : [];
  const out: DictateKeptDim[] = [];
  const seen = new Set<string>();
  for (const item of dims) {
    const row = asRecord(item);
    const name = String(row.name ?? "").trim();
    const score = Number(row.score);
    if (!name || !expected.includes(name) || seen.has(name)) continue;
    if (!Number.isInteger(score) || score < 1 || score > 5) continue;
    const gap = String(row.gap ?? "").trim();
    if (score <= 3 && !gap) continue;
    const options = Array.isArray(row.options)
      ? row.options.map((option) => String(option).trim()).filter(Boolean)
      : [];
    if (options.length > 0 && (options.length < 2 || options.length > 3)) continue;
    seen.add(name);
    out.push({
      name,
      score,
      ...(gap ? { gap } : {}),
      ...(options.length ? { options } : {}),
    });
  }
  return out;
}

function appendFillContinuation(
  messages: ChatMessage[],
  assistantContent: string | null,
  calls: DriverToolCall[],
  results: Array<{ callId: string; content: string }>,
  note: string,
): ChatMessage[] {
  const next = [...messages];
  if (calls.length === 0) {
    next.push({ role: "user", content: note });
    return next;
  }
  next.push({
    role: "assistant",
    content: assistantContent,
    tool_calls: calls.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: call.arguments },
    })),
  });
  const byId = new Map(results.map((item) => [item.callId, item.content]));
  for (const call of calls) {
    next.push({
      role: "tool",
      tool_call_id: call.id,
      content: byId.get(call.id) ?? JSON.stringify({ error: "无结果" }),
    });
  }
  next.push({ role: "user", content: note });
  return next;
}

function incrementalRetryNote(
  passed: ReadonlySet<string>,
  pending: ReadonlySet<string>,
  pendingDeletes: ReadonlySet<string>,
  errors: ReadonlyMap<string, string>,
): string {
  const kept = [...passed].filter((tag) => !tag.startsWith("del:"));
  const deleted = [...passed].filter((tag) => tag.startsWith("del:")).map((tag) => tag.slice(4));
  return [
    "同轮补写：只改未通过项。",
    kept.length ? `已通过，不要再 insert：${kept.join("、")}` : "",
    deleted.length ? `已删除，不要再 delete：${deleted.join("、")}` : "",
    "未通过：",
    ...[...pending].map((tag) => `- 写入 ${tag}：${errors.get(tag) ?? "尚未通过"}`),
    ...[...pendingDeletes].map((tag) => `- 删除 ${tag}：${errors.get(tag) ?? "尚未通过"}`),
    "未通过的正文以上一次 insert 为底稿，只改失败点。已写对的段落、字段，以及已接受的 self_score 维度，保持原样。不要整份重写。",
  ]
    .filter(Boolean)
    .join("\n");
}

function sinkFor(_turnId: string, _step: string): UsageSink {
  return {};
}

function detail(
  turnId: string,
  step: UsageDetail["step"],
  retryIndex: number,
  segmentChars: DictateSegmentChars,
): UsageDetail {
  return { turnId, step, retryIndex, segmentChars };
}

function tailState(params: PlannedRoundParams): DictatePromptTailOpts {
  const products = params.handlers.listProducts();
  const plan = parseCreationPlan(
    products.find((product) => product.tag === CREATION_PLAN_TAG)?.content,
  );
  if (plan) {
    return {
      creationPlanState: formatCreationPlanProgress({
        plan,
        catalog: params.moduleCatalog,
        products,
      }),
    };
  }
  return {
    capabilityCatalog:
      formatCreationPlanCapabilityCatalog(params.moduleCatalog) || params.moduleGuide,
    recipeExamples: params.recipeExamples,
    recipeName: params.recipeName,
    recipeBrief: params.recipeBrief,
    moduleGuide: params.moduleGuide,
  };
}

function parseSelect(raw: unknown, params: PlannedRoundParams): SelectPlan {
  const row = asRecord(raw);
  const clarify = [
    ...askList(row.ask),
    ...askList(row.askUser),
    ...askList(row.ask_user),
    ...stringList(row.clarify),
  ].filter((item, index, all) => all.indexOf(item) === index);
  const reply = String(row.reply ?? "").trim();
  let deletes = stringList(row.deletes).filter((tag) => isAllowedProductTag(tag));
  const inserts: PlanInsert[] = [];
  let items = Array.isArray(row.nodes)
    ? row.nodes
    : Array.isArray(row.inserts)
      ? row.inserts
      : [];
  if (items.length === 0 && deletes.length === 0) {
    const recovered = recoverSelectWork(row);
    items = recovered.items;
    deletes = recovered.deletes.filter((tag) => isAllowedProductTag(tag));
  }
  for (const item of items) {
    const rec = asRecord(item);
    const moduleIdHint = String(rec.module_id ?? rec.moduleId ?? "").trim();
    let tag = String(rec.tag ?? rec.position ?? "").trim();
    if (!tag && moduleIdHint) {
      tag =
        params.moduleCatalog?.modules.find((module) => module.id === moduleIdHint)?.artifact?.trim() ??
        "";
    }
    if (!tag) continue;
    const canonical = canonicalProductTag(tag, moduleIdHint, params.moduleCatalog);
    if (canonical) tag = canonical.tag;
    const resolvedHint = canonical?.moduleId || moduleIdHint;
    const module =
      params.moduleReadIndex?.get(resolvedHint) ??
      params.moduleReadIndex?.get(tag) ??
      undefined;
    const fromTag = resolveModuleForInsertTag(tag, params.moduleCatalog);
    const moduleId = module?.module_id || canonical?.moduleId || fromTag?.id || moduleIdHint;
    const entryIds = stringList(rec.entry_ids);
    const reason = String(rec.reason ?? "").trim();
    if (!isAllowedProductTag(tag) && tag !== VARIABLE_CATALOG_TAG && tag !== VALUE_MAP_TAG) {
      inserts.push({ tag: `!${tag || "空"}`, moduleId, entryIds, reason: "产物 tag 不合法" });
      continue;
    }
    const payload = moduleId ? params.moduleReadIndex?.get(moduleId) : undefined;
    if (payload && !READ_EXEMPT.has(payload.module_id) && payload.libraries.length) {
      const libraryId = String(rec.library_id ?? payload.libraries[0]?.library_id ?? "").trim();
      if (entryIds.length > 2 && !reason) {
        inserts.push({
          tag: `!${tag}`,
          moduleId,
          entryIds,
          reason: "默认最多两个库条目",
        });
        continue;
      }
      if (libraryId && entryIds.length) {
        const bound = payload.libraries.some((library) => library.library_id === libraryId);
        if (!bound) {
          inserts.push({ tag: `!${tag}`, moduleId, entryIds, reason: `能力未绑定库 ${libraryId}` });
          continue;
        }
      }
    }
    inserts.push({
      tag,
      moduleId,
      libraryId: String(rec.library_id ?? "").trim() || undefined,
      entryIds,
      reason: reason || undefined,
    });
  }
  return { clarify, reply, inserts, deletes };
}

/** 选题没交 inserts 时，从方案正文、operations 或别名字段收出本轮要写的能力，再自动发填写。 */
function recoverSelectWork(row: Record<string, unknown>): {
  items: unknown[];
  deletes: string[];
} {
  if (isCreationPlanShape(row)) {
    return { items: [{ tag: CREATION_PLAN_TAG, module_id: "creation-plan" }], deletes: [] };
  }
  const items: unknown[] = [];
  const deletes: string[] = [];
  for (const list of [row.modules, row.selections, row.selected, row.writes, row.products, row.operations]) {
    for (const item of asItemList(list)) {
      const rec = flattenItem(item);
      if (
        typeof rec.tier === "string" &&
        typeof rec.why === "string" &&
        rec.tag == null &&
        rec.position == null
      ) {
        continue;
      }
      const op = operationName(rec);
      if (op === "read_module" || op === "read_library_entry" || op === "prepare_opening") {
        continue;
      }
      const moduleId = String(rec.module_id ?? rec.moduleId ?? "").trim();
      const tag = String(rec.tag ?? rec.position ?? rec.artifact ?? "").trim();
      if (op === "delete" || op === "remove") {
        if (tag) deletes.push(tag);
        continue;
      }
      if (
        op === "declare_variable" ||
        op === "undeclare_variable" ||
        op === "declare_map" ||
        op === "remove_map"
      ) {
        continue;
      }
      if (!tag && !moduleId) continue;
      items.push({
        tag,
        module_id: moduleId,
        ...(rec.library_id != null ? { library_id: rec.library_id } : {}),
        ...(rec.entry_ids != null ? { entry_ids: rec.entry_ids } : {}),
        ...(rec.reason != null ? { reason: rec.reason } : {}),
      });
    }
  }
  return { items, deletes };
}

function isCreationPlanShape(row: Record<string, unknown>): boolean {
  if (row.schema === CREATION_PLAN_SCHEMA) return true;
  if (!Array.isArray(row.items) || row.items.length === 0) return false;
  return row.items.every((item) => {
    const rec = asRecord(item);
    return (
      typeof rec.module_id === "string" &&
      rec.module_id.trim().length > 0 &&
      typeof rec.tier === "string" &&
      rec.tag == null &&
      rec.position == null
    );
  });
}

function injectGroup(
  params: PlannedRoundParams,
  group: PlanInsert[],
): { text: string } {
  const blocks: string[] = [];
  const state = parseDictateModuleReadState(
    params.handlers.readTag(DICTATE_MODULE_READ_STATE_TAG),
  );
  let changed = false;
  for (const item of group) {
    const payload = item.moduleId ? params.moduleReadIndex?.get(item.moduleId) : undefined;
    if (!payload) continue;
    const catalogEntry = resolveModuleForInsertTag(item.tag, params.moduleCatalog);
    if (!READ_EXEMPT.has(payload.module_id) && !catalogEntry?.auto) {
      state.modules[payload.module_id] = payload.version;
      state.active_module_id = payload.module_id;
      changed = true;
    }
    const parts = [
      `### ${payload.module_id} @ ${payload.version}`,
      `产物 tag：${item.tag}`,
      payload.score_dimensions.length
        ? `self_score 维度（这次写入必填，name 必须一致）：${payload.score_dimensions.join("、")}`
        : "",
      `#### task\n${payload.task}`,
      `#### principles\n${payload.principles}`,
      `#### output\n${payload.output}`,
      `#### score\n${payload.score}`,
    ];
    if (item.libraryId && item.entryIds.length) {
      const loaded = readLibraryEntries({
        module: payload,
        libraryId: item.libraryId,
        entryIds: item.entryIds,
        reason: item.reason,
      });
      if (loaded.entries) {
        for (const entry of loaded.entries) {
          const row = entry as { id?: string; content?: string; name?: string };
          parts.push(`#### 库 ${item.libraryId} / ${row.id ?? ""}\n${row.content ?? ""}`);
        }
      } else if (loaded.error) {
        parts.push(`#### 库读取失败\n${loaded.error}`);
      }
    }
    blocks.push(parts.filter(Boolean).join("\n\n"));
  }
  if (changed) {
    params.handlers.writeTag(DICTATE_MODULE_READ_STATE_TAG, serializeDictateModuleReadState(state));
  }
  return { text: blocks.join("\n\n") };
}

function canonicalProductTag(
  tag: string,
  moduleIdHint: string,
  catalog: PlannedRoundParams["moduleCatalog"],
): { tag: string; moduleId: string } | null {
  const bare = tag.replace(/^(?:用户|设计)\./, "").split("#")[0]?.trim() ?? "";
  const entry =
    catalog?.modules.find((module) => module.id === moduleIdHint) ??
    resolveModuleForInsertTag(tag, catalog) ??
    catalog?.modules.find(
      (module) =>
        module.name === bare ||
        module.id === bare ||
        module.artifact === tag ||
        module.artifact.endsWith(`.${bare}`),
    );
  if (!entry?.artifact?.trim()) return null;
  const hash = tag.indexOf("#");
  const suffix = hash > 0 ? tag.slice(hash) : "";
  const next =
    entry.repeatable && suffix.startsWith("#") && suffix.length > 1
      ? `${entry.artifact.trim()}${suffix}`
      : entry.artifact.trim();
  return { tag: next, moduleId: entry.id };
}


function formatChecklist(
  group: PlanInsert[],
  deletes: string[],
  errors: ItemFailure[],
  drafts?: ReadonlyMap<string, string>,
): string {
  const nodes = group.map((item) => item.moduleId || item.tag).filter(Boolean);
  const failedTags = new Set(errors.map((item) => item.tag));
  const pendingWrite = group.filter((item) => !failedTags.has(item.tag)).map((item) => item.tag);
  const pendingDelete = deletes.filter((tag) => !failedTags.has(tag));
  const lines = [
    nodes.length ? `本轮选定的节点：${nodes.join("、")}` : "",
    pendingWrite.length ? `待写：${pendingWrite.join("、")}` : "",
    pendingDelete.length ? `待删：${pendingDelete.join("、")}` : "",
    errors.length
      ? `失败待补：\n${errors
          .map((item) => {
            const draft = item.kind === "delete" ? "" : drafts?.get(item.tag)?.trim() ?? "";
            if (!draft) return `- ${item.tag}：${item.error}`;
            return `- ${item.tag}：${item.error}\n  底稿（只改失败点，已写对的段落和字段保持原样）：\n${draft}`;
          })
          .join("\n")}`
      : "",
    "状态说明：待写/待删=本轮目标；失败待补=上轮或本轮未通过，须补上；已落的产物以黑板为准。有底稿时只改失败点，不要整份重写。",
  ];
  return lines.filter(Boolean).join("\n");
}

function mergeRemediationsIntoPlan(
  plan: SelectPlan,
  items: readonly DictateRemediateItem[],
  params: PlannedRoundParams,
): void {
  for (const item of items) {
    if (item.kind === "delete") {
      if (!plan.deletes.includes(item.tag) && isAllowedProductTag(item.tag)) {
        plan.deletes.push(item.tag);
      }
      continue;
    }
    if (plan.inserts.some((row) => row.tag === item.tag || row.tag === `!${item.tag}`)) {
      continue;
    }
    const canonical = canonicalProductTag(item.tag, item.moduleId ?? "", params.moduleCatalog);
    const tag = canonical?.tag ?? item.tag;
    if (!isAllowedProductTag(tag) && tag !== VARIABLE_CATALOG_TAG && tag !== VALUE_MAP_TAG) {
      continue;
    }
    plan.inserts.push({
      tag,
      moduleId: canonical?.moduleId || item.moduleId || "",
      entryIds: [],
      reason: item.error ? `失败待补：${item.error}` : "失败待补",
    });
  }
}

function persistRemediations(
  params: PlannedRoundParams,
  state: {
    pending: Set<string>;
    pendingDeletes: Set<string>;
    errors: Map<string, string>;
    moduleByTag: Map<string, string>;
    prior: readonly DictateRemediateItem[];
    drafts: ReadonlyMap<string, string>;
    keptDims: ReadonlyMap<string, DictateKeptDim[]>;
  },
): void {
  const priorByKey = new Map(
    state.prior.map((item) => [`${item.kind}:${item.tag}`, item] as const),
  );
  const next: DictateRemediateItem[] = [];
  for (const tag of state.pending) {
    const prev = priorByKey.get(`insert:${tag}`);
    const draft = state.drafts.get(tag) ?? prev?.draft;
    const kept = state.keptDims.get(tag) ?? prev?.keptDims;
    next.push({
      tag,
      kind: "insert",
      error: state.errors.get(tag) ?? prev?.error ?? "尚未通过",
      ...(state.moduleByTag.get(tag) || prev?.moduleId
        ? { moduleId: state.moduleByTag.get(tag) || prev?.moduleId }
        : {}),
      ...(draft ? { draft } : {}),
      ...(kept?.length ? { keptDims: kept } : {}),
    });
  }
  for (const tag of state.pendingDeletes) {
    const prev = priorByKey.get(`delete:${tag}`);
    next.push({
      tag,
      kind: "delete",
      error: state.errors.get(tag) ?? prev?.error ?? "尚未通过",
    });
  }
  if (next.length === 0) {
    if (params.handlers.deleteTag) {
      params.handlers.deleteTag(DICTATE_REMEDIATE_TAG);
    } else {
      params.handlers.writeTag(DICTATE_REMEDIATE_TAG, "");
    }
    return;
  }
  params.handlers.writeTag(
    DICTATE_REMEDIATE_TAG,
    serializeDictateRemediate({ schema: DICTATE_REMEDIATE_SCHEMA, items: next }),
  );
}

function asItemList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const rec = asRecord(value);
  const values = Object.values(rec);
  if (values.length > 0 && values.every((item) => item && typeof item === "object")) {
    return values;
  }
  return [];
}

function flattenItem(item: unknown): Record<string, unknown> {
  if (typeof item === "string") {
    const text = item.trim();
    if (!text) return {};
    if (text.startsWith("设计.") || text.startsWith("用户.")) return { tag: text };
    return { module_id: text };
  }
  const rec = asRecord(item);
  const nested = asRecord(rec.arguments ?? rec.args ?? rec.payload);
  return { ...rec, ...nested };
}

function operationName(rec: Record<string, unknown>): string {
  return String(rec.op ?? rec.name ?? rec.type ?? rec.action ?? "insert").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function askList(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      const rec = asRecord(item);
      return String(rec.prompt ?? rec.text ?? rec.question ?? "").trim();
    })
    .filter(Boolean);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
