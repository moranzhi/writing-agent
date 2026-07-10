export type PresetPromptRole = "system" | "user" | "assistant";

export type PresetPromptEntry = {
  id: string;
  name: string;
  enabled: boolean;
  role: PresetPromptRole;
  content: string;
  marker: boolean;
  sourceIdentifier: string;
  injection?: {
    position?: number;
    depth?: number;
    order?: number;
  };
};

export type PresetPromptOrderItem = {
  promptId: string;
  enabled: boolean;
  orderIndex: number;
};

export type GenerationParameters = {
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  stream?: boolean;
  reasoningEffort?: string;
  verbosity?: string;
  seed?: number;
  variants?: number;
};

export type UnsupportedPresetSection = {
  path: string;
  reason: string;
};

export type PresetPackage = {
  id: string;
  name: string;
  source: "native" | "sillytavern";
  prompts: PresetPromptEntry[];
  promptOrder: PresetPromptOrderItem[];
  generation: GenerationParameters;
  unsupported: UnsupportedPresetSection[];
  importedAt: string;
  raw?: unknown;
};

export type PresetImportReport = {
  preset: PresetPackage;
  promptCount: number;
  enabledCount: number;
  unreferencedCount: number;
  missingIdentifiers: string[];
  generationFields: string[];
  warnings: string[];
};
