import { describe, expect, it } from "vitest";
import {
  DICTATE_MODULE_READ_STATE_TAG,
  buildDictateContext,
  parseDictateModuleReadState,
  runDictateTurn,
  type DictateModuleReadPayload,
} from "../src/dictate/index.js";
import type { LlmProvider } from "../src/llm/client.js";
import type { ModuleCatalog } from "../src/skills/creation-flow.js";

function scriptedLlm(steps: unknown[]): LlmProvider {
  let index = 0;
  return {
    async complete() {
      throw new Error("对话落盘走工具，不走纯文本完成");
    },
    async completeWithTools() {
      const body = steps[index++] ?? {};
      const select = index === 1;
      return {
        content: null,
        toolCalls: toToolCalls(body, select),
        usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
      };
    },
  };
}

function toToolCalls(body: unknown, select: boolean) {
  const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (select) {
    return [{ id: "select", name: "select_nodes", arguments: JSON.stringify(row) }];
  }
  const calls: Array<{ id: string; name: string; arguments: string }> = [];
  const products = row.products;
  if (Array.isArray(products)) {
    products.forEach((item, index) => {
      const rec = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      if ("tag" in rec || "position" in rec || "content" in rec || "正文" in rec) {
        calls.push({
          id: `ins-${index}`,
          name: "insert",
          arguments: JSON.stringify({
            position: rec.tag ?? rec.position,
            content: rec.content ?? rec.正文 ?? "",
            ...(rec.self_score !== undefined ? { self_score: rec.self_score } : {}),
          }),
        });
        return;
      }
      Object.entries(rec).forEach(([key, value], piece) => {
        const content =
          typeof value === "string"
            ? value
            : value && typeof value === "object"
              ? String((value as Record<string, unknown>).内容 ?? (value as Record<string, unknown>).正文 ?? (value as Record<string, unknown>).content ?? "")
              : "";
        calls.push({
          id: `ins-${index}-${piece}`,
          name: "insert",
          arguments: JSON.stringify({ position: key, content }),
        });
      });
    });
  } else if (products && typeof products === "object") {
    Object.entries(products as Record<string, unknown>).forEach(([key, value], index) => {
      const content =
        typeof value === "string"
          ? value
          : value && typeof value === "object"
            ? String((value as Record<string, unknown>).正文 ?? (value as Record<string, unknown>).content ?? "")
            : "";
      calls.push({
        id: `ins-${index}`,
        name: "insert",
        arguments: JSON.stringify({ position: key.startsWith("设计.") || key.startsWith("用户.") ? key : `设计.${key}`, content }),
      });
    });
  }
  for (const [key, value] of Object.entries(row)) {
    if (key === "products" || key === "reply" || key === "operations") continue;
    if (typeof value === "string" && (key.startsWith("设计.") || key.startsWith("用户."))) {
      calls.push({
        id: `extra-${key}`,
        name: "insert",
        arguments: JSON.stringify({ position: key, content: value }),
      });
    }
  }
  if (Array.isArray(row.operations)) {
    row.operations.forEach((item, index) => {
      const rec = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const nested =
        rec.arguments && typeof rec.arguments === "object"
          ? (rec.arguments as Record<string, unknown>)
          : rec;
      const content = String(nested.content ?? "");
      if (!content.trim()) return;
      calls.push({
        id: `op-${index}`,
        name: "insert",
        arguments: JSON.stringify({ position: nested.position ?? nested.tag, content }),
      });
    });
  }
  if (typeof row.reply === "string") {
    calls.push({
      id: "reply",
      name: "reply_user",
      arguments: JSON.stringify({ text: row.reply }),
    });
  }
  return calls;
}

const catalog = {
  modules: [
    {
      id: "mood",
      name: "氛围",
      artifact: "设计.氛围",
      declaration: "细雨",
    },
  ],
} as ModuleCatalog;

const modulePayload: DictateModuleReadPayload = {
  module_id: "mood",
  name: "氛围",
  artifact: "设计.氛围",
  version: "v-test",
  task: "写氛围",
  principles: "短句",
  output: "一段话",
  score: "",
  score_dimensions: [],
  libraries: [],
  constraints: [],
};

