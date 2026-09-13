import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("persona store", () => {
  beforeEach(() => {
    process.env.WRITING_AGENT_DATA_DIR = mkdtempSync(
      path.join(tmpdir(), "wa-persona-"),
    );
  });

  it("seeds a creation-default @玩家 alongside the play persona", async () => {
    const {
      CREATION_PLACEHOLDER_NAME,
      getActivePersona,
      getCreationDefaultPersona,
      listPersonas,
      personaForLifecycle,
    } = await import("../src/persona/store.js");

    const list = listPersonas();
    expect(list.map((p) => p.name)).toEqual(["玩家", CREATION_PLACEHOLDER_NAME]);
    expect(getActivePersona()?.name).toBe("玩家");
    expect(getCreationDefaultPersona()?.name).toBe(CREATION_PLACEHOLDER_NAME);
    expect(personaForLifecycle("design")?.name).toBe(CREATION_PLACEHOLDER_NAME);
    expect(personaForLifecycle("play")?.name).toBe("玩家");
  });

  it("creation default is exclusive and used only in design", async () => {
    const {
      CREATION_PLACEHOLDER_NAME,
      createPersona,
      personaForLifecycle,
      setActivePersonaId,
      updatePersona,
    } = await import("../src/persona/store.js");

    const play = createPersona({
      name: "林晚",
      description: "冷静的调查员",
      activate: true,
    });
    expect(personaForLifecycle("play")?.name).toBe("林晚");
    expect(personaForLifecycle("design")?.name).toBe(CREATION_PLACEHOLDER_NAME);

    updatePersona(play.id, { creationDefault: true });
    expect(personaForLifecycle("design")).toEqual({
      name: "林晚",
      description: "冷静的调查员",
    });
    expect(personaForLifecycle("play")?.name).toBe("林晚");

    setActivePersonaId(play.id);
    updatePersona(play.id, { creationDefault: false });
    expect(personaForLifecycle("design")?.name).toBe(CREATION_PLACEHOLDER_NAME);
  });

  it("falls back to @玩家 when no creation default is set", async () => {
    const {
      CREATION_PLACEHOLDER_NAME,
      getCreationDefaultPersona,
      personaForLifecycle,
      setCreationDefaultPersonaId,
    } = await import("../src/persona/store.js");

    setCreationDefaultPersonaId(null);
    expect(getCreationDefaultPersona()).toBeNull();
    expect(personaForLifecycle("design")).toEqual({
      name: CREATION_PLACEHOLDER_NAME,
      description: "",
    });
  });
});
