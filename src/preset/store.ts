import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PresetPackage } from "../types/preset.js";
import { ensureUserDataDirs, getPresetsDir } from "../config/user-data-dir.js";
import { importSillyTavernPreset } from "./importer.js";

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
      const raw = readFileSync(path.join(getPresetsDir(), file), "utf8");
      presets.push(JSON.parse(raw) as PresetPackage);
    } catch {
      /* skip corrupt files */
    }
  }
  return presets.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function getPreset(id: string): PresetPackage | null {
  try {
    const raw = readFileSync(presetPath(id), "utf8");
    return JSON.parse(raw) as PresetPackage;
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
