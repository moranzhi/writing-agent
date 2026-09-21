import { describe, expect, it } from "vitest";
import {
  buildDictateMessages,
  buildDictateSystemPrompt,
  buildDictateInsertFeedbackIndex,
  defaultDictateOrder,
  extractDictateDialogue,
  formatDictateUserFacingBrief,
  isAllowedProductTag,
  isDictateModeValue,
  resolveModuleForInsertTag,
  runDictateTurn,
  sortDictateProducts,
  resolveRepeatableInsertTag,
  lookupDictateInsertFeedback,
} from "../src/dictate/index.js";
import {
  formatModuleCatalogForDictate,
  loadModuleCatalog,
} from "../src/skills/creation-flow.js";
import type { AgentDriver } from "../src/runtime/driver.js";

describe("dictate context", () => {
  it("assembles full dialogue + products with almost no filtering", () => {
    const messages = buildDictateMessages({
      systemPrompt: "SYS",
      products: [{ tag: "用户.需求", content: "雨夜压抑" }],
      dialogue: [
        { role: "user", text: "我想要压抑雨夜" },
        { role: "assistant", text: "已写入用户.需求" },
      ],
    });
    expect(messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(messages[1]?.role).toBe("user");
    const body = messages[1]?.content ?? "";
    expect(body).toContain("用户.需求");
    expect(body).toContain("雨夜压抑");
    expect(body).toContain("我想要压抑雨夜");
    expect(body).toContain("已写入用户.需求");
  });

  it("after clear (empty dialogue) still carries products", () => {
    const messages = buildDictateMessages({
      systemPrompt: "SYS",
      products: [{ tag: "设计.美学纲领", content: "冷色短句" }],
      dialogue: [],
    });
    const body = messages[1]?.content ?? "";
    expect(body).toContain("冷色短句");
    expect(body).toContain("尚无对话");
  });

  it("extracts only user + dictate_reply turns", () => {
    const turns = extractDictateDialogue([
      { kind: "orchestrator_prompt", text: "欢迎" },
      { kind: "user_input", text: "你好" },
      { kind: "agent_tool", text: "insert" },
      { kind: "dictate_reply", text: "已记下" },
    ]);
    expect(turns).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "已记下" },
    ]);
  });

  it("validates product tags and mode value", () => {
    expect(isAllowedProductTag("用户.需求")).toBe(true);
    expect(isAllowedProductTag("设计.美学纲领")).toBe(true);
    expect(isAllowedProductTag("设计.正文组成")).toBe(true);
    expect(isAllowedProductTag("设计.开场白")).toBe(true);
    expect(isAllowedProductTag("变量.当前")).toBe(false);
    expect(isDictateModeValue("dictate")).toBe(true);
    expect(isDictateModeValue("recipe")).toBe(false);
  });

  it("system prompt requires insert toolcall and relative order", () => {
    const prompt = buildDictateSystemPrompt({
      recipeName: "数据化跑团体验",
      recipeBrief:
        "设定 + 真值 + 分档映射\n怎么做：\n- declare_variable\n- declare_map",
      moduleGuide:
        "【能力 · 何时落盘】\n- 美学纲领与交互范式：…\n  落盘：insert 「设计.美学纲领与交互范式」\n  何时用：还不能回答站位",
    });
    expect(prompt).toContain("设计.正文组成");
    expect(prompt).toContain("设计.开场白");
    expect(prompt).toContain("输出.开场白");
    expect(prompt).toContain("insert");
    expect(prompt).toContain("delete");
    expect(prompt).toContain("declare_variable");
    expect(prompt).toContain("undeclare_variable");
    expect(prompt).toContain("declare_map");
    expect(prompt).toContain("remove_map");
    expect(prompt).toContain("同 position 再 insert");
    expect(prompt).toContain("数据化跑团体验");
    expect(prompt).toMatch(/order/);
    expect(prompt).toContain("仅允许 toolcall");
    expect(prompt).toContain("设计.模仿范例");
    expect(prompt).toContain("设计.模仿要点");
    expect(prompt).toContain("设计.故事推进");
    expect(prompt).toContain("设计.叙事指南");
    expect(prompt).toContain("大纲扩写");
    expect(prompt).toContain("扮演停笔关掉");
    expect(prompt).toContain("只挂载这些产物");
    expect(prompt).toContain("【能力 · 何时落盘】");
    expect(prompt).toContain("设计.美学纲领与交互范式");
    expect(prompt).toContain("同轮可多次 insert");
    expect(prompt).toContain("不抢跑未齐条件的下游");
    expect(prompt).toContain("也不自动开跑 D");
    expect(prompt).toContain("快穿短局");
    expect(prompt).toContain("一核短局");
    expect(prompt).toMatch(/舞台骨架/);
    expect(prompt).toMatch(/覆盖 C/);
    expect(prompt).toContain("设计.主角设定");
    expect(prompt).toContain("reply_module");
    expect(prompt).toContain("对用户可见回复");
    expect(prompt).toContain("有 N 个 reply_module");
    expect(prompt).toContain("〔可反复〕须拆分");
    expect(prompt).toContain("设计.具体实例#");
  });

  it("formats module catalog for dictate with land tags and when", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    expect(catalog).toBeTruthy();
    const block = formatModuleCatalogForDictate(catalog!);
    expect(block).toContain("【能力 · 何时落盘】");
    expect(block).toContain("美学纲领与交互范式");
    expect(block).toContain("落盘：insert 「设计.美学纲领与交互范式」");
    expect(block).toContain("何时用");
    expect(block).toContain("何时不用");
    expect(block).toContain("declare_variable");
    expect(block).toContain("设计.开场白");
    expect(block).toContain("〔落档程序〕");
    expect(block).toContain("设计.生成规则#");
    expect(block).toContain("设计.具体实例#");
    expect(block).toContain("可增殖");
    expect(block).not.toContain("role=prototype");
    expect(block).toContain("落盘：insert 「设计.叙事指南」");
    expect(block).toContain("落盘：insert 「设计.故事推进」");
    expect(block).not.toMatch(/^- 叙事指南与故事推进/m);
  });

  it("sorts products by relative order: neg then 0 then pos", () => {
    const sorted = sortDictateProducts([
      { tag: "设计.开场白", content: "开", order: 20 },
      { tag: "用户.需求", content: "需", order: -40 },
      { tag: "设计.正文组成", content: "格", order: 0 },
    ]);
    expect(sorted.map((p) => p.tag)).toEqual([
      "用户.需求",
      "设计.正文组成",
      "设计.开场白",
    ]);
  });

  it("default order puts stable/important before volatile", () => {
    expect(defaultDictateOrder("用户.需求")).toBeLessThan(
      defaultDictateOrder("设计.正文组成"),
    );
    expect(defaultDictateOrder("设计.正文组成")).toBeLessThan(
      defaultDictateOrder("设计.开场白"),
    );
  });

  it("context lists products in order", () => {
    const body =
      buildDictateMessages({
        systemPrompt: "SYS",
        products: [
          { tag: "设计.开场白", content: "尾", order: 10 },
          { tag: "用户.需求", content: "头", order: -10 },
        ],
        dialogue: [],
      })[1]?.content ?? "";
    expect(body.indexOf("用户.需求")).toBeLessThan(body.indexOf("设计.开场白"));
    expect(body).toContain("order=-10");
    expect(body).toContain("order=10");
  });

  it("resolves insert tag to module and builds user-facing brief", async () => {
    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    expect(catalog).toBeTruthy();
    const mod = resolveModuleForInsertTag(
      "设计.美学纲领与交互范式",
      catalog!,
    );
    expect(mod?.id).toBe("aesthetics-interaction");
    expect(
      resolveModuleForInsertTag("设计.开场白", catalog!)?.id,
    ).toBe("opening-setup");
    expect(
      resolveModuleForInsertTag("设计.具体实例#lei-ying", catalog!)?.id,
    ).toBe("concrete-instances");
    expect(
      resolveModuleForInsertTag("设计.生成规则#ex-girlfriend-card", catalog!)?.id,
    ).toBe("generation-rules");
    expect(resolveModuleForInsertTag("设计.叙事指南", catalog!)?.id).toBe(
      "narrative-guide",
    );
    expect(resolveModuleForInsertTag("设计.故事推进", catalog!)?.id).toBe(
      "story-progression",
    );
    expect(resolveModuleForInsertTag("设计.文风", catalog!)?.id).toBe(
      "narrative-guide",
    );

    const index = await buildDictateInsertFeedbackIndex({
      catalog: catalog!,
      skillPackRoot: "dialogue/world-simulator",
    });
    const brief = index.get("设计.美学纲领与交互范式");
    expect(brief).toBeTruthy();
    expect(brief!).toContain("# 模块 · 美学纲领与交互范式");
    expect(brief!).toContain("回答时请附带本模块");
    expect(brief!).toContain("本模块内容包括");
    expect(brief!).toContain("## 写入用户回复时做什么");
    expect(brief!).toContain("## 探测与追问（本模块口径）");
    expect(brief!).toContain("展示优于提问");
    expect(brief!).toMatch(/自评关注|交互范式|美学纲领/);

    const alias = index.get("设计.开场白");
    expect(alias).toContain("开场白与开场变量");
  });

  it("splits repeatable insert tags and rejects bare overwrite", async () => {
    const families = new Set(["设计.生成规则", "设计.具体实例"]);
    const instanceBody = JSON.stringify({
      schema: "context-fragment.v1",
      技能: "具体实例",
      正文: {
        rule_id: "ex-girlfriend-card",
        batch_id: "lei-ying",
        records: [{ 姓名: "雷樱" }],
      },
    });
    const first = resolveRepeatableInsertTag({
      tag: "设计.具体实例",
      content: instanceBody,
      existingTags: [],
      repeatableFamilies: families,
    });
    expect("tag" in first && first.tag).toBe("设计.具体实例#lei-ying");

    const second = resolveRepeatableInsertTag({
      tag: "设计.具体实例",
      content: JSON.stringify({
        schema: "context-fragment.v1",
        正文: { records: [{ 姓名: "谢明澜" }] },
      }),
      existingTags: ["设计.具体实例#lei-ying"],
      repeatableFamilies: families,
    });
    expect("tag" in second && second.tag).toBe("设计.具体实例#谢明澜");

    const overwriteBare = resolveRepeatableInsertTag({
      tag: "设计.具体实例",
      content: "不是JSON就抽不出槽",
      existingTags: ["设计.具体实例#lei-ying"],
      repeatableFamilies: families,
    });
    expect("error" in overwriteBare).toBe(true);

    const catalog = await loadModuleCatalog("dialogue/world-simulator");
    const index = await buildDictateInsertFeedbackIndex({
      catalog: catalog!,
      skillPackRoot: "dialogue/world-simulator",
    });
    expect(
      lookupDictateInsertFeedback(index, "设计.具体实例#lei-ying"),
    ).toContain("具体实例");
  });

  it("runDictateTurn remaps bare repeatable insert to #slot", async () => {
    const products: { tag: string; content: string }[] = [];
    const body = JSON.stringify({
      schema: "context-fragment.v1",
      正文: {
        batch_id: "lei-ying",
        records: [{ 姓名: "雷樱" }],
      },
    });
    const driver: AgentDriver = {
      async run(input) {
        const outcome = await input.handleStep([
          {
            id: "c1",
            name: "insert",
            arguments: JSON.stringify({
              position: "设计.具体实例",
              content: body,
            }),
          },
        ]);
        expect(outcome.kind).toBe("continue");
        if (outcome.kind === "continue") {
          const payload = JSON.parse(outcome.results[0]!.content) as {
            ok?: boolean;
            position?: string;
            error?: string;
          };
          expect(payload.ok).toBe(true);
          expect(payload.position).toBe("设计.具体实例#lei-ying");
        }
        return {
          iterations: 1,
          stop: { kind: "text", content: "已落实例" },
        };
      },
    };
    const result = await runDictateTurn({
      llm: {} as never,
      dialogue: [{ role: "user", text: "再生成一张雷樱" }],
      driver,
      repeatableFamilies: ["设计.具体实例", "设计.生成规则"],
      handlers: {
        listProducts: () => products,
        writeProduct: (tag, content) => {
          products.push({ tag, content });
        },
        deleteProduct: () => false,
        readTag: () => undefined,
        writeTag: () => undefined,
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });
    expect(result.wroteTags).toEqual(["设计.具体实例#lei-ying"]);
    expect(products.map((p) => p.tag)).toEqual(["设计.具体实例#lei-ying"]);
  });

  it("insert tool result includes reply_module from lookup", async () => {
    let capturedSpec: string | undefined;
    const driver: AgentDriver = {
      async run(input) {
        const outcome = await input.handleStep([
          {
            id: "c1",
            name: "insert",
            arguments: JSON.stringify({
              position: "设计.美学纲领与交互范式",
              content: "傀儡帝体验核",
            }),
          },
        ]);
        expect(outcome.kind).toBe("continue");
        if (outcome.kind === "continue") {
          const payload = JSON.parse(outcome.results[0]!.content) as {
            ok?: boolean;
            reply_module?: string;
          };
          expect(payload.ok).toBe(true);
          expect(payload.reply_module).toContain("回答时请附带本模块");
          capturedSpec = payload.reply_module;
        }
        return {
          iterations: 1,
          stop: { kind: "text", content: "已落美学；下一刀建议主角名片。" },
        };
      },
    };

    const products: { tag: string; content: string }[] = [];
    const result = await runDictateTurn({
      llm: {} as never,
      dialogue: [{ role: "user", text: "傀儡帝恋爱" }],
      driver,
      handlers: {
        listProducts: () => products,
        writeProduct: (tag, content) => {
          products.push({ tag, content });
        },
        deleteProduct: () => false,
        readTag: () => undefined,
        writeTag: () => undefined,
        deleteTag: () => false,
        clearDialogue: () => undefined,
        lookupInsertFeedback: () =>
          formatDictateUserFacingBrief({
            tag: "设计.美学纲领与交互范式",
            module: {
              id: "aesthetics-interaction",
              name: "美学纲领与交互范式",
              declaration: "x",
              artifact: "设计.美学纲领与交互范式",
            },
            promptMd: [
              "```probe",
              "缺其中一件：追问 1～2 点",
              "```",
              "```principles",
              "展示优于提问、大胆优于保守",
              "```",
              "```output",
              '{"自评":{"维度":[{"名":"交互范式"},{"名":"美学纲领"}]}}',
              "```",
            ].join("\n"),
          }),
      },
    });

    expect(capturedSpec).toContain("探测与追问");
    expect(result.wroteTags).toContain("设计.美学纲领与交互范式");
    expect(result.reply).toContain("已落美学");
  });

  it("delete removes a product tag", async () => {
    const products = new Map<string, string>([
      ["设计.开场白", "旧开场"],
      ["用户.需求", "雨夜"],
    ]);
    const driver: AgentDriver = {
      async run(input) {
        const outcome = await input.handleStep([
          {
            id: "d1",
            name: "delete",
            arguments: JSON.stringify({
              position: "设计.开场白",
              reason: "重做开场",
            }),
          },
        ]);
        expect(outcome.kind).toBe("continue");
        if (outcome.kind === "continue") {
          const payload = JSON.parse(outcome.results[0]!.content) as {
            ok?: boolean;
            deleted?: string;
          };
          expect(payload.ok).toBe(true);
          expect(payload.deleted).toBe("设计.开场白");
        }
        return {
          iterations: 1,
          stop: { kind: "text", content: "已删开场白。" },
        };
      },
    };

    const result = await runDictateTurn({
      llm: {} as never,
      dialogue: [{ role: "user", text: "删掉开场白" }],
      driver,
      handlers: {
        listProducts: () =>
          [...products.entries()].map(([tag, content]) => ({ tag, content })),
        writeProduct: (tag, content) => {
          products.set(tag, content);
        },
        deleteProduct: (tag) => products.delete(tag),
        readTag: () => undefined,
        writeTag: () => undefined,
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(products.has("设计.开场白")).toBe(false);
    expect(products.has("用户.需求")).toBe(true);
    expect(result.deletedTags).toContain("设计.开场白");
  });

  it("undeclare_variable and remove_map prune catalog/map docs", async () => {
    let catalogRaw =
      '{"schema":"variable-catalog.v1","fields":[{"key":"好感","type":"number","initial":10,"user_visible":true},{"key":"章节","type":"number","initial":1,"user_visible":true}]}';
    let mapRaw =
      '{"schema":"value-map.v1","maps":[{"id":"aff","field":"好感","target_tag":"上下文.角色态度","bands":[{"min":0,"content":"冷"}]}]}';
    let currentRaw =
      '{"rows":[{"key":"好感","value":10,"rev":1},{"key":"章节","value":1,"rev":1}]}';
    const projection = new Map<string, string>([
      ["上下文.角色态度", "冷"],
    ]);
    const tags = new Map<string, string>([
      ["设计.变量目录", catalogRaw],
      ["设计.变量映射", mapRaw],
      ["变量.当前", currentRaw],
    ]);

    const driver: AgentDriver = {
      async run(input) {
        const r1 = await input.handleStep([
          {
            id: "u1",
            name: "undeclare_variable",
            arguments: JSON.stringify({ key: "好感" }),
          },
        ]);
        expect(r1.kind).toBe("continue");
        const r2 = await input.handleStep([
          {
            id: "r1",
            name: "remove_map",
            arguments: JSON.stringify({ id: "aff" }),
          },
        ]);
        expect(r2.kind).toBe("continue");
        if (r2.kind === "continue") {
          const payload = JSON.parse(r2.results[0]!.content) as {
            cleared_target?: string | null;
          };
          expect(payload.cleared_target).toBe("上下文.角色态度");
        }
        return {
          iterations: 2,
          stop: { kind: "text", content: "已移除好感与映射。" },
        };
      },
    };

    const result = await runDictateTurn({
      llm: {} as never,
      dialogue: [{ role: "user", text: "去掉好感" }],
      driver,
      handlers: {
        listProducts: () => [],
        writeProduct: () => undefined,
        deleteProduct: () => false,
        readTag: (tag) => tags.get(tag) ?? projection.get(tag),
        writeTag: (tag, content) => {
          tags.set(tag, content);
          if (tag === "设计.变量目录") catalogRaw = content;
          if (tag === "设计.变量映射") mapRaw = content;
          if (tag === "变量.当前") currentRaw = content;
        },
        deleteTag: (tag) => {
          const a = tags.delete(tag);
          const b = projection.delete(tag);
          return a || b;
        },
        clearDialogue: () => undefined,
      },
    });

    expect(catalogRaw).toContain("章节");
    expect(catalogRaw).not.toContain('"好感"');
    expect(currentRaw).not.toContain('"好感"');
    expect(tags.has("设计.变量映射")).toBe(false);
    expect(projection.has("上下文.角色态度")).toBe(false);
    expect(result.deletedTags.some((t) => t.includes("好感"))).toBe(true);
    expect(result.deletedTags.some((t) => t.includes("aff"))).toBe(true);
  });

  it("parallel inserts each get a reply_module and multi-module hint", async () => {
    const driver: AgentDriver = {
      async run(input) {
        const outcome = await input.handleStep([
          {
            id: "c1",
            name: "insert",
            arguments: JSON.stringify({
              position: "设计.美学纲领与交互范式",
              content: "美学",
            }),
          },
          {
            id: "c2",
            name: "insert",
            arguments: JSON.stringify({
              position: "设计.主角设定",
              content: "主角",
            }),
          },
        ]);
        expect(outcome.kind).toBe("continue");
        if (outcome.kind === "continue") {
          const a = JSON.parse(outcome.results[0]!.content) as {
            reply_module?: string;
            reply_hint?: string;
          };
          const b = JSON.parse(outcome.results[1]!.content) as {
            reply_module?: string;
            reply_hint?: string;
          };
          expect(a.reply_module).toContain("美学纲领");
          expect(b.reply_module).toContain("主角设定");
          expect(a.reply_hint).toMatch(/多个 reply_module|本步已带回模块/);
          expect(b.reply_hint).toContain("本步已带回模块");
        }
        return {
          iterations: 1,
          stop: { kind: "text", content: "## 模块 · 美学\n\n## 模块 · 主角" },
        };
      },
    };

    await runDictateTurn({
      llm: {} as never,
      dialogue: [{ role: "user", text: "都要" }],
      driver,
      handlers: {
        listProducts: () => [],
        writeProduct: () => undefined,
        deleteProduct: () => false,
        readTag: () => undefined,
        writeTag: () => undefined,
        deleteTag: () => false,
        clearDialogue: () => undefined,
        lookupInsertFeedback: (tag) =>
          tag.includes("美学")
            ? formatDictateUserFacingBrief({
                tag,
                module: {
                  id: "aesthetics-interaction",
                  name: "美学纲领与交互范式",
                  declaration: "x",
                  artifact: tag,
                },
                promptMd: "```probe\n美学追问\n```",
              })
            : formatDictateUserFacingBrief({
                tag,
                module: {
                  id: "protagonist",
                  name: "主角设定",
                  declaration: "x",
                  artifact: tag,
                },
                promptMd: "```probe\n主角追问\n```",
              }),
      },
    });
  });
});
