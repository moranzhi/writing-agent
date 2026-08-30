import type { Blackboard } from "../blackboard/blackboard.js";
import type { LlmProvider, StreamCallbacks, ChatMessage } from "../llm/client.js";
import { completeStructured } from "../llm/structured-complete.js";
import { resolveActiveProfile } from "../config/settings.js";
import { loadWorkerSkillWithContext } from "../skills/loader.js";
import { filterInputsForRolePerspective } from "../skills/worker-llm.js";
import { collectUserInputTranscript } from "../intake/intake.js";
import { resolveWorkerId } from "./resolve-id.js";
import type { BlackboardInputMerge } from "../types/blackboard.js";
import { CONTEXT_BRIEF_TAG } from "../runtime/compress-after-worker.js";
import type { ParsedWorkerSkill } from "../skills/types.js";
import {
  extractJsonObjectText,
  isUsableWorkerSet,
  looksLikeProseNotSpec,
  parseWorkerSetYaml,
} from "../skills/worker-set-parse.js";
import {
  selectJsonPayload,
  tryParseJsonDoc,
} from "../parse/json-doc.js";
import { assembleWorkerContext } from "../skills/context-segments.js";
import { isPlayLayerActive } from "../skills/play-turn.js";
import { loadAppSettings } from "../config/settings.js";
import { resolveActivePreset } from "../preset/store.js";
import { assemblePlayWorkerMessages } from "../preset/play-frame.js";
import { worldInfoPackFromSegments } from "../preset/world-info-pack.js";
import { PRESENT_TAG } from "../skills/present-packet.js";
import {
  coerceToFlatArtifact,
  flatArtifactToFragmentDoc,
} from "../skills/flat-artifact.js";
import {
  gmChanceToolsEnabled,
  GM_CHANCE_HARNESS_INSTRUCTION,
} from "../skills/gm-tools.js";
import { runGmHarness } from "./gm-harness.js";
import {
  mergeQuestionsPreferFragment,
  normalizeQuestions,
  type QuestionItem,
} from "../skills/question-protocol.js";
import {
  extractFragmentAskSidecar,
  isUsableContextFragment,
  looksLikeFragmentDoc,
} from "../skills/context-fragment.js";
import {
  isProgressPointerTag,
  looksLikeCreationFlowDoc,
} from "../skills/creation-flow.js";
import {
  CONTEXT_ORDER_TAG,
  parseContextOrder,
  serializeContextOrder,
} from "../skills/context-order.js";

export type WorkerStreamCallbacks = {
  onThinkingDelta?: (delta: string) => void;
  onOutputDelta?: (delta: string) => void;
};

export type WorkerRunParams = {
  skillName: string;
  workerId: string;
  slots: Record<string, unknown>;
  blackboard: Blackboard;
  llm: LlmProvider;
  stream?: WorkerStreamCallbacks;
  /** 声明驱动：跳过磁盘 SKILL，直接用解析好的契约 */
  declared?: { worker: ParsedWorkerSkill; promptBody: string };
};

export type WorkerRunResult = {
  outputs: Record<string, string>;
  summary: string;
  preview: string;
  askUser?: QuestionItem[];
  /** 来自 context-fragment 自评/导语，挂到验收询问卡评估区 */
  askAssessment?: string;
};

const WORKER_SET_OUTPUT_TAGS = new Set(["设计.worker集", "设计.worker集.草稿"]);
const PLAY_FEED_OUTPUT_TAGS = new Set([PRESENT_TAG, "输出.开场白"]);

function formatWorkerPreview(
  outputs: Record<string, string>,
  summary: string,
): string {
  const visible = Object.entries(outputs).filter(([tag]) =>
    PLAY_FEED_OUTPUT_TAGS.has(tag),
  );
  if (visible.length) {
    return visible.map(([, v]) => v).join("\n\n");
  }
  return (
    Object.entries(outputs)
      .map(([tag, v]) => `### ${tag}\n\n${v}`)
      .join("\n\n")
      .slice(0, 4000) || summary
  );
}

