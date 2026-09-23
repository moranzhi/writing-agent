/**
 * 文风提取：对话 + 样本 → 可入库的「怎么写」草稿。
 */

import type { LlmProvider } from "../llm/client.js";
import { completeStructured } from "../llm/structured-complete.js";

export type StyleExtractMessage = {
  role: "user" | "assistant";
  content: string;
};

export type StyleExtractDraft = {
  name: string;
  content: string;
  ready: boolean;
};

export type StyleExtractResult = {
  reply: string;
  draft: StyleExtractDraft;
};

const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "name", "content", "ready"],
  properties: {
    reply: { type: "string" },
    name: { type: "string" },
    content: { type: "string" },
    ready: { type: "boolean" },
  },
} as const;

function buildSystemPrompt(params: {
  samples: string;
  draftName: string;
  draftContent: string;
}): string {
  const samples = params.samples.trim() || "（未贴样本）";
  const draft = params.draftContent.trim()
    ? `当前草稿名：${params.draftName.trim() || "（未命名）"}\n\n${params.draftContent.trim()}`
    : "（尚无草稿）";
  return `你正在帮用户从对话与样本中提取一份**跨卡可复用文风包**。

任务：只规定「怎么写」，不写世界观、剧情、角色设定、推进方式。产物供叙事指南等节点直接采用。

content 应覆盖（有则写、无则略）：
- 叙事纲领（体裁/调性一句话）
- 风格与遣词（原则 + 至少 1 段示范）
- 笔墨焦点（详写/略写）
- 禁忌与不偏好（绝对禁忌 ≠ 不偏好）
- 写法档（官能/爽文/恐怖/情色等；无切换则写「无切换」）
- 示例对话（若样本或用户给出）

规则：
1. reply：用人话简短回应；缺料时问 1～2 个具体点，可给选项。
2. name：短名（如「锋利爽文」「冷静官能」）；未成形可空串。
3. content：可执行正文（Markdown 小节即可）；禁止写本局剧情。
4. ready=true 仅当遣词+示范+禁忌已够入库；否则 false，继续追问。
5. 每轮都给出目前最好的 name/content（可增量改），不要清空已有好内容。

用户样本：
${samples}

当前草稿：
${draft}`;
}

function parseResult(parsed: unknown): StyleExtractResult {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      reply: "未能解析提取结果，请再试一次。",
      draft: { name: "", content: "", ready: false },
    };
  }
  const row = parsed as Record<string, unknown>;
  const reply =
    typeof row.reply === "string" && row.reply.trim()
      ? row.reply.trim()
      : "已记录。";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const content = typeof row.content === "string" ? row.content.trim() : "";
  const ready = row.ready === true && Boolean(name && content);
  return { reply, draft: { name, content, ready } };
}

export async function extractStylePackTurn(params: {
  llm: LlmProvider;
  messages: StyleExtractMessage[];
  samples?: string;
  draftName?: string;
  draftContent?: string;
}): Promise<StyleExtractResult> {
  const history = params.messages
    .filter((m) => m.content.trim())
    .slice(-16)
    .map((m) => ({
      role: m.role,
      content: m.content.trim(),
    }));
  if (!history.length) {
    throw new Error("请先说点对文风的要求，或贴一段样本");
  }

  const system = buildSystemPrompt({
    samples: params.samples ?? "",
    draftName: params.draftName ?? "",
    draftContent: params.draftContent ?? "",
  });

  const result = await completeStructured(
    params.llm,
    [{ role: "system", content: system }, ...history],
    {
      schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>,
      name: "style_pack_extract",
      schemaIsLoose: true,
      caller: "style_pack_extract",
    },
  );
  return parseResult(result.parsed);
}
