import type { ChatMessage } from "../llm/client.js";
import {
  effectiveDictateOrder,
  sortDictateProducts,
  type DictateChatTurn,
  type DictateProduct,
} from "./types.js";

export type DictateContextPhase = "select" | "fill" | "reply";

/** 五段字数，只给用量统计，不另存正文。 */
export type DictateSegmentChars = {
  rules: number;
  history: number;
  products: number;
  injected: number;
  tail: number;
};

export type DictateBuiltContext = {
  messages: ChatMessage[];
  segmentChars: DictateSegmentChars;
};

/**
 * 创作请求的块顺序：固定规则、更早的对话、全部产物、本轮注入、末尾。
 * 选题不带产物正文和本轮注入。回复步只带本轮刚落盘产物与末句用户话。
 * 更早对话只追加，最后一轮用户输入放在末尾。
 */
export function buildDictateContext(params: {
  systemPrompt: string;
  products: DictateProduct[];
  dialogue: DictateChatTurn[];
  phase?: DictateContextPhase;
  injected?: string;
  tail?: string;
}): DictateBuiltContext {
  const phase = params.phase ?? "fill";
  if (phase === "reply") {
    return buildReplyContext(params);
  }
  const { earlier, lastUser } = splitEarlierDialogue(params.dialogue);
  const history = formatEarlierDialogue(earlier);
  const products =
    phase === "fill" ? formatProducts(sortDictateProducts(params.products)) : "";
  const injected = phase === "fill" ? params.injected?.trim() ?? "" : "";
  const tail = joinBlocks([params.tail?.trim() ?? "", lastUser ? `最后一轮用户输入\n${lastUser}` : ""]);

  const fillDuty =
    phase === "fill"
      ? "## 本步收尾\n\n写完本轮节点表后，同一次请求必须调用 reply_user。只 insert 不算完成。"
      : "";
  const sections = [
    fillDuty,
    history,
    products ? `## 当前产物（已写入黑板，按相对序；对话清空后仍保留）\n\n${products}` : "",
    injected
      ? `## 本轮注入\n\n写完下列节点后，同一次请求必须调用 reply_user。\n\n本轮节点表\n\n${injected}`
      : "",
    tail ? `## 本轮\n\n${tail}` : "",
  ].filter(Boolean);

  const user = sections.join("\n\n");
  return {
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: user },
    ],
    segmentChars: {
      rules: params.systemPrompt.length,
      history: history.length,
      products: products.length,
      injected: injected.length,
      tail: tail.length,
    },
  };
}

/** 回复兜底：只给本轮产物 + 末句，不带全黑板与节点规格。 */
function buildReplyContext(params: {
  systemPrompt: string;
  products: DictateProduct[];
  dialogue: DictateChatTurn[];
  tail?: string;
}): DictateBuiltContext {
  const { lastUser } = splitEarlierDialogue(params.dialogue);
  const products = formatRoundProducts(params.products);
  const tail = joinBlocks([
    params.tail?.trim() ?? "",
    lastUser ? `最后一轮用户输入\n${lastUser}` : "",
  ]);
  const sections = [
    products ? `## 本轮刚落盘\n\n${products}` : "## 本轮刚落盘\n\n（无正文产物；按删除与用户原话回复）",
    tail ? `## 本轮\n\n${tail}` : "",
  ].filter(Boolean);
  const user = sections.join("\n\n");
  return {
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: user },
    ],
    segmentChars: {
      rules: params.systemPrompt.length,
      history: 0,
      products: products.length,
      injected: 0,
      tail: tail.length,
    },
  };
}

function formatRoundProducts(products: DictateProduct[]): string {
  if (products.length === 0) return "";
  return sortDictateProducts(products)
    .map((product) => {
      const score = formatSelfScore(product);
      return [`### ${product.tag}`, score, product.content].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function formatSelfScore(product: DictateProduct): string {
  const dims = product.selfScore?.dims;
  if (!dims?.length) return "";
  const lines = dims.map((dim) => {
    const gap = dim.gap?.trim() ? `；缺口：${dim.gap.trim()}` : "";
    const options =
      dim.options?.length ? `；选项：${dim.options.map((item) => item.trim()).filter(Boolean).join(" / ")}` : "";
    return `- ${dim.name}：${dim.score}${gap}${options}`;
  });
  return `self_score：\n${lines.join("\n")}`;
}

export function buildDictateMessages(params: {
  systemPrompt: string;
  products: DictateProduct[];
  dialogue: DictateChatTurn[];
  phase?: DictateContextPhase;
  injected?: string;
  tail?: string;
}): ChatMessage[] {
  return buildDictateContext(params).messages;
}

/** 从会话消息里抽出转述式对话（用户输入 + 助手回复） */
export function extractDictateDialogue(
  messages: Array<{ role?: string; kind?: string; text?: string; body?: string }>,
): DictateChatTurn[] {
  const out: DictateChatTurn[] = [];
  for (const m of messages) {
    const text = (m.body ?? m.text ?? "").trim();
    if (!text) continue;
    if (m.role === "user" || m.kind === "user_input") {
      out.push({ role: "user", text });
      continue;
    }
    if (m.kind === "dictate_reply") {
      out.push({ role: "assistant", text });
    }
  }
  return out;
}

function splitEarlierDialogue(dialogue: DictateChatTurn[]): {
  earlier: DictateChatTurn[];
  lastUser: string;
} {
  const last = dialogue.at(-1);
  if (last?.role === "user") {
    return { earlier: dialogue.slice(0, -1), lastUser: last.text.trim() };
  }
  return { earlier: dialogue, lastUser: "" };
}

function formatEarlierDialogue(dialogue: DictateChatTurn[]): string {
  if (dialogue.length === 0) return "## 更早的对话\n\n（尚无更早对话）";
  const lines = dialogue.map((turn) => {
    const who = turn.role === "user" ? "用户" : "助手";
    return `【${who}】\n${turn.text}`;
  });
  return `## 更早的对话\n\n${lines.join("\n\n")}`;
}

function formatProducts(products: DictateProduct[]): string {
  if (products.length === 0) return "（尚无）";
  return products
    .map((product) => {
      const ord = effectiveDictateOrder(product);
      return `### ${product.tag} 〔order=${ord}〕\n${product.content}`;
    })
    .join("\n\n");
}

function joinBlocks(blocks: string[]): string {
  return blocks.map((block) => block.trim()).filter(Boolean).join("\n\n");
}