const WORKER_OUTPUT_INSTRUCTION = `

---

## 运行时输出协议

输出 **一个 JSON 对象**（由程序按模型能力用 schema / tool / json_object 约束投递）。

按本步 SKILL 规定的产物形状写。有正文的技能稿按该步 \`正文\` 对象写（柱下到条目/诊断三元组），不要把业务字段改成一段 \`sections[].text\`。
「设计.创作流程」必须是带 \`steps\` 数组的 DAG，worker 集必须是带 \`workers\` 的规格。

也兼容：
1. 直接输出本步产物对象（创作流程 / context-fragment.v1 / worker 集等）
2. \`{ "outputs": { "<本步 tag>": { … } }, "summary":"…", "askUser": null }\`（values 用对象）

不要写入进度指针。追问用 \`questions\`（或旧 \`追问.题目\`）；\`questions: []\` 表示可验收。
「开放问题」留给后续步。残稿也要交。summary 用于界面展示。`;

function slotValueForTag(
  tag: string,
  slots: Record<string, unknown>,
): string | undefined {
  const val = slots[tag];
  if (typeof val === "string" && val.trim()) return val.trim();
  return undefined;
}

function gatherInputs(
  inputTags: string[],
  inputMerge: BlackboardInputMerge,
  slots: Record<string, unknown>,
  blackboard: Blackboard,
): Record<string, string> {
  const inputs: Record<string, string> = {};
  const items = blackboard.queryByPatterns(inputTags, inputMerge);

  for (const item of items) {
    inputs[item.tag] = item.content;
  }

  for (const pattern of inputTags) {
    if (pattern.endsWith(".*") || pattern === "**") continue;
    const slotVal = slotValueForTag(pattern, slots);
    if (slotVal) inputs[pattern] = slotVal;
  }

  const workerReply = slotValueForTag("用户.worker答复", slots);
  if (workerReply && !inputs["用户.worker答复"]) {
    inputs["用户.worker答复"] = workerReply;
  }

  if (inputTags.includes("用户.博弈需求") && !inputs["用户.博弈需求"]) {
    const fromSlot = slotValueForTag("用户.博弈需求", slots);
    if (fromSlot) {
      inputs["用户.博弈需求"] = fromSlot;
    } else {
      const transcript = collectUserInputTranscript(slots);
      if (transcript) inputs["用户.博弈需求"] = transcript;
    }
  }

  if (inputTags.includes("用户.需求") && !inputs["用户.需求"]) {
    const fromSlot = slotValueForTag("用户.需求", slots);
    if (fromSlot) {
      inputs["用户.需求"] = fromSlot;
    } else {
      const transcript = collectUserInputTranscript(slots);
      if (transcript) inputs["用户.需求"] = transcript;
    }
  }

  return inputs;
}

function stringifyOutputValue(val: unknown): string | undefined {
  if (typeof val === "string" && val.trim()) return val.trim();
  if (val && typeof val === "object") return JSON.stringify(val);
  return undefined;
}

function productOutputTags(outputTags: string[]): string[] {
  return outputTags.filter((t) => t.trim() && !isProgressPointerTag(t));
}

function assignOutput(
  outputs: Record<string, string>,
  tag: string | undefined,
  val: unknown,
): void {
  if (!tag || isProgressPointerTag(tag)) return;
  const text = stringifyOutputValue(val);
  if (text) outputs[tag] = text;
}

/** 模型常把片段当根对象，或写进「创作.当前步骤」 */
function existingOutputIsProduct(text: string | undefined): boolean {
  if (!text?.trim()) return false;
  if (isUsableContextFragment(text)) return true;
  const parsed = tryParseJsonDoc(text);
  return looksLikeCreationFlowDoc(parsed) || looksLikeFragmentDoc(parsed);
}

