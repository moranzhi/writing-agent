import { describe, expect, it } from "vitest";
import {
  CREATION_PLAN_TAG,
  buildDictateSystemPrompt,
  creationPlanModules,
  formatCreationPlanCapabilityCatalog,
  formatCreationPlanProgress,
  runDictateTurn,
  validateCreationPlan,
  type CreationPlan,
} from "../src/dictate/index.js";
import {
  formatModuleCatalogForDictate,
  loadModuleCatalog,
} from "../src/skills/creation-flow.js";
import type { AgentDriver } from "../src/runtime/driver.js";

async function fixture() {
  const catalog = await loadModuleCatalog("dialogue/world-simulator");
  expect(catalog).toBeTruthy();
  const modules = creationPlanModules(catalog!);
  const plan: CreationPlan = {
    schema: "creation-plan.v1",
    技能: "本局创作方案",
    brief: "以封闭雨夜中的身份猜疑兑现持续压迫感",
    recipe: {
      primary: "封闭空间悬疑",
      secondary_traits: ["关系拉扯"],
      method: ["让线索公开程度与人物关系共同改变每轮选择"],
      references: [],
    },
    items: modules.map((module, index) => ({
      module_id: module.id,
      tier: index === 0 ? "必须" : "有一定效果",
      why: `${module.name}对本局的作用`,
      missing: "",
      instances: [],
    })),
  };
  return { catalog: catalog!, modules, plan };
}

