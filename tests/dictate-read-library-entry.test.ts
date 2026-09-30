import { describe, expect, it } from "vitest";
import {
  buildDictateModuleReadIndex,
  runDictateTurn,
} from "../src/dictate/index.js";
import {
  formatModuleCatalogForDictate,
  loadModuleCatalog,
} from "../src/skills/creation-flow.js";
import type { AgentDriver } from "../src/runtime/driver.js";

describe("dictate read_library_entry", () => {
  it("lists short entries on read_module and returns selected full entries only", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const moduleReadIndex = await buildDictateModuleReadIndex({
      skillPackRoot: "dialogue/world-simulator",
      catalog: catalog!,
    });
    const preferenceModule = moduleReadIndex.get("story-progression")!;
    const entryId = preferenceModule.libraries[0]!.entries[0]!.id;
    const tags = new Map<string, string>();
    const driver: AgentDriver = {
      async run(input) {
        const outcome = await input.handleStep([
          {
            id: "m1",
            name: "read_module",
            arguments: JSON.stringify({ module_id: "story-progression" }),
          },
          {
            id: "l1",
            name: "read_library_entry",
            arguments: JSON.stringify({
              library_id: "preferences",
              entry_ids: [entryId],
            }),
          },
          {
            id: "l2",
            name: "read_library_entry",
            arguments: JSON.stringify({
              library_id: "style-packs",
              entry_ids: ["missing"],
            }),
          },
        ]);
        if (outcome.kind === "continue") {
          const module = JSON.parse(outcome.results[0]!.content);
          const selected = JSON.parse(outcome.results[1]!.content);
          const rejected = JSON.parse(outcome.results[2]!.content);
          expect(module.libraries[0].entries[0].summary).toBeTruthy();
          expect(selected.entries).toHaveLength(1);
          expect(selected.entries[0].content).toBeTruthy();
          expect(rejected.error).toContain("未绑定库");
        }
        return { iterations: 1, stop: { kind: "text", content: "已读取" } };
      },
    };

    await runDictateTurn({
      llm: {} as never,
      dialogue: [],
      moduleCatalog: catalog,
      moduleReadIndex,
      driver,
      handlers: {
        listProducts: () => [],
        writeProduct: () => undefined,
        deleteProduct: () => false,
        readTag: (tag) => tags.get(tag),
        writeTag: (tag, content) => {
          tags.set(tag, content);
        },
        deleteTag: (tag) => tags.delete(tag),
        clearDialogue: () => undefined,
      },
    });
  });

  it("does not inject full bound libraries into the default dictate catalog", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const block = formatModuleCatalogForDictate(catalog!);
    expect(block).not.toContain("starter-no-user-ntr-victim");
    expect(block).not.toContain("用户代入角色不做被 NTR");
  });
});
