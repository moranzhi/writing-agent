import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import { createSession } from "../src/runtime/phase-machine.js";
import {
  buildInstanceWorkerDeclaration,
  inferLifecycleStage,
  isWorkerDeclared,
  readWorkerSetYamlForDeclaration,
} from "../src/skills/worker-declaration.js";

const WORKER_SET = `
version: 1
workers:
  - ref: world-simulator
    duty: 世界推进
  - ref: narrator
    duty: 转述
  - ref: opening-generator
    duty: 开局
instantiate_hints:
  invoke: [opening-generator]
`;

function sessionWithAcceptedWorkerSet() {
  return {
    ...createSession(),
    slots: {
      ...createSession().slots,
      designInstanceReady: true,
    },
  };
}

describe("worker-declaration", () => {
  it("design before accept: design step skills", () => {
    const bb = new Blackboard();
    const decl = buildInstanceWorkerDeclaration(createSession(), bb, "design");
    expect(decl.activeWorkerIds).toEqual(["design-flow", "design-step"]);
    expect(decl.accepted).toBe(false);
  });

  it("play after accept: only run workers from worker set", () => {
    const bb = new Blackboard();
    bb.write({ tag: "设计.worker集", content: WORKER_SET, source: "test" });
    const session = {
      ...sessionWithAcceptedWorkerSet(),
      slots: {
        ...sessionWithAcceptedWorkerSet().slots,
        uiLifecycleStage: "play",
      },
    };
    const decl = buildInstanceWorkerDeclaration(session, bb, "play");
    expect(decl.playWorkerIds).toEqual(["world-simulator", "narrator"]);
    expect(decl.activeWorkerIds).toEqual(["world-simulator", "narrator"]);
    expect(decl.designEndWorkerIds).toEqual(["opening-generator"]);
    expect(isWorkerDeclared(decl, "narrator")).toBe(true);
    expect(isWorkerDeclared(decl, "design-flow")).toBe(false);
    expect(isWorkerDeclared(decl, "opening-generator")).toBe(false);
  });

  it("design after accept: design steps + design-end workers", () => {
    const bb = new Blackboard();
    bb.write({ tag: "设计.worker集", content: WORKER_SET, source: "test" });
    const decl = buildInstanceWorkerDeclaration(
      sessionWithAcceptedWorkerSet(),
      bb,
      "design",
    );
    expect(decl.activeWorkerIds).toContain("design-flow");
    expect(decl.activeWorkerIds).toContain("design-step");
    expect(decl.activeWorkerIds).toContain("opening-generator");
    expect(decl.activeWorkerIds).not.toContain("world-simulator");
  });

  it("prefers accepted tag over draft when worker set accepted", () => {
    const bb = new Blackboard();
    bb.write({ tag: "设计.worker集", content: WORKER_SET, source: "test" });
    bb.write({ tag: "设计.worker集.草稿", content: "workers: []", source: "test" });
    const raw = readWorkerSetYamlForDeclaration(bb, sessionWithAcceptedWorkerSet());
    expect(raw?.sourceTag).toBe("设计.worker集");
    expect(raw?.yaml).toContain("world-simulator");
  });

  it("inferLifecycleStage respects play tab and acceptance", () => {
    const bb = new Blackboard();
    const s1 = {
      ...createSession(),
      slots: { ...createSession().slots, uiLifecycleStage: "play" },
    };
    expect(inferLifecycleStage(s1)).toBe("design");

    bb.write({ tag: "设计.worker集", content: WORKER_SET, source: "test" });
    const s2 = {
      ...sessionWithAcceptedWorkerSet(),
      slots: {
        ...sessionWithAcceptedWorkerSet().slots,
        uiLifecycleStage: "play",
      },
    };
    expect(inferLifecycleStage(s2)).toBe("play");

    const s3 = {
      ...sessionWithAcceptedWorkerSet(),
      slots: {
        ...sessionWithAcceptedWorkerSet().slots,
        playLayerActive: true,
      },
    };
    expect(inferLifecycleStage(s3)).toBe("play");
  });
});
