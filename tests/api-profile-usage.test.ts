import { beforeEach, describe, expect, it } from "vitest";
import {
  filterUsedApiProfiles,
  forgetApiProfileUsage,
  loadApiProfileUsage,
  recordApiProfileUsage,
} from "../web/api-profile-usage.js";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
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

describe("forgetApiProfileUsage", () => {
  it("drops one used record and leaves the profile out of the shortcut list", () => {
    recordApiProfileUsage("a");
    recordApiProfileUsage("b");

    expect(forgetApiProfileUsage("a")).toBe(true);
    expect(loadApiProfileUsage().a).toBeUndefined();
    expect(loadApiProfileUsage().b).toBeTruthy();

    const visible = filterUsedApiProfiles(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      loadApiProfileUsage(),
      "c",
    );
    expect(visible.map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("does nothing when there is no record", () => {
    expect(forgetApiProfileUsage("missing")).toBe(false);
  });
});
