import { describe, expect, it } from "vitest";
import { resolveWorkerId } from "../src/worker/resolve-id.js";

describe("resolveWorkerId", () => {
  it("maps legacy ids to skill worker ids", () => {
    expect(resolveWorkerId("rules-worker")).toBe("write-rules");
    expect(resolveWorkerId("outline-worker")).toBe("outline");
    expect(resolveWorkerId("write-rules")).toBe("write-rules");
  });
});