describe("dictate planned round", () => {
  it("puts earlier dialogue before products and the last user turn at the end", () => {
    const built = buildDictateContext({
      systemPrompt: "规则",
      products: [{ tag: "设计.氛围", content: "旧稿", order: 0 }],
      dialogue: [
        { role: "user", text: "第一句" },
        { role: "assistant", text: "记下了" },
        { role: "user", text: "改成细雨" },
      ],
      phase: "fill",
      injected: "#### task\n写氛围",
      tail: "方案进度",
    });
    const body = built.messages[1]?.content ?? "";
    expect(body.indexOf("必须调用 reply_user")).toBeLessThan(body.indexOf("第一句"));
    expect(body.indexOf("第一句")).toBeLessThan(body.indexOf("设计.氛围"));
    expect(body.indexOf("设计.氛围")).toBeLessThan(body.indexOf("写氛围"));
    expect(body.indexOf("写氛围")).toBeLessThan(body.indexOf("改成细雨"));
    expect(body.indexOf("方案进度")).toBeLessThan(body.indexOf("改成细雨"));
    expect(body.indexOf("写完下列节点后")).toBeLessThan(body.indexOf("写氛围"));
    expect(built.segmentChars.products).toBeGreaterThan(0);
    expect(built.segmentChars.rules).toBe("规则".length);

    const select = buildDictateContext({
      systemPrompt: "规则",
      products: [{ tag: "设计.氛围", content: "旧稿" }],
      dialogue: [
        { role: "user", text: "第一句" },
        { role: "user", text: "改成细雨" },
      ],
      phase: "select",
      tail: "方案进度",
    });
    const selectBody = select.messages[1]?.content ?? "";
    expect(selectBody).not.toContain("旧稿");
    expect(selectBody).toContain("第一句");
    expect(selectBody.indexOf("第一句")).toBeLessThan(selectBody.indexOf("改成细雨"));
  });

  it("injects the spec, stamps the read credential, and rewrites only the missing tag", async () => {
    const products: Array<{ tag: string; content: string }> = [];
    const tags = new Map<string, string>();
    const result = await runDictateTurn({
      llm: scriptedLlm([
        {
          clarify: [],
          inserts: [{ tag: "设计.氛围", module_id: "mood" }],
          deletes: [],
        },
        { products: [], reply: "还没写" },
        {
          products: [{ tag: "设计.氛围", content: "细雨" }],
          reply: "已写成细雨",
        },
      ]),
      dialogue: [{ role: "user", text: "写成细雨" }],
      moduleCatalog: catalog,
      moduleReadIndex: new Map([
        ["mood", modulePayload],
        ["氛围", modulePayload],
      ]),
      handlers: {
        listProducts: () => products,
        writeProduct: (tag, content) => {
          const existing = products.find((item) => item.tag === tag);
          if (existing) existing.content = content;
          else products.push({ tag, content });
        },
        deleteProduct: () => false,
        readTag: (tag) => tags.get(tag),
        writeTag: (tag, content) => {
          tags.set(tag, content);
        },
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(result.wroteTags).toEqual(["设计.氛围"]);
    expect(products).toEqual([{ tag: "设计.氛围", content: "细雨" }]);
    expect(result.reply).toContain("已写成细雨");
    const state = parseDictateModuleReadState(tags.get(DICTATE_MODULE_READ_STATE_TAG));
    expect(state.modules.mood).toBe("v-test");
  });

  it("stops after the select step when the plan is a clarification", async () => {
    let writes = 0;
    const result = await runDictateTurn({
      llm: scriptedLlm([
        {
          clarify: ["沿用冷色", "改成暖色"],
          inserts: [],
          deletes: [],
        },
      ]),
      dialogue: [{ role: "user", text: "氛围还没定" }],
      handlers: {
        listProducts: () => [],
        writeProduct: () => {
          writes += 1;
        },
        deleteProduct: () => false,
        readTag: () => undefined,
        writeTag: () => undefined,
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });
    expect(writes).toBe(0);
    expect(result.iterations).toBe(1);
    expect(result.reply).toContain("沿用冷色");
    expect(result.reply).toContain("改成暖色");
  });

  it("says the returned fields when the select plan writes nothing", async () => {
    const result = await runDictateTurn({
      llm: scriptedLlm([{ note: "看世界" }]),
      dialogue: [{ role: "user", text: "超级英雄" }],
      handlers: {
        listProducts: () => [],
        writeProduct: () => undefined,
        deleteProduct: () => false,
        readTag: () => undefined,
        writeTag: () => undefined,
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });
    expect(result.wroteTags).toEqual([]);
    expect(result.iterations).toBe(1);
    expect(result.reply).toContain("note");
    expect(result.reply).toContain("没有写入产物");
  });

  it("follows a select result with a fill request that carries specs and products", async () => {
    const seen: string[] = [];
    const steps = [
      {
        schema: "creation-plan.v1",
        items: [{ module_id: "mood", tier: "必须", why: "细雨", missing: "", instances: [] }],
      },
      {
        products: [{ tag: "设计.本局创作方案", content: "{\"schema\":\"creation-plan.v1\"}" }],
        reply: "已写方案",
      },
    ];
    let index = 0;
    const llm: LlmProvider = {
      async complete() {
        throw new Error("对话落盘走工具，不走纯文本完成");
      },
      async completeWithTools(messages) {
        seen.push(messages.map((message) => message.content ?? "").join("\n"));
        const body = steps[index++] ?? {};
        return {
          content: null,
          toolCalls: toToolCalls(body, index === 1),
          usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
        };
      },
    };
    const products = [{ tag: "设计.舞台", content: "已有舞台" }];
    await runDictateTurn({
      llm,
      dialogue: [{ role: "user", text: "超级英雄的世界" }],
      moduleCatalog: catalog,
      moduleReadIndex: new Map([
        [
          "creation-plan",
          {
            ...modulePayload,
            module_id: "creation-plan",
            artifact: "设计.本局创作方案",
            task: "规格任务正文",
            principles: "规格原则正文",
          },
        ],
      ]),
      handlers: {
        listProducts: () => products,
        writeProduct: (tag, content) => {
          const existing = products.find((item) => item.tag === tag);
          if (existing) existing.content = content;
          else products.push({ tag, content });
        },
        deleteProduct: () => false,
        readTag: () => undefined,
        writeTag: () => undefined,
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]).not.toContain("已有舞台");
    expect(seen[0]).not.toContain("规格任务正文");
    expect(seen[1]).toContain("已有舞台");
    expect(seen[1]).toContain("规格任务正文");
    expect(seen[1]).toContain("规格原则正文");
    expect(seen[1]).toContain("#### output");
    expect(seen[1]).toContain("设计.本局创作方案");
  });

  it("treats operations as the selection, injects the node table, and writes every returned item", async () => {
    const seen: string[] = [];
    const steps = [
      {
        operations: [
          { name: "insert", arguments: { position: "设计.氛围", module_id: "mood" } },
        ],
        reply: "先写氛围",
      },
      {
        operations: [
          { position: "设计.氛围", content: "细雨" },
          { tag: "设计.旁白", content: "旁白一句" },
        ],
        reply: "写了两份",
      },
    ];
    let index = 0;
    const llm: LlmProvider = {
      async complete() {
        throw new Error("对话落盘走工具，不走纯文本完成");
      },
      async completeWithTools(messages) {
        seen.push(messages.map((message) => message.content ?? "").join("\n"));
        const body = steps[index++] ?? {};
        return {
          content: null,
          toolCalls: toToolCalls(body, index === 1),
          usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
        };
      },
    };
    const products: Array<{ tag: string; content: string }> = [
      { tag: "设计.舞台", content: "已有舞台" },
    ];
    const tags = new Map<string, string>();
    const result = await runDictateTurn({
      llm,
      dialogue: [{ role: "user", text: "写成细雨" }],
      moduleCatalog: catalog,
      moduleReadIndex: new Map([["mood", modulePayload]]),
      handlers: {
        listProducts: () => products,
        writeProduct: (tag, content) => {
          const existing = products.find((item) => item.tag === tag);
          if (existing) existing.content = content;
          else products.push({ tag, content });
        },
        deleteProduct: () => false,
        readTag: (tag) => tags.get(tag),
        writeTag: (tag, content) => {
          tags.set(tag, content);
        },
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]).not.toContain("已有舞台");
    expect(seen[0]).not.toContain("写氛围");
    expect(seen[1]).toContain("本轮节点表");
    expect(seen[1]).toContain("写氛围");
    expect(seen[1]).toContain("已有舞台");
    expect(result.wroteTags).toEqual(expect.arrayContaining(["设计.氛围", "设计.旁白"]));
    expect(result.reply).toContain("写了两份");
  });

  it("persists products named by module or keyed outside the products array", async () => {
    const resultProducts: Array<{ tag: string; content: string }> = [];
    const tags = new Map<string, string>();
    const result = await runDictateTurn({
      llm: scriptedLlm([
        {
          inserts: [{ tag: "设计.氛围", module_id: "mood" }],
          deletes: [],
        },
        {
          reply: "写了",
          products: { 氛围: { 正文: "细雨连绵" } },
          "设计.旁白": "旁白一句",
        },
      ]),
      dialogue: [{ role: "user", text: "写成细雨" }],
      moduleCatalog: catalog,
      moduleReadIndex: new Map([["mood", modulePayload]]),
      handlers: {
        listProducts: () => resultProducts,
        writeProduct: (tag, content) => {
          resultProducts.push({ tag, content });
        },
        deleteProduct: () => false,
        readTag: (tag) => tags.get(tag),
        writeTag: (tag, content) => {
          tags.set(tag, content);
        },
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });
    expect(resultProducts.map((item) => item.tag).sort()).toEqual(["设计.旁白", "设计.氛围"]);
    expect(resultProducts.find((item) => item.tag === "设计.氛围")?.content).toBe("细雨连绵");
    expect(result.reply).toContain("写了");
    expect(result.reply).not.toContain("未给出");
  });

  it("selects node ids first, then writes them with the user text and the node specs", async () => {
    const seen: string[] = [];
    const steps = [
      { nodes: [{ module_id: "mood" }] },
      {
        products: [{ tag: "设计.氛围", content: "细雨" }],
        reply: "已写氛围。可能还缺主角设定。",
      },
    ];
    let index = 0;
    const llm: LlmProvider = {
      async complete() {
        throw new Error("对话落盘走工具，不走纯文本完成");
      },
      async completeWithTools(messages) {
        seen.push(messages.map((message) => message.content ?? "").join("\n"));
        const body = steps[index++] ?? {};
        return {
          content: null,
          toolCalls: toToolCalls(body, index === 1),
          usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
        };
      },
    };
    const products: Array<{ tag: string; content: string }> = [];
    const tags = new Map<string, string>();
    const result = await runDictateTurn({
      llm,
      dialogue: [{ role: "user", text: "写成细雨" }],
      moduleCatalog: catalog,
      moduleReadIndex: new Map([["mood", modulePayload]]),
      handlers: {
        listProducts: () => products,
        writeProduct: (tag, content) => {
          products.push({ tag, content });
        },
        deleteProduct: () => false,
        readTag: (tag) => tags.get(tag),
        writeTag: (tag, content) => {
          tags.set(tag, content);
        },
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("只做选题");
    expect(seen[0]).toContain("写成细雨");
    expect(seen[0]).not.toContain("declare_variable");
    expect(seen[1]).toContain("写成细雨");
    expect(seen[1]).toContain("写氛围");
    expect(seen[1]).toContain("第一轮选定的节点：mood");
    expect(seen[1]).toContain("还可能缺哪些节点");
    expect(result.wroteTags).toEqual(["设计.氛围"]);
    expect(result.reply).toContain("可能还缺主角设定");
  });

  it("maps a user-prefixed tag onto the catalog artifact and reads Chinese content fields", async () => {
    const narration: DictateModuleReadPayload = {
      ...modulePayload,
      module_id: "narration",
      name: "旁白",
      artifact: "设计.旁白",
      task: "写旁白",
    };
    const products: Array<{ tag: string; content: string }> = [];
    const tags = new Map<string, string>();
    const seen: string[] = [];
    const result = await runDictateTurn({
      llm: {
        async complete() {
          throw new Error("对话落盘走工具，不走纯文本完成");
        },
        async completeWithTools(messages) {
          seen.push(messages.map((message) => message.content ?? "").join("\n"));
          const step = seen.length;
          const body =
            step === 1
              ? { nodes: [{ tag: "用户.氛围" }, { module_id: "narration" }] }
              : {
                  products: [{ "用户.氛围": { 内容: "细雨连绵" }, "设计.旁白": "旁白一句" }],
                  reply: "写了两份",
                };
          return {
            content: null,
            toolCalls: toToolCalls(body, step === 1),
            usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
          };
        },
      },
      dialogue: [{ role: "user", text: "写成细雨" }],
      moduleCatalog: {
        modules: [
          ...catalog.modules,
          { id: "narration", name: "旁白", artifact: "设计.旁白", declaration: "旁白" },
        ],
      } as ModuleCatalog,
      moduleReadIndex: new Map([
        ["mood", modulePayload],
        ["narration", narration],
      ]),
      handlers: {
        listProducts: () => products,
        writeProduct: (tag, content) => {
          products.push({ tag, content });
        },
        deleteProduct: () => false,
        readTag: (tag) => tags.get(tag),
        writeTag: (tag, content) => {
          tags.set(tag, content);
        },
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(seen[1]).toContain("产物 tag：设计.氛围");
    expect(seen[1]).toContain("产物 tag：设计.旁白");
    expect(products.map((item) => item.tag).sort()).toEqual(["设计.旁白", "设计.氛围"]);
    expect(products.find((item) => item.tag === "设计.氛围")?.content).toBe("细雨连绵");
    expect(result.reply).not.toContain("未给出");
  });

  it("asks for self_score dimensions before a write can land", async () => {
    const scored: DictateModuleReadPayload = {
      ...modulePayload,
      score_dimensions: ["短句"],
    };
    const products: Array<{ tag: string; content: string }> = [];
    const tags = new Map<string, string>();
    const seen: string[] = [];
    const result = await runDictateTurn({
      llm: {
        async complete() {
          throw new Error("对话落盘走工具，不走纯文本完成");
        },
        async completeWithTools(messages) {
          seen.push(messages.map((message) => message.content ?? "").join("\n"));
          const body =
            seen.length === 1
              ? { nodes: [{ module_id: "mood" }] }
              : { products: [{ tag: "设计.氛围", content: "细雨" }], reply: "已落盘" };
          return {
            content: null,
            toolCalls: toToolCalls(body, seen.length === 1),
            usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
          };
        },
      },
      dialogue: [{ role: "user", text: "写成细雨" }],
      moduleCatalog: catalog,
      moduleReadIndex: new Map([["mood", scored]]),
      handlers: {
        listProducts: () => products,
        writeProduct: (tag, content) => {
          products.push({ tag, content });
        },
        deleteProduct: () => false,
        readTag: (tag) => tags.get(tag),
        writeTag: (tag, content) => {
          tags.set(tag, content);
        },
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(seen[1]).toContain("self_score 维度（这次写入必填，name 必须一致）：短句");
    expect(seen[2]?.startsWith(seen[1] ?? "")).toBe(true);
    expect(seen[2]).toContain("还有未通过");
    expect(products).toHaveLength(0);
    expect(result.reply).toContain("self_score 必填");
    expect(result.reply).toContain("短句");
    expect(result.reply).not.toContain("未给出");
  });

  it("keeps the node table and refuses to rewrite a tag that already passed", async () => {
    const narration: DictateModuleReadPayload = {
      ...modulePayload,
      module_id: "narration",
      name: "旁白",
      artifact: "设计.旁白",
      task: "写旁白",
      score_dimensions: ["一句"],
    };
    const writes: string[] = [];
    const tags = new Map<string, string>();
    const seen: string[] = [];
    const rounds = [
      [{ id: "select", name: "select_nodes", arguments: JSON.stringify({ nodes: [{ module_id: "mood" }, { module_id: "narration" }] }) }],
      [
        { id: "a", name: "insert", arguments: JSON.stringify({ position: "设计.氛围", content: "细雨" }) },
        { id: "b", name: "insert", arguments: JSON.stringify({ position: "设计.旁白", content: "旁白" }) },
        { id: "r1", name: "reply_user", arguments: JSON.stringify({ text: "都写了" }) },
      ],
      [
        { id: "a2", name: "insert", arguments: JSON.stringify({ position: "设计.氛围", content: "改掉细雨" }) },
        {
          id: "b2",
          name: "insert",
          arguments: JSON.stringify({
            position: "设计.旁白",
            content: "旁白",
            self_score: { dims: [{ name: "一句", score: 4 }] },
          }),
        },
      ],
      [{ id: "r2", name: "reply_user", arguments: JSON.stringify({ text: "旁白补上了" }) }],
    ];
    let index = 0;
    await runDictateTurn({
      llm: {
        async complete() {
          throw new Error("对话落盘走工具，不走纯文本完成");
        },
        async completeWithTools(messages) {
          seen.push(messages.map((message) => message.content ?? "").join("\n"));
          return {
            content: null,
            toolCalls: rounds[index++] ?? [],
            usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
          };
        },
      },
      dialogue: [{ role: "user", text: "写成细雨" }],
      moduleCatalog: {
        modules: [
          ...catalog.modules,
          { id: "narration", name: "旁白", artifact: "设计.旁白", declaration: "旁白" },
        ],
      } as ModuleCatalog,
      moduleReadIndex: new Map([
        ["mood", modulePayload],
        ["narration", narration],
      ]),
      handlers: {
        listProducts: () => [],
        writeProduct: (tag, content) => {
          writes.push(`${tag}:${content}`);
        },
        deleteProduct: () => false,
        readTag: (tag) => tags.get(tag),
        writeTag: (tag, content) => {
          tags.set(tag, content);
        },
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(seen[2]?.startsWith(seen[1] ?? "")).toBe(true);
    expect(seen[2]).toContain("写旁白");
    expect(writes).toEqual(["设计.氛围:细雨", "设计.旁白:旁白"]);
  });

  it("puts reply_user guidance early in the fill prompt and does not mention a fallback reply step", async () => {
    const seen: string[] = [];
    const products: Array<{ tag: string; content: string }> = [];
    const rounds = [
      [{ id: "select", name: "select_nodes", arguments: JSON.stringify({ nodes: [{ module_id: "mood" }] }) }],
      [
        { id: "a", name: "insert", arguments: JSON.stringify({ position: "设计.氛围", content: "细雨" }) },
        { id: "r", name: "reply_user", arguments: JSON.stringify({ text: "细雨留下了" }) },
      ],
    ];
    let index = 0;
    const tags = new Map<string, string>();
    await runDictateTurn({
      llm: {
        async complete() {
          throw new Error("对话落盘走工具，不走纯文本完成");
        },
        async completeWithTools(messages) {
          seen.push(messages.map((message) => message.content ?? "").join("\n"));
          return {
            content: null,
            toolCalls: rounds[index++] ?? [],
            usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
          };
        },
      },
      dialogue: [{ role: "user", text: "写成细雨" }],
      moduleCatalog: catalog,
      moduleReadIndex: new Map([["mood", modulePayload]]),
      handlers: {
        listProducts: () => products,
        writeProduct: (tag, content) => {
          products.push({ tag, content });
        },
        deleteProduct: () => false,
        readTag: (tag) => tags.get(tag),
        writeTag: (tag, content) => {
          tags.set(tag, content);
        },
        deleteTag: () => false,
        clearDialogue: () => undefined,
      },
    });

    expect(seen).toHaveLength(2);
    const fill = seen[1] ?? "";
    expect(fill.indexOf("填写收尾")).toBeLessThan(fill.indexOf("写入规则"));
    expect(fill.indexOf("本步收尾")).toBeLessThan(fill.indexOf("更早的对话"));
    expect(fill.indexOf("同一次请求必须调用 reply_user")).toBeLessThan(fill.indexOf("写氛围"));
    expect(fill).toContain("分数一般或还有更好写法的缺口");
    expect(fill).toContain("下一步可以提及哪些");
    expect(fill).not.toContain("本轮刚落盘");
    expect(fill).not.toContain("你只生成给用户看的综合回复");
  });

  it("silently asks for reply_user with only this round's products when fill omitted it", async () => {
    const products: Array<{ tag: string; content: string }> = [
      { tag: "设计.舞台", content: "旧舞台不应进入回复请求" },
    ];
    const seen: string[] = [];
    const choices: Array<unknown> = [];
    let index = 0;
    const tags = new Map<string, string>();
    const result = await runDictateTurn({
      llm: {
        async complete() {
          throw new Error("对话落盘走工具，不走纯文本完成");
        },
        async completeWithTools(messages, options) {
          seen.push(messages.map((message) => message.content ?? "").join("\n"));
          choices.push(options?.toolChoice);
          const step = index++;
          if (step === 0) {
            return {
              content: null,
              toolCalls: [
                {
                  id: "select",
                  name: "select_nodes",
                  arguments: JSON.stringify({ nodes: [{ module_id: "mood" }] }),
                },
              ],
              usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
            };
          }
          if (step === 1) {
            return {
              content: "细雨留下了，接下来可以定主角怎么进城。",
              toolCalls: [
                {
                  id: "a",
                  name: "insert",
                  arguments: JSON.stringify({
                    position: "设计.氛围",
                    content: "细雨",
                    self_score: {
                      dims: [{ name: "短句", score: 3, gap: "还缺进城方式", options: ["步行", "马车"] }],
                    },
                  }),
                },
              ],
              usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
            };
          }
          return {
            content: null,
            toolCalls: [
              {
                id: "r",
                name: "reply_user",
                arguments: JSON.stringify({ text: "细雨已落盘，接下来可以定进城方式。" }),
              },
            ],
            usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
          };
        },
      },
      dialogue: [{ role: "user", text: "写成细雨" }],
      moduleCatalog: catalog,
      moduleReadIndex: new Map([
        ["mood", { ...modulePayload, score_dimensions: ["短句"] }],
      ]),
      handlers: {
        listProducts: () => products,
        writeProduct: (tag, content, _order, metadata) => {
          products.push({
            tag,
            content,
            ...(metadata?.selfScore ? { selfScore: metadata.selfScore } : {}),
          });
        },
        deleteProduct: () => false,
        readTag: (tag) => tags.get(tag),
        writeTag: (tag, content) => {
          tags.set(tag, content);
        },
        deleteTag: () => false,
        clearDialogue: () => undefined,
        lookupInsertFeedback: (tag) =>
          tag === "设计.氛围"
            ? `# 本轮关注 · 氛围\n\n## 写入用户回复时做什么\n1. 自然回应\n3. 结合 self_score 说明最强处与关键缺口\n\n## 自评关注\n- 短句`
            : undefined,
      },
    });

    expect(result.reply).toBe("细雨已落盘，接下来可以定进城方式。");
    expect(result.iterations).toBe(3);
    expect(seen).toHaveLength(3);
    const replyReq = seen[2] ?? "";
    expect(replyReq).toContain("本轮刚落盘");
    expect(replyReq).toContain("细雨");
    expect(replyReq).toContain("self_score");
    expect(replyReq).toContain("还缺进城方式");
    expect(replyReq).toContain("本轮关注");
    expect(replyReq).toContain("结合 self_score 说明最强处与关键缺口");
    expect(replyReq).toContain("每个缺口写三样");
    expect(replyReq).toContain("2～3 个可以接着说的选项");
    expect(replyReq).not.toContain("旧舞台不应进入回复请求");
    expect(replyReq).not.toContain("#### task");
    expect(choices[2]).toEqual({ type: "function", function: { name: "reply_user" } });
  });
});
