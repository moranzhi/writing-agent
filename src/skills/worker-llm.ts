import { getApiProfile, profileToLlmConfig } from "../config/api-profiles.js";
import {
  OpenAiCompatibleProvider,
  type LlmProvider,
} from "../llm/client.js";
import {
  wrapLlmForSession,
  type LlmTrackingRef,
} from "../llm/preset-wrapper.js";
import type { ParsedWorkerSkill, SkillWorkerLlmBindings } from "./types.js";

export type { LlmTrackingContext } from "../llm/token-tracker.js";

/** 按 ApiProfile.id 构建 LLM；找不到 profile 时回退 fallback */
export function createLlmForProfileId(
  profileId: string,
  fallback: LlmProvider,
  trackingRef?: LlmTrackingRef,
): LlmProvider {
  const profile = getApiProfile(profileId);
  if (!profile?.apiKey?.trim()) {
    return fallback;
  }

  return wrapLlmForSession(
    new OpenAiCompatibleProvider(profileToLlmConfig(profile)),
    trackingRef,
  );
}

/**
 * 解析 worker 应使用的 LLM。
 *
 * 优先级：
 * 1. worker SKILL frontmatter `llmProfileId`
 * 2. llm-bindings.yaml `workers[id].byRole[roleId]`（roleId 来自 slots.世界.当前角色.id）
 * 3. llm-bindings.yaml `workers[id].profileId`
 * 4. fallback（会话默认 profile，与总管相同）
 */
export function resolveWorkerLlmProvider(options: {
  worker: ParsedWorkerSkill;
  bindings?: SkillWorkerLlmBindings;
  slots: Record<string, unknown>;
  fallbackLlm: LlmProvider;
  trackingRef?: LlmTrackingRef;
}): LlmProvider {
  const { worker, bindings, slots, fallbackLlm, trackingRef } = options;

  if (worker.llmProfileId?.trim()) {
    return createLlmForProfileId(
      worker.llmProfileId.trim(),
      fallbackLlm,
      trackingRef,
    );
  }

  const workerBinding = bindings?.workers?.[worker.id];
  if (workerBinding?.byRole) {
    const roleId = slotString(slots, "世界.当前角色.id");
    if (roleId && workerBinding.byRole[roleId]?.trim()) {
      return createLlmForProfileId(
        workerBinding.byRole[roleId].trim(),
        fallbackLlm,
        trackingRef,
      );
    }
  }

  if (workerBinding?.profileId?.trim()) {
    return createLlmForProfileId(
      workerBinding.profileId.trim(),
      fallbackLlm,
      trackingRef,
    );
  }

  if (bindings?.defaultProfileId?.trim()) {
    return createLlmForProfileId(
      bindings.defaultProfileId.trim(),
      fallbackLlm,
      trackingRef,
    );
  }

  return fallbackLlm;
}

function slotString(slots: Record<string, unknown>, key: string): string | undefined {
  const val = slots[key];
  return typeof val === "string" && val.trim() ? val.trim() : undefined;
}

/** 角色 tag：仅用户可见 */
export const ROLE_USER_ONLY_SUFFIXES = [".思考", ".推理.候选"] as const;

/** 角色 tag：对其余角色 agent 可见（经 world-engine 公开） */
export const ROLE_AGENT_VISIBLE_SUFFIXES = [".行动", ".行动.候选"] as const;

export function isRoleUserOnlyTag(tag: string): boolean {
  return ROLE_USER_ONLY_SUFFIXES.some((s) => tag.endsWith(s));
}

export function isRoleAgentVisibleTag(tag: string): boolean {
  return ROLE_AGENT_VISIBLE_SUFFIXES.some((s) => tag.endsWith(s));
}

/**
 * 供 executor：角色 worker 只能看到当前角色的私有 tag。
 * 其他角色的思考永不可见；对方行动仅经 world-engine 分发后的可见信息/公开叙述获知。
 */
export function filterInputsForRolePerspective(
  inputs: Record<string, string>,
  slots: Record<string, unknown>,
): Record<string, string> {
  const roleId = slotString(slots, "世界.当前角色.id");
  if (!roleId) return inputs;

  const filtered: Record<string, string> = {};
  for (const [tag, content] of Object.entries(inputs)) {
    const rolePrefix = `角色.${roleId}.`;
    const otherRoleMatch = tag.match(/^角色\.([^.]+)\./);
    if (otherRoleMatch && otherRoleMatch[1] !== roleId) {
      continue;
    }
    if (tag.startsWith("角色.") && !tag.startsWith(rolePrefix)) {
      continue;
    }
    if (tag.startsWith(rolePrefix) && isRoleUserOnlyTag(tag)) {
      continue;
    }
    filtered[tag] = content;
  }
  return filtered;
}
