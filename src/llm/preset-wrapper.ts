import { loadAppSettings } from "../config/settings.js";
import { resolveActivePreset } from "../preset/store.js";
import type { PresetPackage } from "../types/preset.js";
import type {
  ChatMessage,
  CompleteOptions,
  CompleteResult,
  CompleteWithToolsOptions,
  CompleteWithToolsResult,
  LlmProvider,
  StreamCallbacks,
} from "./client.js";
import {
  TokenTrackingProvider,
  type LlmTrackingContext,
} from "./token-tracker.js";

export type LlmTrackingRef = { current: LlmTrackingContext };

function readActivePreset(): PresetPackage | null {
  return resolveActivePreset(loadAppSettings().activePresetId);
}

/**
 * 统计在内、预设在外：痕迹里的 messages / generation 就是发给模型的那一份。
 * 当前没有选用预设时仍包一层，请求原样转发。
 */
export function wrapLlmForSession(
  inner: LlmProvider,
  trackingRef?: LlmTrackingRef,
  getPreset: () => PresetPackage | null = readActivePreset,
): LlmProvider {
  const tracked = trackingRef
    ? new TokenTrackingProvider(inner, () => trackingRef.current)
    : inner;
  return new PresetLlmProvider(tracked, getPreset);
}

/**
 * 在所有 LLM 请求上合并当前 preset 的生成参数。
 * prompt / marker 不在此前置，由 play worker 按扩展 prompt_order 填洞。
 */
export class PresetLlmProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly getPreset: () => PresetPackage | null,
  ) {}

  private prepare(
    messages: ChatMessage[],
    options?: CompleteOptions,
  ): { messages: ChatMessage[]; options: CompleteOptions | undefined } {
    const preset = this.getPreset();
    if (!preset) return { messages, options };
    // 生成参数全局合并；prompt/marker 只在 play worker 按 prompt_order 填洞，这里不再前置。
    return {
      messages,
      options: {
        ...options,
        generation: options?.generation ?? preset.generation,
      },
    };
  }

  async complete(
    messages: ChatMessage[],
    options?: CompleteOptions,
  ): Promise<CompleteResult> {
    const prepared = this.prepare(messages, options);
    return this.inner.complete(prepared.messages, prepared.options);
  }

  async completeStream(
    messages: ChatMessage[],
    options?: CompleteOptions,
    callbacks: StreamCallbacks = {},
  ): Promise<CompleteResult> {
    if (!this.inner.completeStream) {
      const result = await this.complete(messages, options);
      if (result.reasoning) callbacks.onReasoningDelta?.(result.reasoning);
      if (result.content) callbacks.onContentDelta?.(result.content);
      return result;
    }
    const prepared = this.prepare(messages, options);
    return this.inner.completeStream(
      prepared.messages,
      prepared.options,
      callbacks,
    );
  }

  async completeWithTools(
    messages: ChatMessage[],
    options: CompleteWithToolsOptions,
  ): Promise<CompleteWithToolsResult> {
    const prepared = this.prepare(messages, options);
    return this.inner.completeWithTools(prepared.messages, {
      ...options,
      ...prepared.options,
    });
  }

  async completeWithToolsStream(
    messages: ChatMessage[],
    options: CompleteWithToolsOptions,
    callbacks: StreamCallbacks,
  ): Promise<CompleteWithToolsResult> {
    if (!this.inner.completeWithToolsStream) {
      return this.completeWithTools(messages, options);
    }
    const prepared = this.prepare(messages, options);
    return this.inner.completeWithToolsStream(
      prepared.messages,
      { ...options, ...prepared.options },
      callbacks,
    );
  }
}
