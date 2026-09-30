import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  apiKeyHash,
  createApiProfile,
  listApiGroups,
  listApiProfiles,
  renameApiProfileGroup,
  updateApiProfile,
} from "../src/config/api-profiles.js";
import { modelListUrls, parseModelsPayload } from "../src/llm/list-models.js";

describe("api profile groups", () => {
  let dir = "";
  let prevData: string | undefined;
  let prevKey: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "wa-profiles-"));
    prevData = process.env.WRITING_AGENT_DATA_DIR;
    prevKey = process.env.OPENAI_API_KEY;
    process.env.WRITING_AGENT_DATA_DIR = dir;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.WRITING_AGENT_DATA_DIR;
    else process.env.WRITING_AGENT_DATA_DIR = prevData;
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps same-url profiles separate and folds them into one named group", () => {
    const first = createApiProfile({
      name: "ds",
      baseUrl: "https://openrouter.ai/api/v1/",
      apiKey: "sk-same",
      model: "deepseek/deepseek-v4-pro",
    });
    const second = createApiProfile({
      name: "ds flash",
      baseUrl: "https://OpenRouter.ai/api/v1",
      apiKey: "sk-same",
      model: "deepseek/deepseek-v4-flash",
    });

    expect(second.id).not.toBe(first.id);
    expect(second.groupId).toBe(first.groupId);
    expect(listApiProfiles()).toHaveLength(2);
    const groups = listApiGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("openrouter.ai");
    expect(groups[0]?.id).toBe(first.groupId);
    expect(JSON.stringify(groups)).not.toContain("sk-same");
    expect(JSON.stringify(groups)).not.toContain(apiKeyHash("sk-same"));
  });

  it("uses a different group when the key differs", () => {
    createApiProfile({
      name: "a",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-one",
      model: "alpha",
    });
    createApiProfile({
      name: "b",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-two",
      model: "beta",
    });
    const groups = listApiGroups();
    expect(groups).toHaveLength(2);
    const names = groups.map((group) => group.name).sort();
    expect(names[0]).toBe("openrouter.ai");
    expect(names[1]?.startsWith("openrouter.ai · ")).toBe(true);
  });

  it("splits a legacy multi-model profile back into separate rows", () => {
    const now = "2026-01-01T00:00:00.000Z";
    writeFileSync(
      path.join(dir, "profiles.json"),
      JSON.stringify({
        version: 1,
        profiles: [
          {
            id: "ds",
            name: "ds",
            baseUrl: "https://api.deepseek.com",
            apiKey: "sk-1",
            model: "deepseek-v4-pro",
            models: ["deepseek-v4-pro", "deepseek-v4-flash"],
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    );

    const profiles = listApiProfiles();
    expect(profiles.map((profile) => profile.model).sort()).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
    expect(new Set(profiles.map((profile) => profile.groupId)).size).toBe(1);
    expect(profiles.every((profile) => profile.models === undefined)).toBe(true);
    const stored = JSON.parse(readFileSync(path.join(dir, "profiles.json"), "utf8")) as {
      profiles: Array<{ model: string }>;
      groups: Array<{ name: string }>;
    };
    expect(stored.profiles).toHaveLength(2);
    expect(stored.groups[0]?.name).toBe("api.deepseek.com");
  });

  it("renames a group without moving its profiles", () => {
    const profile = createApiProfile({
      name: "ds",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-1",
      model: "deepseek-v4-pro",
    });
    const renamed = renameApiProfileGroup(profile.groupId ?? "", "深度求索");
    expect(renamed.name).toBe("深度求索");
    expect(listApiProfiles()[0]?.groupId).toBe(profile.groupId);
    expect(listApiGroups()[0]?.name).toBe("深度求索");
  });

  it("clears capability results when the model of one profile changes", () => {
    const profile = createApiProfile({
      name: "ds",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-1",
      model: "deepseek-v4-pro",
    });
    const file = path.join(dir, "profiles.json");
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      profiles: Array<{ capabilities?: { chat: string } }>;
    };
    raw.profiles[0]!.capabilities = { chat: "ok" };
    writeFileSync(file, JSON.stringify(raw));

    const switched = updateApiProfile(profile.id, { model: "deepseek-v4-flash" });
    expect(switched.id).toBe(profile.id);
    expect(switched.model).toBe("deepseek-v4-flash");
    expect(switched.capabilities).toBeUndefined();
    expect(listApiProfiles()).toHaveLength(1);
  });
});

describe("models payload", () => {
  it("parses OpenAI and plain lists", () => {
    expect(
      parseModelsPayload({
        data: [{ id: "a" }, { id: "a" }, { name: "b" }, { id: "" }],
      }),
    ).toEqual(["a", "b"]);
    expect(parseModelsPayload(["z", "z", " y "])).toEqual(["z", "y"]);
    expect(parseModelsPayload({ error: { message: "nope" } })).toBeNull();
    expect(parseModelsPayload({ data: [] })).toEqual([]);
  });

  it("tries versioned models urls when base has no v1", () => {
    expect(modelListUrls("https://openrouter.ai")).toEqual([
      "https://openrouter.ai/models",
      "https://openrouter.ai/v1/models",
      "https://openrouter.ai/api/v1/models",
    ]);
    expect(modelListUrls("https://openrouter.ai/api/v1/")).toEqual([
      "https://openrouter.ai/api/v1/models",
    ]);
  });
});
