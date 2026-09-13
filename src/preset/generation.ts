import type { GenerationParameters, PresetPackage } from "../types/preset.js";
import { savePreset } from "./store.js";

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * 从表单 / API 体归一化 generation：空字段省略（等于清除）。
 * 整对象替换，不做与旧值的字段级合并。
 */
export function normalizeGeneration(
  input: unknown,
): GenerationParameters {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const raw = input as Record<string, unknown>;
  const out: GenerationParameters = {};

  const temperature = finiteNumber(raw.temperature);
  if (temperature !== undefined) out.temperature = temperature;

  const topP = finiteNumber(raw.topP);
  if (topP !== undefined) out.topP = topP;

  const topK = finiteNumber(raw.topK);
  if (topK !== undefined) out.topK = topK;

  const minP = finiteNumber(raw.minP);
  if (minP !== undefined) out.minP = minP;

  const frequencyPenalty = finiteNumber(raw.frequencyPenalty);
  if (frequencyPenalty !== undefined) out.frequencyPenalty = frequencyPenalty;

  const presencePenalty = finiteNumber(raw.presencePenalty);
  if (presencePenalty !== undefined) out.presencePenalty = presencePenalty;

  const repetitionPenalty = finiteNumber(raw.repetitionPenalty);
  if (repetitionPenalty !== undefined) {
    out.repetitionPenalty = repetitionPenalty;
  }

  const maxContextTokens = finiteNumber(raw.maxContextTokens);
  if (maxContextTokens !== undefined) out.maxContextTokens = maxContextTokens;

  const maxOutputTokens = finiteNumber(raw.maxOutputTokens);
  if (maxOutputTokens !== undefined) out.maxOutputTokens = maxOutputTokens;

  if (typeof raw.stream === "boolean") out.stream = raw.stream;

  const reasoningEffort = optionalString(raw.reasoningEffort);
  if (reasoningEffort !== undefined) out.reasoningEffort = reasoningEffort;

  const verbosity = optionalString(raw.verbosity);
  if (verbosity !== undefined) out.verbosity = verbosity;

  const seed = finiteNumber(raw.seed);
  if (seed !== undefined) out.seed = seed;

  const variants = finiteNumber(raw.variants);
  if (variants !== undefined) out.variants = variants;

  return out;
}

export function applyPresetGeneration(
  preset: PresetPackage,
  generation: unknown,
): PresetPackage {
  return {
    ...preset,
    generation: normalizeGeneration(generation),
  };
}

export function patchPresetGeneration(
  preset: PresetPackage,
  generation: unknown,
): PresetPackage {
  return savePreset(applyPresetGeneration(preset, generation));
}
