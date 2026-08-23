/**
 * 创作流程 parse / validate / catalog / recipes
 */
import { describe, expect, it } from "vitest";
import {
  artifactTagForStep,
  extractModuleOpening,
  formatCreationFlowForUser,
  formatFlowProgressForAgent,
  formatModuleCatalogForAgent,
  formatRecipeCatalogForAgent,
  formatSelectedRecipeForAgent,
  isCreationFlowComplete,
  loadAllRecipeDetails,
  loadModuleCatalog,
  loadModulePrompt,
  loadRecipeCatalog,
  mergeCreationFlowPreservingAccepted,
  needsFlowExpansion,
  nextPendingStep,
  parseCreationFlow,
  pickRecordedStepId,
  parseModuleCatalog,
  parseModuleOpeningState,
  parseRecipeCatalog,
  parseRecipeYaml,
  parseSelectedRecipeRef,
  resolveDesignStepBinding,
  shouldSkipModuleOpening,
  isProgressPointerTag,
  stringifyCreationFlow,
  creationFlowFromRecipeSeed,
  validateCreationFlow,
  validateStepReadyToRun,
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

  it("keeps accepted steps intact when the planner rewrites the flow", () => {
    const prev = `{
      "status": "open",
      "steps": [
        { "id": "美学纲领与交互范式", "name": "美学纲领与交互范式", "depends_on": [] }
      ]
    }`;
    const rewritten = `{
      "status": "open",
      "steps": [
        { "id": "美学纲领与交互范式", "name": "美学纲领与交互范式", "depends_on": ["实现机制"] },
        { "id": "实现机制", "name": "实现机制", "depends_on": [] }
      ]
    }`;
    const merged = mergeCreationFlowPreservingAccepted({
      prevRaw: prev,
      nextRaw: rewritten,
      acceptedStepIds: ["美学纲领与交互范式"],
    });
    expect(merged.restored).toEqual(["美学纲领与交互范式"]);
    const flow = parseCreationFlow(merged.raw)!;
    expect(flow.steps[0]?.depends_on).toEqual([]);
    expect(flow.steps.map((s) => s.id)).toEqual([
      "美学纲领与交互范式",
      "实现机制",
    ]);
  });

  it("re-inserts an accepted step the planner dropped", () => {
    const prev = `{
      "status": "open",
      "steps": [
        { "id": "美学纲领与交互范式", "name": "美学纲领与交互范式", "depends_on": [] }
      ]
    }`;
    const rewritten = `{
      "status": "open",
      "steps": [{ "id": "实现机制", "name": "实现机制", "depends_on": [] }]
    }`;
    const merged = mergeCreationFlowPreservingAccepted({
      prevRaw: prev,
      nextRaw: rewritten,
      acceptedStepIds: ["美学纲领与交互范式"],
    });
    expect(parseCreationFlow(merged.raw)!.steps.map((s) => s.id)).toEqual([
      "美学纲领与交互范式",
      "实现机制",
    ]);
  });

  it("leaves an untouched rewrite alone", () => {
    const prev = `{
      "status": "open",
      "steps": [
        { "id": "美学纲领与交互范式", "name": "美学纲领与交互范式", "depends_on": [] }
      ]
    }`;
    const rewritten = `{
      "status": "open",
      "steps": [
        { "id": "美学纲领与交互范式", "name": "美学纲领与交互范式", "depends_on": [] },
        { "id": "实现机制", "name": "实现机制", "depends_on": ["美学纲领与交互范式"] }
      ]
    }`;
    const merged = mergeCreationFlowPreservingAccepted({
      prevRaw: prev,
      nextRaw: rewritten,
      acceptedStepIds: ["美学纲领与交互范式"],
    });
    expect(merged.restored).toEqual([]);
    expect(merged.raw).toBe(rewritten);
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
    expect(view.steps[0]?.runState).toBe("current");
    expect(view.steps[1]?.runState).toBe("pending");
    expect(view.steps[2]?.runState).toBe("pending");
  });

  it("marks accepted steps done and the next pending current", () => {
    const flow = parseCreationFlow(`{
      "brief": "网恋回合",
      "status": "open",
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "name": "生成规则", "depends_on": ["美学纲领与交互范式"] },
        { "id": "生成规则#2", "name": "生成规则", "depends_on": ["生成规则"] }
      ]
    }`)!;
    const view = formatCreationFlowForUser(flow, sampleCatalog, [
      "美学纲领与交互范式",
    ]);
    expect(view.steps.map((s) => s.runState)).toEqual([
      "done",
      "current",
      "pending",
    ]);
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
    expect(
      catalog?.modules.find((m) => m.name === "生成规则")?.kind,
    ).toBe("prior-artifact");
    expect(
      catalog?.modules.find((m) => m.name === "具体实例")?.kind,
    ).toBe("prior-artifact");
    expect(
      catalog?.modules.find((m) => m.name === "生成规则")?.params?.[0]?.key,
    ).toBe("target");
    expect(
      catalog?.modules.find((m) => m.name === "具体实例")?.params?.[0]?.key,
    ).toBe("rule_id");
    expect(
      catalog?.modules.find((m) => m.name === "上下文投影排序")?.auto,
    ).toBe(true);
    const gen = catalog?.modules.find((m) => m.name === "生成规则");
    expect(gen?.when).toBeTruthy();
    expect(gen?.when_not).toBeTruthy();
    expect(gen?.boundary).toBeTruthy();
    const block = formatModuleCatalogForAgent(catalog!);
    expect(block).toContain("【能力");
    expect(block).toContain("美学纲领与交互范式：");
    expect(block).toContain("生成规则〔可反复〕〔先验产物〕");
    expect(block).toContain("开场白与开场变量〔收口〕");
    expect(block).toContain("上下文投影排序〔程序步〕");
    expect(block).toContain("何时用");
    expect(block).toContain("何时不用");
    expect(block).toContain("规划产物字段");
    expect(block).toContain("编排参数");
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
    const ws = details.find((d) => d.id === "world-simulator");
    expect(ws?.when).toBeTruthy();
    expect(ws?.core).toBeTruthy();
    expect(ws?.process).toBeTruthy();
    expect(ws?.principles).toBeTruthy();
    expect(
      ws?.seed?.steps.some((s) => s.name === "美学纲领与交互范式"),
    ).toBe(true);
    expect(ws?.seed?.status).toBe("open");
    const formatted = formatSelectedRecipeForAgent(ws!);
    expect(formatted).toContain("核心思路");
    expect(formatted).toContain("设计流程");
    expect(formatted).toContain("原则");
    expect(formatted).not.toContain("调味提示");
  });

  it("parses selected recipe ref", () => {
    expect(parseSelectedRecipeRef("world-simulator")).toBe("world-simulator");
    expect(parseSelectedRecipeRef('{"id":"expand-assistant","name":"扩写助手"}')).toBe(
      "expand-assistant",
    );
    expect(parseSelectedRecipeRef("")).toBeNull();
  });

  it("parses recipe yaml with methodology fields", () => {
    const detail = parseRecipeYaml(
      `
when: 测试适用
core: 核心一句话
process:
  - 先美学
  - 再按缺口选型
principles:
  - 正推
brief: 测试 brief
steps:
  - name: 美学纲领与交互范式
    depends_on: []
`,
      { id: "t", name: "测试配方", declaration: "测" },
    );
    expect(detail.when).toBe("测试适用");
    expect(detail.core).toContain("核心一句话");
    expect(detail.process).toEqual(["先美学", "再按缺口选型"]);
    expect(detail.principles).toEqual(["正推"]);
    expect(detail.seed?.status).toBe("open");
    expect(detail.seed?.steps).toEqual([
      {
        id: "美学纲领与交互范式",
        name: "美学纲领与交互范式",
        depends_on: [],
      },
    ]);
    const formatted = formatSelectedRecipeForAgent(detail);
    expect(formatted).toContain("用户已选配方");
    expect(formatted).toContain("核心思路");
    expect(formatted).toContain("增量");

    const seeded = creationFlowFromRecipeSeed(detail);
    expect(seeded?.steps[0]?.name).toBe("美学纲领与交互范式");
    expect(seeded?.status).toBe("open");
    const raw = stringifyCreationFlow(seeded!);
    expect(parseCreationFlow(raw)?.steps[0]?.id).toBe("美学纲领与交互范式");
    expect(creationFlowFromRecipeSeed({ seed: null })).toBeNull();
    expect(
      creationFlowFromRecipeSeed({
        seed: { version: 1, status: "open", steps: [] },
      }),
    ).toBeNull();
  });

  it("falls back to legacy hint when methodology absent", () => {
    const detail = parseRecipeYaml(
      `
when: 旧配方
hint: 可调味
steps:
  - name: 美学纲领与交互范式
    depends_on: []
`,
      { id: "legacy", name: "旧", declaration: "测" },
    );
    expect(detail.hint).toBe("可调味");
    expect(formatSelectedRecipeForAgent(detail)).toContain("调味提示（旧字段）");
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
    expect(selected.promptBody).toContain("【用户已选配方 · 世界模拟器】");
    expect(selected.promptBody).toContain("世界模拟器");
    expect(selected.promptBody).toContain("【能力");
    expect(selected.promptBody).toContain("美学纲领与交互范式");
    expect(selected.promptBody).toContain("核心思路");
    expect(selected.promptBody).toContain("何时用");
    expect(selected.promptBody).toContain("增量");
    expect(selected.promptBody).toContain("【流程进度】");
    expect(selected.promptBody).not.toContain("【导演】用户尚未手动选择");
  });

  it("tells design-flow which steps are done and not to reschedule them", async () => {
    const flowRaw = JSON.stringify({
      steps: [{ name: "美学纲领与交互范式", depends_on: [] }],
    });
    const loaded = await loadWorkerSkillWithContext(
      "world-simulator",
      "design-flow",
      undefined,
      {
        selectedRecipeRef: "world-simulator",
        flowRaw,
        acceptedStepNames: ["美学纲领与交互范式"],
        filledArtifactTags: ["设计.美学纲领与交互范式"],
      },
    );
    expect(loaded.promptBody).toContain("【流程进度】");
    expect(loaded.promptBody).toContain("已完成：");
    expect(loaded.promptBody).toContain("美学纲领与交互范式");
    expect(loaded.promptBody).toContain("已验收");
    expect(loaded.promptBody).toContain("禁止再排新建");
    expect(loaded.promptBody).toContain("mode=revise");
    expect(loaded.promptBody).toContain("生成规则");
  });

  it("formatFlowProgressForAgent keeps seed steps as draft not new work", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] }
      ]
    }`)!;
    const text = formatFlowProgressForAgent({
      flow,
      acceptedStepIds: [],
      catalog: sampleCatalog,
    });
    expect(text).toContain("草案已有、尚未验收");
    expect(text).toContain("美学纲领与交互范式");
    expect(text).toContain("不要当作新规划再写一遍");
    expect(text).toContain("可反复追加：生成规则、具体实例");
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
    expect(loaded.worker.outputTags).not.toContain("创作.当前步骤");
    expect(loaded.worker.inputTags).toContain("创作.当前步骤");
    expect(loaded.promptBody).toContain("美学纲领与交互范式");
    expect(loaded.promptBody).toContain("体验契约");
    expect(loaded.promptBody).toContain("程序开场");
    expect(loaded.promptBody).toContain("【本步参数】");
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

    expect(
      shouldSkipModuleOpening({
        demand: "丧尸世界只有我不会被感染",
        dependsOn: [],
      }),
    ).toBe(true);
    expect(
      shouldSkipModuleOpening({
        demand: "丧尸世界只有我不会被感染",
        dependsOn: ["美学纲领与交互范式"],
      }),
    ).toBe(false);
    expect(
      shouldSkipModuleOpening({
        demand: "",
        dependsOn: [],
      }),
    ).toBe(false);
    expect(
      shouldSkipModuleOpening({
        demand: "已有需求",
        dependsOn: [],
        phase: "shown",
      }),
    ).toBe(false);
    expect(isProgressPointerTag("创作.当前步骤")).toBe(true);
    expect(isProgressPointerTag("设计.美学纲领与交互范式")).toBe(false);
    expect(isProgressPointerTag("设计.创作流程")).toBe(false);

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

  it("parses and validates step params from catalog", async () => {
    const flow = parseCreationFlow(`{
      "status": "open",
      "steps": [
        {
          "id": "生成规则·怪物",
          "name": "生成规则",
          "params": { "target": "怪物", "lifecycle_intent": "runtime_only" },
          "depends_on": []
        }
      ]
    }`)!;
    expect(flow.steps[0]?.params).toEqual({
      target: "怪物",
      lifecycle_intent: "runtime_only",
    });
    const view = formatCreationFlowForUser(flow);
    expect(view.steps[0]?.params?.target).toBe("怪物");

    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const rules = catalog?.modules.find((m) => m.name === "生成规则");
    expect(rules?.kind).toBe("prior-artifact");
    expect(rules?.params?.some((p) => p.key === "target")).toBe(true);
    expect(validateCreationFlow(flow, catalog).ok).toBe(true);

    const missing = parseCreationFlow(`{
      "steps": [{ "name": "生成规则", "depends_on": [] }]
    }`)!;
    // 先验产物：编排期允许空壳，确认开干也不拦
    expect(validateCreationFlow(missing, catalog).ok).toBe(true);
    const stepReady = validateStepReadyToRun(missing.steps[0]!, catalog);
    expect(stepReady.ok).toBe(true);
    const missingView = formatCreationFlowForUser(missing, catalog);
    expect(missingView.steps[0]?.kind).toBe("prior-artifact");
    expect(missingView.steps[0]?.paramsMissing).toBeUndefined();

    const block = formatModuleCatalogForAgent(catalog!);
    expect(block).toContain("规划产物字段");
    expect(block).toContain("target");
  });

  it("injects step params into design-step prompt", async () => {
    const flowRaw = JSON.stringify({
      steps: [
        {
          id: "生成规则·怪物",
          name: "生成规则",
          params: { target: "怪物", rule_id: "monsters" },
          depends_on: [],
        },
      ],
    });
    const loaded = await loadWorkerSkillWithContext(
      "world-simulator",
      "design-step",
      undefined,
      {
        flowRaw,
        currentStepName: "生成规则·怪物",
        acceptedStepNames: [],
      },
    );
    expect(loaded.promptBody).toContain("【规划产物】");
    expect(loaded.promptBody).not.toContain("勿再问「生成什么");
    expect(loaded.promptBody).toContain("target: 怪物");
    expect(loaded.promptBody).toContain("rule_id: monsters");
    expect(loaded.worker.outputTags).toContain("设计.生成规则");
  });

  it("injects empty prior-artifact plan and still lets the step run", async () => {
    const catalog = parseModuleCatalog(`
