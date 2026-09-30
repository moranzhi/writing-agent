import { randomUUID } from "node:crypto";
import type {
  GenerationParameters,
  PresetImportReport,
  PresetPackage,
  PresetPromptEntry,
  PresetPromptOrderItem,
  UnsupportedPresetSection,
} from "../types/preset.js";
import { applyExtendedMarkers } from "./markers.js";

type StPrompt = {
  identifier?: string;
  name?: string;
  enabled?: boolean;
  role?: string;
  content?: string;
  marker?: boolean;
  system_prompt?: boolean;
  injection_position?: number;
  injection_depth?: number;
  injection_order?: number;
  forbid_overrides?: boolean;
};

type StPromptOrderBlock = {
  character_id?: number;
  order?: Array<{ identifier: string; enabled: boolean }>;
};

type SillyTavernPreset = {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  openai_max_context?: number;
  openai_max_tokens?: number;
  stream_openai?: boolean;
  reasoning_effort?: string;
  verbosity?: string;
  seed?: number;
  n?: number;
  prompts?: StPrompt[];
  prompt_order?: StPromptOrderBlock[];
  regex_scripts?: unknown;
  extensions?: unknown;
  [key: string]: unknown;
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeRole(role: string | undefined): PresetPromptEntry["role"] {
  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }
  return "system";
}

function readGeneration(raw: SillyTavernPreset): GenerationParameters {
  return {
    temperature: raw.temperature,
    topP: raw.top_p,
    topK: raw.top_k,
    minP: raw.min_p,
    frequencyPenalty: raw.frequency_penalty,
    presencePenalty: raw.presence_penalty,
    repetitionPenalty: raw.repetition_penalty,
    maxContextTokens: raw.openai_max_context,
    maxOutputTokens: raw.openai_max_tokens,
    stream: raw.stream_openai,
    verbosity: raw.verbosity,
    seed: raw.seed !== undefined && raw.seed >= 0 ? raw.seed : undefined,
    variants: raw.n,
  };
}

function selectPromptOrder(
  raw: SillyTavernPreset,
  promptMap: Map<string, StPrompt>,
): StPromptOrderBlock {
  const orders = raw.prompt_order ?? [];
  if (orders.length === 0) return { order: [] };
  if (orders.length === 1) return orders[0];

  let best = orders[0];
  let bestScore = -1;
  for (const block of orders) {
    let score = 0;
    for (const item of block.order ?? []) {
      if (!item.enabled) continue;
      const prompt = promptMap.get(item.identifier);
      if (!prompt) continue;
      if (prompt.content?.trim()) score += 3;
      else if (prompt.marker) score += 0;
      else score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = block;
    }
  }
  return best;
}

function collectUnsupported(raw: SillyTavernPreset): UnsupportedPresetSection[] {
  const unsupported: UnsupportedPresetSection[] = [];
  if (raw.regex_scripts) {
    unsupported.push({
      path: "regex_scripts",
      reason: "第一版不支持正则脚本",
    });
  }
  if (raw.extensions) {
    unsupported.push({
      path: "extensions",
      reason: "第一版不支持扩展脚本",
    });
  }
  return unsupported;
}

export function importSillyTavernPreset(
  rawInput: unknown,
  options: { name?: string; id?: string } = {},
): PresetImportReport {
  const raw = rawInput as SillyTavernPreset;
  const warnings: string[] = [];
  const stPrompts = raw.prompts ?? [];
  const promptMap = new Map<string, StPrompt>();

  for (const p of stPrompts) {
    const id = p.identifier ?? randomUUID();
    if (promptMap.has(id)) {
      warnings.push(`重复 identifier: ${id}`);
    }
    promptMap.set(id, p);
  }

  const selectedOrder = selectPromptOrder(raw, promptMap);
  if ((raw.prompt_order?.length ?? 0) > 1) {
    warnings.push(
      `检测到 ${raw.prompt_order!.length} 套 prompt_order，已自动选用启用内容最多的一套 (character_id=${selectedOrder.character_id ?? "?"})`,
    );
  }

  const prompts: PresetPromptEntry[] = stPrompts.map((p) => {
    const sourceId = p.identifier ?? randomUUID();
    return {
      id: sourceId,
      name: p.name ?? sourceId,
      enabled: p.enabled !== false,
      role: normalizeRole(p.role),
      content: p.content ?? "",
      marker: Boolean(p.marker),
      sourceIdentifier: sourceId,
      injection: {
        position: p.injection_position,
        depth: p.injection_depth,
        order: p.injection_order,
      },
    };
  });

  const promptOrder: PresetPromptOrderItem[] = [];
  const missingIdentifiers: string[] = [];
  const orderItems = selectedOrder.order ?? [];

  orderItems.forEach((item, index) => {
    if (!promptMap.has(item.identifier)) {
      missingIdentifiers.push(item.identifier);
      return;
    }
    promptOrder.push({
      promptId: item.identifier,
      enabled: item.enabled,
      orderIndex: index,
    });
  });

  const generation = readGeneration(raw);
  const generationFields = Object.entries(generation)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);

  const presetName =
    options.name?.trim() ||
    (typeof rawInput === "object" &&
    rawInput &&
    "name" in rawInput &&
    typeof (rawInput as { name: unknown }).name === "string"
      ? (rawInput as { name: string }).name
      : "导入的预设");

  const preset: PresetPackage = applyExtendedMarkers({
    id: options.id ?? `${slugify(presetName) || "preset"}-${randomUUID().slice(0, 8)}`,
    name: presetName,
    source: "sillytavern",
    prompts,
    promptOrder,
    generation,
    unsupported: collectUnsupported(raw),
    importedAt: new Date().toISOString(),
    raw: rawInput,
  });

  const framedReferenced = new Set(preset.promptOrder.map((o) => o.promptId));
  const framedUnreferenced = preset.prompts.filter(
    (p) => !framedReferenced.has(p.id),
  ).length;
  const framedEnabled = preset.promptOrder.filter((o) => {
    if (!o.enabled) return false;
    const entry = preset.prompts.find((p) => p.id === o.promptId);
    return entry?.enabled !== false;
  }).length;

  return {
    preset,
    promptCount: preset.prompts.length,
    enabledCount: framedEnabled,
    unreferencedCount: framedUnreferenced,
    missingIdentifiers,
    generationFields,
    warnings,
  };
}
