/**
 * 创作流程 parse / validate / catalog / recipes
 */
import { describe, expect, it } from "vitest";
import {
  artifactTagForStep,
  extractModuleOpening,
  formatCreationFlowForUser,
  deriveFlowStepTitle,
  titleFromSuggestion,
  formatFlowProgressForAgent,
  listCallableCatalogModules,
  formatModuleCatalogForAgent,
  formatModuleCatalogForDictate,
  catalogModulesForIntake,
  formatRecipeCatalogForAgent,
  formatDictateRecipeBrief,
  formatRecipeExamplesForCreationPlan,
  formatSelectedRecipeForAgent,
  isCreationFlowComplete,
  loadAllRecipeDetails,
  loadModuleCatalog,
  loadModulePrompt,
  loadRecipeCatalog,
  loadRecipeDetail,
  mergeCreationFlowPreservingAccepted,
  needsFlowExpansion,
  nextPendingStep,
  listReadySteps,
  computeStepLayers,
  spawnRepeatableCreationStep,
  repeatableInstanceProductTag,
  spawnInstanceFromPrototype,
  hasSelectableCreationWork,
  hasAcceptedCloserStep,
  removeUnstartedInstance,
  removeRepeatableInstance,
  pruneRepeatableArtifactContent,
  looksLikeCreationFlowDoc,
  parseCreationFlow,
  pickRecordedStepId,
  parseModuleCatalog,
  parseModuleOpeningState,
  parseRecipeCatalog,
  parseRecipeYaml,
  parseSelectedRecipeRef,
  resolveDesignStepBinding,
  isProgressPointerTag,
  stringifyCreationFlow,
  stripReviseSteps,
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
  - name: 开场白与开场变量
    declaration: 收口
    artifact: 设计.开场白与开场变量
    closer: true
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
    expect(parseCreationFlow(merged.raw)!.steps.map((s) => s.id)).toEqual([
      "美学纲领与交互范式",
      "实现机制",
    ]);
  });

  it("drops planner revise steps when merging flow", () => {
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
        {
          "id": "美学纲领与交互范式·改",
          "name": "美学纲领与交互范式",
          "mode": "revise",
          "revises": "美学纲领与交互范式",
          "depends_on": ["美学纲领与交互范式"]
        },
        { "id": "实现机制", "name": "实现机制", "depends_on": ["美学纲领与交互范式·改"] }
      ]
    }`;
    const merged = mergeCreationFlowPreservingAccepted({
      prevRaw: prev,
      nextRaw: rewritten,
      acceptedStepIds: ["美学纲领与交互范式"],
    });
    const flow = parseCreationFlow(merged.raw)!;
    expect(flow.steps.map((s) => s.id)).toEqual([
      "美学纲领与交互范式",
      "实现机制",
    ]);
    expect(flow.steps[1]?.depends_on).toEqual(["美学纲领与交互范式"]);
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

  it("extracts JSON from a code fence", () => {
    const flow = parseCreationFlow(
      "```json\n{\"brief\":\"单角代入\",\"steps\":[{\"name\":\"美学纲领与交互范式\",\"depends_on\":[]}]}\n```",
    );
    expect(flow?.brief).toBe("单角代入");
    expect(flow?.steps[0]?.name).toBe("美学纲领与交互范式");
  });

  it("recognizes a DAG object and ignores brief-only objects", () => {
    expect(
      looksLikeCreationFlowDoc({
        brief: "单角代入",
        steps: [{ name: "美学纲领与交互范式", depends_on: [] }],
      }),
    ).toBe(true);
    expect(looksLikeCreationFlowDoc({ brief: "单角代入" })).toBe(false);
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
    expect(view.steps[2]?.role).toBe("instance");
    expect(view.steps[2]?.occurrence).toBe(1);
    expect(view.steps[1]?.role).toBe("prototype");
    expect(view.steps[2]?.repeatable).toBe(true);
    expect(view.steps[0]?.runState).toBe("pending");
    expect(view.steps[0]?.layer).toBe(0);
    expect(view.steps[0]?.ready).toBe(true);
    expect(view.steps[0]?.selectable).toBe(true);
    expect(view.availableModules?.map((m) => m.name)).toEqual([
      "实现机制",
      "具体实例",
      "开场白与开场变量",
    ]);
    expect(view.steps[1]?.runState).toBe("pending");
    expect(view.steps[1]?.layer).toBe(1);
    expect(view.steps[1]?.ready).toBe(false);
    expect(view.steps[2]?.runState).toBe("pending");
  });

  it("shows a short title for 生成规则 / 具体实例 prototypes and instances", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        {
          "id": "生成规则",
          "name": "生成规则",
          "role": "prototype",
          "suggestion": "幸存者生成规则：锚定出租屋内的女性租客",
          "depends_on": []
        },
        {
          "id": "生成规则#1",
          "name": "生成规则",
          "role": "instance",
          "from": "生成规则",
          "depends_on": []
        },
        {
          "id": "具体实例",
          "name": "具体实例",
          "role": "prototype",
          "suggestion": "按幸存者规则生成开局女租客",
          "depends_on": ["生成规则"]
        },
        {
          "id": "具体实例#1",
          "name": "具体实例",
          "role": "instance",
          "from": "具体实例",
          "params": { "batch_goal": "开局女租客", "rule_id": "survivors" },
          "depends_on": ["生成规则#1"]
        }
      ]
    }`)!;
    const untitled = formatCreationFlowForUser(flow, sampleCatalog);
    expect(untitled.steps.find((s) => s.id === "生成规则")?.title).toBe(
      "幸存者生成规则",
    );
    expect(untitled.steps.find((s) => s.id === "生成规则#1")?.title).toBe(
      "幸存者生成规则",
    );
    expect(untitled.steps.find((s) => s.id === "具体实例")?.title).toBe(
      "按幸存者规则生成开局女租客",
    );
    expect(untitled.steps.find((s) => s.id === "具体实例#1")?.title).toBe(
      "开局女租客",
    );

    const accepted = formatCreationFlowForUser(flow, sampleCatalog, [], [], {
      "生成规则#1": { summary: "生成规则 · 幸存者 · 预生成并动态" },
      "具体实例#1": { summary: "具体实例 · 女租客 · 2条" },
    });
    expect(accepted.steps.find((s) => s.id === "生成规则#1")?.title).toBe(
      "幸存者",
    );
    expect(accepted.steps.find((s) => s.id === "具体实例#1")?.title).toBe(
      "女租客",
    );
    expect(
      deriveFlowStepTitle({
        name: "生成规则",
        hint: {
          content: {
            正文: { 本步参数: { target: "女租客" } },
          },
        },
      }),
    ).toBe("女租客");
    expect(titleFromSuggestion("怪物生成规则：按族群抽样")).toBe(
      "怪物生成规则",
    );
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
      "pending",
      "pending",
    ]);
    expect(view.steps[1]?.selectable).toBe(true);
  });

  it("loads world-simulator catalog and formats for agent", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    expect(catalog?.modules.some((m) => m.name === "美学纲领与交互范式")).toBe(
      true,
    );
    expect(catalog?.modules.some((m) => m.name === "主角设定")).toBe(true);
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
      catalog?.modules.find((m) => m.name === "上下文排序")?.auto,
    ).toBe(true);
    const gen = catalog?.modules.find((m) => m.name === "生成规则");
    expect(gen?.when).toBeTruthy();
    expect(gen?.when_not).toBeTruthy();
    expect(gen?.boundary).toBeTruthy();
    const block = formatModuleCatalogForAgent(catalog!);
    expect(block).toContain("【能力");
    expect(block).toContain("美学纲领与交互范式：");
    expect(block).toContain("生成规则〔可反复〕〔先验产物〕");
    expect(block).toContain("上下文排序〔程序步〕");
    expect(block).toContain("何时用");
    expect(block).toContain("何时不用");
    expect(block).toContain("role=prototype");
    expect(block).toContain("编排参数");
    expect(block).not.toContain("设计.美学纲领与交互范式");
    expect(block).toContain("- 叙事指南与故事推进：");
    expect(block).not.toMatch(/^- 叙事指南：/m);
    expect(block).not.toMatch(/^- 故事推进：/m);
    const dictateBlock = formatModuleCatalogForDictate(catalog!);
    expect(dictateBlock).toMatch(/^- 叙事指南：/m);
    expect(dictateBlock).toMatch(/^- 故事推进：/m);
    expect(dictateBlock).toContain("开场白与开场变量〔可反复〕〔收口〕");
    expect(dictateBlock).toContain("信息可见范围〔落档程序〕");
    expect(dictateBlock).not.toMatch(/^- 叙事指南与故事推进/m);
    expect(
      catalog?.modules.find((m) => m.name === "叙事指南与故事推进")?.intake,
    ).toBe("recipe");
    expect(catalog?.modules.find((m) => m.name === "叙事指南")?.intake).toBe(
      "dictate",
    );
    expect(catalog?.modules.find((m) => m.name === "故事推进")?.intake).toBe(
      "dictate",
    );
    expect(catalog?.modules.find((m) => m.name === "故事推进")?.libraries).toEqual([
      "preferences",
    ]);
    expect(catalog?.modules.some((m) => m.id === "user-requirements")).toBe(false);
    expect(
      catalog?.modules.find((m) => m.name === "叙事指南")?.libraries,
    ).toEqual(["style-packs"]);
    expect(
      catalog?.modules.find((m) => m.name === "叙事指南与故事推进")?.libraries,
    ).toEqual(["style-packs"]);
    expect(dictateBlock).not.toContain("【偏好库 · 可选用】");
    expect(
      catalogModulesForIntake(catalog!, "recipe").some(
        (m) => m.name === "叙事指南",
      ),
    ).toBe(false);
    expect(
      catalogModulesForIntake(catalog!, "dictate").some(
        (m) => m.name === "叙事指南与故事推进",
      ),
    ).toBe(false);

    const leftover = listCallableCatalogModules({ catalog: catalog! });
    expect(leftover.some((m) => m.name === "叙事指南与故事推进")).toBe(true);
    expect(leftover.some((m) => m.name === "叙事指南")).toBe(false);
    expect(leftover.some((m) => m.name === "故事推进")).toBe(false);

    const splitFlow = parseCreationFlow(`{
      "steps": [{ "name": "叙事指南", "depends_on": [] }]
    }`)!;
    expect(validateCreationFlow(splitFlow, catalog).ok).toBe(false);
  });

  it("loads recipe catalog for user director selection UI", async () => {
    const recipes = await loadRecipeCatalog("dialogue/world-simulator");
    expect(recipes?.recipes.some((r) => r.name === "回合推演")).toBe(true);
    expect(recipes?.recipes.some((r) => r.name === "扩写助手")).toBe(true);
    expect(recipes?.recipes.some((r) => r.name === "文本生成器")).toBe(false);
    const block = formatRecipeCatalogForAgent(recipes!);
    expect(block).toContain("须由用户手动选择");
    expect(block).toContain("回合推演");

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

  it("loads dictate recipe catalog separately with Chinese ids", async () => {
    const dictate = await loadRecipeCatalog(
      "dialogue/world-simulator",
      undefined,
      "dictate",
    );
    expect(dictate?.recipes.some((r) => r.id === "文本生成器")).toBe(true);
    expect(dictate?.recipes.some((r) => r.name === "文本生成器")).toBe(true);
    expect(dictate?.recipes.some((r) => r.name === "交互式长文生成器")).toBe(true);
    expect(dictate?.recipes.some((r) => r.name === "数据化跑团体验")).toBe(true);
    expect(dictate?.recipes.some((r) => r.id === "快穿短局")).toBe(true);
    expect(dictate?.recipes.some((r) => r.name === "快穿短局")).toBe(true);
    expect(dictate?.recipes.some((r) => r.id === "正文组成")).toBe(false);
    expect(dictate?.recipes).toHaveLength(4);
    expect(dictate?.recipes[0]?.id).toBe("快穿短局");
    const entry = dictate!.recipes.find((r) => r.id === "文本生成器")!;
    expect(entry.family).toBe("dictate");
    const detail = await loadRecipeDetail("dialogue/world-simulator", entry);
    expect(detail.method?.join("")).toMatch(/范例|写法|输入/);
    expect(detail.tierTendencies?.some((item) => item.module_id === "narrative-guide")).toBe(true);
    expect(detail.seed).toBeNull();

    const longform = dictate!.recipes.find((r) => r.id === "交互式长文生成器")!;
    const longDetail = await loadRecipeDetail("dialogue/world-simulator", longform);
    expect(longDetail.brief).toMatch(/长连续/);
    expect(longDetail.method?.join("")).toMatch(/变量|动态表/);
    expect(longDetail.method?.join("")).toMatch(/硬机制|数据化跑团/);

    const rpg = dictate!.recipes.find((r) => r.id === "数据化跑团体验")!;
    const rpgDetail = await loadRecipeDetail("dialogue/world-simulator", rpg);
    expect(rpgDetail.brief).toMatch(/硬判断|结构化状态/);
    expect(rpgDetail.method?.join("")).toMatch(/长短|连续性/);
    expect(rpgDetail.tierTendencies?.some((item) => item.module_id === "mechanism")).toBe(true);

    const skip = dictate!.recipes.find((r) => r.id === "快穿短局")!;
    const skipDetail = await loadRecipeDetail("dialogue/world-simulator", skip);
    expect(skipDetail.seed).toBeNull();
    expect(skipDetail.brief).toMatch(/体验核|短反馈/);
    expect(skipDetail.signals?.join("")).toMatch(/快穿|一次性|短任务/);

    const examples = formatRecipeExamplesForCreationPlan([
      detail,
      longDetail,
      rpgDetail,
      skipDetail,
    ]);
    expect(examples).toContain("适用信号");
    expect(examples).toContain("档位倾向");
    expect(examples).toContain("variable-design=有必要");
    expect(examples).not.toContain("固定路径");
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
    expect(formatted).toContain("开局 steps");

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

  it("creationFlowFromRecipeSeed follows the recipe steps, not a fixed first node", () => {
    const detail = parseRecipeYaml(
      `
