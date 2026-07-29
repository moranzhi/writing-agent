/**
 * 创作流程 parse / validate / catalog / recipes
 */
import { describe, expect, it } from "vitest";
import {
  artifactTagForStep,
  extractModuleOpening,
  formatCreationFlowForUser,
  formatModuleCatalogForAgent,
  formatRecipeCatalogForAgent,
  formatSelectedRecipeForAgent,
  isCreationFlowComplete,
  loadAllRecipeDetails,
  loadModuleCatalog,
  loadModulePrompt,
  loadRecipeCatalog,
  needsFlowExpansion,
  nextPendingStep,
  parseCreationFlow,
  parseModuleCatalog,
  parseModuleOpeningState,
  parseRecipeCatalog,
  parseRecipeYaml,
  parseSelectedRecipeRef,
  resolveDesignStepBinding,
  validateCreationFlow,
} from "../src/skills/creation-flow.js";
import { loadWorkerSkillWithContext } from "../src/skills/loader.js";

const sampleCatalog = parseModuleCatalog(`
modules:
  - name: 美学纲领与交互范式
    declaration: 站位与体验契约
    artifact: 设计.美学纲领与交互范式
  - name: 实现机制
    declaration: worker 与表
    artifact: 设计.实现机制
  - name: 生成规则
    declaration: 可执行规则
    artifact: 设计.生成规则
    repeatable: true
  - name: 具体实例
    declaration: 锚定实例
    artifact: 设计.具体实例
    repeatable: true
`)!;

describe("creation-flow", () => {
  it("parses minimal flow JSON and fills step ids", () => {
    const flow = parseCreationFlow(`{
      "brief": "单角代入",
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] }
      ]
    }`);
    expect(flow).toEqual({
      version: 1,
      brief: "单角代入",
      status: undefined,
      steps: [
        {
          id: "美学纲领与交互范式",
          name: "美学纲领与交互范式",
          depends_on: [],
        },
      ],
    });
  });

  it("allows duplicate capability names with distinct ids", () => {
    const flow = parseCreationFlow(`{
      "status": "open",
      "steps": [
        { "id": "生成规则", "name": "生成规则", "depends_on": [] },
        { "id": "生成规则#2", "name": "生成规则", "depends_on": ["生成规则"] },
        { "id": "具体实例", "name": "具体实例", "depends_on": ["生成规则#2"] }
      ]
    }`)!;
    expect(flow.status).toBe("open");
    expect(flow.steps.map((s) => s.id)).toEqual([
      "生成规则",
      "生成规则#2",
      "具体实例",
    ]);
    expect(validateCreationFlow(flow, sampleCatalog).ok).toBe(true);
  });

  it("auto-numbers duplicate names when id omitted", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        { "name": "生成规则", "depends_on": [] },
        { "name": "生成规则", "depends_on": ["生成规则"] }
      ]
    }`)!;
    expect(flow.steps[0]?.id).toBe("生成规则");
    expect(flow.steps[1]?.id).toBe("生成规则#2");
    expect(validateCreationFlow(flow, sampleCatalog).ok).toBe(true);
  });

  it("extracts JSON from surrounding text", () => {
    const flow = parseCreationFlow(
      `说明如下\n{"steps":[{"name":"美学纲领与交互范式","depends_on":[]}]}\n完`,
    );
    expect(flow?.steps[0]?.name).toBe("美学纲领与交互范式");
  });

  it("validates deps must appear earlier", () => {
    const bad = parseCreationFlow(`{
      "steps": [
        { "name": "实现机制", "depends_on": ["美学纲领与交互范式"] },
        { "name": "美学纲领与交互范式", "depends_on": [] }
      ]
    }`)!;
    const result = validateCreationFlow(bad, sampleCatalog);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("未排在其前面"))).toBe(true);
  });

  it("rejects unknown module names when catalog given", () => {
    const flow = parseCreationFlow(`{
      "steps": [{ "name": "不存在的工序", "depends_on": [] }]
    }`)!;
    const result = validateCreationFlow(flow, sampleCatalog);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("不在模块目录");
  });

  it("rejects non-repeatable duplicate names", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        { "name": "实现机制", "depends_on": [] },
        { "id": "实现机制#2", "name": "实现机制", "depends_on": ["实现机制"] }
      ]
    }`)!;
    const result = validateCreationFlow(flow, sampleCatalog);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("repeatable"))).toBe(true);
  });

  it("accepts a valid ordered flow", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "name": "实现机制", "depends_on": ["美学纲领与交互范式"] }
      ]
    }`)!;
    expect(validateCreationFlow(flow, sampleCatalog).ok).toBe(true);
    expect(artifactTagForStep("美学纲领与交互范式", sampleCatalog)).toBe(
      "设计.美学纲领与交互范式",
    );
  });

  it("formats user view without English tags", () => {
    const flow = parseCreationFlow(`{
      "brief": "网恋回合",
      "status": "open",
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "name": "生成规则", "depends_on": ["美学纲领与交互范式"] },
        { "id": "生成规则#2", "name": "生成规则", "depends_on": ["生成规则"] }
      ]
    }`)!;
    const view = formatCreationFlowForUser(flow, sampleCatalog);
    expect(view.brief).toBe("网恋回合");
    expect(view.status).toBe("open");
    expect(view.steps[0]).toMatchObject({
      order: 1,
      name: "美学纲领与交互范式",
      depends_on: [],
      declaration: "站位与体验契约",
    });
    expect(view.steps[2]?.occurrence).toBe(2);
    expect(view.steps[2]?.repeatable).toBe(true);
  });

  it("loads world-simulator catalog and formats for agent", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    expect(catalog?.modules.some((m) => m.name === "美学纲领与交互范式")).toBe(
      true,
    );
    expect(catalog?.modules.some((m) => m.name === "交互范式")).toBe(false);
    expect(catalog?.modules.some((m) => m.name === "美学纲领")).toBe(false);
    expect(
      catalog?.modules.find((m) => m.name === "生成规则")?.repeatable,
    ).toBe(true);
    expect(
      catalog?.modules.find((m) => m.name === "具体实例")?.repeatable,
    ).toBe(true);
    const block = formatModuleCatalogForAgent(catalog!);
    expect(block).toContain("【能力");
    expect(block).toContain("美学纲领与交互范式：");
    expect(block).toContain("生成规则〔可反复〕");
    expect(block).not.toContain("设计.美学纲领与交互范式");
  });

  it("loads recipe catalog for user director selection UI", async () => {
    const recipes = await loadRecipeCatalog("dialogue/world-simulator");
    expect(recipes?.recipes.some((r) => r.name === "世界模拟器")).toBe(true);
    expect(recipes?.recipes.some((r) => r.name === "扩写助手")).toBe(true);
    const block = formatRecipeCatalogForAgent(recipes!);
    expect(block).toContain("须由用户手动选择");
    expect(block).toContain("世界模拟器");

    const details = await loadAllRecipeDetails("dialogue/world-simulator");
    expect(details.length).toBeGreaterThanOrEqual(2);
    expect(details.find((d) => d.id === "world-simulator")?.when).toBeTruthy();
    expect(
      details
        .find((d) => d.id === "world-simulator")
        ?.seed?.steps.some((s) => s.name === "美学纲领与交互范式"),
    ).toBe(true);
    expect(details.find((d) => d.id === "world-simulator")?.seed?.status).toBe(
      "open",
    );
  });

  it("parses selected recipe ref", () => {
    expect(parseSelectedRecipeRef("world-simulator")).toBe("world-simulator");
    expect(parseSelectedRecipeRef('{"id":"expand-assistant","name":"扩写助手"}')).toBe(
      "expand-assistant",
    );
    expect(parseSelectedRecipeRef("")).toBeNull();
  });

  it("parses recipe yaml with suggested steps", () => {
    const detail = parseRecipeYaml(
      `