describe("creation plan", () => {
  it("covers all current content modules and excludes approved mechanical or legacy nodes", async () => {
    const { modules } = await fixture();
    expect(modules).toHaveLength(14);
    expect(modules.map((module) => module.id)).not.toEqual(
      expect.arrayContaining([
        "creation-plan",
        "narrative",
        "variable-context",
        "context-order",
        "worker-spec",
        "refine",
        "user-requirements",
      ]),
    );
    expect(modules.map((module) => module.id)).toEqual(
      expect.arrayContaining([
        "aesthetics-interaction",
        "generation-rules",
        "reply-format",
        "opening-setup",
      ]),
    );
  });

  it("selects exactly one presentation chain", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    expect(catalog).toBeTruthy();
    const zeroModules = creationPlanModules(catalog!, "zero_layer");
    const ids = zeroModules.map((module) => module.id);
    expect(zeroModules).toHaveLength(14);
    expect(ids).toEqual(
      expect.arrayContaining([
        "zero-layer-status",
        "zero-layer-reply-format",
        "zero-layer-opening-setup",
      ]),
    );
    expect(ids).not.toEqual(
      expect.arrayContaining(["status-bar", "reply-format", "opening-setup"]),
    );

    const plan: CreationPlan = {
      schema: "creation-plan.v1",
      技能: "本局创作方案",
      brief: "持久终端体验",
      presentation_mode: "zero_layer",
      recipe: {
        primary: "终端操作",
        secondary_traits: [],
        method: ["原地更新持久卡"],
        references: [],
      },
      items: zeroModules.map((module) => ({
        module_id: module.id,
        tier: "必须",
        why: module.name,
        missing: "",
        instances: [],
      })),
    };
    expect(validateCreationPlan(JSON.stringify(plan), catalog).ok).toBe(true);

    plan.items[plan.items.findIndex((item) => item.module_id === "zero-layer-status")] = {
      module_id: "status-bar",
      tier: "必须",
      why: "错误混入普通楼层",
      missing: "",
      instances: [],
    };
    const mixed = validateCreationPlan(JSON.stringify(plan), catalog);
    expect(mixed.ok).toBe(false);
    expect(mixed.missingIds).toContain("zero-layer-status");
    expect(mixed.unknownIds).toContain("status-bar");
  });

  it("rejects missing module ids and reports them", async () => {
    const { catalog, plan } = await fixture();
    const omitted = plan.items.at(-1)!.module_id;
    plan.items.pop();
    const result = validateCreationPlan(JSON.stringify(plan), catalog);
    expect(result.ok).toBe(false);
    expect(result.missingIds).toEqual([omitted]);
    expect(result.error).toContain(omitted);
  });

  it("uses a short catalog before the plan and grouped state after it", async () => {
    const { catalog, plan } = await fixture();
    const shortCatalog = formatCreationPlanCapabilityCatalog(catalog);
    expect(shortCatalog).toContain("items 必须覆盖");
    expect(shortCatalog).toContain("presentation_mode=`message|zero_layer`");
    expect(shortCatalog).toContain("0层回复呈现");
    expect(shortCatalog).not.toContain("creation-plan（本局创作方案）");

    const rules = plan.items.find((item) => item.module_id === "generation-rules");
    expect(rules).toBeTruthy();
    rules!.tier = "必须";
    const unused = plan.items.find((item) => item.module_id === "topology");
    expect(unused).toBeTruthy();
    unused!.tier = "没有意义";
    const progress = formatCreationPlanProgress({
      plan,
      catalog,
      products: [
        { tag: catalog.modules.find((m) => m.id === "aesthetics-interaction")!.artifact, content: "{}" },
        { tag: "设计.生成规则#tenants", content: "{}" },
      ],
    });
    expect(progress).toContain("【本局创作方案 · 当前决策】");
    expect(progress).toContain("不是本轮待办");
    expect(progress).toContain("何时用 / 何时不用");
    expect(progress).toContain("### 必须");
    expect(progress).toContain("〔已落〕");
    expect(progress).toContain("要落两份或以上同类对象");
    expect(progress).toContain("字段很少、也不承载玩法");
    const unusedSection = progress.split("### 没有意义")[1] ?? "";
    expect(unusedSection).toContain("topology");
    expect(unusedSection).not.toContain("何时用：");

    const oldFullGuide = formatModuleCatalogForDictate(catalog);
    const before = buildDictateSystemPrompt({
      capabilityCatalog: shortCatalog,
      recipeExamples: "- text-generator：文本生成案例",
    });
    const after = buildDictateSystemPrompt({ creationPlanState: progress });
    expect(before).toContain("尚无本局创作方案");
    expect(after).toContain("当前决策");
    expect(after).toContain("收口前的核对清单");
    expect(after).not.toContain("旧配方案例目录");
    expect(after.length).toBeLessThan(
      buildDictateSystemPrompt({ moduleGuide: oldFullGuide }).length,
    );
  });

  it("blocks an incomplete plan insert before writing", async () => {
    const { catalog, plan } = await fixture();
    const missingId = plan.items.at(-1)!.module_id;
    plan.items.pop();
    const products: Array<{ tag: string; content: string }> = [];
    const driver: AgentDriver = {
      async run(input) {
        const outcome = await input.handleStep([
          {
            id: "p1",
            name: "insert",
            arguments: JSON.stringify({
              position: CREATION_PLAN_TAG,
              content: JSON.stringify(plan),
            }),
          },
        ]);
        expect(outcome.kind).toBe("continue");
        if (outcome.kind === "continue") {
          const payload = JSON.parse(outcome.results[0]!.content) as {
            error?: string;
            missing_ids?: string[];
          };
          expect(payload.error).toContain("能力覆盖校验失败");
          expect(payload.missing_ids).toContain(missingId);
        }
        return { iterations: 1, stop: { kind: "text", content: "方案未写入。" } };
      },
    };

    const result = await runDictateTurn({
      llm: {} as never,
      dialogue: [{ role: "user", text: "做一个封闭空间悬疑" }],
      moduleCatalog: catalog,
      driver,
      handlers: {
        listProducts: () => products,
        writeProduct: (tag, content) => products.push({ tag, content }),
        deleteProduct: () => false,
        readTag: () => undefined,
        writeTag: () => undefined,
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(result.wroteTags).toEqual([]);
    expect(products).toEqual([]);
  });

  it("warns but does not reject an opening with required gaps", async () => {
    const { catalog, plan } = await fixture();
    const requiredId = plan.items[0]!.module_id;
    const products = [{ tag: CREATION_PLAN_TAG, content: JSON.stringify(plan) }];
    const driver: AgentDriver = {
      async run(input) {
        const outcome = await input.handleStep([
          {
            id: "o1",
            name: "insert",
            arguments: JSON.stringify({
              position: "设计.开场白",
              content: "@玩家在雨夜醒来。",
            }),
          },
        ]);
        expect(outcome.kind).toBe("continue");
        if (outcome.kind === "continue") {
          const payload = JSON.parse(outcome.results[0]!.content) as {
            ok?: boolean;
            missing_required_module_ids?: string[];
          };
          expect(payload.ok).toBe(true);
          expect(payload.missing_required_module_ids).toContain(requiredId);
        }
        return { iterations: 1, stop: { kind: "text", content: "开场已写入，并提示缺项。" } };
      },
    };

    await runDictateTurn({
      llm: {} as never,
      dialogue: [{ role: "user", text: "先写开场" }],
      moduleCatalog: catalog,
      driver,
      handlers: {
        listProducts: () => products,
        writeProduct: (tag, content) => products.push({ tag, content }),
        deleteProduct: () => false,
        readTag: () => undefined,
        writeTag: () => undefined,
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(products.some((product) => product.tag === "设计.开场白")).toBe(true);
  });
});
