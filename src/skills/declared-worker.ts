import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Blackboard } from "../blackboard/blackboard.js";
import type { RuntimeSession } from "../types/runtime.js";
import type { AcceptanceMode } from "../types/runtime.js";
import type { ParsedWorkerSkill } from "./types.js";
import {
  parseWorkerSetYaml,
  type ParsedWorkerSet,
  type WorkerSetEntry,
} from "./worker-set-parse.js";
import {
  buildInstanceWorkerDeclaration,
  inferLifecycleStage,
  readWorkerSetYamlForDeclaration,
} from "./worker-declaration.js";
import { loadWorkerSkill, SKILLS_ROOT } from "./loader.js";
import { CONTEXT_BRIEF_TAG } from "../runtime/compress-after-worker.js";
import { isDesignDiskWorker } from "./creation-units.js";
import {
  entriesForWorker,
  formatResidentPromptSection,
  parseResidentContext,
  residentTagFor,
} from "./resident-context.js";
import {
  CONTEXT_ORDER_TAG,
  contextOrderToSegments,
  parseContextOrder,
  slotOrderForRef,
} from "./context-order.js";
import type { ContextSegmentDef } from "./context-segments.js";
import { PLAY_VISIBLE_BODY_INSTRUCTION } from "./present-packet.js";
import { isNarratorEnabled } from "./play-slots.js";

type WorkerTemplateDoc = {
  id?: string;
  label?: string;
  duty?: string;
  prompt_excerpt?: string;
  suggested_context?: { static?: string[]; dynamic?: string[] };
  suggested_outputs?: string[];
};

/**
 * 解析本次 worker 的验收模式（创作 / run 共用入口）。
 * - design-flow → no_confirmation（图上点节点即确认；底栏输入即改编排）
 * - design-step / opening-generator 磁盘创作 worker → 始终 user_confirmed
 * - 游玩回合：一律 no_confirmation（一句输入连跑，不穿插验收）
 * - Worker 集 acceptance: review → user_confirmed；continue → no_confirmation
 * - 未声明 acceptance：创作默认确认
 */
export function resolveAcceptanceModeForWorker(params: {
  session: RuntimeSession;
  blackboard: Blackboard;
  workerId: string;
}): AcceptanceMode {
  const workerId = params.workerId.trim();
  if (workerId === "design-flow") return "no_confirmation";
  if (isDesignDiskWorker(workerId) || workerId === "opening-generator") {
    return "user_confirmed";
  }
  if (inferLifecycleStage(params.session) === "play") {
    return "no_confirmation";
  }

  const decl = buildInstanceWorkerDeclaration(
    params.session,
    params.blackboard,
    inferLifecycleStage(params.session),
  );
  const entry = decl.parsed?.workers.find((w) => w.ref?.trim() === workerId);
  if (entry?.acceptance === "continue") return "no_confirmation";
  if (entry?.acceptance === "review") return "user_confirmed";

  return "user_confirmed";
}