when: 测试适用
hint: 可调味
brief: 测试 brief
steps:
  - name: 美学纲领与交互范式
    depends_on: []
`,
      { id: "t", name: "测试配方", declaration: "测" },
    );
    expect(detail.when).toBe("测试适用");
    expect(detail.seed?.status).toBe("open");
    expect(detail.seed?.steps).toEqual([
      {
        id: "美学纲领与交互范式",
        name: "美学纲领与交互范式",
        depends_on: [],
      },
    ]);
    expect(formatSelectedRecipeForAgent(detail)).toContain("用户已选导演");
    expect(formatSelectedRecipeForAgent(detail)).toContain("增量");
  });

  it("parseRecipeCatalog skips incomplete rows", () => {
    const cat = parseRecipeCatalog(`
recipes:
  - id: ok
    name: 好配方
    declaration: 有声明
  - id: bad
    name: 缺声明
`);
    expect(cat?.recipes).toEqual([
      { id: "ok", name: "好配方", declaration: "有声明" },
    ]);
  });

  it("injects selected director into design-flow; missing selection warns", async () => {
    const missing = await loadWorkerSkillWithContext(
      "world-simulator",
      "design-flow",
    );
    expect(missing.promptBody).toContain("用户尚未手动选择");
    expect(missing.promptBody).toContain("【能力");
    expect(missing.promptBody).toContain("禁止自行猜测");

    const selected = await loadWorkerSkillWithContext(
      "world-simulator",
      "design-flow",
      undefined,
      { selectedRecipeRef: "world-simulator" },
    );
    expect(selected.worker.outputTags).toContain("设计.创作流程");
    expect(selected.promptBody).toContain("【用户已选导演 · 世界模拟器】");
    expect(selected.promptBody).toContain("世界模拟器");
    expect(selected.promptBody).toContain("【能力");
    expect(selected.promptBody).toContain("美学纲领与交互范式");
    expect(selected.promptBody).toContain("增量");
    expect(selected.promptBody).not.toContain("【导演】用户尚未手动选择");
  });

  it("injects aesthetics-interaction module prompt into design-step", async () => {
    const flowRaw = JSON.stringify({
      steps: [{ name: "美学纲领与交互范式", depends_on: [] }],
    });
    const loaded = await loadWorkerSkillWithContext(
      "world-simulator",
      "design-step",
      undefined,
      {
        flowRaw,
        currentStepName: "美学纲领与交互范式",
        acceptedStepNames: [],
      },
    );
    expect(loaded.worker.outputTags).toContain("设计.美学纲领与交互范式");
    expect(loaded.promptBody).toContain("美学纲领与交互范式");
    expect(loaded.promptBody).toContain("体验契约");
    expect(loaded.promptBody).toContain("程序开场");
    expect(loaded.worker.inputTags).toContain("创作.能力开场白");
  });

  it("extracts ```opening default question from module prompt", async () => {
    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "aesthetics-interaction",
    );
    expect(prompt).toBeTruthy();
    const opening = extractModuleOpening(prompt!);
    expect(opening).toContain("原型世界");
    expect(opening).toContain("变在哪里");
    expect(opening).toContain("代入");
    expect(opening).toContain("最想反复感受到");
    expect(opening).not.toContain("nail清站位");

    const {
      parseModulePromptSections,
      formatModulePromptForLlm,
      MODULE_SECTION_IDS,
    } = await import("../src/skills/creation-flow.js");
    const sections = parseModulePromptSections(prompt!);
    for (const id of ["meta", "opening", "task", "output", "checklist"] as const) {
      expect(sections.blocks[id]?.length).toBeGreaterThan(0);
    }
    expect(MODULE_SECTION_IDS).toContain("opening");

    const forLlm = formatModulePromptForLlm(prompt!);
    expect(forLlm).toContain("```task");
    expect(forLlm).not.toContain("原型世界是什么");

    expect(
      extractModuleOpening("## opening\n\n```opening\nhello world\n```\n"),
    ).toBe("hello world");

    expect(parseModuleOpeningState('{"美学纲领与交互范式":"shown"}')).toEqual({
      美学纲领与交互范式: "shown",
    });

    const binding = await resolveDesignStepBinding({
      skillPackRoot: "dialogue/world-simulator",
      flowRaw: JSON.stringify({
        steps: [{ name: "美学纲领与交互范式", depends_on: [] }],
      }),
      currentStepName: "美学纲领与交互范式",
    });
    expect(binding?.opening).toContain("原型世界");
    expect(binding?.modulePrompt).toContain("```task");
    expect(binding?.modulePrompt).not.toContain("最想反复感受到的是什么");
  });

  it("nextPendingStep respects deps and accepted by id", () => {
    const flow = parseCreationFlow(`{
      "status": "open",
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "name": "生成规则", "depends_on": ["美学纲领与交互范式"] },
        { "id": "生成规则#2", "name": "生成规则", "depends_on": ["生成规则"] }
      ]
    }`)!;
    expect(nextPendingStep(flow, [])?.id).toBe("美学纲领与交互范式");
    expect(nextPendingStep(flow, ["美学纲领与交互范式"])?.id).toBe("生成规则");
    expect(nextPendingStep(flow, ["美学纲领与交互范式", "生成规则"])?.id).toBe(
      "生成规则#2",
    );
    expect(
      nextPendingStep(flow, ["美学纲领与交互范式", "生成规则", "生成规则#2"]),
    ).toBeNull();
  });

  it("open flow needs expansion after listed steps accepted", () => {
    const flow = parseCreationFlow(`{
      "status": "open",
      "steps": [{ "name": "美学纲领与交互范式", "depends_on": [] }]
    }`)!;
    expect(isCreationFlowComplete(flow, ["美学纲领与交互范式"])).toBe(false);
    expect(needsFlowExpansion(flow, ["美学纲领与交互范式"])).toBe(true);

    const closed = parseCreationFlow(`{
      "status": "closed",
      "steps": [{ "name": "美学纲领与交互范式", "depends_on": [] }]
    }`)!;
    expect(isCreationFlowComplete(closed, ["美学纲领与交互范式"])).toBe(true);
    expect(needsFlowExpansion(closed, ["美学纲领与交互范式"])).toBe(false);

    const legacy = parseCreationFlow(`{
      "steps": [{ "name": "美学纲领与交互范式", "depends_on": [] }]
    }`)!;
    expect(isCreationFlowComplete(legacy, ["美学纲领与交互范式"])).toBe(true);
  });
});
