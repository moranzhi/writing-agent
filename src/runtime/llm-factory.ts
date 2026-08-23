import { profileToLlmConfig } from "../config/api-profiles.js";
import {
  ensureActiveProfileDefault,
  resolveActiveProfile,
} from "../config/settings.js";
import {
  createMockMainAgentResponse,
  MockLlmProvider,
  OpenAiCompatibleProvider,
  type LlmProvider,
} from "../llm/client.js";
import type { PresetPackage } from "../types/preset.js";
import {
  wrapLlmForSession,
  type LlmTrackingRef,
} from "../llm/preset-wrapper.js";

export type { LlmTrackingRef };

function buildInnerLlm(): LlmProvider {
  ensureActiveProfileDefault();
  const profile = resolveActiveProfile();

  if (profile?.apiKey?.trim()) {
    return new OpenAiCompatibleProvider(profileToLlmConfig(profile));
  }

  return new MockLlmProvider([
    createMockMainAgentResponse({
      action: "run_worker",
      reason: "信息已足够，建议运行 outline-worker 生成大纲。",
      workerId: "outline-worker",
      requiresApproval: true,
    }),
    createMockMainAgentResponse({
      action: "finish",
      reason: "创作流程结束",
      requiresApproval: false,
    }),
  ]);
}

/** Web/CLI 默认 LLM：本地 profile + 全局 preset + token 统计 */
export function createDefaultMainAgentLlm(
  trackingRef?: LlmTrackingRef,
): LlmProvider {
  return wrapLlmForSession(buildInnerLlm(), trackingRef);
}

export function hasRealLlmConfig(): boolean {
  ensureActiveProfileDefault();
  return Boolean(resolveActiveProfile()?.apiKey?.trim());
}

/** @deprecated 包装层下 instanceof 不可靠，请用 hasRealLlmConfig */
export function isMockLlm(_llm: LlmProvider): boolean {
  return !hasRealLlmConfig();
}

/** 设置页切换 profile / preset 后调用，返回新 LLM 实例 */
export function reloadDefaultMainAgentLlm(
  trackingRef?: LlmTrackingRef,
): LlmProvider {
  return createDefaultMainAgentLlm(trackingRef);
}

/** 试跑指定预设：生成参数跟这条预设走，不依赖当前选用。 */
export function createLlmForPreset(preset: PresetPackage): LlmProvider {
  return wrapLlmForSession(buildInnerLlm(), undefined, () => preset);
}
