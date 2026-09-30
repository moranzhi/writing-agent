/**
 * 仓库内库种子 ↔ 用户数据目录库文件的导入/导出。
 * 导入：缺 id 才补，不覆盖用户已改同 id 正文。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPreferenceStore,
  savePreferenceStore,
  type PreferenceStoreFile,
} from "../preference/store.js";
import {
  loadStylePackStore,
  saveStylePackStore,
  type StylePackStoreFile,
} from "../style-pack/store.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const LIBRARY_SEED_DIR = path.join(ROOT, "seeds", "libraries");

function readJsonFile(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function isPreferenceStore(raw: unknown): raw is PreferenceStoreFile {
  return (
    !!raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as PreferenceStoreFile).version === 1 &&
    Array.isArray((raw as PreferenceStoreFile).entries)
  );
}

function isStylePackStore(raw: unknown): raw is StylePackStoreFile {
  return (
    !!raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as StylePackStoreFile).version === 1 &&
    Array.isArray((raw as StylePackStoreFile).entries)
  );
}

export function restoreLibrarySeedsFromRepo(): {
  preferencesAdded: number;
  stylePacksAdded: number;
} {
  const prefPath = path.join(LIBRARY_SEED_DIR, "preferences.json");
  const stylePath = path.join(LIBRARY_SEED_DIR, "style-packs.json");
  let preferencesAdded = 0;
  let stylePacksAdded = 0;

  if (existsSync(prefPath)) {
    const seed = readJsonFile(prefPath);
    if (isPreferenceStore(seed)) {
      const store = loadPreferenceStore();
      const have = new Set(store.entries.map((entry) => entry.id));
      for (const entry of seed.entries) {
        if (!entry.id || have.has(entry.id)) continue;
        store.entries.push(entry);
        have.add(entry.id);
        preferencesAdded += 1;
      }
      if (preferencesAdded) savePreferenceStore(store);
    }
  }

  if (existsSync(stylePath)) {
    const seed = readJsonFile(stylePath);
    if (isStylePackStore(seed)) {
      const store = loadStylePackStore();
      const have = new Set(store.entries.map((entry) => entry.id));
      for (const entry of seed.entries) {
        if (!entry.id || have.has(entry.id)) continue;
        store.entries.push(entry);
        have.add(entry.id);
        stylePacksAdded += 1;
      }
      if (stylePacksAdded) saveStylePackStore(store);
    }
  }

  return { preferencesAdded, stylePacksAdded };
}

export function exportLibrarySeedsToRepo(): {
  preferences: number;
  stylePacks: number;
} {
  mkdirSync(LIBRARY_SEED_DIR, { recursive: true });
  const preferences = loadPreferenceStore();
  const stylePacks = loadStylePackStore();
  writeFileSync(
    path.join(LIBRARY_SEED_DIR, "preferences.json"),
    `${JSON.stringify(preferences, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(LIBRARY_SEED_DIR, "style-packs.json"),
    `${JSON.stringify(stylePacks, null, 2)}\n`,
    "utf8",
  );
  return {
    preferences: preferences.entries.length,
    stylePacks: stylePacks.entries.length,
  };
}
