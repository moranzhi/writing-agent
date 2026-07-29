import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import {
  CONTEXT_BRIEF_TAG,
  buildBoardPanel,
  compressAfterWorkerAccept,
} from "../src/runtime/compress-after-worker.js";

describe("compressAfterWorkerAccept", () => {
  it("keeps finals, archives process tags, writes brief", () => {
    const bb = new Blackboard();
    bb.write({
      tag: "设计.worker集.草稿",
      content: '{ "workers": [] }',
      source: "design-core",
    });
    bb.write({
      tag: "设计.worker集",
      content: '{ "workers": [{ "ref": "narrator" }] }',
      source: "design-core",
    });
    bb.write({
      tag: "用户.worker答复",
      content: "过程问答……",
      source: "user",
    });

    const result = compressAfterWorkerAccept({
      blackboard: bb,
      workerId: "design-core",
      outputTags: ["设计.worker集", "用户.需求"],
      summary: "单角代入 + 叙事",
    });

    expect(result.finals.map((f) => f.tag)).toContain("设计.worker集");
    expect(result.archivedTags).toEqual(
      expect.arrayContaining(["用户.worker答复", "设计.worker集.草稿"]),
    );
    expect(bb.getContentByTag(CONTEXT_BRIEF_TAG)).toContain("设计.worker集");
    expect(bb.getContentByTag(CONTEXT_BRIEF_TAG)).toContain("单角代入");

    const draftHits = bb.queryByPatterns(["设计.worker集.草稿"]);
    expect(draftHits).toHaveLength(0);

    const finalHits = bb.queryByPatterns(["设计.worker集"]);
    expect(finalHits).toHaveLength(1);
    expect(finalHits[0].metadata?.role).toBe("final");

    const panel = buildBoardPanel(bb);
    expect(panel.finals.some((f) => f.tag === "设计.worker集")).toBe(true);
    expect(panel.archivedCount).toBeGreaterThanOrEqual(1);
    expect(panel.brief).toContain("定稿");
  });
});
