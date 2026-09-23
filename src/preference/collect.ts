/**
 * 游玩期偏好采集：隔 N 个用户回合，从近窗对话抽出可复用跨局偏好候选。
 * 不改本局「设计.用户约束」；候选须经审核卡才写入全局库。
 */

import { randomUUID } from "node:crypto";
import type { LlmProvider } from "../llm/client.js";
import { completeStructured } from "../llm/structured-complete.js";
import { listActivePreferences } from "./store.js";

export type PreferenceCandidate = {
  id: string;
  content: string;
};

const COLLECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["content"],
        properties: {
          content: { type: "string" },
        },
      },
    },
  },
} as const;

function buildCollectPrompt(params: {
  recentDialogue: string;
  existing: string[];
}): string {
  const existingBlock = params.existing.length
    ? params.existing.map((c, i) => `${i + 1}. ${c}`).join("\n")
    : "（库空）";
  return `你正在从游玩对话中采集用户的**跨局偏好**候选。

任务：读近窗对话，判断用户是否表达了可复用的喜好/禁区/节奏/写法纠偏。有则写入 candidates；没有则 candidates 为空数组。

规则：
1. 只收跨局可复用约束，不收本局剧情指令（如「这章让她出门」）。
2. 每条写成可执行做法，带替代行为；禁止只写「不要 xxx」。
3. 与已有条目近义则不要再提。
4. 一次最多 2 条；拿不准就 0 条。
5. 力度偏「默认避开」；只有用户说死了才写成绝对禁止。

已有偏好：
${existingBlock}

近窗对话：
${params.recentDialogue}`;
}

function parseCandidates(parsed: unknown): PreferenceCandidate[] {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const raw = (parsed as { candidates?: unknown }).candidates;
  if (!Array.isArray(raw)) return [];
  const out: PreferenceCandidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const content = String(
      (item as { content?: unknown }).content ?? "",
    ).trim();
    if (!content) continue;
    out.push({ id: randomUUID(), content });
    if (out.length >= 2) break;
  }
  return out;
}

/**
 * 调用 LLM 产出候选；失败或空则返回 []。
 */
export async function collectPreferenceCandidates(params: {
  llm: LlmProvider;
  recentDialogue: string;
}): Promise<PreferenceCandidate[]> {
  const dialogue = params.recentDialogue.trim();
  if (!dialogue) return [];
  const existing = listActivePreferences().map((e) => e.content);
  try {
    const result = await completeStructured(
      params.llm,
      [
        {
          role: "user",
          content: buildCollectPrompt({
            recentDialogue: dialogue,
            existing,
          }),
        },
      ],
      {
        schema: COLLECT_SCHEMA as unknown as Record<string, unknown>,
        name: "preference_candidates",
        schemaIsLoose: true,
        caller: "preference_collect",
      },
    );
    return parseCandidates(result.parsed);
  } catch {
    return [];
  }
}

/** 从会话消息拼近窗（用户 + 助手可见文），供采集 */
export function formatRecentDialogueForCollect(
  messages: Array<{ role: string; text?: string; body?: string }>,
  limit = 12,
): string {
  const slice = messages.slice(-limit);
  const lines: string[] = [];
  for (const m of slice) {
    const role = m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : m.role;
    const text = (m.body ?? m.text ?? "").trim();
    if (!text) continue;
    // 跳过系统调度句
    if (/^\[(总管|阶段机|游玩|创作|对话落盘)/.test(text)) continue;
    lines.push(`${role}：${text.slice(0, 800)}`);
  }
  return lines.join("\n\n");
}
