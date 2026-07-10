import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** 本地用户数据目录（不进 git、不同步） */
export function getUserDataDir(): string {
  if (process.env.WRITING_AGENT_DATA_DIR) {
    return path.resolve(process.env.WRITING_AGENT_DATA_DIR);
  }
  return path.join(os.homedir(), ".writing-agent");
}

export function getPresetsDir(): string {
  return path.join(getUserDataDir(), "presets");
}

export function getBooksDir(): string {
  return path.join(getUserDataDir(), "books");
}

export function ensureUserDataDirs(): void {
  mkdirSync(getPresetsDir(), { recursive: true });
  mkdirSync(getBooksDir(), { recursive: true });
  mkdirSync(path.join(getUserDataDir(), "stats"), { recursive: true });
}
