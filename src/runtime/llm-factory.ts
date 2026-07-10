import { profileToLlmConfig } from "../config/api-profiles.js";
import {
  ensureActiveProfileDefault,
  loadAppSettings,
  resolveActiveProfile,
} from "../config/settings.js";
import { resolveActivePreset } from "../preset/store.js";
import {
  createMockMainAgentResponse,
  MockLlmProvider,
  OpenAiCompatibleProvider,
  type LlmProvider,
} from "../llm/client.js";
import { PresetLlmProvider } from "../llm/preset-wrapper.js";
import {
  TokenTrackingProvider,
  type LlmTrackingContext,
} from "../llm/token-tracker.js";

export type LlmTrackingRef = { current: LlmTrackingContext };

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

function wrapWithPreset(inner: LlmProvider): LlmProvider {
  const settings = loadAppSettings();
  const preset = resolveActivePreset(settings.activePresetId);
  if (!preset) return inner;
  return new PresetLlmProvider(inner, () =>
    resolveActivePreset(loadAppSettings().activePresetId),
  );
}

/** Web/CLI 默认 LLM：本地 profile + 全局 preset + token 统计 */
export function createDefaultMainAgentLlm(
  trackingRef?: LlmTrackingRef,
): LlmProvider {
  const llm = wrapWithPreset(buildInnerLlm());
  if (!trackingRef) return llm;
  return new TokenTrackingProvider(llm, () => trackingRef.current);
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
