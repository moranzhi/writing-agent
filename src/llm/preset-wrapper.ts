import { assemblePresetMessages, mergeMessages } from "../preset/assembler.js";
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

/**
 * 在所有 LLM 请求前注入当前 preset 的 prompt 片段与生成参数。
 */
export class PresetLlmProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly getPreset: () => PresetPackage | null,
  ) {}

  async complete(
    messages: ChatMessage[],
    options?: CompleteOptions,
  ): Promise<CompleteResult> {
    const preset = this.getPreset();
    if (!preset) {
      return this.inner.complete(messages, options);
    }

    const presetMessages = assemblePresetMessages(preset);
    const merged = mergeMessages(presetMessages, messages);
    const generation = options?.generation ?? preset.generation;

    return this.inner.complete(merged, {
      ...options,
      generation,
    });
  }

  async completeWithTools(
    messages: ChatMessage[],
    options: CompleteWithToolsOptions,
  ): Promise<CompleteWithToolsResult> {
    const preset = this.getPreset();
    if (!preset) {
      return this.inner.completeWithTools(messages, options);
    }

    const presetMessages = assemblePresetMessages(preset);
    const merged = mergeMessages(presetMessages, messages);
    const generation = options.generation ?? preset.generation;

    return this.inner.completeWithTools(merged, {
      ...options,
      generation,
    });
  }

  async completeWithToolsStream(
    messages: ChatMessage[],
    options: CompleteWithToolsOptions,
    callbacks: StreamCallbacks,
  ): Promise<CompleteWithToolsResult> {
    const preset = this.getPreset();
    if (!this.inner.completeWithToolsStream) {
      return this.completeWithTools(messages, options);
    }
    const presetMessages = preset ? assemblePresetMessages(preset) : [];
    const merged = preset ? mergeMessages(presetMessages, messages) : messages;
    const generation = options.generation ?? preset?.generation;

    return this.inner.completeWithToolsStream(merged, {
      ...options,
      generation,
    }, callbacks);
  }
}
