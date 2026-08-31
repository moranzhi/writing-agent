import type { Blackboard } from "../blackboard/blackboard.js";
import type { RuntimeSession } from "../types/runtime.js";
import { isPlayLayerActive } from "./play-turn.js";
import {
  SLOT_CREATION_ACCEPTED_UNITS,
  parseAcceptedUnits,
} from "./creation-units.js";
import {
  isCloserStepRef,
  SLOT_CREATION_SEALED_BY_OPENING,
} from "./opening-seal.js";
import {
  deriveDesignStageScope,
  deriveOnDemandWorkerScope,
  deriveRunWorkerScope,
  parseWorkerSetYaml,
  runWorkerMeta,
  type ParsedWorkerSet,
} from "./worker-set-parse.js";

export type LifecycleStage = "design" | "play";

/** 实例 Worker 声明：由创作阶段 设计.worker集 动态定义，play 只调度声明内的 id */
export type InstanceWorkerDeclaration = {
  /** 声明正文来源 tag；null 表示尚无 Worker 集 */
  sourceTag: "设计.worker集" | "设计.worker集.草稿" | null;
  /** Worker 集是否已通过用户验收 */
  accepted: boolean;
  parsed: ParsedWorkerSet | null;
  /** 当前 lifecycle 下总管可 run_worker 的 id 列表 */
  activeWorkerIds: string[];
  /** play 阶段声明（deriveRunWorkerScope；每轮管线） */
  playWorkerIds: string[];
  /** play 按需调度（chance 等；不进自动回合序） */
  onDemandWorkerIds: string[];
  /** 创作末尾声明（如 opening-generator） */
  designEndWorkerIds: string[];
};

const WORKER_SET_ACCEPTED_TAG = "设计.worker集";
const WORKER_SET_DRAFT_TAG = "设计.worker集.草稿";

export function hasAcceptedWorkerSet(session: RuntimeSession): boolean {
  if (Boolean(session.slots.designInstanceReady)) return true;
  return session.artifacts.some(
    (a) =>
      a.status === "accepted" &&
      a.outputTags.some((tag) => tag === WORKER_SET_ACCEPTED_TAG),
  );
}

function hasAcceptedCloser(session: RuntimeSession): boolean {
  if (Boolean(session.slots[SLOT_CREATION_SEALED_BY_OPENING])) return true;
  const accepted = parseAcceptedUnits(session.slots[SLOT_CREATION_ACCEPTED_UNITS]);
  return accepted.some((id) => isCloserStepRef(id));
}

export function canEnterPlay(session: RuntimeSession): boolean {
  return hasAcceptedWorkerSet(session) || hasAcceptedCloser(session);
}

export function inferLifecycleStage(session: RuntimeSession): LifecycleStage {
  if (!canEnterPlay(session)) return "design";
  if (session.slots.uiLifecycleStage === "play") return "play";
  if (isPlayLayerActive(session.slots)) return "play";
  return "design";
}

/** 读取用于构建声明的 Worker 集 YAML */
export function readWorkerSetYamlForDeclaration(
  blackboard: Blackboard,
  session: RuntimeSession,
): { yaml: string; sourceTag: InstanceWorkerDeclaration["sourceTag"] } | null {
  const accepted = blackboard.getContentByTag(WORKER_SET_ACCEPTED_TAG)?.trim();
  const draft = blackboard.getContentByTag(WORKER_SET_DRAFT_TAG)?.trim();
  const workerSetAccepted = hasAcceptedWorkerSet(session);

  if (workerSetAccepted && accepted) {
    return { yaml: accepted, sourceTag: WORKER_SET_ACCEPTED_TAG };
  }
  if (draft) {
    return { yaml: draft, sourceTag: WORKER_SET_DRAFT_TAG };
  }
  if (accepted) {
    return { yaml: accepted, sourceTag: WORKER_SET_ACCEPTED_TAG };
  }
  return null;
}

/**
 * 构建实例 Worker 声明。
 * world-simulator：play 仅 activeWorkerIds；design 验收前为分步 design-*。
 */
export function buildInstanceWorkerDeclaration(
  session: RuntimeSession,
  blackboard: Blackboard,
  lifecycle: LifecycleStage = inferLifecycleStage(session),
): InstanceWorkerDeclaration {
  const accepted = hasAcceptedWorkerSet(session);
  const raw = readWorkerSetYamlForDeclaration(blackboard, session);
  const parsed = raw ? parseWorkerSetYaml(raw.yaml) : null;
  const playWorkerIds = accepted && parsed ? deriveRunWorkerScope(parsed) : [];
  const onDemandWorkerIds =
    accepted && parsed ? deriveOnDemandWorkerScope(parsed) : [];
  const designEndWorkerIds =
    accepted && parsed ? deriveDesignStageScope(parsed) : [];

  const designStepIds = ["design-flow", "design-step"];

  let activeWorkerIds: string[];

  if (lifecycle === "play") {
    activeWorkerIds = [...playWorkerIds, ...onDemandWorkerIds];
    const seen = new Set<string>();
    activeWorkerIds = activeWorkerIds.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  } else if (!accepted) {
    activeWorkerIds = [...designStepIds];
  } else {
    activeWorkerIds = [...designStepIds, ...designEndWorkerIds];
    // 去重保序
    const seen = new Set<string>();
    activeWorkerIds = activeWorkerIds.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  return {
    sourceTag: raw?.sourceTag ?? null,
    accepted,
    parsed,
    activeWorkerIds,
    playWorkerIds,
    onDemandWorkerIds,
    designEndWorkerIds,
  };
}

export function isWorkerDeclared(
  declaration: InstanceWorkerDeclaration,
  workerId: string,
): boolean {
  const id = workerId.trim();
  return declaration.activeWorkerIds.includes(id);
}

export function formatUndeclaredWorkerError(
  workerId: string,
  declaration: InstanceWorkerDeclaration,
): string {
  const allowed =
    declaration.activeWorkerIds.length > 0
      ? declaration.activeWorkerIds.join("、")
      : "（尚无）";
  return (
    `Worker「${workerId}」不在本实例声明内。` +
    `当前可调度：${allowed}。` +
    (declaration.accepted
      ? " play 阶段仅允许 设计.worker集 中 ref 列出的 Worker。"
      : " 请先完成 design-flow → design-step，并验收终稿 Worker 集。")
  );
}

/** 合并磁盘已安装 SKILL 与声明中的 gap id（供 list_workers 展示） */
export function mergeDeclaredWorkersForAgent(
  installed: Array<{ id: string; description: string }>,
  declaration: InstanceWorkerDeclaration,
): Array<{ id: string; description: string }> {
  const byId = new Map(installed.map((w) => [w.id, w]));
  const out: Array<{ id: string; description: string }> = [];

  for (const id of declaration.activeWorkerIds) {
    const found = byId.get(id);
    if (found) {
      out.push(found);
    } else {
      const meta = runWorkerMeta(id);
      out.push({
        id,
        description: `[声明已启用 · SKILL 待补] ${meta.purpose}`,
      });
    }
  }
  return out;
}

export function shouldEnforceWorkerDeclaration(skillPackName?: string): boolean {
  return skillPackName === "world-simulator";
}
