import { describe, expect, it } from "vitest";
import {
  DICTATE_MODULE_READ_STATE_TAG,
  buildDictateModuleReadIndex,
  runDictateTurn,
} from "../src/dictate/index.js";
import { loadModuleCatalog } from "../src/skills/creation-flow.js";
import type { AgentDriver } from "../src/runtime/driver.js";

async function setup() {
  const catalog = await loadModuleCatalog("dialogue/world-simulator");
  expect(catalog).toBeTruthy();
  const moduleReadIndex = await buildDictateModuleReadIndex({
    skillPackRoot: "dialogue/world-simulator",
    catalog: catalog!,
  });
  return { catalog: catalog!, moduleReadIndex };
}

describe("dictate read_module", () => {
  it("rejects insert before reading the current prompt version", async () => {
    const { catalog, moduleReadIndex } = await setup();
    const tags = new Map<string, string>();
    const driver: AgentDriver = {
      async run(input) {
        const outcome = await input.handleStep([
          {
            id: "i1",
            name: "insert",
            arguments: JSON.stringify({
              position: "设计.美学纲领与交互范式",
              content: "{}",
              self_score: {
                dims: [
                  { name: "核心体验", score: 5 },
                  { name: "背景与规则", score: 5 },
                ],
              },
            }),
          },
        ]);
        if (outcome.kind === "continue") {
          const payload = JSON.parse(outcome.results[0]!.content);
          expect(payload.error).toContain('read_module("aesthetics-interaction")');
        }
        return { iterations: 1, stop: { kind: "text", content: "未写入" } };
      },
    };

    const result = await runDictateTurn({
      llm: {} as never,
      dialogue: [],
      moduleCatalog: catalog,
      moduleReadIndex,
      driver,
      handlers: handlers(tags),
    });
    expect(result.wroteTags).toEqual([]);
  });

  it("allows reading multiple modules then inserting both in the same step", async () => {
    const { catalog, moduleReadIndex } = await setup();
    const tags = new Map<string, string>();
    const driver: AgentDriver = {
      async run(input) {
        const outcome = await input.handleStep([
          {
            id: "r1",
            name: "read_module",
            arguments: JSON.stringify({ module_id: "美学纲领与交互范式" }),
          },
          {
            id: "r2",
            name: "read_module",
            arguments: JSON.stringify({ module_id: "protagonist" }),
          },
          {
            id: "i1",
            name: "insert",
            arguments: JSON.stringify({
              position: "设计.美学纲领与交互范式",
              content: "{}",
              self_score: {
                dims: [
                  { name: "核心体验", score: 5 },
                  { name: "背景与规则", score: 3, gap: "规则因果仍需确认" },
                ],
              },
            }),
          },
          {
            id: "i2",
            name: "insert",
            arguments: JSON.stringify({
              position: "设计.主角设定",
              content: "{}",
              self_score: {
                dims: [
                  { name: "宽松度", score: 5 },
                  { name: "必要度", score: 5 },
                ],
              },
            }),
          },
        ]);
        if (outcome.kind === "continue") {
          const read = JSON.parse(outcome.results[0]!.content);
          expect(read.task).toBeTruthy();
          expect(read.version).toMatch(/^[a-f0-9]{16}$/);
          expect(JSON.parse(outcome.results[2]!.content).ok).toBe(true);
          expect(JSON.parse(outcome.results[3]!.content).ok).toBe(true);
        }
        return { iterations: 1, stop: { kind: "text", content: "已写入" } };
      },
    };

    const result = await runDictateTurn({
      llm: {} as never,
      dialogue: [],
      moduleCatalog: catalog,
      moduleReadIndex,
      driver,
      handlers: handlers(tags),
    });
    expect(result.wroteTags).toEqual([
      "设计.美学纲领与交互范式",
      "设计.主角设定",
    ]);
    expect(tags.get(DICTATE_MODULE_READ_STATE_TAG)).toContain("protagonist");
  });

  it("returns presentation references for reply-format", async () => {
    const { moduleReadIndex } = await setup();
    const module = moduleReadIndex.get("reply-format");
    expect(module?.presentation_references?.shells.length).toBeGreaterThan(0);
    expect(module?.presentation_references?.markdown_safe_subset).toContain(
      "正文安全子集",
    );
    expect(module?.presentation_references?.iframe_contract).toContain(
      "present.onData",
    );
  });

  it("requires another read when the prompt version changes", async () => {
    const { catalog, moduleReadIndex } = await setup();
    const tags = new Map<string, string>();
    const driver: AgentDriver = {
      async run(input) {
        await input.handleStep([
          {
            id: "r1",
            name: "read_module",
            arguments: JSON.stringify({ module_id: "aesthetics-interaction" }),
          },
        ]);
        moduleReadIndex.get("aesthetics-interaction")!.version = "new-version";
        const outcome = await input.handleStep([
          {
            id: "i1",
            name: "insert",
            arguments: JSON.stringify({
              position: "设计.美学纲领与交互范式",
              content: "{}",
            }),
          },
        ]);
        if (outcome.kind === "continue") {
          expect(JSON.parse(outcome.results[0]!.content).error).toContain(
            "当前提示版本",
          );
        }
        return { iterations: 2, stop: { kind: "text", content: "需重读" } };
      },
    };
    const result = await runDictateTurn({
      llm: {} as never,
      dialogue: [],
      moduleCatalog: catalog,
      moduleReadIndex,
      driver,
      handlers: handlers(tags),
    });
    expect(result.wroteTags).toEqual([]);
  });

  it("validates score dimensions and stores low-score gaps as metadata", async () => {
    const { catalog, moduleReadIndex } = await setup();
    const tags = new Map<string, string>();
    let metadata: unknown;
    const driver: AgentDriver = {
      async run(input) {
        await input.handleStep([
          {
            id: "r1",
            name: "read_module",
            arguments: JSON.stringify({ module_id: "aesthetics-interaction" }),
          },
        ]);
        const rejected = await input.handleStep([
          {
            id: "i1",
            name: "insert",
            arguments: JSON.stringify({
              position: "设计.美学纲领与交互范式",
              content: "{}",
              self_score: {
                dims: [
                  { name: "核心体验", score: 3 },
                  { name: "背景与规则", score: 5 },
                ],
              },
            }),
          },
        ]);
        if (rejected.kind === "continue") {
          expect(JSON.parse(rejected.results[0]!.content).error).toContain(
            "必须写 gap",
          );
        }
        await input.handleStep([
          {
            id: "i2",
            name: "insert",
            arguments: JSON.stringify({
              position: "设计.美学纲领与交互范式",
              content: "{}",
              self_score: {
                dims: [
                  { name: "核心体验", score: 3, gap: "发生方式仍偏宽" },
                  { name: "背景与规则", score: 5 },
                ],
              },
            }),
          },
        ]);
        return { iterations: 3, stop: { kind: "text", content: "已写入" } };
      },
    };
    await runDictateTurn({
      llm: {} as never,
      dialogue: [],
      moduleCatalog: catalog,
      moduleReadIndex,
      driver,
      handlers: {
        ...handlers(tags),
        writeProduct: (tag, content, order, meta) => {
          tags.set(tag, content);
          metadata = { order, ...meta };
        },
      },
    });
    expect(metadata).toMatchObject({
      layer: "final",
      selfScore: {
        dims: expect.arrayContaining([
          expect.objectContaining({ name: "核心体验", score: 3 }),
        ]),
      },
    });
  });
});

function handlers(tags: Map<string, string>) {
  return {
    listProducts: () =>
      [...tags.entries()]
        .filter(([tag]) => tag.startsWith("设计.") || tag.startsWith("用户."))
        .map(([tag, content]) => ({ tag, content })),
    writeProduct: (tag: string, content: string) => tags.set(tag, content),
    deleteProduct: (tag: string) => tags.delete(tag),
    readTag: (tag: string) => tags.get(tag),
    writeTag: (tag: string, content: string) => {
      tags.set(tag, content);
    },
    deleteTag: (tag: string) => tags.delete(tag),
    clearDialogue: () => undefined,
  };
}