when: 其它剧本
steps:
  - name: 舞台骨架
    depends_on: []
  - name: 实现机制
    depends_on: ["舞台骨架"]
`,
      { id: "other", name: "其它", declaration: "测" },
    );
    const seeded = creationFlowFromRecipeSeed(detail);
    expect(seeded?.steps.map((s) => s.name)).toEqual(["舞台骨架", "实现机制"]);
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
      { id: "ok", name: "好配方", declaration: "有声明", family: "recipe" },
    ]);
  });

  it("injects selected recipe into design-flow", async () => {
    const selected = await loadWorkerSkillWithContext(
      "world-simulator",
      "design-flow",
      undefined,
      { selectedRecipeRef: "world-simulator" },
    );
    expect(selected.worker.outputTags).toContain("设计.创作流程");
    expect(selected.promptBody).toContain("【用户已选配方 · 回合推演】");
    expect(selected.promptBody).toContain("回合推演");
    expect(selected.promptBody).toContain("【能力");
    expect(selected.promptBody).toContain("美学纲领与交互范式");
    expect(selected.promptBody).toContain("核心思路");
    expect(selected.promptBody).toContain("何时用");
    expect(selected.promptBody).toContain("开局 steps");
    expect(selected.promptBody).toContain("【流程进度】");
    expect(selected.promptBody).not.toContain("用户尚未手动选择");
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
    expect(loaded.promptBody).toContain("这一面已覆盖");
    expect(loaded.promptBody).toContain("要改则用户点该节点重进");
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
    expect(text).toContain("保留原 id");
    expect(text).toContain("目录〔可反复〕：生成规则、具体实例");
    expect(text).toContain("尚未编入、仍可调用");
    expect(text).toContain("实现机制");
    const leftoverAt = text.indexOf("尚未编入、仍可调用");
    expect(leftoverAt).toBeGreaterThan(-1);
    expect(text.slice(leftoverAt)).not.toContain("美学纲领与交互范式");
  });

  it("listCallableCatalogModules skips scheduled names and filled non-repeatable artifacts", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "name": "生成规则", "role": "prototype", "depends_on": ["美学纲领与交互范式"] }
      ]
    }`)!;
    const leftover = listCallableCatalogModules({
      flow,
      catalog: sampleCatalog,
      filledArtifactTags: ["设计.实现机制"],
    });
    expect(leftover.map((m) => m.name)).toEqual([
      "具体实例",
      "开场白与开场变量",
    ]);
  });

  it("tells design-flow to insert nodes before an unaccepted closer", () => {
    const catalog = parseModuleCatalog(`
modules:
  - name: 美学纲领与交互范式
    declaration: 站位
    artifact: 设计.美学纲领与交互范式
  - name: 开场白与开场变量
    declaration: 收口
    artifact: 设计.开场白与开场变量
    closer: true
`)!;
    const flow = parseCreationFlow(`{
      "status": "closed",
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "name": "开场白与开场变量", "depends_on": ["美学纲领与交互范式"] }
      ]
    }`)!;
    const text = formatFlowProgressForAgent({
      flow,
      acceptedStepIds: ["美学纲领与交互范式"],
      catalog,
    });
    expect(text).toContain("〔收口〕");
    expect(text).toContain("开场白与开场变量");
    expect(text).toContain("插在收口之前");
    expect(text).toContain("status 改回 open");
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
    expect(opening).toContain("反复获得什么体验");
    expect(opening).toContain("站在什么位置");
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
    expect(binding?.opening).toContain("反复获得什么体验");
    expect(binding?.modulePrompt).toContain("```task");
    expect(binding?.modulePrompt).not.toContain("最想反复感受到的是什么");
  });

  it("loads the migrated world-blueprint contract", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const module = catalog?.modules.find((item) => item.id === "world-blueprint");
    expect(module?.layer).toBe("final");
    expect(module?.mount).toEqual(["world-simulator"]);

    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "world-blueprint",
    );
    const { parseModulePromptSections } = await import(
      "../src/skills/creation-flow.js"
    );
    const sections = parseModulePromptSections(prompt!);
    expect(sections.blocks.task).toContain("稳定反馈");
    expect(sections.blocks.output).toContain('"核心运转"');
    expect(sections.blocks.output).not.toContain('"自评"');
    expect(sections.blocks.output).not.toContain('"追问"');
    expect(sections.blocks.score).toContain("支撑度");
    expect(sections.blocks.score).toContain("克制度");
    expect(sections.blocks.score).not.toContain("0–10");
  });

  it("loads the migrated generation-rules contract", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const module = catalog?.modules.find((item) => item.id === "generation-rules");
    expect(module?.layer).toBe("final");
    expect(module?.mount).toEqual(["world-simulator", "auditor"]);
    expect(module?.repeatable).toBe(true);

    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "generation-rules",
    );
    const { parseModulePromptSections } = await import(
      "../src/skills/creation-flow.js"
    );
    const sections = parseModulePromptSections(prompt!);
    expect(sections.blocks.meta).toContain("两份或以上");
    expect(sections.blocks.task).toContain("填写工作流");
    expect(sections.blocks.output).toContain('"字段"');
    expect(sections.blocks.output).toContain('"填写工作流"');
    expect(sections.blocks.output).toContain('"依赖关系"');
    expect(sections.blocks.output).not.toContain('"rules"');
    expect(sections.blocks.output).not.toContain('"自评"');
    expect(sections.blocks.score).toContain("字段妥当");
    expect(sections.blocks.score).toContain("池与提示");
    expect(sections.blocks.score).toContain("填写工作流");
  });

  it("loads the migrated concrete-instances contract", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const module = catalog?.modules.find(
      (item) => item.id === "concrete-instances",
    );
    expect(module?.layer).toBe("final");
    expect(module?.mount).toEqual(["world-simulator"]);
    expect(module?.repeatable).toBe(true);

    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "concrete-instances",
    );
    const { parseModulePromptSections } = await import(
      "../src/skills/creation-flow.js"
    );
    const sections = parseModulePromptSections(prompt!);
    expect(sections.blocks.meta).toContain("字段很少");
    expect(sections.blocks.task).toContain("一份产物只含一条记录");
    expect(sections.blocks.output).toContain('"名称"');
    expect(sections.blocks.output).toContain('"记录"');
    expect(sections.blocks.output).not.toContain('"自评"');
    expect(sections.blocks.score).toContain("工作流符合度");
    expect(sections.blocks.score).not.toContain("充实度");
  });

  it("loads the migrated narrative-guide contract", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const module = catalog?.modules.find((item) => item.id === "narrative-guide");
    expect(module?.layer).toBe("final");
    expect(module?.mount).toEqual(["narrator", "world-simulator"]);
    expect(module?.libraries).toEqual(["style-packs"]);

    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "narrative-guide",
    );
    const { parseModulePromptSections } = await import(
      "../src/skills/creation-flow.js"
    );
    const sections = parseModulePromptSections(prompt!);
    expect(sections.blocks.task).toContain("read_library_entry");
    expect(sections.blocks.task).toContain("风格推荐");
    expect(sections.blocks.output).toContain('"选用文风"');
    expect(sections.blocks.output).toContain('"写法要求"');
    expect(sections.blocks.output).not.toContain('"示范"');
    expect(sections.blocks.output).not.toContain('"自评"');
    expect(sections.blocks.score).toContain("遣词可执行");
    expect(sections.blocks.score).toContain("文风选用");
    expect(sections.blocks.score).toContain("本局化");
  });

  it("loads the migrated story-progression contract", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const module = catalog?.modules.find(
      (item) => item.id === "story-progression",
    );
    expect(module?.layer).toBe("final");
    expect(module?.mount).toEqual(["world-simulator", "narrator"]);
    expect(module?.libraries).toEqual(["preferences"]);

    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "story-progression",
    );
    const { parseModulePromptSections } = await import(
      "../src/skills/creation-flow.js"
    );
    const sections = parseModulePromptSections(prompt!);
    expect(sections.blocks.task).toContain("只选定一种");
    expect(sections.blocks.task).toContain("read_library_entry");
    expect(sections.blocks.output).toContain('"用户输入用法"');
    expect(sections.blocks.output).toContain('"扩写要求"');
    expect(sections.blocks.output).toContain('"续写要求"');
    expect(sections.blocks.output).toContain('"单轮篇幅"');
    expect(sections.blocks.output).toContain('"目标字数"');
    expect(sections.blocks.output).toContain('"扩写占比"');
    expect(sections.blocks.output).toContain('"续写占比"');
    expect(sections.blocks.output).toContain('"OOC处理"');
    expect(sections.blocks.output).not.toContain('"自评"');
    expect(sections.blocks.score).toContain("唯一性与切分");
    expect(sections.blocks.score).toContain("可执行性");
    expect(sections.blocks.score).toContain("偏好本局化");
  });

  it("loads the migrated mechanism contract", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const module = catalog?.modules.find((item) => item.id === "mechanism");
    expect(module?.layer).toBe("final");
    expect(module?.mount).toEqual(["world-simulator"]);

    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "mechanism",
    );
    const { parseModulePromptSections } = await import(
      "../src/skills/creation-flow.js"
    );
    const sections = parseModulePromptSections(prompt!);
    expect(sections.blocks.task).toContain("多条共同作用");
    expect(sections.blocks.task).toContain("缺失后果");
    expect(sections.blocks.output).toContain('"既成机制"');
    expect(sections.blocks.output).toContain('"因果影响"');
    expect(sections.blocks.output).toContain('"推演口径"');
    expect(sections.blocks.output).toContain('"共同作用"');
    expect(sections.blocks.output).not.toContain('"缺失后果"');
    expect(sections.blocks.output).not.toContain('"自评"');
    expect(sections.blocks.score).toContain("骨架必要度");
    expect(sections.blocks.score).toContain("因果清晰度");
    expect(sections.blocks.score).toContain("推演开放度");
    expect(sections.blocks.examples).toContain("灵气复苏");
    expect(sections.blocks.examples).toContain("全民直播求生");
  });

  it("loads the migrated topology contract", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const module = catalog?.modules.find((item) => item.id === "topology");
    expect(module?.layer).toBe("final");
    expect(module?.mount).toEqual(["world-simulator", "auditor"]);
    expect(module?.repeatable).toBe(true);

    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "topology",
    );
    const { parseModulePromptSections } = await import(
      "../src/skills/creation-flow.js"
    );
    const sections = parseModulePromptSections(prompt!);
    expect(sections.blocks.task).toContain("一张图");
    expect(sections.blocks.task).toContain("static");
    expect(sections.blocks.task).toContain("record");
    expect(sections.blocks.task).toContain("expand");
    expect(sections.blocks.output).toContain('"节点字段"');
    expect(sections.blocks.output).toContain('"连接字段"');
    expect(sections.blocks.output).toContain('"初始图"');
    expect(sections.blocks.output).toContain('"维护规则"');
    expect(sections.blocks.output).not.toContain('"自评"');
    expect(sections.blocks.output).not.toContain("SVG");
    expect(sections.blocks.score).toContain("对象适配");
    expect(sections.blocks.score).toContain("字段合同");
    expect(sections.blocks.score).toContain("初始图有效性");
    expect(sections.blocks.score).toContain("维护可执行性");
    expect(sections.blocks.score).toContain("长期一致性");
  });

  it("loads the migrated variable-design contract", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const module = catalog?.modules.find((item) => item.id === "variable-design");
    expect(module?.layer).toBe("final");
    expect(module?.mount).toEqual(["world-simulator", "auditor"]);

    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "variable-design",
    );
    const { parseModulePromptSections } = await import(
      "../src/skills/creation-flow.js"
    );
    const sections = parseModulePromptSections(prompt!);
    expect(sections.blocks.task).toContain("deterministic");
    expect(sections.blocks.task).toContain("narrative_inference");
    expect(sections.blocks.task).toContain("inline_tool");
    expect(sections.blocks.task).toContain("auditor_bundle");
    expect(sections.blocks.output).toContain('"允许写入者"');
    expect(sections.blocks.output).toContain('"更新规则"');
    expect(sections.blocks.output).toContain('"派生映射"');
    expect(sections.blocks.output).toContain('"触发规则"');
    expect(sections.blocks.output).toContain('"维护复杂度"');
    expect(sections.blocks.output).not.toContain('"自评"');
    expect(sections.blocks.output).not.toContain("maintain.v1");
    expect(sections.blocks.output).not.toContain("隐藏段");
    expect(sections.blocks.score).toContain("真值必要性");
    expect(sections.blocks.score).toContain("字段妥当性");
    expect(sections.blocks.score).toContain("更新可执行性");
    expect(sections.blocks.score).toContain("权限与公开性");
    expect(sections.blocks.score).toContain("映射与触发一致性");
  });

  it("loads the migrated status-bar contract", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const module = catalog?.modules.find((item) => item.id === "status-bar");
    expect(module?.layer).toBe("final");
    expect(module?.mount).toEqual(["world-simulator", "narrator"]);

    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "status-bar",
    );
    const { parseModulePromptSections } = await import(
      "../src/skills/creation-flow.js"
    );
    const sections = parseModulePromptSections(prompt!);
    expect(sections.blocks.task).toContain("语义区域");
    expect(sections.blocks.task).toContain("inline");
    expect(sections.blocks.output).toContain('"语义区域"');
    expect(sections.blocks.output).toContain("program_projection");
    expect(sections.blocks.output).toContain("maintenance_channel");
    expect(sections.blocks.output).toContain("state_ops");
    expect(sections.blocks.output).not.toContain('"启用"');
    expect(sections.blocks.output).not.toContain("1000～2000");
    expect(sections.blocks.output).not.toContain('"自评"');
    expect(sections.blocks.score).toContain("区域必要性");
    expect(sections.blocks.score).toContain("来源一致性");
    expect(sections.blocks.score).toContain("内容可执行性");
    expect(sections.blocks.score).toContain("信息负担");
    expect(sections.blocks.score).toContain("职责边界");
  });

  it("loads the migrated random-range contract", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const module = catalog?.modules.find((item) => item.id === "random-range");
    expect(module?.layer).toBe("final");
    expect(module?.mount).toEqual(["world-simulator"]);

    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "random-range",
    );
    const { parseModulePromptSections } = await import(
      "../src/skills/creation-flow.js"
    );
    const sections = parseModulePromptSections(prompt!);
    expect(sections.blocks.task).toContain("名称.随机数");
    expect(sections.blocks.task).toContain("只剩 1 个");
    expect(sections.blocks.output).toContain("敏捷.随机数");
    expect(sections.blocks.output).not.toContain("票 id");
    expect(sections.blocks.output).not.toContain('"自评"');
    expect(sections.blocks.score).toContain("覆盖度");
    expect(sections.blocks.score).toContain("克制");
  });

  it("loads the migrated reply-format contract", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const module = catalog?.modules.find((item) => item.id === "reply-format");
    expect(module?.layer).toBe("final");
    expect(module?.mount).toEqual(["world-simulator", "narrator"]);

    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "reply-format",
    );
    const { parseModulePromptSections } = await import(
      "../src/skills/creation-flow.js"
    );
    const sections = parseModulePromptSections(prompt!);
    expect(sections.blocks.task).toContain("普通楼层");
    expect(sections.blocks.task).toContain("present.onData");
    expect(sections.blocks.output).toContain('"数据契约"');
    expect(sections.blocks.output).toContain('"区域落点"');
    expect(sections.blocks.output).toContain('"frontend"');
    expect(sections.blocks.output).toContain('"html"');
    expect(sections.blocks.output).toContain('"css"');
    expect(sections.blocks.output).toContain('"js"');
    expect(sections.blocks.output).toContain('"示例灌数"');
    expect(sections.blocks.output).not.toContain('"自评"');
    expect(sections.blocks.score).toContain("区域落实");
    expect(sections.blocks.score).toContain("权威绑定");
    expect(sections.blocks.score).toContain("实现完整");
    expect(sections.blocks.score).toContain("本局化");
  });

  it("loads the migrated opening-setup contract", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const module = catalog?.modules.find((item) => item.id === "opening-setup");
    expect(module?.layer).toBe("final");
    expect(module?.mount).toEqual(["world-simulator", "narrator"]);
    expect(module?.closer).toBe(true);
    expect(module?.repeatable).toBe(true);

    const prompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "opening-setup",
    );
    const { parseModulePromptSections } = await import(
      "../src/skills/creation-flow.js"
    );
    const sections = parseModulePromptSections(prompt!);
    expect(sections.blocks.task).toContain("默认只生成 1 条");
    expect(sections.blocks.task).toContain("@玩家");
    expect(sections.blocks.task).toContain("随机");
    expect(sections.blocks.output).toContain('"默认候选id"');
    expect(sections.blocks.output).toContain('"开场白候选"');
    expect(sections.blocks.output).not.toContain('"开场白全文"');
    expect(sections.blocks.output).toContain("present.v1");
    expect(sections.blocks.output).not.toContain('"自评"');
    expect(sections.blocks.score).toContain("开场必要");
    expect(sections.blocks.score).toContain("前端符合");
    expect(sections.blocks.score).toContain("状态自洽");
    expect(sections.blocks.score).toContain("角色占位");
    expect(sections.blocks.score).toContain("收口可切换");
  });

  it("loads the three zero-layer presentation contracts", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const ids = [
      "zero-layer-status",
      "zero-layer-reply-format",
      "zero-layer-opening-setup",
    ];
    for (const id of ids) {
      const module = catalog?.modules.find((item) => item.id === id);
      expect(module?.layer).toBe("final");
      expect(module?.mount).toEqual(["world-simulator", "narrator"]);
      const prompt = await loadModulePrompt("dialogue/world-simulator", id);
      const { parseModulePromptSections } = await import(
        "../src/skills/creation-flow.js"
      );
      const sections = parseModulePromptSections(prompt!);
      expect(sections.blocks.task).toBeTruthy();
      expect(sections.blocks.output).not.toContain('"自评"');
      expect(sections.blocks.score).toBeTruthy();
    }

    expect(
      catalog?.modules.find((item) => item.id === "zero-layer-opening-setup")
        ?.closer,
    ).toBe(true);
    expect(
      catalog?.modules.find((item) => item.id === "zero-layer-opening-setup")
        ?.repeatable,
    ).toBe(true);
    const formatPrompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "zero-layer-reply-format",
    );
    expect(formatPrompt).toContain("zero-layer.update.v1");
    expect(formatPrompt).toContain("slot_updates");
    expect(formatPrompt).toContain("base_revision");

    const openingPrompt = await loadModulePrompt(
      "dialogue/world-simulator",
      "zero-layer-opening-setup",
    );
    expect(openingPrompt).toContain("zero-layer.card.v1");
    expect(openingPrompt).toContain("@玩家");
    expect(openingPrompt).toContain("不输出任何 `名称.随机数`");
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
    expect(block).toContain("role=prototype");
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
    expect(loaded.promptBody).toContain("【本步对象】");
    expect(loaded.promptBody).toContain("target: 怪物");
    expect(loaded.promptBody).toContain("rule_id: monsters");
    expect(loaded.worker.outputTags).toEqual(["设计.生成规则#monsters"]);
  });

  it("lands each rule, instance, and opening on its own tag", () => {
    const catalog = parseModuleCatalog(`
modules:
  - id: generation-rules
    name: 生成规则
    declaration: 一条规则一份产物
    artifact: 设计.生成规则
    repeatable: true
  - id: concrete-instances
    name: 具体实例
    declaration: 一条记录一份产物
    artifact: 设计.具体实例
    repeatable: true
  - id: opening-setup
    name: 开场白与开场变量
    declaration: 一条开场一份产物
    artifact: 设计.开场白与开场变量
    repeatable: true
    closer: true
  - id: aesthetics-interaction
    name: 美学纲领与交互范式
    declaration: 一次写完
    artifact: 设计.美学纲领与交互范式
`)!;
    const rule = catalog.modules.find((m) => m.id === "generation-rules")!;
    const row = catalog.modules.find((m) => m.id === "concrete-instances")!;
    const opening = catalog.modules.find((m) => m.id === "opening-setup")!;
    const once = catalog.modules.find((m) => m.id === "aesthetics-interaction")!;
    expect(
      repeatableInstanceProductTag({
        module: rule,
        step: { id: "生成规则·怪物", role: "instance", params: { rule_id: "女租客" } },
      }),
    ).toBe("设计.生成规则#女租客");
    expect(
      repeatableInstanceProductTag({
        module: row,
        step: { id: "具体实例#1", role: "instance", params: { batch_goal: "雷樱" } },
      }),
    ).toBe("设计.具体实例#1");
    expect(
      repeatableInstanceProductTag({
        module: row,
        step: { id: "具体实例·雷樱", role: "instance", params: { batch_goal: "雷樱" } },
      }),
    ).toBe("设计.具体实例#雷樱");
    expect(
      repeatableInstanceProductTag({
        module: opening,
        step: { id: "开场白与开场变量#dorm", role: "instance" },
      }),
    ).toBe("设计.开场白#dorm");
    expect(
      repeatableInstanceProductTag({
        module: once,
        step: { id: "美学纲领与交互范式", role: "instance" },
      }),
    ).toBeNull();
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
          steps: [
            {
              id: "生成规则#1",
              name: "生成规则",
              role: "instance",
              from: "生成规则",
              depends_on: [],
            },
          ],
        }),
        currentStepName: "生成规则#1",
        acceptedStepNames: [],
      },
    );
    expect(loaded.promptBody).toContain("【本步对象】");
    expect(loaded.promptBody).toContain("尚未钉本步具体写什么");
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

  it("parses legacy revise steps then strips them from the user graph", () => {
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
    const stripped = stripReviseSteps(flow);
    expect(stripped.steps.map((s) => s.id)).toEqual(["实现机制"]);
    const view = formatCreationFlowForUser(flow, sampleCatalog, ["实现机制"]);
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0]?.id).toBe("实现机制");
    expect(view.steps[0]?.runState).toBe("done");
    expect(view.steps[0]?.mode).toBeUndefined();
  });

  it("stripReviseSteps remaps dependents back to the origin step", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        { "id": "美学纲领与交互范式", "name": "美学纲领与交互范式", "depends_on": [] },
        {
          "id": "美学纲领与交互范式·改",
          "name": "美学纲领与交互范式",
          "mode": "revise",
          "revises": "美学纲领与交互范式",
          "depends_on": ["美学纲领与交互范式"]
        },
        { "id": "正文组成", "name": "实现机制", "depends_on": ["美学纲领与交互范式·改"] }
      ]
    }`)!;
    const stripped = stripReviseSteps(flow);
    expect(stripped.steps.map((s) => s.id)).toEqual([
      "美学纲领与交互范式",
      "正文组成",
    ]);
    expect(stripped.steps[1]?.depends_on).toEqual(["美学纲领与交互范式"]);
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

  it("nextPendingStep ignores orchestrated revise steps", () => {
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
    expect(nextPendingStep(flow, ["美学纲领与交互范式"])?.mode).toBeUndefined();
    expect(nextPendingStep(flow, ["美学纲领与交互范式"])?.id).toBe("生成规则");
    expect(
      listReadySteps(flow, ["美学纲领与交互范式"]).map((s) => s.id),
    ).toEqual(["生成规则"]);
  });

  it("inherits existing artifact when reentering an accepted step", async () => {
    const flowRaw = JSON.stringify({
      status: "open",
      steps: [
        { id: "美学纲领与交互范式", name: "美学纲领与交互范式", depends_on: [] },
      ],
    });
    const binding = await resolveDesignStepBinding({
      skillPackRoot: "dialogue/world-simulator",
      flowRaw,
      currentStepName: "美学纲领与交互范式",
      acceptedStepNames: ["美学纲领与交互范式"],
      inheritExisting: true,
    });
    expect(binding?.opening).toBeNull();
    expect(binding?.inheritTag).toBe("设计.美学纲领与交互范式");

    const loaded = await loadWorkerSkillWithContext(
      "world-simulator",
      "design-step",
      undefined,
      {
        flowRaw,
        currentStepName: "美学纲领与交互范式",
        acceptedStepNames: ["美学纲领与交互范式"],
        inheritExisting: true,
      },
    );
    expect(loaded.promptBody).toContain("【回头修改】");
    expect(loaded.promptBody).not.toContain("程序开场");
    expect(loaded.worker.name).toContain("回头修改");
    expect(loaded.worker.inputTags).toContain("设计.美学纲领与交互范式");
  });

  it("layers follow longest dependency path", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "name": "生成规则", "depends_on": ["美学纲领与交互范式"] },
        { "name": "具体实例", "depends_on": ["生成规则"] },
        { "name": "开场白与开场变量", "depends_on": ["美学纲领与交互范式", "具体实例"] }
      ]
    }`)!;
    const layers = computeStepLayers(flow);
    expect(layers.get("美学纲领与交互范式")).toBe(0);
    expect(layers.get("生成规则")).toBe(1);
    expect(layers.get("具体实例")).toBe(2);
    expect(layers.get("开场白与开场变量")).toBe(3);
  });

  it("listReadySteps returns every unblocked pending step", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "name": "生成规则", "depends_on": ["美学纲领与交互范式"] },
        { "id": "实现机制", "name": "实现机制", "depends_on": ["美学纲领与交互范式"] }
      ]
    }`)!;
    expect(listReadySteps(flow, []).map((s) => s.id)).toEqual([
      "美学纲领与交互范式",
    ]);
    expect(
      listReadySteps(flow, ["美学纲领与交互范式"]).map((s) => s.id),
    ).toEqual(["生成规则", "实现机制"]);
  });

  it("spawns instance from prototype before closer and hangs instance on closer deps", () => {
    const flow = parseCreationFlow(`{
      "status": "open",
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "name": "开场白与开场变量", "depends_on": ["美学纲领与交互范式"] }
      ]
    }`)!;
    expect(
      hasSelectableCreationWork(flow, sampleCatalog, ["美学纲领与交互范式"]),
    ).toBe(true);
    const spawned = spawnRepeatableCreationStep({
      flow,
      catalog: sampleCatalog,
      moduleName: "生成规则",
      acceptedStepIds: ["美学纲领与交互范式"],
    });
    expect("error" in spawned).toBe(false);
    if ("error" in spawned) return;
    expect(spawned.step.id).toBe("生成规则#1");
    expect(spawned.step.role).toBe("instance");
    expect(spawned.step.depends_on).toEqual(["美学纲领与交互范式"]);
    expect(spawned.flow.steps.map((s) => s.id)).toEqual([
      "美学纲领与交互范式",
      "生成规则",
      "生成规则#1",
      "开场白与开场变量",
    ]);
    expect(
      spawned.flow.steps.find((s) => s.name === "开场白与开场变量")?.depends_on,
    ).toEqual(["美学纲领与交互范式", "生成规则#1"]);

    const second = spawnRepeatableCreationStep({
      flow: spawned.flow,
      catalog: sampleCatalog,
      moduleName: "生成规则",
      acceptedStepIds: ["美学纲领与交互范式"],
    });
    expect("error" in second).toBe(false);
    if ("error" in second) return;
    expect(second.step.id).toBe("生成规则#2");
  });

  it("spawns an opening instance from its own prototype without depending on itself", () => {
    const catalog = parseModuleCatalog(`
