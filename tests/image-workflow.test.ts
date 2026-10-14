import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

describe("image workflow library", () => {
  beforeEach(() => {
    process.env.WRITING_AGENT_DATA_DIR = mkdtempSync(
      path.join(tmpdir(), "wa-img-"),
    );
  });

  it("lists a folder only when meta and workflow are both valid", async () => {
    const { getImageWorkflowsDir, listImageWorkflows, getImageWorkflow } =
      await import("../src/image-workflow/store.js");
    const { formatImageWorkflowCatalogForPrompt } = await import(
      "../src/image-workflow/catalog.js"
    );
    const root = getImageWorkflowsDir();
    const ready = path.join(root, "western-fantasy");
    const broken = path.join(root, "broken");
    mkdirSync(ready, { recursive: true });
    mkdirSync(broken, { recursive: true });
    writeFileSync(
      path.join(ready, "meta.json"),
      JSON.stringify({
        id: "western-fantasy",
        name: "西幻",
        summary: "铠甲、城堡、油画光",
        prompt_node: "6",
        prompt_field: "text",
        prompt_notes: "提示词写场面，不堆画风词",
      }),
    );
    writeFileSync(
      path.join(ready, "workflow.json"),
      JSON.stringify({ "6": { class_type: "CLIPTextEncode", inputs: { text: "" } } }),
    );
    writeFileSync(path.join(broken, "meta.json"), JSON.stringify({ name: "缺图" }));

    const listed = listImageWorkflows();
    expect(listed.map((entry) => entry.id)).toEqual(["western-fantasy"]);
    expect(getImageWorkflow("western-fantasy")?.promptNode).toBe("6");
    const catalog = formatImageWorkflowCatalogForPrompt();
    expect(catalog).toContain("【工作流库 · 可选用】");
    expect(catalog).toContain("western-fantasy｜西幻｜铠甲、城堡、油画光");
    expect(catalog).not.toContain("CLIPTextEncode");
  });
});
