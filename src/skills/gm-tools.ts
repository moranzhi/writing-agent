/**
 * 主世界层 harness 可用工具（游玩期）。
 * 仅挂载「本轮裁决缺了就没法写」的程序能力；转述/旁观/调度不在此列。
 */
import type { ToolDefinition } from "../llm/client.js";
import {
  executeChanceBatch,
  parseChanceBatchRequest,
  type ChanceBatchResult,
} from "./chance-tools.js";

export const GM_CHANCE_TOOL_NAME = "chance" as const;

export const GM_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: GM_CHANCE_TOOL_NAME,
      description:
        "批量程序随机：掷骰、比点、抽签/加权抽取。需要多个随机时必须在 requests 数组中一次性全部提交；禁止口算或编造随机结果。",
      parameters: {
        type: "object",
        properties: {
          requests: {
            type: "array",
            description:
              "本步所需的全部随机请求；每项必须有唯一 id，供后续 settlement 引用",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "本批内唯一标识，如 attack-roll、loot-pick",
                },
                op: {
                  type: "string",
                  enum: ["roll", "compare", "draw", "pick"],
                },
                expression: {
                  type: "string",
                  description: "roll 时：如 1d20、2d6+3",
                },
                left: { type: "number", description: "compare 时：左值" },
                right: { type: "number", description: "compare 时：右值" },
                mode: {
                  type: "string",
                  enum: ["gt", "gte", "lt", "lte", "eq"],
                },
                pool: {
                  type: "array",
                  items: { type: "string" },
                  description: "draw 时：候选池",
                },
                count: { type: "number" },
                unique: { type: "boolean" },
                items: {
                  type: "array",
                  description: "pick 时：{ id, weight? }[]",
                },
                reason: { type: "string" },
              },
              required: ["id", "op"],
            },
          },
        },
        required: ["requests"],
        additionalProperties: false,
      },
    },
  },
];

export function executeGmChanceTool(argumentsJson: string): ChanceBatchResult {
  let args: unknown;
  try {
    args = JSON.parse(argumentsJson || "{}");
  } catch {
    return {
      schema: "chance.batch.v1",
      ok: false,
      results: [],
      summary: "机遇失败：工具参数不是合法 JSON",
    };
  }
  const items = parseChanceBatchRequest(args);
  if (!items?.length) {
    return {
      schema: "chance.batch.v1",
      ok: false,
      results: [],
      summary: "机遇失败：requests 须为非空数组，且每项含 id 与 op",
    };
  }
  return executeChanceBatch(items);
}

export function handleGmToolCall(
  name: string,
  argumentsJson: string,
): string | null {
  if (name !== GM_CHANCE_TOOL_NAME) return null;
  return JSON.stringify(executeGmChanceTool(argumentsJson), null, 2);
}

/** 游玩拓扑 play_slots.chance：启用主世界层机遇工具 harness */
export function gmChanceToolsEnabled(
  playSlots: { chance?: boolean } | undefined,
): boolean {
  if (!playSlots) return true;
  return playSlots.chance !== false;
}

export const GM_CHANCE_HARNESS_INSTRUCTION = `

## 机遇工具（游玩期）
需要真随机（掷骰/比点/抽签/加权抽取）时：调用工具 \`chance\`，在 \`requests\` 数组中**一次性**列出本步全部随机需求（每项必须有唯一 \`id\`）。
禁止口算或编造随机结果。收到工具结果后，再在 settlement 的 \`resolved\` 等处引用对应 \`id\` 写出后果。
无随机需求时：直接输出 settlement.v1 JSON，不要调用工具。
`;