function recoverFragmentOutputs(
  obj: Record<string, unknown>,
  outputs: Record<string, string>,
  outputTags: string[],
): void {
  const target = productOutputTags(outputTags)[0];
  if (!target) return;
  if (existingOutputIsProduct(outputs[target])) return;

  const outputsRaw =
    obj.outputs && typeof obj.outputs === "object" && !Array.isArray(obj.outputs)
      ? (obj.outputs as Record<string, unknown>)
      : null;

  if (outputsRaw) {
    for (const [key, val] of Object.entries(outputsRaw)) {
      if (key === target) continue;
      const text = stringifyOutputValue(val);
      if (!text) continue;
      if (
        isUsableContextFragment(text) ||
        looksLikeFragmentDoc(val) ||
        looksLikeCreationFlowDoc(val)
      ) {
        outputs[target] = text;
        return;
      }
    }
  }

  const protocolKeys = new Set(["outputs", "summary", "askUser", "askAssessment"]);
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!protocolKeys.has(k)) rest[k] = v;
  }
  if (looksLikeFragmentDoc(obj) || looksLikeFragmentDoc(rest)) {
    const source = looksLikeFragmentDoc(obj) ? obj : rest;
    outputs[target] = JSON.stringify(source);
    return;
  }
  if (looksLikeCreationFlowDoc(obj) || looksLikeCreationFlowDoc(rest)) {
    const source = looksLikeCreationFlowDoc(obj) ? obj : rest;
    if (!outputs[target]?.trim()) {
      outputs[target] = JSON.stringify(source);
    }
  }
}

/** 进度指针不得当产物；半残 JSON / 缺字段仍保留，交给验收卡。 */
function dropProgressPointerOutputs(outputs: Record<string, string>): void {
  for (const tag of Object.keys(outputs)) {
    if (isProgressPointerTag(tag) || !outputs[tag]?.trim()) {
      delete outputs[tag];
    }
  }
}

