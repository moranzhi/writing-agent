import type { Blackboard } from "../blackboard/blackboard.js";
import type { LlmProvider } from "../llm/client.js";
import { loadWorkerSkillWithContext } from "../skills/loader.js";
import { filterInputsForRolePerspective } from "../skills/worker-llm.js";
import { collectUserInputTranscript } from "../intake/intake.js";
import { resolveWorkerId } from "./resolve-id.js";
import type { BlackboardInputMerge } from "../types/blackboard.js";

export type WorkerRunParams = {
  skillName: string;
  workerId: string;
  slots: Record<string, unknown>;
  blackboard: Blackboard;
  llm: LlmProvider;
};

export type WorkerRunResult = {
  outputs: Record<string, string>;
  summary: string;
  preview: string;
  askUser?: string[];
};

const WORKER_OUTPUT_INSTRUCTION = `

---

## 运行时输出协议（必须遵守）

请输出 **单个 JSON 对象**（不要 markdown 代码块），字段：
{
  "outputs": { "<outputTag>": "<内容字符串>" },
  "summary": "50字以内产物摘要",
  "askUser": null 或 ["需要用户补充的问题"]
}

- outputs 的 key 必须是要求的 outputTags
- 若信息不足，outputs 可为空对象，askUser 填入问题
- 若 inputs 中 \`用户.博弈需求\`（或 book.brief）已有实质内容，禁止 askUser 要求用户重复提供其中已写明的情境、角色、规则等；仅对 genuinely 缺失且无法推断的要点提问
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

  return inputs;
}

function parseWorkerResponse(
  raw: string,
  outputTags: string[],
): WorkerRunResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const fallback: Record<string, string> = {};
    if (outputTags.length === 1) {
      fallback[outputTags[0]] = raw;
    } else {
      fallback[outputTags[0] ?? "output.草稿"] = raw;
    }
    return {
      outputs: fallback,
      summary: raw.slice(0, 80),
      preview: raw.slice(0, 600),
    };
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Worker 返回了无效 JSON");
  }

  const obj = parsed as Record<string, unknown>;
  const outputsRaw = obj.outputs;
  const outputs: Record<string, string> = {};

  if (outputsRaw && typeof outputsRaw === "object") {
    for (const tag of outputTags) {
      const val = (outputsRaw as Record<string, unknown>)[tag];
      if (typeof val === "string" && val.trim()) {
        outputs[tag] = val.trim();
      }
    }
  }

  const isMetaAskToken = (s: string) => /^ask[_-]?user$/i.test(s.trim());

  let askUser: string[] | undefined;
  if (Array.isArray(obj.askUser)) {
    askUser = obj.askUser.filter(
      (q): q is string =>
        typeof q === "string" && q.trim().length > 0 && !isMetaAskToken(q),
    );
  } else if (typeof obj.askUser === "string" && obj.askUser.trim()) {
    const q = obj.askUser.trim();
    askUser = isMetaAskToken(q) ? undefined : [q];
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
      askUser = [summaryText];
    } else if (isMetaAskToken(summaryText)) {
      askUser = ["请补充当前步骤所需的信息（情境、参数或你的具体设想）。"];
    }
  }

  const summary =
    typeof obj.summary === "string" && obj.summary.trim()
      ? obj.summary.trim()
      : Object.values(outputs)[0]?.slice(0, 80) ?? "Worker 已完成";

  const preview =
    Object.entries(outputs)
      .map(([tag, v]) => `### ${tag}\n\n${v}`)
      .join("\n\n")
      .slice(0, 4000) || summary;

  return { outputs, summary, preview, askUser: askUser?.length ? askUser : undefined };
}

export async function runWorkerSkill(params: WorkerRunParams): Promise<WorkerRunResult> {
  const workerId = resolveWorkerId(params.workerId);
  const { worker, promptBody } = await loadWorkerSkillWithContext(
    params.skillName,
    workerId,
  );

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

  const userPayload = {
    workerId: worker.id,
    workerName: worker.name,
    inputTags: worker.inputTags,
    outputTags: worker.outputTags,
    inputs,
    instruction:
      "根据 SKILL 说明完成创作任务。若 inputs 不足，使用 askUser 提问而非臆造。inputs 中已有用户.博弈需求 / book.brief 时，应直接据此产出，勿重复索要已提供信息。",
  };

  const result = await params.llm.complete(
    [
      { role: "system", content: promptBody + WORKER_OUTPUT_INSTRUCTION },
      { role: "user", content: JSON.stringify(userPayload, null, 2) },
    ],
    {
      responseFormat: "json_object",
      caller: `worker:${worker.id}`,
    },
  );

  return parseWorkerResponse(result.content, worker.outputTags);
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
