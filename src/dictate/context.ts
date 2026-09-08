import type { ChatMessage } from "../llm/client.js";
import {
  effectiveDictateOrder,
  sortDictateProducts,
  type DictateChatTurn,
  type DictateProduct,
} from "./types.js";

/**
 * 拼给模型的上下文：系统提示 + 全部产物（按相对序）+ 全量对话。
 * 清空对话后，只剩产物块，产物即浓缩上下文。
 */
export function buildDictateMessages(params: {
  systemPrompt: string;
  products: DictateProduct[];
  dialogue: DictateChatTurn[];
}): ChatMessage[] {
  const parts: string[] = [];
  const products = sortDictateProducts(params.products);

  if (products.length > 0) {
    parts.push("## 当前产物（已写入黑板，按相对序；对话清空后仍保留）");
    for (const p of products) {
      const ord = effectiveDictateOrder(p);
      parts.push(`### ${p.tag} 〔order=${ord}〕\n${p.content}`);
    }
  } else {
    parts.push("## 当前产物\n（尚无）");
  }

  parts.push("## 对话（全量）");
  if (params.dialogue.length === 0) {
    parts.push("（尚无对话；等用户开口）");
  } else {
    for (const turn of params.dialogue) {
      const who = turn.role === "user" ? "用户" : "助手";
      parts.push(`【${who}】\n${turn.text}`);
    }
  }

  return [
    { role: "system", content: params.systemPrompt },
    { role: "user", content: parts.join("\n\n") },
  ];
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
