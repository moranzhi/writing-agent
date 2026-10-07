/**
 * 从「设计.正文组成」取出数据契约。
 * 开场与之后每一楼只填模型生成区；程序把这份 present.v1 灌进已固定的 frontend。
 */
import { extractJsonObjectText } from "./worker-set-parse.js";

export type ReplyContractBlock = {
  id: string;
  type: string;
  source: "model_generated" | "program_projection";
  role?: string;
};

export type ReplyFrontend = {
  html: string;
  css: string;
  js: string;
};

export type ReplyDataContract = {
  modelBlocks: ReplyContractBlock[];
  programBlocks: ReplyContractBlock[];
  frontend?: ReplyFrontend;
};

export function parseReplyDataContract(
  raw: string | undefined | null,
): ReplyDataContract | undefined {
  const doc = parseObject(raw);
  if (!doc) return undefined;
  const body = asObject(doc.正文) ?? doc;
  const contract = asObject(body.数据契约) ?? asObject(body.data_contract);
  const blocksRaw = asObject(contract?.blocks);
  if (!blocksRaw) return undefined;
  const modelBlocks: ReplyContractBlock[] = [];
  const programBlocks: ReplyContractBlock[] = [];
  for (const [id, value] of Object.entries(blocksRaw)) {
    const row = asObject(value);
    if (!id.trim() || !row) continue;
    const block: ReplyContractBlock = {
      id: id.trim(),
      type: asString(row.类型 ?? row.type) || "text",
      source:
        asString(row.来源 ?? row.source) === "program_projection"
          ? "program_projection"
          : "model_generated",
      role: asString(row.职责 ?? row.role),
    };
    if (block.source === "program_projection") programBlocks.push(block);
    else modelBlocks.push(block);
  }
  if (!modelBlocks.length && !programBlocks.length) return undefined;
  const frontend = parseFrontend(asObject(body.frontend));
  return {
    modelBlocks,
    programBlocks,
    ...(frontend ? { frontend } : {}),
  };
}

export function replyContractSummary(contract: ReplyDataContract): {
  schema: "present.v1";
  model_blocks: Array<{ id: string; type: string; role?: string }>;
  program_blocks: string[];
  rule: string;
} {
  return {
    schema: "present.v1",
    model_blocks: contract.modelBlocks.map((block) => ({
      id: block.id,
      type: block.type,
      ...(block.role ? { role: block.role } : {}),
    })),
    program_blocks: contract.programBlocks.map((block) => block.id),
    rule: "开场和之后每一轮只填写 model_blocks。程序把这份 present.v1 灌进已固定的 frontend，替换示例内容。不要重写 frontend，不要填写 program_blocks。",
  };
}

/** 开场 JSON 里所有 present.v1 的 blocks。缺模型区时返回错误，供 insert 拒绝。 */
export function openingContractError(
  content: string,
  contract: ReplyDataContract,
): string | undefined {
  if (!contract.modelBlocks.length) return undefined;
  const maps = collectPresentBlockMaps(content);
  const need = formatModelBlocks(contract);
  if (!maps.length) {
    return `有正文组成时，开场必须给出 present.v1，并填写模型生成区：${need}。程序投影区不要填写。`;
  }
  const missing = new Set<string>();
  for (const blocks of maps) {
    for (const block of contract.modelBlocks) {
      if (!Object.prototype.hasOwnProperty.call(blocks, block.id)) {
        missing.add(block.id);
      }
    }
  }
  if (!missing.size) return undefined;
  return `开场的 present.v1 未按正文组成填写模型生成区，缺少：${[...missing].join("、")}。需要：${need}。程序投影区不要填写。`;
}

export function presentSchemaFromContract(contract: ReplyDataContract): {
  schema: Record<string, unknown>;
  loose: boolean;
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  let loose = false;
  for (const block of contract.modelBlocks) {
    required.push(block.id);
    const built = schemaForBlock(block);
    properties[block.id] = built.schema;
    if (built.loose) loose = true;
  }
  return {
    loose,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["schema", "blocks"],
      properties: {
        schema: { type: "string", enum: ["present.v1"] },
        blocks: {
          type: "object",
          additionalProperties: false,
          required,
          properties,
        },
      },
    },
  };
}

export function contractOutputInstruction(contract: ReplyDataContract): string {
  const lines = contract.modelBlocks.map((block) => {
    const role = block.role ? `：${block.role}` : "";
    return `- ${block.id}（${typeHint(block.type)}）${role}`;
  });
  const projected = contract.programBlocks.map((block) => block.id);
  return `

---

## 运行时输出协议（按正文组成灌数）

本局前端已经固定。只输出一个 present.v1 对象，程序把它灌进正文组成，替换示例内容。
不要输出 HTML、CSS、JS，不要重写模板，不要再套 shell。

只填模型生成区：
${lines.join("\n")}
${projected.length ? `不要填写程序投影区：${projected.join("、")}。\n` : ""}list 用字符串数组，没有内容时给 []。markdown 与 text 用字符串。
不要写追问、askUser、自评或「可验收产物」。`;
}

function formatModelBlocks(contract: ReplyDataContract): string {
  return contract.modelBlocks
    .map((block) => `${block.id}（${typeHint(block.type)}）`)
    .join("、");
}

function typeHint(type: string): string {
  if (type === "list") return "字符串数组";
  if (type === "markdown" || type === "text") return "字符串";
  if (type === "kv" || type === "table" || type === "topology") return "对象";
  return type || "字符串";
}

function schemaForBlock(block: ReplyContractBlock): {
  schema: Record<string, unknown>;
  loose: boolean;
} {
  if (block.type === "list") {
    return {
      loose: false,
      schema: { type: "array", items: { type: "string" } },
    };
  }
  if (block.type === "markdown" || block.type === "text") {
    return { loose: false, schema: { type: "string" } };
  }
  return {
    loose: true,
    schema: { type: "object", additionalProperties: true },
  };
}

function collectPresentBlockMaps(content: string): Array<Record<string, unknown>> {
  const doc = parseObject(content);
  if (!doc) return [];
  const maps: Array<Record<string, unknown>> = [];
  walk(doc, maps, 0);
  return maps;
}

function walk(node: unknown, maps: Array<Record<string, unknown>>, depth: number): void {
  if (depth > 8 || node == null) return;
  if (typeof node === "string") {
    if (!node.includes("present.v1")) return;
    const parsed = parseObject(node);
    if (parsed) walk(parsed, maps, depth + 1);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walk(item, maps, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const row = node as Record<string, unknown>;
  const blocks = asObject(row.blocks);
  if ((row.schema === "present.v1" || row.shell != null) && blocks) {
    maps.push(blocks);
  }
  for (const value of Object.values(row)) walk(value, maps, depth + 1);
}

function parseFrontend(raw: Record<string, unknown> | undefined): ReplyFrontend | undefined {
  if (!raw) return undefined;
  const html = asString(raw.html);
  if (!html || !/<\w+/.test(html)) return undefined;
  return {
    html,
    css: asString(raw.css) ?? "",
    js: asString(raw.js) ?? "",
  };
}

function parseObject(raw: string | undefined | null): Record<string, unknown> | undefined {
  const text = raw?.trim() ?? "";
  if (!text) return undefined;
  const jsonText = extractJsonObjectText(text) ?? (text.startsWith("{") ? text : null);
  if (!jsonText) return undefined;
  try {
    const doc = JSON.parse(jsonText) as unknown;
    return asObject(doc);
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
}
