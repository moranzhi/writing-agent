import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getUserDataDir } from "../config/user-data-dir.js";

function cacheDir(): string {
  const dir = path.join(getUserDataDir(), "tts-cache");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function ttsCacheKey(parts: {
  provider: string;
  voice: string;
  text: string;
  extra?: string;
}): string {
  const h = createHash("sha256");
  h.update(parts.provider);
  h.update("\0");
  h.update(parts.voice);
  h.update("\0");
  h.update(parts.extra ?? "");
  h.update("\0");
  h.update(parts.text);
  return h.digest("hex").slice(0, 40);
}

export function readTtsCache(key: string, ext: string): Buffer | null {
  const file = path.join(cacheDir(), `${key}.${ext}`);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

export function writeTtsCache(key: string, ext: string, data: Buffer): void {
  const file = path.join(cacheDir(), `${key}.${ext}`);
  writeFileSync(file, data);
}
