import { describe, expect, it } from "vitest";
import {
  filterInputsForRolePerspective,
  isRoleUserOnlyTag,
} from "../src/skills/worker-llm.js";
import type { ParsedWorkerSkill } from "../src/skills/types.js";
import { resolveWorkerLlmProvider } from "../src/skills/worker-llm.js";
import { MockLlmProvider } from "../src/llm/client.js";

describe("filterInputsForRolePerspective", () => {
  it("keeps only current role tags when 世界.当前角色.id is set", () => {
    const inputs = {
      "世界.当前角色.id": "A",
      "角色.A.可见信息": "hand A",
      "角色.B.可见信息": "hand B",
      "场景.公开叙述": "public",
    };
    const filtered = filterInputsForRolePerspective(inputs, {
      "世界.当前角色.id": "A",
    });
    expect(filtered["角色.A.可见信息"]).toBe("hand A");
    expect(filtered["角色.B.可见信息"]).toBeUndefined();
    expect(filtered["场景.公开叙述"]).toBe("public");
  });

  it("strips thinking tags even for current role", () => {
    const inputs = {
      "角色.A.可见信息": "hand A",
      "角色.A.思考": "inner monologue",
      "角色.A.推理.候选": "legacy thinking",
      "角色.B.行动": "should not see",
    };
    const filtered = filterInputsForRolePerspective(inputs, {
      "世界.当前角色.id": "A",
    });
    expect(filtered["角色.A.可见信息"]).toBe("hand A");
    expect(filtered["角色.A.思考"]).toBeUndefined();
    expect(filtered["角色.A.推理.候选"]).toBeUndefined();
    expect(filtered["角色.B.行动"]).toBeUndefined();
  });

  it("isRoleUserOnlyTag detects thinking suffixes", () => {
    expect(isRoleUserOnlyTag("角色.A.思考")).toBe(true);
    expect(isRoleUserOnlyTag("角色.A.推理.候选")).toBe(true);
    expect(isRoleUserOnlyTag("角色.A.行动")).toBe(false);
  });
});

describe("resolveWorkerLlmProvider", () => {
  const fallback = new MockLlmProvider([]);

  it("returns fallback when no binding", () => {
    const worker: ParsedWorkerSkill = {
      id: "role-decide",
      skill: "world-simulator",
      name: "x",
      description: "",
      version: 1,
      inputTags: [],
      outputTags: [],
      path: "",
      body: "",
    };
    expect(
      resolveWorkerLlmProvider({
        worker,
        slots: { "世界.当前角色.id": "A" },
        fallbackLlm: fallback,
      }),
    ).toBe(fallback);
  });

  it("uses byRole when bindings match", () => {
    const worker: ParsedWorkerSkill = {
      id: "role-decide",
      skill: "world-simulator",
      name: "x",
      description: "",
      version: 1,
      inputTags: [],
      outputTags: [],
      path: "",
      body: "",
    };
    const resolved = resolveWorkerLlmProvider({
      worker,
      bindings: {
        workers: {
          "role-decide": {
            byRole: { A: "nonexistent-profile-id" },
          },
        },
      },
      slots: { "世界.当前角色.id": "A" },
      fallbackLlm: fallback,
    });
    // profile 不存在时回退 fallback
    expect(resolved).toBe(fallback);
  });
});
