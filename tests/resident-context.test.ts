import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import {
  entriesForWorker,
  formatResidentPromptSection,
  mountResidentContextForWorker,
  parseResidentContext,
  residentTagFor,
} from "../src/skills/resident-context.js";
import { buildDeclaredWorkerSkill } from "../src/skills/declared-worker.js";
import type { ParsedWorkerSet } from "../src/skills/worker-set-parse.js";

describe("resident-context", () => {
  const entries = parseResidentContext([
    {
      id: "tone",
      position: "static",
      importance: 2,
      content: "文风克制、偏冷",
      mount: ["narrator"],
    },
    {
      id: "rules",
      content: "硬规则：不死复活",
      mount: ["world-simulator", "narrator"],
    },
    {
      id: "scratch",
      position: "dynamic",
      content: "本轮提示",
      mount: ["world-simulator"],
    },
  ]);

  it("parses and sorts by importance", () => {
    expect(entries[0]?.id).toBe("tone");
    expect(residentTagFor(entries[0]!)).toBe("上下文.常驻.tone");
  });

  it("filters mount per worker", () => {
    expect(entriesForWorker(entries, "narrator").map((e) => e.id)).toEqual([
      "tone",
      "rules",
    ]);
    expect(entriesForWorker(entries, "world-simulator").map((e) => e.id)).toEqual([
      "rules",
      "scratch",
    ]);
  });

  it("writes tags to blackboard", () => {
    const bb = new Blackboard();
    const { staticTags, dynamicTags, written } = mountResidentContextForWorker({
      blackboard: bb,
      entries,
      workerId: "world-simulator",
    });
    expect(written).toContain("上下文.常驻.rules");
    expect(staticTags).toContain("上下文.常驻.rules");
    expect(dynamicTags).toContain("上下文.常驻.scratch");
    expect(bb.getContentByTag("上下文.常驻.rules")).toContain("不死复活");
  });

  it("injects into declared worker prompt and inputTags", () => {
    const workerSet: ParsedWorkerSet = {
      workers: [
        {
          ref: "narrator",
          duty: "转述",
          acceptance: "review",
        },
      ],
      resident_context: entries,
      narrative_guide: "残酷求生",
    };
    const built = buildDeclaredWorkerSkill({
      skillPackName: "world-simulator",
      entry: workerSet.workers[0]!,
      template: {
        id: "narrator",
        label: "转述",
        suggested_outputs: ["输出.用户展示"],
      },
      workerSet,
    });
    expect(built.promptBody).toContain("常驻上下文");
    expect(built.promptBody).toContain("文风克制");
    expect(built.worker.inputTags).toContain("上下文.常驻.tone");
    expect(built.worker.inputTags).toContain("上下文.常驻.rules");
    expect(built.worker.inputTags).not.toContain("上下文.常驻.scratch");
  });

  it("formats prompt section", () => {
    const text = formatResidentPromptSection(entries, "narrator");
    expect(text).toContain("### tone");
    expect(text).not.toContain("scratch");
  });
});
