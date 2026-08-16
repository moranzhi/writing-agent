import type { Blackboard } from "../blackboard/blackboard.js";
import type { LlmProvider, StreamCallbacks } from "../llm/client.js";
import { supportsContentStream } from "../llm/stream-complete.js";
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
  parseWorkerSetYaml,
} from "../skills/worker-set-parse.js";
import { assembleWorkerContext } from "../skills/context-segments.js";
import {
  mergeQuestionsPreferFragment,
  normalizeQuestions,
  type QuestionItem,
} from "../skills/question-protocol.js";
import {
  extractFragmentAskSidecar,
  expectsContextFragmentTag,
  isUsableContextFragment,
  looksLikeFragmentDoc,
} from "../skills/context-fragment.js";
import { isProgressPointerTag } from "../skills/creation-flow.js";

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

export type WorkerStreamCallbacks = {
  onThinkingDelta?: (delta: string) => void;
  onOutputDelta?: (delta: string) => void;
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

const WORKER_OUTPUT_INSTRUCTION = `

---

## 运行时输出协议（必须遵守）

请输出 **单个 JSON 对象**（不要 markdown 代码块），字段：
{
  "outputs": { "<outputTag>": "<内容字符串>" },
  "summary": "50字以内产物摘要",
  "askUser": null 或 问题数组
}

askUser 每项可为：
- 字符串："需要用户补充的问题"
- 或结构化：{ "id": "q1", "prompt": "问题", "options": [{ "id": "A", "label": "可编辑完整句选项" }], "allowOther": true }

- outputs 的 key 必须是要求的 outputTags
- **设计.worker集 / 设计.worker集.草稿**：value 必须是 JSON 对象文本（以 { 开头），禁止中文说明、元叙述、提问长文；禁止 YAML
- **context-fragment.v1**：必须放在 outputs["<本步 artifact tag>"]，禁止把片段当根对象。题目只写在产物「追问」（建议选项 + 示例）；顶层 askUser 必须为 **null**。程序会把「追问」挂到询问卡。禁止同一问再抄一份 askUser。禁止写入「创作.当前步骤」等进度指针
- **其它产物**：优先同时给 outputs + askUser；有产物时追问挂在产物下（用户可直接接受而不作答）。仅当完全无法产出时才留空 outputs、只填 askUser
- 能推断选项时 **必须**给 options（完整句、可改写）；不要只丢裸问题逼用户写长段
- 若 inputs 中 \`用户.需求\` / \`用户.博弈需求\`（或 book.brief）已有实质内容，禁止 askUser 要求用户重复提供其中已写明的情境、角色、规则等；仅对 genuinely 缺失且无法推断的要点提问
- summary 用于界面展示`;

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
function recoverFragmentOutputs(
  obj: Record<string, unknown>,
  outputs: Record<string, string>,
  outputTags: string[],
): void {
  const target = productOutputTags(outputTags)[0];
  if (!target) return;
  if (outputs[target] && isUsableContextFragment(outputs[target])) return;

  const outputsRaw =
    obj.outputs && typeof obj.outputs === "object" && !Array.isArray(obj.outputs)
      ? (obj.outputs as Record<string, unknown>)
      : null;

  if (outputsRaw) {
    for (const [key, val] of Object.entries(outputsRaw)) {
      if (key === target) continue;
      const text = stringifyOutputValue(val);
      if (!text) continue;
      if (isUsableContextFragment(text) || looksLikeFragmentDoc(val)) {
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
  }
}

function dropUnusableFragmentOutputs(outputs: Record<string, string>): void {
  for (const tag of Object.keys(outputs)) {
    if (isProgressPointerTag(tag)) {
      delete outputs[tag];
      continue;
    }
    const content = outputs[tag]!;
    const requireFragment = expectsContextFragmentTag(tag);
    const looksFragment =
      isUsableContextFragment(content) ||
      looksLikeFragmentDoc(tryParseObject(content)) ||
      /"schema"\s*:\s*"context-fragment\.v1"/.test(content) ||
      /"技能"\s*:/.test(content);
    if ((requireFragment || looksFragment) && !isUsableContextFragment(content)) {
      delete outputs[tag];
    }
  }
}

function tryParseObject(text: string): unknown {
  const extracted = extractJsonObjectText(text) ?? text.trim();
  try {
    return JSON.parse(extracted);
  } catch {
    return undefined;
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

function parseWorkerResponse(
  raw: string,
  outputTags: string[],
): WorkerRunResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (outputTags.some((t) => WORKER_SET_OUTPUT_TAGS.has(t))) {
      const questions = normalizeQuestions(extractQuestionsFromText(raw));
      return {
        outputs: {},
        summary: "未产出合法协议 JSON",
        preview: raw.slice(0, 600),
        askUser: questions.length
          ? questions.slice(0, 2)
          : normalizeQuestions([
              "请补充设计所需的关键信息（上一次未产出合法 JSON 规格）。",
            ]),
      };
    }
    const target = productOutputTags(outputTags)[0] ?? outputTags[0];
    if (target && isUsableContextFragment(raw)) {
      return finalizeParsedOutputs(
        { [target]: raw },
        { summary: raw.slice(0, 80) },
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

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Worker 返回了无效 JSON");
  }

  const obj = parsed as Record<string, unknown>;
  const outputsRaw = obj.outputs;
  const outputs: Record<string, string> = {};

  if (outputsRaw && typeof outputsRaw === "object") {
    for (const tag of productOutputTags(outputTags)) {
      assignOutput(outputs, tag, (outputsRaw as Record<string, unknown>)[tag]);
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

  // 先抽追问，再丢掉半残片段——无正文时仍要把题留给 LLM loop
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

  dropUnusableFragmentOutputs(outputs);

  if (Object.keys(outputs).length === 0 && (!askUser || askUser.length === 0)) {
    askUser = normalizeQuestions(INCOMPLETE_FRAGMENT_ASK);
  }

  const summary =
    typeof obj.summary === "string" && obj.summary.trim()
      ? obj.summary.trim()
      : Object.values(outputs)[0]?.slice(0, 80) ??
        (askUser?.length ? `待补充：${askUser[0]!.prompt.slice(0, 40)}` : "Worker 已完成");

  const preview =
    Object.entries(outputs)
      .map(([tag, v]) => `### ${tag}\n\n${v}`)
      .join("\n\n")
      .slice(0, 4000) || summary;

  return sanitizeWorkerSetOutputs({
    outputs,
    summary,
    preview,
    askUser: askUser?.length ? askUser : undefined,
    askAssessment,
  });
}

/** 规格 tag 必须是可用 JSON；非法散文改为 askUser，避免污染黑板 */
export function sanitizeWorkerSetOutputs(result: WorkerRunResult): WorkerRunResult {
  const outputs = { ...result.outputs };
  const askUser = [...(result.askUser ?? [])];
  const askAssessment = result.askAssessment;
  let droppedProse = false;

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
    droppedProse = true;
    delete outputs[tag];
    if (askUser.length === 0) {
      const qs = normalizeQuestions(extractQuestionsFromText(content));
      if (qs.length) askUser.push(...qs.slice(0, 2));
    }
  }

  if (droppedProse && askUser.length === 0) {
    askUser.push(
      ...normalizeQuestions([
        "请补充或确认开局关键前提（上一次把说明文字写进了规格字段，未产出合法 JSON）。",
      ]),
    );
  }

  // 提问时不要夹带半残规格
  if (askUser.length > 0) {
    for (const tag of WORKER_SET_OUTPUT_TAGS) {
      // 保留仍合法的草稿；已在上面删掉非法的
      void tag;
    }
  }

  const summary =
    askUser.length && Object.keys(outputs).length === 0
      ? `待补充：${askUser[0]!.prompt.slice(0, 40)}`
      : result.summary;

  const preview =
    askUser.length && Object.keys(outputs).length === 0
      ? askUser.map((q) => `- ${q.prompt}`).join("\n")
      : Object.entries(outputs)
          .map(([tag, v]) => `### ${tag}\n\n${v}`)
          .join("\n\n")
          .slice(0, 4000) || summary;

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

async function completeWorkerPreferStream(
  llm: LlmProvider,
  messages: Parameters<LlmProvider["complete"]>[0],
  options: Parameters<LlmProvider["complete"]>[1],
  stream?: WorkerStreamCallbacks,
): Promise<Awaited<ReturnType<LlmProvider["complete"]>>> {
  const callbacks: StreamCallbacks = {
    onReasoningDelta: (delta) => stream?.onThinkingDelta?.(delta),
    onContentDelta: (delta) => stream?.onOutputDelta?.(delta),
  };
  if (supportsContentStream(llm)) {
    return llm.completeStream!(messages, options, callbacks);
  }
  const result = await llm.complete(messages, options);
  if (result.reasoning) callbacks.onReasoningDelta?.(result.reasoning);
  if (result.content) callbacks.onContentDelta?.(result.content);
  return result;
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
    try {
      const { parseAcceptedSteps } = await import("../skills/creation-flow.js");
      acceptedStepNames = parseAcceptedSteps(acceptedRaw);
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

  const userPayload = assembleWorkerContext({
    inputs,
    segments: worker.contextSegments,
    blackboard: params.blackboard,
    inputMerge,
    workerId: worker.id,
    workerName: worker.name,
    outputTags: worker.outputTags,
  });

  const result = await completeWorkerPreferStream(
    params.llm,
    [
      { role: "system", content: promptBody + WORKER_OUTPUT_INSTRUCTION },
      { role: "user", content: userPayload },
    ],
    {
      responseFormat: "json_object",
      caller: `worker:${worker.id}`,
    },
    params.stream,
  );

  return parseWorkerResponse(result.content, worker.outputTags);
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
