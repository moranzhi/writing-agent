import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LIBRARY_SEED_DIR,
  restoreLibrarySeedsFromRepo,
} from "../src/libraries/seed-backup.js";
import {
  listActivePreferences,
  loadPreferenceStore,
  savePreferenceStore,
} from "../src/preference/store.js";

const originalUserData = process.env.WRITING_AGENT_DATA_DIR;

describe("library seed backup", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "wa-lib-seed-"));
    process.env.WRITING_AGENT_DATA_DIR = tempDir;
  });

  afterEach(() => {
    if (originalUserData === undefined) {
      delete process.env.WRITING_AGENT_DATA_DIR;
    } else {
      process.env.WRITING_AGENT_DATA_DIR = originalUserData;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("restores missing preference ids from repo seeds without overwriting", () => {
    savePreferenceStore({
      version: 1,
      entries: [
        {
          id: "starter-no-user-ntr-victim",
          content: "用户已改过的正文",
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const result = restoreLibrarySeedsFromRepo();
    expect(result.preferencesAdded).toBeGreaterThanOrEqual(1);

    const store = loadPreferenceStore();
    const kept = store.entries.find((e) => e.id === "starter-no-user-ntr-victim");
    expect(kept?.content).toBe("用户已改过的正文");
    expect(
      store.entries.some((e) => e.id === "starter-default-male-hetero-yuri-ok"),
    ).toBe(true);
    expect(listActivePreferences().length).toBeGreaterThanOrEqual(2);
  });

  it("keeps seed files in the repository libraries directory", () => {
    const prefSeed = path.join(LIBRARY_SEED_DIR, "preferences.json");
    const raw = JSON.parse(readFileSync(prefSeed, "utf8")) as {
      version: number;
      entries: Array<{ id: string }>;
    };
    expect(raw.version).toBe(1);
    expect(raw.entries.some((e) => e.id === "starter-no-user-ntr-victim")).toBe(
      true,
    );
  });
});