/** 从声明 + 可选模板构建可执行 worker；有磁盘 SKILL 时优先磁盘（design-intake） */
export async function resolveRunnableWorker(params: {
  skillPackName: string;
  workerId: string;
  session: RuntimeSession;
  blackboard: Blackboard;
  skillsRoot?: string;
}): Promise<{
  worker: ParsedWorkerSkill;
  promptBody: string;
  source: "disk" | "declaration";
}> {
  const root = params.skillsRoot ?? SKILLS_ROOT;
  try {
    const { loadWorkerSkillWithContext } = await import("./loader.js");
    const flowRaw = params.blackboard.getContentByTag("设计.创作流程");
    const currentStepName = params.blackboard.getContentByTag("创作.当前步骤");
    const selectedRecipeRef = params.blackboard.getContentByTag("创作.选用配方");
    const acceptedRaw =
      params.session.slots?.creationAcceptedUnits ??
      params.blackboard.getContentByTag("创作.已验收单位");
    const { parseAcceptedSteps, isInheritExistingFlag } = await import("./creation-flow.js");
    const withCtx = await loadWorkerSkillWithContext(
      params.skillPackName,
      params.workerId,
      root,
      {
        flowRaw,
        currentStepName,
        acceptedStepNames: parseAcceptedSteps(acceptedRaw),
        selectedRecipeRef,
        filledArtifactTags: params.blackboard.listTagIndex().map((item) => item.tag),
        inheritExisting: isInheritExistingFlag(
          params.blackboard.getContentByTag("创作.继承修改"),
        ),
      },
    );
    return {
      worker: withCtx.worker,
      promptBody: withCtx.promptBody,
      source: "disk",
    };
  } catch {
    // fall through to declaration
  }

  const raw = readWorkerSetYamlForDeclaration(params.blackboard, params.session);
  let parsed = raw ? parseWorkerSetYaml(raw.yaml) : null;
  // 用户编排的排序表优先：规格内 context_order → 独立 tag
  if (parsed && !parseContextOrder(parsed.context_order)) {
    const fromTag = parseContextOrder(
      params.blackboard.getContentByTag(CONTEXT_ORDER_TAG),
    );
    if (fromTag) parsed = { ...parsed, context_order: fromTag };
  }
  const entry = parsed?.workers.find(
    (w) => w.ref?.trim() === params.workerId.trim(),
  );
  if (!entry?.ref) {
    throw new Error(
      `未找到 worker「${params.workerId}」的磁盘 SKILL，且 设计.worker集 中无对应声明`,
    );
  }

  const template = await loadWorkerTemplate(
    params.skillPackName,
    entry.ref,
    root,
  );
  const built = buildDeclaredWorkerSkill({
    skillPackName: params.skillPackName,
    entry,
    template,
    workerSet: parsed,
  });
  return { ...built, source: "declaration" };
}

async function loadWorkerTemplate(
  skillPackName: string,
  workerId: string,
  skillsRoot: string,
): Promise<WorkerTemplateDoc | null> {
  const { loadSkill } = await import("./loader.js");
  let packRoot: string | undefined;
  try {
    const skill = await loadSkill(skillPackName, skillsRoot);
    packRoot = skill.skillPackRoot;
  } catch {
    return null;
  }
  if (!packRoot) return null;
  const file = path.join(
    skillsRoot,
    packRoot,
    "worker-templates",
    `${workerId}.yaml`,
  );
  try {
    const raw = await readFile(file, "utf8");
    const doc = parseYaml(raw) as WorkerTemplateDoc;
    return doc && typeof doc === "object" ? doc : null;
  } catch {
    return null;
  }
}