modules:
  - name: 开场白与开场变量
    declaration: 可增殖收口
    artifact: 设计.开场白与开场变量
    closer: true
    repeatable: true
`)!;
    const flow = parseCreationFlow(`{
      "status": "open",
      "steps": [
        {
          "id": "开场白与开场变量",
          "name": "开场白与开场变量",
          "role": "prototype",
          "depends_on": []
        }
      ]
    }`)!;
    const spawned = spawnInstanceFromPrototype({
      flow,
      catalog,
      prototypeId: "开场白与开场变量",
      acceptedStepIds: [],
    });
    expect("error" in spawned).toBe(false);
    if ("error" in spawned) return;
    expect(spawned.step.role).toBe("instance");
    expect(spawned.step.from).toBe("开场白与开场变量");
    expect(spawned.step.depends_on).toEqual([]);
    const proto = spawned.flow.steps.find((s) => s.role === "prototype");
    expect(proto?.depends_on).toEqual([]);
    expect(spawned.flow.steps.map((s) => s.id)).toEqual([
      "开场白与开场变量",
      "开场白与开场变量#1",
    ]);
  });

  it("removeUnstartedInstance drops empty spawn and closer dep", () => {
    const flow = parseCreationFlow(`{
      "status": "open",
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "id": "生成规则", "name": "生成规则", "role": "prototype", "depends_on": ["美学纲领与交互范式"] },
        { "id": "生成规则#1", "name": "生成规则", "role": "instance", "from": "生成规则", "depends_on": ["美学纲领与交互范式"] },
        { "name": "开场白与开场变量", "depends_on": ["美学纲领与交互范式", "生成规则#1"] }
      ]
    }`)!;
    const next = removeUnstartedInstance(flow, "生成规则#1", []);
    expect(next.steps.map((s) => s.id)).toEqual([
      "美学纲领与交互范式",
      "生成规则",
      "开场白与开场变量",
    ]);
    expect(
      next.steps.find((s) => s.name === "开场白与开场变量")?.depends_on,
    ).toEqual(["美学纲领与交互范式"]);
    const kept = removeUnstartedInstance(next, "美学纲领与交互范式", []);
    expect(kept.steps.map((s) => s.id)).toEqual(next.steps.map((s) => s.id));
    const accepted = removeUnstartedInstance(flow, "生成规则#1", ["生成规则#1"]);
    expect(accepted.steps.some((s) => s.id === "生成规则#1")).toBe(true);
  });

  it("removeRepeatableInstance drops accepted spawn and closer dep", () => {
    const flow = parseCreationFlow(`{
      "status": "open",
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "id": "生成规则", "name": "生成规则", "role": "prototype", "depends_on": ["美学纲领与交互范式"] },
        { "id": "生成规则#1", "name": "生成规则", "role": "instance", "from": "生成规则", "depends_on": ["美学纲领与交互范式"], "params": { "rule_id": "core-female-roles" } },
        { "name": "开场白与开场变量", "depends_on": ["美学纲领与交互范式", "生成规则#1"] }
      ]
    }`)!;
    const dropped = removeRepeatableInstance({
      flow,
      stepId: "生成规则#1",
      catalog: sampleCatalog,
    });
    expect("error" in dropped).toBe(false);
    if ("error" in dropped) return;
    expect(dropped.flow.steps.map((s) => s.id)).toEqual([
      "美学纲领与交互范式",
      "生成规则",
      "开场白与开场变量",
    ]);
    expect(
      dropped.flow.steps.find((s) => s.name === "开场白与开场变量")?.depends_on,
    ).toEqual(["美学纲领与交互范式"]);
  });

  it("removeRepeatableInstance blocks when another instance depends on it", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        { "id": "生成规则", "name": "生成规则", "role": "prototype", "depends_on": ["美学纲领与交互范式"] },
        { "id": "生成规则#1", "name": "生成规则", "role": "instance", "from": "生成规则", "depends_on": ["美学纲领与交互范式"], "params": { "target": "4位核心女性", "rule_id": "core-female-roles" } },
        { "id": "具体实例", "name": "具体实例", "role": "prototype", "depends_on": ["生成规则"] },
        { "id": "具体实例#1", "name": "具体实例", "role": "instance", "from": "具体实例", "depends_on": ["生成规则#1"] }
      ]
    }`)!;
    const blocked = removeRepeatableInstance({
      flow,
      stepId: "生成规则#1",
      catalog: sampleCatalog,
    });
    expect(blocked).toMatchObject({ error: expect.stringContaining("具体实例") });
    const ok = removeRepeatableInstance({
      flow,
      stepId: "具体实例#1",
      catalog: sampleCatalog,
    });
    expect("error" in ok).toBe(false);
  });

  it("pruneRepeatableArtifactContent strips the deleted rule_id", () => {
    const raw = JSON.stringify({
      schema: "context-fragment.v1",
      技能: "生成规则",
      brief: "两条规则",
      正文: {
        rules: [
          { rule_id: "core-female-roles", 对象: "女臣" },
          { rule_id: "zombies", 对象: "丧尸" },
        ],
      },
    });
    const step = {
      id: "生成规则#1",
      name: "生成规则",
      role: "instance" as const,
      depends_on: [],
      params: { rule_id: "core-female-roles" },
    };
    const pruned = JSON.parse(
      pruneRepeatableArtifactContent({
        raw,
        step,
        remainingSameModule: 1,
      }),
    );
    expect(pruned.正文.rules.map((r) => r.rule_id)).toEqual(["zombies"]);
    expect(
      pruneRepeatableArtifactContent({
        raw,
        step,
        remainingSameModule: 0,
      }),
    ).toBe("");
  });

  it("blocks 具体实例 spawn until a 生成规则 instance is accepted", () => {
    const flow = parseCreationFlow(`{
      "steps": [
        { "name": "美学纲领与交互范式", "depends_on": [] },
        {
          "id": "生成规则",
          "name": "生成规则",
          "role": "prototype",
          "depends_on": ["美学纲领与交互范式"]
        }
      ]
    }`)!;
    const blocked = spawnRepeatableCreationStep({
      flow,
      catalog: sampleCatalog,
      moduleName: "具体实例",
      acceptedStepIds: ["美学纲领与交互范式"],
    });
    expect(blocked).toMatchObject({ error: "先完成一条生成规则" });
    const ruleSpawn = spawnInstanceFromPrototype({
      flow,
      catalog: sampleCatalog,
      prototypeId: "生成规则",
      acceptedStepIds: ["美学纲领与交互范式"],
    });
    expect("error" in ruleSpawn).toBe(false);
    if ("error" in ruleSpawn) return;
    const withRule = ruleSpawn.flow;
    const ok = spawnRepeatableCreationStep({
      flow: withRule,
      catalog: sampleCatalog,
      moduleName: "具体实例",
      acceptedStepIds: ["美学纲领与交互范式", "生成规则#1"],
    });
    expect("error" in ok).toBe(false);
    if ("error" in ok) return;
    expect(ok.step.depends_on).toEqual(["生成规则#1"]);
  });

  it("detects accepted closer step", () => {
    const flow = parseCreationFlow(
      JSON.stringify({
        steps: [
          {
            id: "开场白与开场变量",
            name: "开场白与开场变量",
            depends_on: [],
          },
        ],
      }),
    );
    expect(hasAcceptedCloserStep(flow, [])).toBe(false);
    expect(hasAcceptedCloserStep(flow, ["开场白与开场变量"])).toBe(true);
    expect(hasAcceptedCloserStep(null, ["开场白与开场变量"])).toBe(true);
  });
});