/** 像结构化残稿（含截断 JSON），应进验收而不是改成提问。 */
function looksLikeStructuredDraft(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith("{") || t.startsWith("[")) return true;
  if (/```(?:json)?/i.test(t) && t.includes("{")) return true;
  if (/"schema"\s*:/.test(t)) return true;
  if (/"技能"\s*:/.test(t) || /"正文"\s*:/.test(t)) return true;
  if (/"inserts"\s*:/.test(t) || /"agents"\s*:/.test(t) || /"play_slots"\s*:/.test(t)) {
    return true;
  }
  if (/"workers"\s*:/.test(t) && t.includes("{")) return true;
  return Boolean(extractJsonObjectText(t));
}

/** 几乎只有提问、没有稿。 */
function isQuestionOnlyText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (looksLikeStructuredDraft(t)) return false;
  const qs = extractQuestionsFromText(t);
  if (!qs.length) return false;
  return looksLikeProseNotSpec(t) || /你的选择|请(?:描述|选择|确认|补充)/.test(t);
}

function canonicalizeKnownOutputs(outputs: Record<string, string>): void {
  const raw = outputs[CONTEXT_ORDER_TAG];
  if (!raw?.trim()) return;
  const doc = parseContextOrder(raw);
  if (doc?.slots.length) {
    outputs[CONTEXT_ORDER_TAG] = serializeContextOrder(doc);
  }
}

const INCOMPLETE_FRAGMENT_ASK = normalizeQuestions([
  {
    id: "design-step-retry",
    prompt:
      "这一步还没写出可验收的产物。请再补一点你最在意的体验或参与方式；也可以说「按已有描述先出一版」。",
    allowOther: true,
    required: true,
  },
]);

function lookupOutputValue(
  raw: Record<string, unknown>,
  tag: string,
): unknown {
  if (raw[tag] != null) return raw[tag];
  const leaf = tag.includes(".") ? tag.slice(tag.lastIndexOf(".") + 1) : tag;
  if (!leaf) return undefined;
  for (const [key, val] of Object.entries(raw)) {
    if (val == null) continue;
    if (key === leaf || key.endsWith(`.${leaf}`)) return val;
  }
  return undefined;
}

function parseWorkerResponse(
  raw: string,
  outputTags: string[],
): WorkerRunResult {
  const parsed = tryParseJsonDoc(raw);
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    const target = productOutputTags(outputTags)[0] ?? outputTags[0];
    if (target && looksLikeStructuredDraft(raw)) {
      return finalizeParsedOutputs(
        { [target]: raw },
        { summary: "格式不完整，已交出残稿" },
        outputTags,
      );
    }
    if (target && isUsableContextFragment(raw)) {
      return finalizeParsedOutputs(
        { [target]: raw },
        { summary: raw.slice(0, 80) },
        outputTags,
      );
    }
    if (target && raw.trim() && !isQuestionOnlyText(raw)) {
      return finalizeParsedOutputs(
        { [target]: raw },
        { summary: "未按协议包一层，已交出原文" },
        outputTags,
      );
    }
    const questions = normalizeQuestions(extractQuestionsFromText(raw));
    return {
      outputs: {},
      summary: "未产出可验收产物",
      preview: raw.slice(0, 600),
      askUser: questions.length ? questions.slice(0, 2) : INCOMPLETE_FRAGMENT_ASK,
    };
  }

  const obj = parsed as Record<string, unknown>;

  // 创作流程 DAG：根对象就是产物，不能先收成扁形（brief 会被当成稿、steps 丢掉）
  if (looksLikeCreationFlowDoc(obj)) {
    const target = productOutputTags(outputTags)[0] ?? outputTags[0];
    if (target) {
      return finalizeParsedOutputs(
        { [target]: JSON.stringify(obj) },
        obj,
        outputTags,
      );
    }
  }

  // 扁形产物 → 旧 fragment 外壳。已是 context-fragment 深树则原样收下（保留自评与嵌套正文）。
  if (!looksLikeFragmentDoc(obj)) {
    const asFlat = coerceToFlatArtifact(obj);
    if (asFlat) {
      const frag = flatArtifactToFragmentDoc(asFlat);
      const target = productOutputTags(outputTags)[0] ?? outputTags[0];
      if (target) {
        return finalizeParsedOutputs(
          { [target]: JSON.stringify(frag) },
          { ...frag, summary: asFlat.summary || obj.summary },
          outputTags,
        );
      }
    }
  }

  const outputsRaw = obj.outputs;
  const outputs: Record<string, string> = {};

  if (outputsRaw && typeof outputsRaw === "object" && !Array.isArray(outputsRaw)) {
    const bag = outputsRaw as Record<string, unknown>;
    for (const tag of productOutputTags(outputTags)) {
      assignOutput(outputs, tag, lookupOutputValue(bag, tag));
    }
  }
  recoverFragmentOutputs(obj, outputs, outputTags);

  return finalizeParsedOutputs(outputs, obj, outputTags);
}

function finalizeParsedOutputs(
  outputs: Record<string, string>,
  obj: Record<string, unknown>,
  _outputTags: string[],
): WorkerRunResult {
  const isMetaAskToken = (s: string) => /^ask[_-]?user$/i.test(s.trim());

  let askUser: QuestionItem[] | undefined;
  if (Array.isArray(obj.askUser)) {
    askUser = normalizeQuestions(
      obj.askUser.filter((q) => {
        if (typeof q === "string") return q.trim() && !isMetaAskToken(q);
        return true;
      }),
    );
  } else if (typeof obj.askUser === "string" && obj.askUser.trim()) {
    const q = obj.askUser.trim();
    askUser = isMetaAskToken(q) ? undefined : normalizeQuestions([q]);
  }
  if ((!askUser || askUser.length === 0) && Object.keys(outputs).length === 0) {
    const summaryText =
      typeof obj.summary === "string" ? obj.summary.trim() : "";
    if (
      summaryText &&
      !isMetaAskToken(summaryText) &&
      summaryText.length > 8 &&
      /[？?]/.test(summaryText)
    ) {
      askUser = normalizeQuestions([summaryText]);
    } else if (isMetaAskToken(summaryText)) {
      askUser = normalizeQuestions([
        "请补充当前步骤所需的信息（情境、参数或你的具体设想）。",
      ]);
    }
  }

  // 先抽追问；半残稿仍留在 outputs，追问挂验收卡（不因缺字段丢掉正文）
  let askAssessment: string | undefined;
  const fragQuestions: QuestionItem[] = [];
  for (const content of Object.values(outputs)) {
    const side = extractFragmentAskSidecar(content);
    if (side.assessment && !askAssessment) askAssessment = side.assessment;
    for (const q of side.questions) {
      if (!fragQuestions.some((x) => x.prompt === q.prompt)) {
        fragQuestions.push(q);
      }
    }
  }
  if (fragQuestions.length) {
    askUser = mergeQuestionsPreferFragment(askUser, fragQuestions);
  }

  dropProgressPointerOutputs(outputs);
  canonicalizeKnownOutputs(outputs);

  if (Object.keys(outputs).length === 0 && (!askUser || askUser.length === 0)) {
    askUser = normalizeQuestions(INCOMPLETE_FRAGMENT_ASK);
  }

  const summary =
    typeof obj.summary === "string" && obj.summary.trim()
      ? obj.summary.trim()
      : Object.values(outputs)[0]?.slice(0, 80) ??
        (askUser?.length ? `待补充：${askUser[0]!.prompt.slice(0, 40)}` : "Worker 已完成");

  const preview = formatWorkerPreview(outputs, summary);

  return sanitizeWorkerSetOutputs({
    outputs,
    summary,
    preview,
    askUser: askUser?.length ? askUser : undefined,
    askAssessment,
  });
}

/** 规格 tag：能解析则收成 JSON；半残 JSON 保留进验收；纯提问才改成 askUser。 */
export function sanitizeWorkerSetOutputs(result: WorkerRunResult): WorkerRunResult {
  const outputs = { ...result.outputs };
  const askUser = [...(result.askUser ?? [])];
  const askAssessment = result.askAssessment;

  for (const tag of [...Object.keys(outputs)]) {
    if (!WORKER_SET_OUTPUT_TAGS.has(tag)) continue;
    const content = outputs[tag];
    if (!content?.trim()) {
      delete outputs[tag];
      continue;
    }
    const extracted = extractJsonObjectText(content) ?? content.trim();
    const parsed = parseWorkerSetYaml(extracted);
    if (isUsableWorkerSet(parsed)) {
      outputs[tag] = extracted.startsWith("{")
        ? extracted
        : (extractJsonObjectText(extracted) ?? extracted);
      continue;
    }
    if (looksLikeStructuredDraft(content)) {
      outputs[tag] = content.trim();
      continue;
    }
    if (isQuestionOnlyText(content)) {
      delete outputs[tag];
      if (askUser.length === 0) {
        const qs = normalizeQuestions(extractQuestionsFromText(content));
        if (qs.length) askUser.push(...qs.slice(0, 2));
      }
    }
  }

  const summary =
    askUser.length && Object.keys(outputs).length === 0
      ? `待补充：${askUser[0]!.prompt.slice(0, 40)}`
      : result.summary;

  const preview =
    askUser.length && Object.keys(outputs).length === 0
      ? askUser.map((q) => `- ${q.prompt}`).join("\n")
      : formatWorkerPreview(outputs, summary);

  return {
    outputs,
    summary,
    preview,
    askUser: askUser.length ? askUser : undefined,
    askAssessment: askAssessment?.trim() || undefined,
  };
}

function extractQuestionsFromText(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•\d.、)）]+\s*/, "").trim())
    .filter((l) => l.length >= 6);
  const withMark = lines.filter((l) => /[？?]/.test(l) || /请(?:描述|选择|确认|补充)/.test(l));
  if (withMark.length) return withMark.slice(0, 3);
  // 整段像提问说明
  if (/请(?:描述|选择|确认|补充)|你选择|或者你也可以/.test(text)) {
    const compact = text.replace(/\s+/g, " ").trim().slice(0, 240);
    if (compact) return [compact];
  }
  return [];
}

export async function runWorkerSkill(params: WorkerRunParams): Promise<WorkerRunResult> {
  const workerId = resolveWorkerId(params.workerId);
  let worker: ParsedWorkerSkill;
  let promptBody: string;

  if (params.declared) {
    worker = params.declared.worker;
    promptBody = params.declared.promptBody;
  } else {
    const flowRaw = params.blackboard.getContentByTag("设计.创作流程");
    const currentStepName = params.blackboard.getContentByTag("创作.当前步骤");
    const selectedRecipeRef = params.blackboard.getContentByTag("创作.选用配方");
    const acceptedRaw =
      params.slots.creationAcceptedUnits ??
      params.blackboard.getContentByTag("创作.已验收单位");
    let acceptedStepNames: string[] = [];
    let inheritExisting = false;
    try {
      const { parseAcceptedSteps, isInheritExistingFlag } = await import(
        "../skills/creation-flow.js"
      );
      acceptedStepNames = parseAcceptedSteps(acceptedRaw);
      inheritExisting = isInheritExistingFlag(
        params.blackboard.getContentByTag("创作.继承修改"),
      );
    } catch {
      acceptedStepNames = [];
    }
    const filledArtifactTags = params.blackboard
      .listTagIndex()
      .map((item) => item.tag);
    const loaded = await loadWorkerSkillWithContext(
      params.skillName,
      workerId,
      undefined,
      {
        flowRaw,
        currentStepName,
        acceptedStepNames,
        selectedRecipeRef,
        filledArtifactTags,
        inheritExisting,
      },
    );
    worker = loaded.worker;
    promptBody = loaded.promptBody;
  }

  const inputMerge = worker.inputMerge ?? "latest";
  let inputs = gatherInputs(
    worker.inputTags,
    inputMerge,
    params.slots,
    params.blackboard,
  );

  if (worker.id === "role-decide") {
    inputs = filterInputsForRolePerspective(inputs, params.slots);
  }

  // 上一 worker 验收后的定稿摘要：始终注入，供本 worker「指点」用
  const priorBrief = params.blackboard.getContentByTag(CONTEXT_BRIEF_TAG)?.trim();
  if (priorBrief && !inputs[CONTEXT_BRIEF_TAG]) {
    inputs[CONTEXT_BRIEF_TAG] = priorBrief;
  }

  const useGmHarness =
    isPlayLayerActive(params.slots) &&
    worker.id === "world-simulator" &&
    gmChanceToolsEnabled(
      parseWorkerSetYaml(
        params.blackboard.getContentByTag("设计.worker集") ?? "",
      )?.play_slots,
    );

  const systemContent =
    promptBody +
    WORKER_OUTPUT_INSTRUCTION +
    (useGmHarness ? GM_CHANCE_HARNESS_INSTRUCTION : "");
  const playPreset = isPlayLayerActive(params.slots)
    ? resolveActivePreset(loadAppSettings().activePresetId)
    : null;

  const messages = playPreset
    ? assemblePlayWorkerMessages({
        systemPrompt: systemContent,
        preset: playPreset,
        pack: worldInfoPackFromSegments({
          segments: worker.contextSegments ?? [],
          inputs,
          blackboard: params.blackboard,
          inputMerge,
        }),
      })
    : [
        { role: "system" as const, content: systemContent },
        {
          role: "user" as const,
          content: assembleWorkerContext({
            inputs,
            segments: worker.contextSegments,
            blackboard: params.blackboard,
            inputMerge,
            workerId: worker.id,
            workerName: worker.name,
            outputTags: worker.outputTags,
          }),
        },
      ];

  if (useGmHarness) {
    const systemMsg = messages.find((m) => m.role === "system");
    const rest = messages.filter((m) => m.role !== "system") as ChatMessage[];
    const harness = await runGmHarness({
      llm: params.llm,
      system: systemMsg?.content ?? systemContent,
      messages: rest,
      stream: params.stream,
      caller: `worker:${worker.id}`,
    });
    return parseWorkerResponse(selectJsonPayload(harness.content), worker.outputTags);
  }

  const streamCallbacks: StreamCallbacks | undefined = params.stream
    ? {
        onReasoningDelta: (delta) => params.stream?.onThinkingDelta?.(delta),
        onContentDelta: (delta) => params.stream?.onOutputDelta?.(delta),
      }
    : undefined;

  const result = await completeStructured(params.llm, messages, {
    schema: {
      type: "object",
      additionalProperties: true,
    },
    name: "submit_worker_result",
    schemaIsLoose: true,
    capabilities: resolveActiveProfile()?.capabilities,
    caller: `worker:${worker.id}`,
    stream: streamCallbacks,
  });

  const raw =
    typeof result.parsed === "string"
      ? result.parsed
      : JSON.stringify(result.parsed);
  return parseWorkerResponse(
    selectJsonPayload(raw, result.reasoning) || raw,
    worker.outputTags,
  );
}

/** @internal 供单测 */
export function parseWorkerResponseForTest(
  raw: string,
  outputTags: string[],
): WorkerRunResult {
  return parseWorkerResponse(raw, outputTags);
}

/** @internal 供单测验证 inputTags → inputs 拼接 */
export function gatherWorkerInputs(
  inputTags: string[],
  inputMerge: BlackboardInputMerge,
  slots: Record<string, unknown>,
  blackboard: Blackboard,
): Record<string, string> {
  return gatherInputs(inputTags, inputMerge, slots, blackboard);
}
