import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PresetPackage } from "../types/preset.js";
import { ensureUserDataDirs, getPresetsDir } from "../config/user-data-dir.js";
import { importSillyTavernPreset } from "./importer.js";

/** 旧预设里的思考强度不再使用；读到就从文件里删掉。 */
function withoutReasoningEffort(preset: PresetPackage, filePath: string): PresetPackage {
  if (preset.generation?.reasoningEffort === undefined) return preset;
  const generation = { ...preset.generation };
  delete generation.reasoningEffort;
  const next = { ...preset, generation };
  writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function presetPath(id: string): string {
  return path.join(getPresetsDir(), `${id}.json`);
}

export function listPresets(): PresetPackage[] {
  ensureUserDataDirs();
  let files: string[];
  try {
    files = readdirSync(getPresetsDir()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const presets: PresetPackage[] = [];
  for (const file of files) {
    try {
      const filePath = path.join(getPresetsDir(), file);
      const raw = readFileSync(filePath, "utf8");
      presets.push(withoutReasoningEffort(JSON.parse(raw) as PresetPackage, filePath));
    } catch {
      /* skip corrupt files */
    }
  }
  return presets.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function getPreset(id: string): PresetPackage | null {
  try {
    const filePath = presetPath(id);
    const raw = readFileSync(filePath, "utf8");
    return withoutReasoningEffort(JSON.parse(raw) as PresetPackage, filePath);
  } catch {
    return null;
  }
}

export function savePreset(preset: PresetPackage): PresetPackage {
  ensureUserDataDirs();
  writeFileSync(presetPath(preset.id), JSON.stringify(preset, null, 2), "utf8");
  return preset;
}

export function deletePreset(id: string): void {
  try {
    unlinkSync(presetPath(id));
  } catch {
    /* ignore */
  }
}

export function importAndSavePreset(
  raw: unknown,
  options: { name?: string } = {},
) {
  const report = importSillyTavernPreset(raw, options);
  savePreset(report.preset);
  return report;
}

export function resolveActivePreset(activePresetId: string | null): PresetPackage | null {
  if (!activePresetId) return null;
  return getPreset(activePresetId);
}
