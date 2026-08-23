import type { RuntimeSession } from "../types/runtime.js";
import {
  deriveDesignStageScope,
  deriveRunWorkerScope,
  instantiateMeta,
  parseWorkerSetYaml,
  runWorkerMeta,
} from "../skills/worker-set-parse.js";
import {
  canEnterPlay,
  hasAcceptedWorkerSet,
  inferLifecycleStage,
  type LifecycleStage,
} from "../skills/worker-declaration.js";

export type { LifecycleStage };
export { canEnterPlay, hasAcceptedWorkerSet, inferLifecycleStage };

export type SkillCatalogEntry = {
  id: string;
  stage: "design" | "run";
  label: string;
  /** 这一步要干嘛（占位说明，详细设计后续补充） */
  purpose: string;
  status: "pending" | "active" | "done" | "skipped";
  /** 同一 skill 被 invoke 的次数（design 阶段 instantiate 可多次） */
  runCount?: number;
};

type CatalogTemplate = {
  id: string;
  stage: "design" | "run";
  label: string;
  purpose: string;
};

export type BuildSkillCatalogOptions = {
  /** `设计.worker集` 或 `.草稿` 的 YAML 正文 */
  workerSetYaml?: string;
};

function templatesFor(_skillPackId?: string): CatalogTemplate[] {
  return [];
}

type ArtifactRunStats = {
  total: number;
  accepted: number;
  pending: number;
  rejected: number;
};

function collectArtifactRuns(session: RuntimeSession): Map<string, ArtifactRunStats> {
  const map = new Map<string, ArtifactRunStats>();
  for (const art of session.artifacts) {
    if (!art.workerId) continue;
    const prev = map.get(art.workerId) ?? {
      total: 0,
      accepted: 0,
      pending: 0,
      rejected: 0,
    };
    prev.total += 1;
    if (art.status === "accepted") prev.accepted += 1;
    else if (art.status === "rejected") prev.rejected += 1;
    else prev.pending += 1;
    map.set(art.workerId, prev);
  }
  return map;
}

function statusForWorkerId(
  id: string,
  session: RuntimeSession,
  runs: Map<string, ArtifactRunStats>,
  skipped: Set<string>,
): SkillCatalogEntry["status"] {
  if (skipped.has(id)) return "skipped";
  const stats = runs.get(id);
  if (stats?.accepted) return "done";
  if (session.currentWorkerId === id) return "active";
  if (stats?.pending) return "active";
  return "pending";
}

function buildWorldSimulatorCatalog(
  session: RuntimeSession,
  lifecycle: LifecycleStage,
  workerSetYaml?: string,
): SkillCatalogEntry[] {
  const workerSet = parseWorkerSetYaml(workerSetYaml);
  const runs = collectArtifactRuns(session);
  const skipped = new Set(workerSet?.instantiate_hints?.skip ?? []);

  if (lifecycle === "play") {
    const runIds = deriveRunWorkerScope(workerSet);
    const entries: SkillCatalogEntry[] = [
      {
        id: "agent-burst",
        stage: "run",
        label: "总管调度",
        purpose: "总管 tool loop：读黑板 → 选择下一步 Worker。",
        status:
          session.phase === "running" && !session.currentWorkerId
            ? "active"
            : "pending",
      },
    ];

    for (const id of runIds) {
      const meta = runWorkerMeta(id);
      const stats = runs.get(id);
      entries.push({
        id,
        stage: "run",
        label: meta.label,
        purpose: meta.purpose,
        status: statusForWorkerId(id, session, runs, new Set()),
        runCount: stats?.total || undefined,
      });
    }
    return entries;
  }

  const designSteps: Array<{ id: string; label: string; purpose: string }> = [
    {
      id: "design-flow",
      label: "创作 · 流程编排",
      purpose: "编排/增量修订可变 DAG → 设计.创作流程（可反复编入同能力）。",
    },
    {
      id: "design-step",
      label: "创作 · 执行步骤",
      purpose: "按已认可流程执行当前一步模块。",
    },
  ];

  const entries: SkillCatalogEntry[] = designSteps.map((step) => ({
    id: step.id,
    stage: "design" as const,
    label: step.label,
    purpose: step.purpose,
    status: statusForWorkerId(step.id, session, runs, skipped),
    runCount: runs.get(step.id)?.total || undefined,
  }));

  const planned = deriveDesignStageScope(workerSet);
  for (const id of planned) {
    const meta = instantiateMeta(id);
    const stats = runs.get(id);
    entries.push({
      id,
      stage: "design",
      label: meta.label,
      purpose: meta.purpose,
      status: statusForWorkerId(id, session, runs, skipped),
      runCount: stats?.total || undefined,
    });
  }

  const designIds = new Set(designSteps.map((s) => s.id));
  for (const [id, stats] of runs) {
    if (designIds.has(id) || id === "design-intake") continue;
    if (planned.includes(id) || skipped.has(id)) continue;
    const meta = instantiateMeta(id);
    entries.push({
      id,
      stage: "design",
      label: meta.label,
      purpose: meta.purpose,
      status: statusForWorkerId(id, session, runs, skipped),
      runCount: stats.total || undefined,
    });
  }

  entries.push({
    id: "declare-ready",
    stage: "design",
    label: "实例就绪",
    purpose: "Worker 集已 accept 即可进游玩；若走了开场白终节点，选定后会自动保存定稿。",
    status: hasAcceptedWorkerSet(session) ? "done" : "pending",
  });

  return entries;
}

export function buildSkillCatalog(
  session: RuntimeSession,
  skillPackId?: string,
  lifecycle: LifecycleStage = inferLifecycleStage(session),
  options?: BuildSkillCatalogOptions,
): SkillCatalogEntry[] {
  if (skillPackId === "world-simulator") {
    return buildWorldSimulatorCatalog(session, lifecycle, options?.workerSetYaml);
  }

  const templates = templatesFor(skillPackId);
  const filtered = templates.filter((t) =>
    lifecycle === "design" ? t.stage === "design" : t.stage === "run",
  );

  const runs = collectArtifactRuns(session);

  return filtered.map((t) => {
    let status: SkillCatalogEntry["status"] = "pending";

    if (t.id === "intake") {
      if (session.slots.startupCompleted) status = "done";
      else if (
        session.waitingReason?.kind === "intake" ||
        session.waitingReason?.kind === "input"
      ) {
        status = "active";
      }
    } else if (t.id === "declare-ready") {
      if (session.slots.startupCompleted || hasAcceptedWorkerSet(session)) {
        status = "done";
      }
    } else if (t.id === "agent-burst") {
      if (session.phase === "running" && !session.currentWorkerId) {
        status = "active";
      }
    } else if (runs.has(t.id)) {
      status = statusForWorkerId(t.id, session, runs, new Set());
    } else if (session.currentWorkerId === t.id) {
      status = "active";
    }

    const runCount = runs.get(t.id)?.total;
    return {
      ...t,
      status,
      runCount: runCount || undefined,
    };
  });
}

export const TOOL_LOOP_BURST_MAX = 12;