modules:
  - name: 生成规则
    declaration: 可执行规则
    artifact: 设计.生成规则
    kind: prior-artifact
    params:
      - key: target
        label: 生成对象
        required: true
`)!;
    const empty = parseCreationFlow(`{
      "steps": [{ "name": "生成规则", "depends_on": [] }]
    }`)!;
    expect(catalog.modules[0]?.kind).toBe("prior-artifact");
    expect(validateStepReadyToRun(empty.steps[0]!, catalog).ok).toBe(true);

    const loaded = await loadWorkerSkillWithContext(
      "world-simulator",
      "design-step",
      undefined,
      {
        flowRaw: JSON.stringify({
          steps: [{ id: "生成规则", name: "生成规则", depends_on: [] }],
        }),
        currentStepName: "生成规则",
        acceptedStepNames: [],
      },
    );
    expect(loaded.promptBody).toContain("【规划产物】");
    expect(loaded.promptBody).toContain("尚未规划本步具体写什么");
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

  it("pickRecordedStepId ignores LLM junk on 创作.当前步骤", () => {
    const flow = parseCreationFlow(`{
      "status": "open",
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "name": "生成规则", "depends_on": ["美学纲领与交互范式"] }
      ]
    }`)!;
    expect(
      pickRecordedStepId({
        flow,
        alreadyAccepted: [],
        pinnedUnitId: "美学纲领与交互范式",
        writtenCurrentStep: JSON.stringify({
          schema: "context-fragment.v1",
          正文: { 交互范式: {}, 美学纲领: {} },
        }),
      }),
    ).toBe("美学纲领与交互范式");
    expect(
      pickRecordedStepId({
        flow,
        alreadyAccepted: [],
        pinnedUnitId: "flow",
        writtenCurrentStep: "交互范式",
      }),
    ).toBe("美学纲领与交互范式");
    expect(
      pickRecordedStepId({
        flow,
        alreadyAccepted: ["美学纲领与交互范式"],
        pinnedUnitId: "",
        writtenCurrentStep: "",
      }),
    ).toBe("生成规则");
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

  it("allows revising a non-repeatable skill and infers revises + id", () => {
    const flow = parseCreationFlow(`{
      "status": "open",
      "steps": [
        { "name": "实现机制", "depends_on": [] },
        { "name": "实现机制", "mode": "回头修改", "depends_on": ["实现机制"] }
      ]
    }`)!;
    expect(flow.steps[1]).toMatchObject({
      id: "实现机制·改",
      name: "实现机制",
      mode: "revise",
      revises: "实现机制",
    });
    expect(validateCreationFlow(flow, sampleCatalog).ok).toBe(true);
    const view = formatCreationFlowForUser(flow, sampleCatalog, ["实现机制"]);
    expect(view.steps[1]?.mode).toBe("revise");
    expect(view.steps[1]?.occurrence).toBeUndefined();
    expect(view.steps[1]?.runState).toBe("current");
  });

  it("still rejects two fresh copies of a non-repeatable skill", () => {
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

  it("treats a second generation-rules step as fresh, not revise", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        { "id": "生成规则·怪物", "name": "生成规则", "params": { "target": "怪物" }, "depends_on": [] },
        { "id": "生成规则·NPC", "name": "生成规则", "params": { "target": "NPC" }, "depends_on": ["生成规则·怪物"] }
      ]
    }`)!;
    expect(flow.steps[1]?.mode).toBeUndefined();
    expect(validateCreationFlow(flow, sampleCatalog).ok).toBe(true);
  });

  it("revise of generation-rules inherits params from the origin step", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        {
          "id": "生成规则·怪物",
          "name": "生成规则",
          "params": { "target": "怪物", "rule_id": "monsters" },
          "depends_on": []
        },
        {
          "id": "生成规则·怪物·改",
          "name": "生成规则",
          "mode": "revise",
          "revises": "生成规则·怪物",
          "depends_on": ["生成规则·怪物"]
        }
      ]
    }`)!;
    expect(flow.steps[1]?.params).toEqual({
      target: "怪物",
      rule_id: "monsters",
    });
    expect(validateCreationFlow(flow, sampleCatalog).ok).toBe(true);
  });

  it("nextPendingStep prefers a ready revise over a later fresh step", () => {
    const flow = parseCreationFlow(`{
      "status": "open",
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "name": "生成规则", "depends_on": ["美学纲领与交互范式"] },
        {
          "name": "美学纲领与交互范式",
          "mode": "revise",
          "revises": "美学纲领与交互范式",
          "depends_on": ["美学纲领与交互范式"]
        }
      ]
    }`)!;
    expect(nextPendingStep(flow, ["美学纲领与交互范式"])?.mode).toBe("revise");
    expect(nextPendingStep(flow, ["美学纲领与交互范式"])?.id).toBe(
      "美学纲领与交互范式·改",
    );
  });

  it("injects inherit draft and skips opening on a revise design-step", async () => {
    const flowRaw = JSON.stringify({
      status: "open",
      steps: [
        { id: "美学纲领与交互范式", name: "美学纲领与交互范式", depends_on: [] },
        {
          id: "美学纲领与交互范式·改",
          name: "美学纲领与交互范式",
          mode: "revise",
          revises: "美学纲领与交互范式",
          depends_on: ["美学纲领与交互范式"],
        },
      ],
    });
    const binding = await resolveDesignStepBinding({
      skillPackRoot: "dialogue/world-simulator",
      flowRaw,
      currentStepName: "美学纲领与交互范式·改",
      acceptedStepNames: ["美学纲领与交互范式"],
    });
    expect(binding?.opening).toBeNull();
    expect(binding?.inheritTag).toBe("设计.美学纲领与交互范式");

    const loaded = await loadWorkerSkillWithContext(
      "world-simulator",
      "design-step",
      undefined,
      {
        flowRaw,
        currentStepName: "美学纲领与交互范式·改",
        acceptedStepNames: ["美学纲领与交互范式"],
      },
    );
    expect(loaded.promptBody).toContain("【回头修改】");
    expect(loaded.promptBody).not.toContain("程序开场");
    expect(loaded.worker.name).toContain("回头修改");
    expect(loaded.worker.inputTags).toContain("设计.美学纲领与交互范式");
    expect(
      loaded.worker.contextSegments?.some((s) => s.id === "inherit-existing"),
    ).toBe(true);
  });
});
