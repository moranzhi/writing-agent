import type { BlackboardItem } from "../types/blackboard.js";
import type { RuntimeSession } from "../types/runtime.js";

/**
 * 判断黑板 tag 是否属于 run 阶段（非实例化确认稿）。
 * 实例快照保存/加载时会剥离这些 tag，只保留「实例化后的对象」。
 */
export function isRunPhaseBlackboardTag(tag: string): boolean {
  // 实例化层：保留
  if (/^角色\.[^.]+\.设定$/.test(tag)) return false;
  if (/^用户\./.test(tag)) return false;
  if (/^book\./.test(tag)) return false;
  if (/^情境\./.test(tag)) return false;
  if (/^博弈\./.test(tag)) return false;

  // run 层：剥离
  return (
    /^运行\./.test(tag) ||
    /^世界\.(当前|裁决)/.test(tag) ||
    /^场景\.公开/.test(tag) ||
    /^输出\./.test(tag) ||
    /^角色\.[^.]+\.(可见信息|思考|行动)$/.test(tag) ||
    /^review\./.test(tag)
  );
}

export function filterBlackboardForInstance(items: BlackboardItem[]): BlackboardItem[] {
  return items.filter((item) => !isRunPhaseBlackboardTag(item.tag));
}

/** 读档实例时：去掉 run 产物记录，清空 pending，便于从 instanceReady 重新开跑 */
export function prepareRuntimeSessionForInstance(session: RuntimeSession): RuntimeSession {
  const copy = structuredClone(session);
  copy.pendingArtifactId = undefined;
  copy.pendingDecision = undefined;
  copy.currentWorkerId = undefined;
  copy.waitingReason = undefined;
  copy.artifacts = copy.artifacts.filter((a) =>
    a.outputTags.every((tag) => !isRunPhaseBlackboardTag(tag)),
  );
  if (copy.phase === "done") copy.phase = "running";
  return copy;
}

export function materializeInstanceSnapshotPayload(payload: {
  runtimeSession: RuntimeSession;
  blackboardItems: BlackboardItem[];
}): { runtimeSession: RuntimeSession; blackboardItems: BlackboardItem[] } {
  return {
    blackboardItems: filterBlackboardForInstance(payload.blackboardItems),
    runtimeSession: prepareRuntimeSessionForInstance(payload.runtimeSession),
  };
}