export function buildDeclaredWorkerSkill(params: {
  skillPackName: string;
  entry: WorkerSetEntry;
  template: WorkerTemplateDoc | null;
  workerSet: ParsedWorkerSet | null;
}): { worker: ParsedWorkerSkill; promptBody: string } {
  const id = params.entry.ref!.trim();
  const staticTags =
    params.entry.context?.static ??
    params.template?.suggested_context?.static ??
    ["设计.worker集", CONTEXT_BRIEF_TAG];
  const dynamicTags =
    params.entry.context?.dynamic ??
    params.template?.suggested_context?.dynamic ??
    ["用户.最新输入"];
  const outputTags =
    params.entry.outputs?.length
      ? params.entry.outputs
      : params.template?.suggested_outputs?.length
        ? params.template.suggested_outputs
        : ["输出.用户展示"];

  const resident = parseResidentContext(params.workerSet?.resident_context);
  const residentForWorker = entriesForWorker(resident, id);
  const residentStaticTags = residentForWorker
    .filter((e) => e.position !== "dynamic")
    .map(residentTagFor);
  const residentDynamicTags = residentForWorker
    .filter((e) => e.position === "dynamic")
    .map(residentTagFor);

  const duty =
    params.entry.duty?.trim() ||
    params.template?.duty?.trim() ||
    `执行 ${id}`;
  const excerpt = params.template?.prompt_excerpt?.trim() || "";
  const visibleBodyRule =
    id === "narrator" ||
    id === "round-present" ||
    (id === "world-simulator" && !isNarratorEnabled(params.workerSet?.play_slots))
      ? PLAY_VISIBLE_BODY_INSTRUCTION
      : "";
  const excerptWithRule = [excerpt, visibleBodyRule].filter(Boolean).join("\n\n");
  const presentation = params.entry.presentation
    ? JSON.stringify(params.entry.presentation, null, 2)
    : "";
  const narrative = params.workerSet?.narrative_guide?.trim() || "";
  const premises = (params.workerSet?.core_premises ?? []).filter(Boolean);
  const residentSection = formatResidentPromptSection(resident, id);

  const personaText = [duty, excerptWithRule].filter(Boolean).join("\n\n");
  const orderDoc = parseContextOrder(params.workerSet?.context_order);
  const orderSlot = slotOrderForRef(orderDoc, id);
  let contextSegments: ContextSegmentDef[] | undefined;
  if (orderSlot && orderSlot.inserts.length) {
    contextSegments = contextOrderToSegments({
      slot: orderSlot,
      personaText,
    });
  }

  const orderTags = (contextSegments ?? []).flatMap((s) => s.tags);
  const inputTags = [
    ...new Set([
      ...staticTags,
      ...residentStaticTags,
      ...dynamicTags,
      ...residentDynamicTags,
      ...orderTags,
      CONTEXT_BRIEF_TAG,
    ]),
  ];

  // 无 context_order 时：沿用模板 static→dynamic 两档 segments
  if (!contextSegments?.length) {
    contextSegments = [
      ...staticTags.map((tag, i) => ({
        id: `static-${i}`,
        tier: "static" as const,
        tags: [tag],
        label: `## ${tag}`,
      })),
      ...residentStaticTags.map((tag, i) => ({
        id: `resident-s-${i}`,
        tier: "static" as const,
        tags: [tag],
        label: `## ${tag}`,
      })),
      ...dynamicTags.map((tag, i) => ({
        id: `dynamic-${i}`,
        tier: "dynamic" as const,
        tags: [tag],
        label: `## ${tag}`,
      })),
      ...residentDynamicTags.map((tag, i) => ({
        id: `resident-d-${i}`,
        tier: "dynamic" as const,
        tags: [tag],
        label: `## ${tag}`,
      })),
    ];
  }

  const body = [
    `# ${params.template?.label ?? id}`,
    "",
    "## 角色与职责",
    "",
    duty,
    "",
    excerptWithRule ? `## 写法要点\n\n${excerptWithRule}` : "",
    presentation ? `## presentation（实例）\n\n\`\`\`json\n${presentation}\n\`\`\`` : "",
    narrative ? `## 叙事指南\n\n${narrative}` : "",
    premises.length
      ? `## 核心实现前提\n\n${premises.map((p) => `- ${p}`).join("\n")}`
      : "",
    residentSection,
    params.entry.rationale
      ? `## 为何需要本 worker\n\n${params.entry.rationale}`
      : "",
    "",
    "## 输出",
    "",
    `写入 outputTags：${outputTags.join("、")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const worker: ParsedWorkerSkill = {
    id,
    skill: params.skillPackName,
    name: params.template?.label ?? id,
    description: duty.slice(0, 200),
    version: 1,
    inputTags,
    outputTags,
    inputMerge: "latest",
    path: `declaration:${id}`,
    body,
    contextSegments,
  };

  const promptBody = [
    "（本 worker 由 设计.worker集 声明驱动，无独立磁盘 SKILL。）",
    "",
    body,
  ].join("\n");

  return { worker, promptBody };
}
