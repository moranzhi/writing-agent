import { beforeEach, describe, expect, it } from "vitest";
import { readSniffModels, writeSniffModels } from "../web/model-sniff-cache.js";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
});

describe("model sniff cache", () => {
  it("keeps models for the current boot and drops them after restart", () => {
    writeSniffModels("boot-a", "https://openrouter.ai/api/v1\nkey:abc", [
      "google/gemini-3.8-flash",
      "google/gemini-3.7-flash",
    ]);

    expect(
      readSniffModels("boot-a", "https://openrouter.ai/api/v1\nkey:abc"),
    ).toEqual(["google/gemini-3.8-flash", "google/gemini-3.7-flash"]);

    expect(
      readSniffModels("boot-b", "https://openrouter.ai/api/v1\nkey:abc"),
    ).toEqual([]);
  });

  it("does not keep another boot's entries when writing again", () => {
    writeSniffModels("boot-a", "slot", ["old-model"]);
    writeSniffModels("boot-b", "slot", ["new-model"]);

    expect(readSniffModels("boot-a", "slot")).toEqual([]);
    expect(readSniffModels("boot-b", "slot")).toEqual(["new-model"]);
  });
});
