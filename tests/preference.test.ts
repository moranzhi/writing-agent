import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Blackboard } from "../src/blackboard/blackboard.js";

describe("preference store", () => {
  beforeEach(() => {
    process.env.WRITING_AGENT_DATA_DIR = mkdtempSync(
      path.join(tmpdir(), "wa-pref-"),
    );
  });

  it("seeds starter preferences on empty store", async () => {
    const {
      STARTER_PREFERENCES,
      ensureStarterPreferences,
      listActivePreferences,
      loadPreferenceStore,
    } = await import("../src/preference/store.js");

    const seeded = loadPreferenceStore();
    expect(seeded.entries.length).toBe(STARTER_PREFERENCES.length);
    expect(listActivePreferences().map((e) => e.id).sort()).toEqual(
      STARTER_PREFERENCES.map((s) => s.id).sort(),
    );
    ensureStarterPreferences();
    expect(listActivePreferences()).toHaveLength(STARTER_PREFERENCES.length);
    expect(
      listActivePreferences().some((e) => e.content.includes("被 NTR")),
    ).toBe(true);
    expect(
      listActivePreferences().some((e) => e.content.includes("男同性恋")),
    ).toBe(true);
  });

  it("creates, lists, archives, and deletes custom entries", async () => {
    const {
      STARTER_PREFERENCES,
      createPreference,
      listActivePreferences,
      listPreferences,
      updatePreference,
      deletePreference,
      loadPreferenceStore,
    } = await import("../src/preference/store.js");

    loadPreferenceStore();
    const starterCount = STARTER_PREFERENCES.length;
    const a = createPreference({
      content: "关系线保持专一；不写出轨已成。",
    });
    expect(listActivePreferences()).toHaveLength(starterCount + 1);
    updatePreference(a.id, { status: "archived" });
    expect(listActivePreferences()).toHaveLength(starterCount);
    expect(listPreferences()).toHaveLength(starterCount + 1);
    deletePreference(a.id);
    expect(listPreferences()).toHaveLength(starterCount);
  });
});

describe("user constraints", () => {
  beforeEach(() => {
    process.env.WRITING_AGENT_DATA_DIR = mkdtempSync(
      path.join(tmpdir(), "wa-pref-c-"),
    );
  });

  it("builds full dump and mounts into play spec", async () => {
    const {
      STARTER_PREFERENCES,
      createPreference,
      loadPreferenceStore,
    } = await import("../src/preference/store.js");
    const {
      USER_CONSTRAINTS_TAG,
      buildUserConstraintsContent,
      applyUserConstraintsToPlaySpec,
    } = await import("../src/preference/constraints.js");

    loadPreferenceStore();
    createPreference({ content: "不要反复报精确数字；用量感与约数。" });
    createPreference({ content: "推进偏慢；每轮只推进一个小决定点。" });

    const body = buildUserConstraintsContent();
    expect(body).toContain("【用户约束】");
    expect(body).toContain("精确数字");
    expect(body).toContain("推进偏慢");
    expect(body).toContain("被 NTR");

    const board = new Blackboard();
    board.write({
      tag: "设计.worker集",
      content: JSON.stringify({
        play_slots: { gm: true, narrator: true, auditor: false, perspective: false },
        brief: "test",
      }),
      source: "test",
    });

    const applied = applyUserConstraintsToPlaySpec(board);
    expect(applied.mounted).toBe(true);
    expect(applied.count).toBe(STARTER_PREFERENCES.length + 2);
    expect(board.getContentByTag(USER_CONSTRAINTS_TAG)).toContain("精确数字");
    const order = board.getContentByTag("设计.上下文投影排序") ?? "";
    expect(order).toContain(USER_CONSTRAINTS_TAG);
  });

  it("clears mount when all preferences archived", async () => {
    const {
      listPreferences,
      updatePreference,
      loadPreferenceStore,
    } = await import("../src/preference/store.js");
    const {
      USER_CONSTRAINTS_TAG,
      applyUserConstraintsToPlaySpec,
    } = await import("../src/preference/constraints.js");

    loadPreferenceStore();
    for (const e of listPreferences()) {
      updatePreference(e.id, { status: "archived" });
    }

    const board = new Blackboard();
    board.write({
      tag: USER_CONSTRAINTS_TAG,
      content: "旧约束",
      source: "test",
    });
    board.write({
      tag: "设计.worker集",
      content: JSON.stringify({
        play_slots: { gm: true, narrator: false },
        context_order: {
          schema: "context-order.v1",
          slots: [
            {
              ref: "world-simulator",
              inserts: [
                { order: 0, ref: "worker.persona", projection: "fixed" },
                { order: 1, ref: USER_CONSTRAINTS_TAG, projection: "full" },
              ],
            },
          ],
        },
      }),
      source: "test",
    });

    const applied = applyUserConstraintsToPlaySpec(board);
    expect(applied.mounted).toBe(false);
    expect(board.getContentByTag(USER_CONSTRAINTS_TAG)).toBe("");
    const order = board.getContentByTag("设计.上下文投影排序") ?? "";
    expect(order).not.toContain(`"ref": "${USER_CONSTRAINTS_TAG}"`);
  });
});
