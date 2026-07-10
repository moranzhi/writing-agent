import type { LlmProvider } from "../llm/client.js";
import type { IntakeFieldDef } from "../types/intake.js";
import { extractIntakeHeuristic } from "./intake.js";

export async function extractIntakeFromMessage(
  text: string,
  fields: IntakeFieldDef[],
  current: Record<string, string>,
  llm?: LlmProvider,
): Promise<Record<string, string>> {
  if (!text.trim()) return { ...current };
  if (llm) {
    try {
      return await extractWithLlm(text, fields, current, llm);
    } catch {
      /* fallback */
    }
  }
  return extractIntakeHeuristic(text, fields, current);
}

async function extractWithLlm(
  text: string,
  fields: IntakeFieldDef[],
  current: Record<string, string>,
  llm: LlmProvider,
): Promise<Record<string, string>> {
  const fieldList = fields.map((f) => ({
    id: f.id,
    label: f.label,
    required: f.required,
    current: current[f.id] ?? null,
  }));

  const result = await llm.complete(
    [
      {
        role: "system",
        content: `你是信息抽取助手。根据用户最新消息，更新「填空题」各字段的值。
规则：
1. 只输出 JSON：{ "updates": { "<fieldId>": "<完整字段值或 null>" } }
2. 仅更新用户本条消息明确提到或能推断的字段；未提及的字段不要出现在 updates 中
3. 若某字段已有 current 值且用户是在补充，合并新旧内容
4. 不要臆造用户未说的细节
5. 「角色」须能识别出至少 2 个参与者或其倾向；「进程」包含轮次、局数或终止条件（如破产）`,
      },
      {
        role: "user",
        content: JSON.stringify(
          { fields: fieldList, userMessage: text },
          null,
          2,
        ),
      },
    ],
    { responseFormat: "json_object", caller: "intake_extract" },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    return extractIntakeHeuristic(text, fields, current);
  }

  const updates = (parsed as { updates?: Record<string, unknown> }).updates;
  if (!updates || typeof updates !== "object") {
    return extractIntakeHeuristic(text, fields, current);
  }

  const next = { ...current };
  for (const field of fields) {
    const val = updates[field.id];
    if (val === null || val === undefined) continue;
    if (typeof val !== "string" || !val.trim()) continue;
    const merged = next[field.id]?.trim()
      ? `${next[field.id].trim()}\n${val.trim()}`
      : val.trim();
    next[field.id] = merged;
  }

  if (Object.keys(updates).length === 0) {
    return extractIntakeHeuristic(text, fields, current);
  }
  return next;
}
